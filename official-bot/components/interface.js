import { EMBED } from "../../config.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import logger from "../../logger.js";
import { handleStatusButton } from './interface/status.js';
import { handleHelpButton } from './interface/help.js';
import { handlePauseButton } from './interface/pause.js';
import { handleSendMessageButton, handleSendMessageModal, handleChannelSelection, handleRoleSelection, handleCompleteSetup } from './interface/sendmessage.js';
import { handleInactiveButton } from './interface/inactive.js';
import { handleCustomSupporterRoleButton, handleCustomSupporterRoleModal, handleEditCustomSupporterRole, handleDeleteCustomSupporterRole } from './interface/customsupporterrole.js';
import { handleFeedbackButton, handleFeedbackModal } from './interface/feedback.js';

// Handle button interactions
export async function handleButtonInteraction(interaction, client) {
    const { customId } = interaction;
    const user = interaction.user;

    // Log button interaction attempt
    await logger.log(`🔘 Button clicked: "${customId}" by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`);

    // Check if bot is paused (except for pause button)
    if (client.isPaused && customId !== 'bot_pause') {
        await logger.log(`⏸️ Button "${customId}" blocked - bot is paused`);
        await interaction.reply({
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
            await handleSendMessageButton(interaction);
            break;
        case 'bot_inactive':
            await handleInactiveButton(interaction, client);
            break;
        case 'bot_custom_supporter_role':
            await handleCustomSupporterRoleButton(interaction);
            break;
        case 'custom_supporter_role_edit':
            await handleEditCustomSupporterRole(interaction);
            break;
        case 'custom_supporter_role_delete':
            await handleDeleteCustomSupporterRole(interaction);
            break;
        case 'bot_feedback':
            await handleFeedbackButton(interaction);
            break;
        default:
            // Handle send message related buttons
            if (customId.startsWith('send_message_complete_')) {
                await handleCompleteSetup(interaction);
            } else {
                await logger.log(`🔍 Unknown button interaction: ${customId}`);
                await interaction.reply({
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
        title: "GO BLOX Bot Panel",
        description: "Use the buttons below to interact with the bot",
        thumbnail: {
            url: client.user.displayAvatarURL()
        },
        footer: {
            text: "GO BLOX Bot"
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

    const feedbackButton = new ButtonBuilder()
        .setCustomId('bot_feedback')
        .setLabel('💬 Feedback')
        .setStyle(ButtonStyle.Secondary);

    const pauseButton = new ButtonBuilder()
        .setCustomId('bot_pause')
        .setLabel('⏸️ Pause/Resume')
        .setStyle(ButtonStyle.Danger);

    const sendMessageButton = new ButtonBuilder()
        .setCustomId('bot_send_message')
        .setLabel('📤 Send Message')
        .setStyle(ButtonStyle.Success);

    const inactiveButton = new ButtonBuilder()
        .setCustomId('bot_inactive')
        .setLabel('📊 Inactive Members')
        .setStyle(ButtonStyle.Primary);

    const customSupporterRoleButton = new ButtonBuilder()
        .setCustomId('bot_custom_supporter_role')
        .setLabel('💎 Custom Supporter Role')
        .setStyle(ButtonStyle.Success);

    // Create action rows with buttons (max 5 buttons per row)
    // Status and Help always go in the last row
    const buttonRow1 = new ActionRowBuilder()
        .addComponents(sendMessageButton, inactiveButton, pauseButton, customSupporterRoleButton);

    const buttonRow2 = new ActionRowBuilder()
        .addComponents(statusButton, helpButton, feedbackButton);

    return [buttonRow1, buttonRow2];
}

// Send interface to channel
export async function sendInterfaceToChannel(targetChannel, interaction, client) {
    try {
        const interfaceEmbed = createInterfaceEmbed(client);
        const buttonRow = createInterfaceButtons();

        // Send the interface to the target channel
        await targetChannel.send({
            embeds: [interfaceEmbed],
            components: Array.isArray(buttonRow) ? buttonRow : [buttonRow]
        });

        await interaction.reply({
            content: `✅ Bot interface sent to ${targetChannel}!`,
            flags: 64
        });

        await logger.log(`🎮 Bot interface sent to ${targetChannel.name} by ${interaction.user.tag} (${interaction.user.id})`);

    } catch (error) {
        await interaction.reply({
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
                    await interaction.reply({
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
                const user = interaction.user;
                const customId = interaction.customId;
                await logger.log(`📝 Modal submitted: "${customId}" by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`);

                if (interaction.customId.startsWith('send_message_modal_')) {
                    await handleSendMessageModal(interaction);
                } else if (interaction.customId === 'custom_supporter_role_create') {
                    await handleCustomSupporterRoleModal(interaction);
                } else if (interaction.customId === 'feedback_submit') {
                    await handleFeedbackModal(interaction);
                } else {
                    await logger.log(`⚠️ Unknown modal: "${customId}" by ${user.tag} (${user.id})`);
                }
            } catch (error) {
                await logger.log(`❌ Modal submission error: ${error.message}`);

                try {
                    await interaction.reply({
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
                const user = interaction.user;
                const customId = interaction.customId;
                const selectedChannels = interaction.values;
                await logger.log(`📋 Channel selected: "${customId}" → [${selectedChannels.join(', ')}] by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`);

                if (interaction.customId === 'send_message_channel_select') {
                    await handleChannelSelection(interaction);
                } else {
                    await logger.log(`⚠️ Unknown channel select: "${customId}" by ${user.tag} (${user.id})`);
                }
            } catch (error) {
                await logger.log(`❌ Channel selection error: ${error.message}`);

                try {
                    await interaction.reply({
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
                const user = interaction.user;
                const customId = interaction.customId;
                const selectedRoles = interaction.values;
                await logger.log(`👥 Role selected: "${customId}" → [${selectedRoles.join(', ')}] by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`);

                if (interaction.customId.startsWith('send_message_role_select_')) {
                    await handleRoleSelection(interaction);
                } else {
                    await logger.log(`⚠️ Unknown role select: "${customId}" by ${user.tag} (${user.id})`);
                }
            } catch (error) {
                await logger.log(`❌ Role selection error in interface.js: ${error.message}`);
                await logger.log(`❌ Role selection error stack: ${error.stack}`);

                try {
                    await interaction.reply({
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
    init
};
