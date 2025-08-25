import fs from "fs";
import { FORWARDER } from "./config.js";
import logger from "./logger.js";
import { delay } from "./utils.js";

let forwarded = {};
if (fs.existsSync(FORWARDER.FILES.JSON)) {
    forwarded = JSON.parse(fs.readFileSync(FORWARDER.FILES.JSON, "utf8"));
}

function saveForwarded() {
    fs.writeFileSync(FORWARDER.FILES.JSON, JSON.stringify(forwarded, null, 2));
}

async function forwardMessage(message, channelConfig, client) {
    const { group, type, fetchHistory } = channelConfig;

    if (fetchHistory && forwarded[message.id]) return;

    if (FORWARDER.EXCLUDED_USERS.includes(message.author.id)) {
        await logger.log(`⏭️ Skipped forwarding message ${message.id} from excluded user ${message.author.tag} (${message.author.id})`);
        return;
    }

    const targetChannelId = FORWARDER.TARGET_CHANNELS[group][type];
    const roleMention = FORWARDER.ROLE_MENTIONS[group];
    const targetChannel = client.channels.cache.get(targetChannelId);

    if (!targetChannel) return;

    try {
        await message.forward(targetChannel);
        await targetChannel.send(roleMention);

        if (fetchHistory) {
            forwarded[message.id] = true;
            saveForwarded();
        }

        await logger.log(`✅ Forwarded ${message.id} from ${group} (${type})`);
    } catch (err) {
        await logger.log(`❌ Failed to forward ${message.id}: ${err.message}`);
    }
}

async function fetchHistoricalMessages(client) {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    for (const [channelId, config] of Object.entries(FORWARDER.SOURCE_CHANNELS)) {
        if (!config.fetchHistory) continue;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.messages) continue;

        try {
            let lastId;
            let allMessages = [];

            while (true) {
                const options = { limit: 100 };
                if (lastId) options.before = lastId;

                const messages = await channel.messages.fetch(options);
                if (!messages.size) break;

                for (const msg of messages.values()) {
                    if (msg.createdTimestamp < sevenDaysAgo) break;
                    if (!forwarded[msg.id]) {
                        allMessages.push(msg);
                    }
                }

                const oldest = messages.last();
                if (!oldest || oldest.createdTimestamp < sevenDaysAgo) break;
                lastId = oldest.id;
            }

            allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

            for (const msg of allMessages) {
                await forwardMessage(msg, config, client);
                await delay(5000);
            }

            await logger.log(`✅ Historical forward done for ${config.group} (${config.type}) - ${allMessages.length} messages`);
        } catch (err) {
            await logger.log(`❌ Error fetching for ${config.group} (${config.type}): ${err.message}`);
        }
    }
}

function init(client) {
    client.on("messageCreate", async (message) => {
        const channelConfig = FORWARDER.SOURCE_CHANNELS[message.channel.id];
        if (!channelConfig) return;

        await forwardMessage(message, channelConfig, client);
    });

    fetchHistoricalMessages(client);
}

export default { init };
