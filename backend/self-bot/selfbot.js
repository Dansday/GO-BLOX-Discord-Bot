import { Client } from "discord.js-selfbot-v13";
import { getBotToken, initializeConfig } from "../config.js";
import logger from "../logger.js";
import forwarder from "./components/forwarder.js";
import sync from "./components/sync.js";

let BOT_TOKEN;
(async () => {
    await initializeConfig();
    BOT_TOKEN = getBotToken('selfbot');
})().catch(err => {
    console.error('Failed to initialize config:', err);
    process.exit(1);
});
const BOT_ID = process.env.BOT_ID;

const client = new Client();

client.on("ready", async () => {
    console.log(`Self-bot logged in as ${client.user.tag}`);

    if (!BOT_TOKEN) {
        await initializeConfig();
        BOT_TOKEN = getBotToken('selfbot');
    }
    
    if (!BOT_TOKEN) {
        throw new Error('Bot token not available. Cannot proceed.');
    }

    await sync.init(client, BOT_ID);
    
    logger.init(client);
    forwarder.init(client);
});

function shutdown() {
    console.log("\n🛑 Shutting down self-bot...");
    client.destroy();
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

(async () => {
    if (!BOT_TOKEN) {
        await initializeConfig();
        BOT_TOKEN = getBotToken('selfbot');
    }
    
    if (!BOT_TOKEN) {
        throw new Error('Bot token not available. Cannot login.');
    }
    
    await client.login(BOT_TOKEN);
})().catch(err => {
    console.error('Failed to login:', err);
    process.exit(1);
});
