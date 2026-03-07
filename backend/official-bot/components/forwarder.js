import { FORWARDER, getEmbedConfig } from "../../config.js";
import logger from "../../logger.js";

/** Extract unique custom emoji refs from text: { name, id, animated }. */
function extractCustomEmojis(text) {
    const str = text != null ? String(text) : '';
    if (!str) return [];
    const seen = new Set();
    const out = [];
    const patternSpecs = [
        ['<:([^:]+):(\\d+)>', false],
        ['<a:([^:]+):(\\d+)>', true]
    ];
    for (const [pattern, animated] of patternSpecs) {
        const regex = new RegExp(pattern, 'g');
        let m;
        while ((m = regex.exec(str)) !== null) {
            const name = m[1];
            const id = m[2];
            if (typeof name !== 'string' || typeof id !== 'string') continue;
            const trimmedName = name.trim();
            if (!trimmedName || seen.has(id)) continue;
            seen.add(id);
            out.push({ name: trimmedName, id, animated });
        }
    }
    return out;
}

/**
 * Download emoji image from CDN. Returns Buffer or null.
 */
async function downloadEmojiBuffer(emojiId, ext, log) {
    const cdnUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}`;
    try {
        const res = await fetch(cdnUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
    } catch (err) {
        if (log) await log(`⚠️ Forwarder: could not download emoji ${emojiId}: ${err.message}`);
        return null;
    }
}

function findEmojiByName(cache, name) {
    const n = String(name).trim();
    if (!n) return null;
    return cache.find(e => String(e.name || '').trim() === n) || null;
}

function isAppEmojiLimitError(err) {
    const msg = (err?.message || '').toLowerCase();
    return msg.includes('maximum number of emojis') || msg.includes('emojis reached') || msg.includes('2000');
}

/** Discord app emoji names: ≥2 chars, alphanumeric + underscores only. */
function sanitizeAppEmojiName(name) {
    const s = String(name).trim().replace(/[^a-zA-Z0-9_]/g, '_');
    if (s.length >= 2) return s;
    return 'e_' + String(name || '').replace(/\D/g, '').slice(-6) || 'emoji';
}

/**
 * Ensure each emoji exists on the application (by name). Reuse if same name; only create when missing. Up to 2,000 app emojis; no per-server limit.
 * Returns { sourceToTarget: Map }. Bot token must have application emoji scope.
 */
async function ensureEmojisOnApplication(client, emojiRefs, log) {
    const sourceToTarget = new Map();
    if (!emojiRefs.length) return { sourceToTarget };
    const app = client.application;
    if (!app?.emojis) {
        if (log) await log('⚠️ Forwarder: application emojis not available (client.application.emojis missing)');
        return { sourceToTarget };
    }
    await app.emojis.fetch();
    let cache = app.emojis.cache;
    for (const ref of emojiRefs) {
        let name = ref.name != null ? String(ref.name).trim() : '';
        if (!name && ref.id) name = String(ref.id);
        if (!name) continue;
        name = sanitizeAppEmojiName(name);
        const refId = ref.id != null ? String(ref.id) : '';
        if (!refId) continue;
        let existingEmoji = findEmojiByName(cache, name);
        if (existingEmoji) {
            sourceToTarget.set(refId, existingEmoji.id);
            continue;
        }
        await app.emojis.fetch();
        cache = app.emojis.cache;
        existingEmoji = findEmojiByName(cache, name);
        if (existingEmoji) {
            sourceToTarget.set(refId, existingEmoji.id);
            continue;
        }
        const ext = ref.animated ? 'gif' : 'png';
        const buffer = await downloadEmojiBuffer(refId, ext, log);
        if (!buffer) continue;
        let created = null;
        try {
            created = await app.emojis.create({ attachment: buffer, name });
        } catch (err) {
            if (isAppEmojiLimitError(err) && cache.size > 0) {
                const toRemove = cache.first();
                try {
                    await toRemove.delete();
                    await app.emojis.fetch();
                    cache = app.emojis.cache;
                    created = await app.emojis.create({ attachment: buffer, name });
                } catch (retryErr) {
                    if (log) await log(`⚠️ Forwarder: could not add application emoji :${name}: (${retryErr.message})`);
                }
            } else {
                if (log) await log(`⚠️ Forwarder: could not add application emoji :${name}: (${err.message})`);
            }
        }
        if (created) {
            sourceToTarget.set(refId, created.id);
            cache = app.emojis.cache;
        }
    }
    return { sourceToTarget };
}

/** Replace custom emoji IDs in text so they point to target server or application emojis. */
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
        const pairs = allTexts.flatMap(t => extractCustomEmojis(t).map(e => [e.id, e])).filter(([id, r]) => id && r && typeof r.name === 'string' && r.name.length > 0);
        const emojiRefs = [...new Map(pairs).values()];
        const { sourceToTarget: sourceIdToTargetId } = await ensureEmojisOnApplication(client, emojiRefs, logger.log.bind(logger));

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
