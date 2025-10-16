import { REST, Routes } from 'discord.js';
import { EMBED, OFFICIAL_BOT_TOKEN, OFFICIAL_BOT_APPLICATION_ID } from "../../config.js";
import logger from "../../logger.js";

// Define all slash commands in one place
const commandDefinitions = [
    {
        name: 'reload',
        description: 'Reload all bot components (Admin only)',
    },
    {
        name: 'help',
        description: 'Show available slash commands',
    },
    {
        name: 'status',
        description: 'Show bot status and uptime',
    },
    {
        name: 'pause',
        description: 'Pause/Resume the bot (Admin only)',
    },
];

// Slash command registry
const slashCommands = new Map();

// Bot pause state
let isPaused = false;

// Register a slash command
function registerSlashCommand(name, command) {
    slashCommands.set(name, command);
}

// Get all registered slash commands
function getSlashCommands() {
    return Array.from(slashCommands.keys());
}

// Execute a slash command
async function executeSlashCommand(interaction, client) {
    // Check if bot is paused (except for pause and status commands)
    if (isPaused && interaction.commandName !== 'pause' && interaction.commandName !== 'status') {
        await interaction.reply({ 
            content: '⏸️ Bot is currently paused. Use `/pause` to resume.',
            flags: 64 // Ephemeral flag
        });
        return true; // Command was handled (bot is paused)
    }

    const command = slashCommands.get(interaction.commandName);
    if (!command) {
        return false;
    }

    try {
        await command.execute(interaction, client);
        return true;
    } catch (error) {
        await logger.log(`❌ Error executing slash command ${interaction.commandName}: ${error.message}`);
        return false;
    }
}

// Deploy commands to Discord
async function deployCommands(clearFirst = false) {
    const rest = new REST({ version: '10' }).setToken(OFFICIAL_BOT_TOKEN);

    try {
        console.log('🔄 Started refreshing application (/) commands.');

        // Only clear commands if explicitly requested
        if (clearFirst) {
            await rest.put(
                Routes.applicationCommands(OFFICIAL_BOT_APPLICATION_ID),
                { body: [] },
            );
            console.log('🧹 Cleared existing slash commands.');
            
            // Wait a moment for Discord to process the clear
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Register our commands
        await rest.put(
            Routes.applicationCommands(OFFICIAL_BOT_APPLICATION_ID),
            { body: commandDefinitions },
        );

        console.log('✅ Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
        throw error; // Re-throw so reload command can handle it
    }
}


// Reload slash command - reloads all bot components and redeploys commands
async function reloadSlashCommand(interaction, client) {
    try {
        // Check if user has permission
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({
                content: '❌ You need Administrator permissions to use this command.',
                ephemeral: true
            });
            return;
        }

        await interaction.reply('🔄 Reloading bot components and refreshing slash commands...');

        // Import and reinitialize components
        const { default: forwarder } = await import('./forwarder.js');
        const { default: welcomer } = await import('./welcomer.js');
        const { default: webhook } = await import('./webhook.js');

        // Reinitialize components
        forwarder.init(client);
        welcomer.init(client);

        // Restart webhook server
        webhook.stopWebhookServer();
        webhook.startWebhookServer(client);

        // Clear and re-register slash commands locally
        slashCommands.clear();
        registerSlashCommand('reload', { execute: reloadSlashCommand });
        registerSlashCommand('help', { execute: helpSlashCommand });
        registerSlashCommand('status', { execute: statusSlashCommand });
        registerSlashCommand('pause', { execute: pauseSlashCommand });

        // Redeploy slash commands to Discord (this will update/refresh them)
        // Don't clear first to avoid "Unknown Integration" issues
        await deployCommands(false);

        await interaction.editReply('✅ Bot components reloaded and slash commands refreshed successfully!');
        await logger.log(`🔄 Bot reloaded and commands refreshed by ${interaction.user.tag} (${interaction.user.id})`);

    } catch (error) {
        await interaction.editReply(`❌ Failed to reload: ${error.message}`);
        await logger.log(`❌ Reload failed: ${error.message}`);
    }
}

// Help slash command - shows available commands
async function helpSlashCommand(interaction, client) {
    const commandList = getSlashCommands().map(cmd => `\`/${cmd}\``).join(', ');

    const helpEmbed = {
        color: EMBED.COLOR,
        title: "🤖 GOBLOX Bot Slash Commands",
        description: "Available slash commands:",
        fields: [
            {
                name: "Commands",
                value: commandList || "No commands available",
                inline: false
            },
            {
                name: "Usage",
                value: "Use `/command` to execute a slash command",
                inline: false
            },
            {
                name: "Pause State",
                value: isPaused ? "⏸️ Bot is paused - only `/pause` and `/status` work" : "✅ All commands available",
                inline: false
            }
        ],
        timestamp: new Date().toISOString()
    };

    await interaction.reply({ embeds: [helpEmbed] });
}

// Status slash command - shows bot status
async function statusSlashCommand(interaction, client) {
    const statusEmbed = {
        color: isPaused ? 0xffaa00 : EMBED.COLOR, // Orange if paused, red if active
        title: isPaused ? "⏸️ Bot Status (PAUSED)" : "📊 Bot Status",
        fields: [
            {
                name: "🟢 Bot Status",
                value: isPaused ? "⏸️ Paused" : "🟢 Online",
                inline: true
            },
            {
                name: "⏰ Uptime",
                value: `${Math.floor(process.uptime())} seconds`,
                inline: true
            },
            {
                name: "📡 Webhook Server",
                value: "Active",
                inline: true
            },
            {
                name: "🔧 Components",
                value: "Forwarder, Welcomer, Slash Commands",
                inline: false
            },
            {
                name: "🎮 Commands",
                value: isPaused ? "⏸️ All commands paused (except /pause)" : "✅ All commands available",
                inline: false
            }
        ],
        timestamp: new Date().toISOString()
    };

    await interaction.reply({ embeds: [statusEmbed] });
}

// Pause/Resume slash command - pauses or resumes the bot
async function pauseSlashCommand(interaction, client) {
    try {
        // Check if user has permission
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ 
                content: '❌ You need Administrator permissions to use this command.',
                flags: 64 // Ephemeral flag
            });
            return;
        }

        // Toggle pause state
        isPaused = !isPaused;

        if (isPaused) {
            await interaction.reply('⏸️ Bot has been **paused**. All commands are now unavailable except `/pause`.');
            await logger.log(`⏸️ Bot paused by ${interaction.user.tag} (${interaction.user.id})`);
        } else {
            await interaction.reply('▶️ Bot has been **resumed**. All commands are now available.');
            await logger.log(`▶️ Bot resumed by ${interaction.user.tag} (${interaction.user.id})`);
        }

    } catch (error) {
        await interaction.editReply(`❌ Failed to toggle pause state: ${error.message}`);
        await logger.log(`❌ Pause toggle failed: ${error.message}`);
    }
}

// Initialize the slash command system
function init(client) {
    // Register default slash commands
    registerSlashCommand('reload', { execute: reloadSlashCommand });
    registerSlashCommand('help', { execute: helpSlashCommand });
    registerSlashCommand('status', { execute: statusSlashCommand });
    registerSlashCommand('pause', { execute: pauseSlashCommand });

    // Listen for slash command interactions
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        // Execute slash command
        const commandExecuted = await executeSlashCommand(interaction, client);

        if (!commandExecuted) {
            await interaction.reply({ 
                content: `❌ Unknown slash command: \`/${interaction.commandName}\`. Use \`/help\` to see available commands.`,
                flags: 64 // Ephemeral flag
            });
        }
    });

    logger.log("🎮 Slash command system initialized");
}

export default { init, registerSlashCommand, getSlashCommands, deployCommands };
