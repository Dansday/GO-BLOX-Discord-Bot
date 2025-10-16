import { FORWARDER, EMBED } from "../../config.js";
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
    const { group, type } = messageData.forwarderConfig;

    const targetChannelId = FORWARDER.TARGET_CHANNELS[group][type];
    const roleMention = FORWARDER.ROLE_MENTIONS[group];
    const targetChannel = client.channels.cache.get(targetChannelId);

    if (!targetChannel) {
        await logger.log(`❌ Target channel not found for ${group} (${type}): ${targetChannelId}`);
        return;
    }

    try {
        let embeds = [];

        // Always create our own embed for the message content first
        const messageEmbed = {
            color: EMBED.COLOR,
            title: `Message from ${messageData.channel.name}`,
            author: {
                name: messageData.author.displayName || `${messageData.author.username}#${messageData.author.discriminator}`,
                icon_url: messageData.author.avatar ?
                    `https://cdn.discordapp.com/avatars/${messageData.author.id}/${messageData.author.avatar}.png` :
                    `https://cdn.discordapp.com/embed/avatars/${parseInt(messageData.author.discriminator) % 5}.png`
            },
            timestamp: new Date(messageData.createdTimestamp).toISOString(),
            footer: {
                text: `Server: ${messageData.guild.name}`
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

        // Add role mention to message content if available
        if (roleMention) {
            messageOptions.content = roleMention;
        }

        await targetChannel.send(messageOptions);

        await logger.log(`✅ Forwarded ${messageData.id} from ${group} (${type})`);
    } catch (err) {
        await logger.log(`❌ Failed to forward ${messageData.id}: ${err.message}`);
        throw err; // Re-throw to indicate failure
    }
}


function init() {
    logger.log("📡 Using webhook communication");
}

export default { init };
