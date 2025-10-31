import { Client, GatewayIntentBits } from "discord.js";
import { OFFICIAL_BOT_TOKEN } from "../config.js";
import logger from "../logger.js";
import forwarder from "./components/forwarder.js";
import welcomer from "./components/welcomer.js";
import booster from "./components/booster.js";
import moderation from "./components/moderation.js";
import webhook from "./components/webhook.js";
import commands from "./components/commands.js";
import interfaceComponent from "./components/interface.js";
import customSupporterRole from "./components/interface/customsupporterrole.js";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
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

    // Start webhook server
    webhook.startWebhookServer(client);
});

// Handle graceful shutdown
process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down official bot...");
    webhook.stopWebhookServer();
    client.destroy();
    process.exit(0);
});

client.login(OFFICIAL_BOT_TOKEN);
