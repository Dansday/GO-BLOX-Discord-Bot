import { FORWARDER, getEmbedConfig } from "../../config.js";
import logger from "../../logger.js";

// Function to remove custom emojis and unknown roles from text
function cleanMessageContent(text) {
    if (!text) return text;

    // Remove <:name:id> format entirely (custom emojis)
    let cleaned = text.replace(/<:([^:]+):(\d+)>/g, '');

    // Remove @unknown-role mentions
    cleaned = cleaned.replace(/@unknown-role/g, '');

    return cleaned;
}

export async function processMessageFromSelfBot(messageData, client) {
    // Get source channel ID and guild ID from message data
    const sourceChannelId = messageData.channel?.id;
    const sourceGuildId = messageData.guild?.id;

    if (!sourceChannelId || !sourceGuildId) {
        await logger.log(`❌ Source channel ID or guild ID not provided in message data`);
        return;
    }

    // Find forwarder config by source channel and server
    // This checks all forwarder configs on official bot servers to find one that matches
    let forwarderConfig;
    try {
        forwarderConfig = await FORWARDER.getForwarderConfigBySourceChannel(sourceChannelId, sourceGuildId);
    } catch (err) {
        await logger.log(`❌ Error finding forwarder config for source channel ${sourceChannelId}: ${err.message}`, sourceGuildId);
        return;
    }

    // If no forwarder config found, skip forwarding (channel not configured)
    if (!forwarderConfig) {
        await logger.log(`⚠️ No forwarder config found for channel ${sourceChannelId} in guild ${sourceGuildId}`, sourceGuildId);
        return;
    }

    const targetChannelId = forwarderConfig.target_channel_id;
    const targetGuildId = forwarderConfig.target_guild_id;
    const roles = forwarderConfig.roles;

    const targetChannel = client.channels.cache.get(targetChannelId);

    if (!targetChannel) {
        await logger.log(`❌ Target channel not found: ${targetChannelId}`);
        return;
    }

    try {
        // Get embed config for the target channel's guild
        const embedConfig = await getEmbedConfig(targetGuildId);

        let embeds = [];

        // Always create our own embed for the message content first
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

        // Only add description if there's actual content
        const cleanContent = cleanMessageContent(messageData.content);
        if (cleanContent && cleanContent.trim()) {
            messageEmbed.description = cleanContent;
        }

        // Handle attachments - display all attachments directly
        if (messageData.attachments && messageData.attachments.length > 0) {
            const firstAttachment = messageData.attachments[0];

            // Display the first attachment directly in the embed
            messageEmbed.image = {
                url: firstAttachment.url
            };

            // Add additional attachments as fields if there are more than one
            if (messageData.attachments.length > 1) {
                messageEmbed.fields = [{
                    name: "Additional Attachments",
                    value: messageData.attachments.slice(1).map(att => `[${att.name}](${att.url})`).join('\n'),
                    inline: false
                }];
            }
        }

        // Add our message embed first
        embeds.push(messageEmbed);

        // If the original message has embeds, add them after our message embed
        if (messageData.embeds && messageData.embeds.length > 0) {
            // Forward the original embeds with source info
            messageData.embeds.forEach(embed => {
                // Preserve the original embed structure but convert custom emojis to CDN URLs
                const originalEmbed = { ...embed };

                // Clean embed content (remove custom emojis and unknown roles)
                if (originalEmbed.description) {
                    originalEmbed.description = cleanMessageContent(originalEmbed.description);
                }

                if (originalEmbed.title) {
                    originalEmbed.title = cleanMessageContent(originalEmbed.title);
                }

                if (originalEmbed.fields && originalEmbed.fields.length > 0) {
                    originalEmbed.fields = originalEmbed.fields.map(field => ({
                        ...field,
                        name: cleanMessageContent(field.name),
                        value: cleanMessageContent(field.value)
                    }));
                }

                embeds.push(originalEmbed);
            });
        }

        // Send the message with role mention in content
        const messageOptions = {
            embeds: embeds
        };

        // Add role mentions to message content if available
        if (roles && Array.isArray(roles) && roles.length > 0) {
            const roleMentions = roles.map(role => `<@&${role.role_id}>`).join(' ');
            messageOptions.content = roleMentions;
        }

        await targetChannel.send(messageOptions);

        await logger.log(`✅ Forwarded ${messageData.id} from source channel ${sourceChannelId}`);
    } catch (err) {
        await logger.log(`❌ Failed to forward ${messageData.id}: ${err.message}`);
        throw err; // Re-throw to indicate failure
    }
}


function init() {
    logger.log("📡 Using webhook communication");
}

export default { init };
