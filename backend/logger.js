import { formatTimestamp } from "./utils.js";
import db from "../database/database.js";
import { getBotConfig } from "./config.js";

async function log(text) {
    const timestamp = formatTimestamp(Date.now(), true);
    const formattedText = `[${timestamp}] ${text}`;

    try {
        const botConfig = getBotConfig();
        if (!botConfig || !botConfig.id) {
            console.log(formattedText);
            return;
        }

        const botId = botConfig.id;

        try {
            await db.insertBotLog(botId, text);
        } catch (error) {
            console.log(formattedText);
            console.error('Failed to store log in database:', error.message);
        }
    } catch (error) {
        console.log(formattedText);
        console.error('Logger error:', error.message);
    }
}

function init(client) {
    void client;
}

export default {
    init,
    log
};
