import { FORWARDER, getEmbedConfig } from "../../config.js";
import logger from "../../logger.js";

const CUSTOM_EMOJI_STATIC = /<:([^:]+):(\d+)>/g;
const CUSTOM_EMOJI_ANIMATED = /<a:([^:]+):(\d+)>/g;

/** Extract unique custom emoji refs from text: { name, id, animated } */
function extractCustomEmojis(text) {
    if (!text) return [];
    const seen = new Set();
    const out = [];
    for (const g of [CUSTOM_EMOJI_STATIC, CUSTOM_EMOJI_ANIMATED]) {
        g.lastIndex = 0;
        let m;
        while ((m = g.exec(text)) !== null) {
            const name = m[1];
            const id = m[2];
            if (!name || !id || seen.has(id)) continue;
            const trimmedName = String(name).trim();
            if (!trimmedName) continue;
            seen.add(id);
            out.push({ name: trimmedName, id, animated: g === CUSTOM_EMOJI_ANIMATED });
        }
    }
    return out;
}

/**
 * Ensure each emoji exists on the target guild (by name). If not, download from CDN and create.
 * Returns { sourceToTarget: Map, createdIds: string[] } so we can delete created emojis after send.
 * Bot needs Manage Guild Expressions on the target server.
 */
async function ensureEmojisOnGuild(guild, emojiRefs, log) {
    const sourceToTarget = new Map();
    const createdIds = [];
    if (!emojiRefs.length) return { sourceToTarget, createdIds };

    const existing = guild.emojis.cache;
    for (const ref of emojiRefs) {
        const name = ref.name != null ? String(ref.name).trim() : '';
        if (!name) continue;
        const existingEmoji = existing.find(e => e.name === name);
        if (existingEmoji) {
            sourceToTarget.set(ref.id, existingEmoji.id);
            continue;
        }
        const ext = ref.animated ? 'gif' : 'png';
        const cdnUrl = `https://cdn.discordapp.com/emojis/${ref.id}.${ext}`;
        try {
            const created = await guild.emojis.create({ attachment: cdnUrl, name });
            sourceToTarget.set(ref.id, created.id);
            createdIds.push(created.id);
            if (log) await log(`📥 Forwarder: added emoji :${name}: to this server`);
        } catch (err) {
            if (log) await log(`⚠️ Forwarder: could not add emoji :${name}: (${err.message})`);
        }
    }
    return { sourceToTarget, createdIds };
}

/** Replace custom emoji IDs in text so they point to target server emojis. */
function replaceEmojiIdsInText(text, sourceIdToTargetId) {
    if (!text || sourceIdToTargetId.size === 0) return text;
    return text
        .replace(/<:([^:]+):(\d+)>/g, (_, name, id) => {
            const target = sourceIdToTargetId.get(id);
            return target ? `<:${name}:${target}>` : `<:${name}:${id}>`;
        })
        .replace(/<a:([^:]+):(\d+)>/g, (_, name, id) => {
            const target = sourceIdToTargetId.get(id);
            return target ? `<a:${name}:${target}>` : `<a:${name}:${id}>`;
        });
}

function cleanMessageContent(text) {
    if (!text) return text;

    let cleaned = text.replace(/@unknown-role/g, '');
    return cleaned;
}

/** Remove Discord user/role mention tags so embed text is clean. Keeps message.content mentions for notifications. Preserves newlines so format is not broken. */
function stripMentionsFromText(text) {
    if (!text) return text;
    let stripped = text
        .replace(/<@!?\d+>/g, '')   // user mentions <@123> or <@!123>
        .replace(/<@&\d+>/g, '');   // role mentions <@&123>
    stripped = stripped
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .join('\n')
        .trim();
    return stripped;
}

export async function processMessageFromSelfBot(messageData, client) {

    const sourceChannelId = messageData.channel?.id;
    const sourceGuildId = messageData.guild?.id;

    if (!sourceChannelId || !sourceGuildId) {
        await logger.log(`❌ Source channel ID or guild ID not provided in message data`);
        return;
    }


    let forwarderConfig;
    try {
        forwarderConfig = await FORWARDER.getForwarderConfigBySourceChannel(sourceChannelId, sourceGuildId);
    } catch (err) {
        await logger.log(`❌ Error finding forwarder config for source channel ${sourceChannelId}: ${err.message}`);
        return;
    }

    if (!forwarderConfig) {
        await logger.log(`⚠️ No forwarder config found for channel ${sourceChannelId} in guild ${sourceGuildId}`);
        return;
    }

    const targetChannelId = forwarderConfig.target_channel_id;
    const targetGuildId = forwarderConfig.target_guild_id;
    const roles = forwarderConfig.roles;
    const onlyForwardWhenMentionsMember = forwarderConfig.only_forward_when_mentions_member === true;

    const targetChannel = client.channels.cache.get(targetChannelId);

    if (!targetChannel) {
        await logger.log(`❌ Target channel not found: ${targetChannelId}`);
        return;
    }

    let mentionedMainMembers = [];
    if (onlyForwardWhenMentionsMember) {
        const mentionedUserIds = messageData.mentioned_user_ids || [];
        if (mentionedUserIds.length === 0) {
            return;
        }
        const mainGuild = targetChannel.guild;
        if (!mainGuild?.members) {
            return;
        }
        const checkMember = (userId) =>
            Promise.resolve(mainGuild.members.cache.get(userId)).then(cached =>
                cached ?? mainGuild.members.fetch(userId).catch(() => null)
            );
        const resolved = await Promise.all(mentionedUserIds.map(checkMember));
        mentionedMainMembers = resolved.filter(m => m !== null);
        if (mentionedMainMembers.length === 0) {
            return;
        }
    }

    try {
        const targetGuild = targetChannel.guild;

        const embedConfig = await getEmbedConfig(targetGuildId);

        const allTexts = [messageData.content || ''];
        if (messageData.embeds?.length) {
            for (const emb of messageData.embeds) {
                if (emb.description) allTexts.push(emb.description);
                if (emb.title) allTexts.push(emb.title);
                if (emb.fields?.length) for (const f of emb.fields) {
                    if (f.name) allTexts.push(f.name);
                    if (f.value) allTexts.push(f.value);
                }
            }
        }
        const emojiRefs = [...new Map(allTexts.flatMap(t => extractCustomEmojis(t).map(e => [e.id, e])).values())];
        const { sourceToTarget: sourceIdToTargetId, createdIds: createdEmojiIds } = await ensureEmojisOnGuild(targetGuild, emojiRefs, logger.log.bind(logger));

        const applyEmojiReplace = (text) => replaceEmojiIdsInText(text, sourceIdToTargetId);

        let embeds = [];

        const messageEmbed = {
            color: embedConfig.COLOR,
            title: `Message from ${messageData.channel.name}`,
            author: {
                name: messageData.author.displayName || `${messageData.author.username}#${messageData.author.discriminator}`,
                icon_url: messageData.author.avatar ?
                    `https://cdn.discordapp.com/avatars/${messageData.author.id}/${messageData.author.avatar}.png` :
                    `https://cdn.discordapp.com/embed/avatars/${parseInt(messageData.author.discriminator) % 5}.png`
            },
            timestamp: new Date(messageData.createdTimestamp).toISOString(),
            footer: {
                text: embedConfig.FOOTER
            }
        };

        let cleanContent = applyEmojiReplace(messageData.content || '');
        cleanContent = cleanMessageContent(cleanContent);
        if (onlyForwardWhenMentionsMember && cleanContent) {
            cleanContent = stripMentionsFromText(cleanContent);
        }
        if (cleanContent && cleanContent.trim()) {
            messageEmbed.description = cleanContent;
        }

        if (messageData.attachments && messageData.attachments.length > 0) {
            const firstAttachment = messageData.attachments[0];

            messageEmbed.image = {
                url: firstAttachment.url
            };

            if (messageData.attachments.length > 1) {
                messageEmbed.fields = messageEmbed.fields || [];
                messageEmbed.fields.push({
                    name: "Additional Attachments",
                    value: messageData.attachments.slice(1).map(att => `[${att.name}](${att.url})`).join('\n'),
                    inline: false
                });
            }
        }

        embeds.push(messageEmbed);

        if (messageData.embeds && messageData.embeds.length > 0) {
            const cleanForEmbed = (t) => {
                if (!t) return t;
                let out = applyEmojiReplace(t);
                out = cleanMessageContent(out);
                if (onlyForwardWhenMentionsMember && out) out = stripMentionsFromText(out);
                return out;
            };

            messageData.embeds.forEach(embed => {

                const originalEmbed = { ...embed };

                if (originalEmbed.description) {
                    originalEmbed.description = cleanForEmbed(originalEmbed.description);
                }

                if (originalEmbed.title) {
                    originalEmbed.title = cleanForEmbed(originalEmbed.title);
                }

                if (originalEmbed.fields && originalEmbed.fields.length > 0) {
                    originalEmbed.fields = originalEmbed.fields.map(field => ({
                        ...field,
                        name: cleanForEmbed(field.name),
                        value: cleanForEmbed(field.value)
                    }));
                }

                embeds.push(originalEmbed);
            });
        }

        const contentParts = [];
        if (roles && Array.isArray(roles) && roles.length > 0) {
            contentParts.push(roles.map(role => `<@&${role.role_id}>`).join(' '));
        }
        if (mentionedMainMembers.length > 0) {
            contentParts.push(mentionedMainMembers.map(m => `<@${m.id}>`).join(' '));
        }
        const messageOptions = {
            embeds: embeds
        };
        if (contentParts.length > 0) {
            messageOptions.content = contentParts.join(' ');
        }

        await targetChannel.send(messageOptions);

        for (const emojiId of createdEmojiIds) {
            try {
                await targetGuild.emojis.delete(emojiId);
            } catch (err) {
                await logger.log(`⚠️ Forwarder: could not remove temporary emoji ${emojiId}: ${err.message}`);
            }
        }

        await logger.log(`✅ Forwarded ${messageData.id} from source channel ${sourceChannelId}`);
    } catch (err) {
        await logger.log(`❌ Failed to forward ${messageData.id}: ${err.message}`);
        throw err;
    }
}


function init() {
    logger.log("📡 Using webhook communication");
}

export default { init };
