import { LOGGER } from "./config.js";
import { formatTimestamp, delay } from "./utils.js";

let logChannel = null;
let lastLogTime = 0;
const MIN_DELAY = 5000;

async function log(text) {
    if (!logChannel) return;

    try {
        const now = Date.now();
        const timeSinceLastLog = now - lastLogTime;

        if (timeSinceLastLog < MIN_DELAY) {
            await delay(MIN_DELAY - timeSinceLastLog);
        }

        const timestamp = formatTimestamp(Date.now(), true);
        await logChannel.send(`[${timestamp}] ${text}`);
        lastLogTime = Date.now();
    } catch (err) {
        console.error("Failed to log to Discord:", err);
    }
}

function init(client) {
    logChannel = client.channels.cache.get(LOGGER.CHANNELS);
    if (!logChannel) {
        console.error("Log channel not found!");
    }
}

export default {
    init,
    log
};
