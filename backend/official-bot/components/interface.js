import { getEmbedConfig, getServerForCurrentBot } from "../../config.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import logger from "../../logger.js";
import { handleHelpButton } from './interface/help.js';
import { handleSendMessageButton, handleSendMessageModal, handleChannelSelection, handleRoleSelection, handleCompleteSetup } from './interface/sendmessage.js';
import { handleCustomSupporterRoleButton, handleCustomSupporterRoleModal, handleEditCustomSupporterRole, handleDeleteCustomSupporterRole } from './interface/customsupporterrole.js';
import { handleFeedbackButton, handleFeedbackModal } from './interface/feedback.js';
import { handleAFKButton, handleAFKModal, handleRemoveAFKButton } from './interface/afk.js';
import { handleLevelingButton } from './interface/leveling.js';

export async function handleButtonInteraction(interaction, client) {
    const { customId } = interaction;
    const user = interaction.user;

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
        case 'bot_leveling':
            await handleLevelingButton(interaction);
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

    const levelingButton = new ButtonBuilder()
        .setCustomId('bot_leveling')
        .setLabel('📈 Leveling')
        .setStyle(ButtonStyle.Success);

    const afkButton = new ButtonBuilder()
        .setCustomId('bot_afk')
        .setLabel('⏸️ AFK')
        .setStyle(ButtonStyle.Success);

    const buttonRow1 = new ActionRowBuilder()
        .addComponents(sendMessageButton, customSupporterRoleButton, levelingButton, afkButton, feedbackButton);

    const buttonRow2 = new ActionRowBuilder()
        .addComponents(helpButton);

    return [buttonRow1, buttonRow2];
}

export async function sendInterfaceToChannel(targetChannel, interaction, client) {
    try {
        const interfaceEmbed = await createInterfaceEmbed(client, interaction.guild.id);
        const buttonRow = createInterfaceButtons();

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

function init(client) {

    client.on('interactionCreate', async (interaction) => {
        if (interaction.isButton()) {

            if (!interaction.guild) {
                return;
            }

            try {
                await getServerForCurrentBot(interaction.guild.id);
            } catch (error) {

                await logger.log(`⚠️  Server ${interaction.guild.name} (${interaction.guild.id}) not found for this bot, ignoring interaction`);
                return;
            }

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

            if (!interaction.guild) {
                return;
            }

            try {
                await getServerForCurrentBot(interaction.guild.id);
            } catch (error) {

                await logger.log(`⚠️  Server ${interaction.guild.name} (${interaction.guild.id}) not found for this bot, ignoring interaction`);
                return;
            }

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

            if (!interaction.guild) {
                return;
            }

            try {
                await getServerForCurrentBot(interaction.guild.id);
            } catch (error) {

                await logger.log(`⚠️  Server ${interaction.guild.name} (${interaction.guild.id}) not found for this bot, ignoring interaction`);
                return;
            }

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

            if (!interaction.guild) {
                return;
            }

            try {
                await getServerForCurrentBot(interaction.guild.id);
            } catch (error) {

                await logger.log(`⚠️  Server ${interaction.guild.name} (${interaction.guild.id}) not found for this bot, ignoring interaction`);
                return;
            }

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
