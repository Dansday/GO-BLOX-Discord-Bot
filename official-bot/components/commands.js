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

        await interaction.reply({ 
            content: '🔄 Reloading bot components and refreshing slash commands...',
            ephemeral: true
        });

        // Import and reinitialize components with cache-busting
        // Using timestamp query string to force Node.js to load fresh modules instead of cached versions
        const timestamp = Date.now();
        const { default: forwarder } = await import(`./forwarder.js?t=${timestamp}`);
        const { default: welcomer } = await import(`./welcomer.js?t=${timestamp}`);
        const { default: webhook } = await import(`./webhook.js?t=${timestamp}`);
        const { default: logger } = await import(`../../logger.js?t=${timestamp}`);

        // Reinitialize components
        forwarder.init(client);
        welcomer.init(client);
        logger.init(client);
        
        // Restart webhook server with error handling
        let webhookStopSuccess = false;
        let webhookStartSuccess = false;
        
        try {
            webhook.stopWebhookServer();
            webhookStopSuccess = true;
            await logger.log('🛑 Webhook server stopped successfully');
        } catch (webhookStopError) {
            await logger.log(`⚠️ Warning: Failed to stop webhook server: ${webhookStopError.message}`);
        }
        
        try {
            webhook.startWebhookServer(client);
            webhookStartSuccess = true;
            await logger.log('🚀 Webhook server started successfully');
        } catch (webhookStartError) {
            await logger.log(`❌ Error: Failed to start webhook server: ${webhookStartError.message}`);
            // Don't throw here - let the reload continue even if webhook fails
        }

        // Clear and re-register slash commands locally
        slashCommands.clear();
        registerSlashCommand('reload', { execute: reloadSlashCommand });
        registerSlashCommand('help', { execute: helpSlashCommand });
        registerSlashCommand('status', { execute: statusSlashCommand });
        registerSlashCommand('pause', { execute: pauseSlashCommand });

        // Redeploy slash commands to Discord (this will update/refresh them)
        // Don't clear first to avoid "Unknown Integration" issues
        await deployCommands(false);

        // Generate webhook status message based on success/failure
        let webhookStatus = '';
        if (webhookStopSuccess && webhookStartSuccess) {
            webhookStatus = ' Webhook server restarted successfully.';
        } else if (!webhookStopSuccess && !webhookStartSuccess) {
            webhookStatus = ' ⚠️ Webhook server restart failed - check logs.';
        } else if (!webhookStartSuccess) {
            webhookStatus = ' ⚠️ Webhook server failed to start - check logs.';
        } else {
            webhookStatus = ' ⚠️ Webhook server had issues stopping - check logs.';
        }

        await interaction.editReply({ 
            content: `✅ Bot components reloaded and slash commands refreshed successfully!${webhookStatus}`,
            ephemeral: true
        });
        await logger.log(`🔄 Bot reloaded and commands refreshed by ${interaction.user.tag} (${interaction.user.id})`);

    } catch (error) {
        await interaction.editReply({ 
            content: `❌ Failed to reload: ${error.message}`,
            ephemeral: true
        });
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

    await interaction.reply({ 
        embeds: [helpEmbed],
        ephemeral: true
    });
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

    await interaction.reply({ 
        embeds: [statusEmbed],
        ephemeral: true
    });
}

// Pause/Resume slash command - pauses or resumes the bot
async function pauseSlashCommand(interaction, client) {
    try {
        // Check if user has permission
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ 
                content: '❌ You need Administrator permissions to use this command.',
                ephemeral: true
            });
            return;
        }

        // Toggle pause state
        isPaused = !isPaused;

        if (isPaused) {
            await interaction.reply({ 
                content: '⏸️ Bot has been **paused**. All commands are now unavailable except `/pause`.',
                ephemeral: true
            });
            await logger.log(`⏸️ Bot paused by ${interaction.user.tag} (${interaction.user.id})`);
        } else {
            await interaction.reply({ 
                content: '▶️ Bot has been **resumed**. All commands are now available.',
                ephemeral: true
            });
            await logger.log(`▶️ Bot resumed by ${interaction.user.tag} (${interaction.user.id})`);
        }

    } catch (error) {
        await interaction.editReply({ 
            content: `❌ Failed to toggle pause state: ${error.message}`,
            ephemeral: true
        });
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
    });

    logger.log("🎮 Slash command system initialized");
}

export default { init, registerSlashCommand, getSlashCommands, deployCommands };
