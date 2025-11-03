import { REST, Routes } from 'discord.js';
import { getBotToken, getApplicationId } from "../../config.js";
import logger from "../../logger.js";

// Import setup command
import { commandDefinition as setupCommand, execute as setupExecute } from './commands/admin/setup.js';


// Define all slash commands in one place
const commandDefinitions = [
    setupCommand,
];

// Slash command registry
const slashCommands = new Map();

// Register a slash command
function registerSlashCommand(name, command) {
    slashCommands.set(name, command);
}

// Execute a slash command
async function executeSlashCommand(interaction, client) {
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
        const token = process.env.BOT_TOKEN || getBotToken('official');
        if (!token) {
            throw new Error('Bot token not available for command deployment.');
        }
        const rest = new REST({ version: '10' }).setToken(token);

    try {
        // Only clear commands if explicitly requested
        if (clearFirst) {
            await rest.put(
                Routes.applicationCommands(getApplicationId()),
                { body: [] },
            );
        }

        // Register our commands
        await rest.put(
            Routes.applicationCommands(getApplicationId()),
            { body: commandDefinitions },
        );
    } catch (error) {
        throw error; // Re-throw so reload command can handle it
    }
}

// Initialize the slash command system
function init(client) {
    // Register setup slash command
    registerSlashCommand('setup', { execute: setupExecute });

    // Listen for slash command interactions
    client.on('interactionCreate', async (interaction) => {
        if (interaction.isChatInputCommand()) {
            // Handle slash commands
            try {
                const user = interaction.user;
                const commandName = interaction.commandName;
                const options = interaction.options?.data || [];
                const optionsStr = options.map(opt => `${opt.name}:${opt.value}`).join(', ') || 'none';
                
                // Log command attempt
                await logger.log(`⌨️  Command triggered: /${commandName} ${optionsStr ? `(${optionsStr})` : ''} by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`);
                
                // Execute slash command and get detailed result
                const result = await executeSlashCommand(interaction, client);

                // Handle different failure scenarios with specific feedback
                if (!result.success) {
                    let errorMessage;

                    switch (result.reason) {
                        case 'unknown_command':
                            errorMessage = `❌ **Unknown Command**: \`/${interaction.commandName}\`\n\n` +
                                `This command doesn't exist. Only \`/setup\` is available.`;
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
                        flags: 64
                    });
                } else {
                    // Log successful command execution
                    await logger.log(`✅ Command executed successfully: /${commandName} by ${user.tag} (${user.id})`);
                }
            } catch (error) {
                // Handle any unexpected errors in the interaction handler itself
                await logger.log(`❌ Critical error in interaction handler: ${error.message}`);

                try {
                    await interaction.reply({
                        content: `❌ **Critical Error**: An unexpected error occurred while processing your command.\n\n` +
                            `Please try again later or contact an administrator.`,
                        flags: 64
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send error response: ${replyError.message}`);
                }
            }
        }
        // Note: Button interactions are handled by the interface component
    });

    logger.log("🎮 Slash command system initialized");
}

export default { init, deployCommands };
