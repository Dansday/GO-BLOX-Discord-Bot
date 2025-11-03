import { Client, GatewayIntentBits } from "discord.js";
import { OFFICIAL_BOT_TOKEN } from "../config.js";
import logger from "../logger.js";

// Use BOT_TOKEN from environment if provided (for control panel), otherwise use config
const BOT_TOKEN = process.env.BOT_TOKEN || OFFICIAL_BOT_TOKEN;
import forwarder from "./components/forwarder.js";
import welcomer from "./components/welcomer.js";
import booster from "./components/booster.js";
import moderation from "./components/moderation.js";
import webhook from "./components/webhook.js";
import commands from "./components/commands.js";
import interfaceComponent from "./components/interface.js";
import customSupporterRole from "./components/interface/customsupporterrole.js";
import afk from "./components/interface/afk.js";
import sync from "./components/sync.js";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates
    ]
});

client.on("clientReady", async () => {
    console.log(`Official bot logged in as ${client.user.tag}`);

    // Deploy slash commands (don't clear first on startup)
    await commands.deployCommands(false);

    logger.init(client);
    forwarder.init();
    welcomer.init(client);
    booster.init(client);
    moderation.init(client);
    commands.init(client);
    interfaceComponent.init(client);
    customSupporterRole.init(client);
    afk.init(client);

    // Initialize sync BEFORE other components to ensure bot info syncs
    await sync.init(client, BOT_TOKEN); // Sync channels and roles to database

    // Start webhook server
    webhook.startWebhookServer(client);
});

// Handle graceful shutdown
process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down official bot...");
    sync.stop();
    webhook.stopWebhookServer();
    client.destroy();
    process.exit(0);
});

client.login(BOT_TOKEN);
