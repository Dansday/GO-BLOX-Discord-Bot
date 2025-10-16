import { REST, Routes } from 'discord.js';
import { OFFICIAL_BOT_TOKEN, OFFICIAL_BOT_APPLICATION_ID, EMBED } from "../../config.js";
import logger from "../../logger.js";

// Import all commands directly
import { commandDefinition as pauseCommand, execute as pauseExecute } from './commands/admin/pause.js';
import { commandDefinition as interfaceCommand, execute as interfaceExecute } from './commands/admin/interface.js';
import { commandDefinition as helpCommand, execute as helpExecute } from './commands/user/help.js';
import { commandDefinition as statusCommand, execute as statusExecute } from './commands/user/status.js';

// Define all slash commands in one place
const commandDefinitions = [
    helpCommand,
    statusCommand,
    pauseCommand,
    interfaceCommand,
];

// Slash command registry
const slashCommands = new Map();

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
    // Check if bot is paused (except for pause command only)
    if (client.isPaused && interaction.commandName !== 'pause') {
        await interaction.reply({
            content: '⏸️ Bot is currently paused. Use `/pause` to resume.',
            ephemeral: true
        });
        return { success: true, reason: 'paused' }; // Command was handled (bot is paused)
    }

    const command = slashCommands.get(interaction.commandName);
    if (!command) {
        return { success: false, reason: 'unknown_command' };
    }

    try {
        await command.execute(interaction, client);
        return { success: true, reason: 'executed' };
    } catch (error) {
        await logger.log(`❌ Error executing slash command ${interaction.commandName}: ${error.message}`);
        return { success: false, reason: 'execution_error', error: error.message };
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

// Handle button interactions
async function handleButtonInteraction(interaction, client) {
    const { customId } = interaction;

    // Check if bot is paused (except for pause button)
    if (client.isPaused && customId !== 'bot_pause') {
        await interaction.reply({
            content: '⏸️ Bot is currently paused. Use the Pause/Resume button to resume.',
            ephemeral: true
        });
        return;
    }

    switch (customId) {
        case 'bot_status':
            await handleStatusButton(interaction);
            break;
        case 'bot_help':
            await handleHelpButton(interaction);
            break;
        case 'bot_pause':
            await handlePauseButton(interaction, client);
            break;
        default:
            await interaction.reply({
                content: '❌ Unknown button interaction.',
                ephemeral: true
            });
    }
}

// Handle status button
async function handleStatusButton(interaction) {
    const statusEmbed = {
        color: EMBED.COLOR,
        title: "📊 Bot Status",
        fields: [
            {
                name: "🟢 Bot Status",
                value: "🟢 Online",
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
                value: "✅ All commands available",
                inline: false
            }
        ],
        timestamp: new Date().toISOString()
    };

    await interaction.reply({
        embeds: [statusEmbed],
        ephemeral: true
    });
}

// Handle help button
async function handleHelpButton(interaction) {
    const availableCommands = getSlashCommands();
    const commandList = availableCommands.map(cmd => `\`/${cmd}\``).join(', ');

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
                value: "Use `/command` to execute a slash command, or use the buttons above for quick access",
                inline: false
            }
        ],
        timestamp: new Date().toISOString()
    };

    await interaction.reply({
        embeds: [helpEmbed],
        ephemeral: true
    });
}

// Handle pause button
async function handlePauseButton(interaction, client) {
    // Check if user has permission
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ You need Administrator permissions to use this button.',
            ephemeral: true
        });
        return;
    }

    // Toggle pause state
    client.isPaused = !client.isPaused;

    if (client.isPaused) {
        await interaction.reply({
            content: '⏸️ Bot has been **paused**. All commands are now unavailable except the Pause/Resume button.',
            ephemeral: true
        });
        await logger.log(`⏸️ Bot paused by ${interaction.user.tag} (${interaction.user.id}) via button`);
    } else {
        await interaction.reply({
            content: '▶️ Bot has been **resumed**. All commands are now available.',
            ephemeral: true
        });
        await logger.log(`▶️ Bot resumed by ${interaction.user.tag} (${interaction.user.id}) via button`);
    }
}

// Initialize the slash command system
function init(client) {
    // Add client properties for command system
    client.isPaused = false; // Initialize pause state
    client.commandDefinitions = commandDefinitions; // Store command definitions for reload

    // Register default slash commands
    registerSlashCommand('help', { execute: helpExecute });
    registerSlashCommand('status', { execute: statusExecute });
    registerSlashCommand('pause', { execute: pauseExecute });
    registerSlashCommand('interface', { execute: interfaceExecute });

    // Listen for slash command interactions
    client.on('interactionCreate', async (interaction) => {
        if (interaction.isChatInputCommand()) {
            // Handle slash commands

        try {
            // Execute slash command and get detailed result
            const result = await executeSlashCommand(interaction, client);

            // Handle different failure scenarios with specific feedback
            if (!result.success) {
                let errorMessage;

                switch (result.reason) {
                    case 'unknown_command':
                        errorMessage = `❌ **Unknown Command**: \`/${interaction.commandName}\`\n\n` +
                            `This command doesn't exist. Use \`/help\` to see available commands.`;
                        await logger.log(`❌ Unknown command attempted: /${interaction.commandName} by ${interaction.user.tag}`);
                        break;

                    case 'execution_error':
                        errorMessage = `❌ **Command Error**: \`/${interaction.commandName}\`\n\n` +
                            `The command failed to execute properly.\n` +
                            `**Error**: ${result.error}\n\n` +
                            `Please try again or contact an administrator if the issue persists.`;
                        await logger.log(`❌ Command execution error: /${interaction.commandName} by ${interaction.user.tag} - ${result.error}`);
                        break;

                    default:
                        errorMessage = `❌ **Unexpected Error**: \`/${interaction.commandName}\`\n\n` +
                            `An unexpected error occurred. Please try again.`;
                        await logger.log(`❌ Unexpected command error: /${interaction.commandName} by ${interaction.user.tag} - ${result.reason}`);
                }

                await interaction.reply({
                    content: errorMessage,
                    ephemeral: true
                });
            } else {
                // Log successful command execution (except for paused state)
                if (result.reason !== 'paused') {
                    await logger.log(`✅ Command executed: /${interaction.commandName} by ${interaction.user.tag}`);
                }
            }
        } catch (error) {
            // Handle any unexpected errors in the interaction handler itself
            await logger.log(`❌ Critical error in interaction handler: ${error.message}`);

            try {
                await interaction.reply({
                    content: `❌ **Critical Error**: An unexpected error occurred while processing your command.\n\n` +
                        `Please try again later or contact an administrator.`,
                    ephemeral: true
                });
            } catch (replyError) {
                await logger.log(`❌ Failed to send error response: ${replyError.message}`);
            }
        }
        // Note: Success cases are handled by individual command functions
        } else if (interaction.isButton()) {
            // Handle button interactions
            try {
                await handleButtonInteraction(interaction, client);
            } catch (error) {
                await logger.log(`❌ Button interaction error: ${error.message}`);
                
                try {
                    await interaction.reply({
                        content: `❌ **Button Error**: An error occurred while processing your button click.\n\nPlease try again or contact an administrator.`,
                        ephemeral: true
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send button error response: ${replyError.message}`);
                }
            }
        }
    });

    logger.log("🎮 Slash command system initialized");
}

export default { init, registerSlashCommand, getSlashCommands, deployCommands };
