import { FORWARDER, COMMUNICATION } from "../../config.js";
import logger from "../../logger.js";

async function sendToOfficialBot(messageData) {
    try {
        const response = await fetch(COMMUNICATION.WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Goblox-SelfBot/1.0.0',
                'X-Secret-Key': COMMUNICATION.SECRET_KEY
            },
            body: JSON.stringify({
                type: 'message_forward',
                data: messageData,
                timestamp: Date.now()
            })
        });

        if (!response.ok) {
            throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
        }

        await logger.log(`📤 Sent message ${messageData.id} to official bot via webhook (${response.status})`);
    } catch (err) {
        await logger.log(`❌ Failed to send message ${messageData.id} to official bot: ${err.message}`);
    }
}

async function processMessage(message, channelConfig) {
    const { group, type } = channelConfig;

    if (FORWARDER.EXCLUDED_USERS.includes(message.author.id)) {
        await logger.log(`⏭️ Skipped processing message ${message.id} from excluded user ${message.author.tag} (${message.author.id})`);
        return;
    }

    // Prepare message data for official bot
    const messageData = {
        id: message.id,
        content: message.content,
        author: {
            id: message.author.id,
            username: message.author.username,
            displayName: message.author.displayName,
            discriminator: message.author.discriminator,
            avatar: message.author.avatar,
            bot: message.author.bot
        },
        channel: {
            id: message.channel.id,
            name: message.channel.name
        },
        guild: {
            id: message.guild?.id,
            name: message.guild?.name
        },
        createdTimestamp: message.createdTimestamp,
        editedTimestamp: message.editedTimestamp,
        attachments: message.attachments.map(att => ({
            id: att.id,
            name: att.name,
            url: att.url,
            size: att.size,
            contentType: att.contentType
        })),
        embeds: message.embeds,
        forwarderConfig: {
            group,
            type
        },
        timestamp: Date.now()
    };

    try {
        await sendToOfficialBot(messageData);
        await logger.log(`✅ Processed ${message.id} from ${group} (${type})`);
    } catch (err) {
        await logger.log(`❌ Failed to process ${message.id}: ${err.message}`);
        throw err; // Re-throw to indicate failure
    }
}

function init(client) {
    client.on("messageCreate", async (message) => {
        const channelConfig = FORWARDER.SOURCE_CHANNELS[message.channel.id];
        if (!channelConfig) return;

        await processMessage(message, channelConfig);
    });
}

export default { init };
