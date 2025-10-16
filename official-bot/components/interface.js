import { EMBED } from "../../config.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { replyWithAutoDelete } from "../../utils.js";
import logger from "../../logger.js";
import { handleStatusButton } from './interface/status.js';
import { handleHelpButton } from './interface/help.js';
import { handlePauseButton } from './interface/pause.js';
import { handleSendMessageButton, handleSendMessageModal, handleChannelSelection, handleRoleSelection, handleCompleteSetup } from './interface/sendmessage.js';

// Handle button interactions
export async function handleButtonInteraction(interaction, client) {
    const { customId } = interaction;

    // Check if bot is paused (except for pause button)
    if (client.isPaused && customId !== 'bot_pause') {
        await replyWithAutoDelete({
            content: '⏸️ Bot is currently paused. Use the Pause/Resume button to resume.',
            flags: 64
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
        case 'bot_send_message':
            await handleSendMessageButton(interaction, client);
            break;
        default:
            // Handle send message related buttons
            if (customId.startsWith('send_message_complete_')) {
                await handleCompleteSetup(interaction, client);
            } else {
                await logger.log(`🔍 Unknown button interaction: ${customId}`);
                await replyWithAutoDelete(interaction, {
                    content: '❌ Unknown button interaction.',
                    flags: 64
                });
            }
    }
}

// Create interface embed and buttons
export function createInterfaceEmbed(client) {
    const interfaceEmbed = {
        color: EMBED.COLOR,
        title: "GOBLOX Bot Interface",
        description: "Use the buttons below to interact with the bot",
        thumbnail: {
            url: client.user.displayAvatarURL()
        },
        footer: {
            text: "GOBLOX Bot System"
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

    const sendMessageButton = new ButtonBuilder()
        .setCustomId('bot_send_message')
        .setLabel('📤 Send Message')
        .setStyle(ButtonStyle.Success);

    // Create action row with buttons
    const buttonRow = new ActionRowBuilder()
        .addComponents(statusButton, helpButton, pauseButton, sendMessageButton);

    return buttonRow;
}

// Send interface to channel
export async function sendInterfaceToChannel(targetChannel, interaction, client) {
    try {
        const interfaceEmbed = createInterfaceEmbed(client);
        const buttonRow = createInterfaceButtons();

        // Send the interface to the target channel
        await targetChannel.send({
            embeds: [interfaceEmbed],
            components: [buttonRow]
        });

        await replyWithAutoDelete({
            content: `✅ Bot interface sent to ${targetChannel}!`,
            flags: 64
        });

        await logger.log(`🎮 Bot interface sent to ${targetChannel.name} by ${interaction.user.tag} (${interaction.user.id})`);

    } catch (error) {
        await replyWithAutoDelete({
            content: `❌ Failed to send interface: ${error.message}`,
            flags: 64
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
                    await replyWithAutoDelete({
                        content: `❌ **Button Error**: An error occurred while processing your button click.\n\nPlease try again or contact an administrator.`,
                        flags: 64
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send button error response: ${replyError.message}`);
                }
            }
        } else if (interaction.isModalSubmit()) {
            // Handle modal submissions
            try {
                if (interaction.customId.startsWith('send_message_modal_')) {
                    await handleSendMessageModal(interaction, client);
                }
            } catch (error) {
                await logger.log(`❌ Modal submission error: ${error.message}`);
                
                try {
                    await replyWithAutoDelete({
                        content: `❌ **Modal Error**: An error occurred while processing your form submission.\n\nPlease try again or contact an administrator.`,
                        flags: 64
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send modal error response: ${replyError.message}`);
                }
            }
        } else if (interaction.isChannelSelectMenu()) {
            // Handle channel selection
            try {
                if (interaction.customId === 'send_message_channel_select') {
                    await handleChannelSelection(interaction, client);
                }
            } catch (error) {
                await logger.log(`❌ Channel selection error: ${error.message}`);
                
                try {
                    await replyWithAutoDelete({
                        content: `❌ **Selection Error**: An error occurred while processing your channel selection.\n\nPlease try again or contact an administrator.`,
                        flags: 64
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send selection error response: ${replyError.message}`);
                }
            }
        } else if (interaction.isRoleSelectMenu()) {
            // Handle role selection
            try {
                if (interaction.customId.startsWith('send_message_role_select_')) {
                    await handleRoleSelection(interaction, client);
                }
            } catch (error) {
                await logger.log(`❌ Role selection error in interface.js: ${error.message}`);
                await logger.log(`❌ Role selection error stack: ${error.stack}`);
                
                try {
                    await replyWithAutoDelete({
                        content: `❌ **Selection Error**: An error occurred while processing your role selection.\n\nPlease try again or contact an administrator.`,
                        flags: 64
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send role selection error response: ${replyError.message}`);
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
