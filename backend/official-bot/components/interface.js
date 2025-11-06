import { getEmbedConfig, getServerForCurrentBot } from "../../config.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import logger from "../../logger.js";
import { handleHelpButton } from './interface/help.js';
import { handleSendMessageButton, handleSendMessageModal, handleChannelSelection, handleRoleSelection, handleCompleteSetup } from './interface/sendmessage.js';
import { handleCustomSupporterRoleButton, handleCustomSupporterRoleModal, handleEditCustomSupporterRole, handleDeleteCustomSupporterRole } from './interface/customsupporterrole.js';
import { handleFeedbackButton, handleFeedbackModal } from './interface/feedback.js';
import { handleAFKButton, handleAFKModal, handleRemoveAFKButton } from './interface/afk.js';

// Handle button interactions
export async function handleButtonInteraction(interaction, client) {
    const { customId } = interaction;
    const user = interaction.user;

    // Log button interaction attempt to the specific server's logger channel
    await logger.log(`🔘 Button clicked: "${customId}" by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`, interaction.guild?.id);

    switch (customId) {
        case 'bot_help':
            await handleHelpButton(interaction);
            break;
        case 'bot_send_message':
            await handleSendMessageButton(interaction);
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
                case 'bot_afk':
                    await handleAFKButton(interaction);
                    break;
                case 'afk_remove':
                    await handleRemoveAFKButton(interaction);
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
export async function createInterfaceEmbed(client, guildId) {
    if (!guildId) {
        throw new Error('Guild ID is required to create interface embed');
    }
    
    const embedConfig = await getEmbedConfig(guildId);
    const interfaceEmbed = {
        color: embedConfig.COLOR,
        title: "GO BLOX Bot Panel",
        description: "Use the buttons below to interact with the bot",
        thumbnail: {
            url: client.user.displayAvatarURL()
        },
        footer: {
            text: embedConfig.FOOTER
        },
        timestamp: new Date().toISOString()
    };

    return interfaceEmbed;
}

// Create interface buttons
export function createInterfaceButtons() {
    const helpButton = new ButtonBuilder()
        .setCustomId('bot_help')
        .setLabel('❓ Help')
        .setStyle(ButtonStyle.Secondary);

    const feedbackButton = new ButtonBuilder()
        .setCustomId('bot_feedback')
        .setLabel('💬 Feedback')
        .setStyle(ButtonStyle.Success);

    const sendMessageButton = new ButtonBuilder()
        .setCustomId('bot_send_message')
        .setLabel('📤 Send Message')
        .setStyle(ButtonStyle.Success);

    const customSupporterRoleButton = new ButtonBuilder()
        .setCustomId('bot_custom_supporter_role')
        .setLabel('💎 Custom Supporter Role')
        .setStyle(ButtonStyle.Success);

    const afkButton = new ButtonBuilder()
        .setCustomId('bot_afk')
        .setLabel('⏸️ AFK')
        .setStyle(ButtonStyle.Success);

    // Create action rows with buttons (max 5 buttons per row)
    const buttonRow1 = new ActionRowBuilder()
        .addComponents(sendMessageButton, customSupporterRoleButton, afkButton, feedbackButton, helpButton);

    return [buttonRow1];
}

// Send interface to channel
export async function sendInterfaceToChannel(targetChannel, interaction, client) {
    try {
        const interfaceEmbed = await createInterfaceEmbed(client, interaction.guild.id);
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
            // Skip if interaction is not from a guild
            if (!interaction.guild) {
                return;
            }

            // Check if this server belongs to this bot instance
            try {
                await getServerForCurrentBot(interaction.guild.id);
            } catch (error) {
                // Server not found for this bot, ignore interaction
                await logger.log(`⚠️  Server ${interaction.guild.name} (${interaction.guild.id}) not found for this bot, ignoring interaction`);
                return;
            }

            // Handle button interactions
            try {
                await handleButtonInteraction(interaction, client);
            } catch (error) {
                await logger.log(`❌ Button interaction error: ${error.message}`, interaction.guild?.id);

                try {
                    await interaction.reply({
                        content: `❌ **Button Error**: An error occurred while processing your button click.\n\nPlease try again or contact an administrator.`,
                        flags: 64
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send button error response: ${replyError.message}`, interaction.guild?.id);
                }
            }
        } else if (interaction.isModalSubmit()) {
            // Skip if interaction is not from a guild
            if (!interaction.guild) {
                return;
            }

            // Check if this server belongs to this bot instance
            try {
                await getServerForCurrentBot(interaction.guild.id);
            } catch (error) {
                // Server not found for this bot, ignore interaction
                await logger.log(`⚠️  Server ${interaction.guild.name} (${interaction.guild.id}) not found for this bot, ignoring interaction`);
                return;
            }

            // Handle modal submissions
            try {
                const user = interaction.user;
                const customId = interaction.customId;
                await logger.log(`📝 Modal submitted: "${customId}" by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`, interaction.guild?.id);

                if (interaction.customId.startsWith('send_message_modal_')) {
                    await handleSendMessageModal(interaction);
                } else if (interaction.customId === 'custom_supporter_role_create') {
                    await handleCustomSupporterRoleModal(interaction);
                } else if (interaction.customId === 'feedback_submit') {
                    await handleFeedbackModal(interaction);
                } else if (interaction.customId === 'afk_set') {
                    await handleAFKModal(interaction);
                } else {
                    await logger.log(`⚠️ Unknown modal: "${customId}" by ${user.tag} (${user.id})`, interaction.guild?.id);
                }
            } catch (error) {
                await logger.log(`❌ Modal submission error: ${error.message}`, interaction.guild?.id);

                try {
                    await interaction.reply({
                        content: `❌ **Modal Error**: An error occurred while processing your form submission.\n\nPlease try again or contact an administrator.`,
                        flags: 64
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send modal error response: ${replyError.message}`, interaction.guild?.id);
                }
            }
        } else if (interaction.isChannelSelectMenu()) {
            // Skip if interaction is not from a guild
            if (!interaction.guild) {
                return;
            }

            // Check if this server belongs to this bot instance
            try {
                await getServerForCurrentBot(interaction.guild.id);
            } catch (error) {
                // Server not found for this bot, ignore interaction
                await logger.log(`⚠️  Server ${interaction.guild.name} (${interaction.guild.id}) not found for this bot, ignoring interaction`);
                return;
            }

            // Handle channel selection
            try {
                const user = interaction.user;
                const customId = interaction.customId;
                const selectedChannels = interaction.values;
                await logger.log(`📋 Channel selected: "${customId}" → [${selectedChannels.join(', ')}] by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`, interaction.guild?.id);

                if (interaction.customId === 'send_message_channel_select') {
                    await handleChannelSelection(interaction);
                } else {
                    await logger.log(`⚠️ Unknown channel select: "${customId}" by ${user.tag} (${user.id})`, interaction.guild?.id);
                }
            } catch (error) {
                await logger.log(`❌ Channel selection error: ${error.message}`, interaction.guild?.id);

                try {
                    await interaction.reply({
                        content: `❌ **Selection Error**: An error occurred while processing your channel selection.\n\nPlease try again or contact an administrator.`,
                        flags: 64
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send selection error response: ${replyError.message}`, interaction.guild?.id);
                }
            }
        } else if (interaction.isRoleSelectMenu()) {
            // Skip if interaction is not from a guild
            if (!interaction.guild) {
                return;
            }

            // Check if this server belongs to this bot instance
            try {
                await getServerForCurrentBot(interaction.guild.id);
            } catch (error) {
                // Server not found for this bot, ignore interaction
                await logger.log(`⚠️  Server ${interaction.guild.name} (${interaction.guild.id}) not found for this bot, ignoring interaction`);
                return;
            }

            // Handle role selection
            try {
                const user = interaction.user;
                const customId = interaction.customId;
                const selectedRoles = interaction.values;
                await logger.log(`👥 Role selected: "${customId}" → [${selectedRoles.join(', ')}] by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`, interaction.guild?.id);

                if (interaction.customId.startsWith('send_message_role_select_')) {
                    await handleRoleSelection(interaction);
                } else {
                    await logger.log(`⚠️ Unknown role select: "${customId}" by ${user.tag} (${user.id})`, interaction.guild?.id);
                }
            } catch (error) {
                await logger.log(`❌ Role selection error in interface.js: ${error.message}`, interaction.guild?.id);
                await logger.log(`❌ Role selection error stack: ${error.stack}`, interaction.guild?.id);

                try {
                    await interaction.reply({
                        content: `❌ **Selection Error**: An error occurred while processing your role selection.\n\nPlease try again or contact an administrator.`,
                        flags: 64
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send role selection error response: ${replyError.message}`, interaction.guild?.id);
                }
            }
        }
    });
    logger.log("🎮 Interface component initialized");
}

export default {
    init
};
