import { EMBED } from "../../config.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import logger from "../../logger.js";
import { handleStatusButton } from './interface/status.js';
import { handleHelpButton } from './interface/help.js';
import { handlePauseButton } from './interface/pause.js';

// Handle button interactions
export async function handleButtonInteraction(interaction, client) {
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

// Create interface embed and buttons
export function createInterfaceEmbed() {
    const interfaceEmbed = {
        color: EMBED.COLOR,
        title: "🤖 GOBLOX Bot Interface",
        description: "Use the buttons below to interact with the bot:",
        fields: [
            {
                name: "📊 Status",
                value: "Check bot status and uptime",
                inline: true
            },
            {
                name: "❓ Help",
                value: "Show available commands",
                inline: true
            },
            {
                name: "⏸️ Pause/Resume",
                value: "Pause or resume the bot",
                inline: true
            }
        ],
        footer: {
            text: "GOBLOX Bot System • Use buttons to interact"
        },
        timestamp: new Date().toISOString()
    };

    return interfaceEmbed;
}

// Create interface buttons
export function createInterfaceButtons() {
    const statusButton = new ButtonBuilder()
        .setCustomId('bot_status')
        .setLabel('📊 Status')
        .setStyle(ButtonStyle.Primary);

    const helpButton = new ButtonBuilder()
        .setCustomId('bot_help')
        .setLabel('❓ Help')
        .setStyle(ButtonStyle.Secondary);

    const pauseButton = new ButtonBuilder()
        .setCustomId('bot_pause')
        .setLabel('⏸️ Pause/Resume')
        .setStyle(ButtonStyle.Danger);

    // Create action row with buttons
    const buttonRow = new ActionRowBuilder()
        .addComponents(statusButton, helpButton, pauseButton);

    return buttonRow;
}

// Send interface to channel
export async function sendInterfaceToChannel(targetChannel, interaction) {
    try {
        const interfaceEmbed = createInterfaceEmbed();
        const buttonRow = createInterfaceButtons();

        // Send the interface to the target channel
        await targetChannel.send({
            embeds: [interfaceEmbed],
            components: [buttonRow]
        });

        await interaction.reply({
            content: `✅ Bot interface sent to ${targetChannel}!`,
            ephemeral: true
        });

        await logger.log(`🎮 Bot interface sent to ${targetChannel.name} by ${interaction.user.tag} (${interaction.user.id})`);

    } catch (error) {
        await interaction.reply({
            content: `❌ Failed to send interface: ${error.message}`,
            ephemeral: true
        });
        await logger.log(`❌ Interface send failed: ${error.message}`);
    }
}

// Initialize interface component
function init(client) {
    // Listen for button interactions
    client.on('interactionCreate', async (interaction) => {
        if (interaction.isButton()) {
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
    
    logger.log("🎮 Interface component initialized");
}

export default {
    init,
    handleButtonInteraction,
    createInterfaceEmbed,
    createInterfaceButtons,
    sendInterfaceToChannel
};
