import { Client } from "discord.js-selfbot-v13";
import { SELF_BOT_TOKEN } from "../config.js";
import logger from "../logger.js";
import forwarder from "./components/forwarder.js";
import sync from "./components/sync.js";

// Use BOT_TOKEN from environment if provided (for control panel), otherwise use config
const BOT_TOKEN = process.env.BOT_TOKEN || SELF_BOT_TOKEN;
const BOT_ID = process.env.BOT_ID;

const client = new Client();

client.on("ready", async () => {
    console.log(`Self-bot logged in as ${client.user.tag}`);

    // Initialize sync component to sync servers
    await sync.init(client, BOT_ID);

    logger.init(client);
    forwarder.init(client);
});

// Handle graceful shutdown
process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down self-bot...");
    sync.stop();
    client.destroy();
    process.exit(0);
});

client.login(BOT_TOKEN);
