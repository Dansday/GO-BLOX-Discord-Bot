import { FORWARDER, COMMUNICATION } from "../../config.js";
import logger from "../../logger.js";

async function sendToOfficialBot(messageData) {
    try {
        const response = await fetch(COMMUNICATION.WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'GO-BLOX-SelfBot/1.0.0',
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

async function processMessage(message) {
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
        // Source channel and guild info will be used by official bot to find forwarder config
        timestamp: Date.now()
    };

    try {
        await sendToOfficialBot(messageData);
        await logger.log(`✅ Forwarded message ${message.id} from channel ${message.channel.id} to official bot`);
    } catch (err) {
        await logger.log(`❌ Failed to forward message ${message.id}: ${err.message}`);
        throw err; // Re-throw to indicate failure
    }
}

function init(client) {
    client.on("messageCreate", async (message) => {
        // Skip DMs and messages without guild
        if (!message.guild) return;

        // Forward all messages to official bot (no filtering here)
        // Official bot will check forwarder configs to decide what to forward
        try {
            await processMessage(message);
        } catch (err) {
            // Log error
            await logger.log(`❌ Error forwarding message ${message.id}: ${err.message}`);
        }
    });
}

export default { init };
