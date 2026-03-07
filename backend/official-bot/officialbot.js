import { Client, GatewayIntentBits } from "discord.js";
import { getBotToken, initializeConfig } from "../config.js";
import logger from "../logger.js";

let BOT_TOKEN;
(async () => {
    await initializeConfig();
    BOT_TOKEN = getBotToken('official');
})().catch(err => {
    console.error('Failed to initialize config:', err);
    process.exit(1);
});
import forwarder from "./components/forwarder.js";
import welcomer from "./components/welcomer.js";
import booster from "./components/booster.js";
import moderation from "./components/moderation.js";
import webhook from "./components/webhook.js";
import commands from "./components/commands.js";
import interfaceComponent from "./components/interface.js";
import customSupporterRole from "./components/interface/customsupporterrole.js";
import afk from "./components/interface/afk.js";
import giveaway from "./components/interface/giveaway.js";
import staffReportRating from "./components/staffreportrating.js";
import sync from "./components/sync.js";
import leveling from "./components/leveling.js";

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

    if (!BOT_TOKEN) {
        await initializeConfig();
        BOT_TOKEN = getBotToken('official');
    }
    
    if (!BOT_TOKEN) {
        throw new Error('Bot token not available. Cannot proceed.');
    }

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
    giveaway.init(client);
    staffReportRating.init(client);
    leveling.init(client);

    await sync.init(client, BOT_TOKEN);
    webhook.startWebhookServer(client);
});

function shutdown() {
    console.log("\n🛑 Shutting down official bot...");
    webhook.stopWebhookServer();
    client.destroy();
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

(async () => {
    if (!BOT_TOKEN) {
        await initializeConfig();
        BOT_TOKEN = getBotToken('official');
    }
    
    if (!BOT_TOKEN) {
        throw new Error('Bot token not available. Cannot login.');
    }
    
    await client.login(BOT_TOKEN);
})().catch(err => {
    console.error('Failed to login:', err);
    process.exit(1);
});
