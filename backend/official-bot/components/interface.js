import { getEmbedConfig, getServerForCurrentBot } from "../../config.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import logger from "../../logger.js";
import { hasPermission, getPermissionDeniedMessage } from './permissions.js';
import { handleCustomSupporterRoleButton, handleCustomSupporterRoleModal, handleEditCustomSupporterRole, handleDeleteCustomSupporterRole } from './interface/customsupporterrole.js';
import { handleFeedbackButton, handleFeedbackModal } from './interface/feedback.js';
import { handleAFKButton, handleAFKModal, handleRemoveAFKButton } from './interface/afk.js';
import { handleLevelingButton, handleLeaderboardButton } from './interface/leveling.js';
import { handleGiveawayButton, handleGiveawayModal, handleGiveawayEnterButton, handleGiveawayRoleSelect, handleGiveawaySkipRolesContinue, handleGiveawayCancel, handleGiveawayFinish } from './interface/giveaway.js';
import { handleSettingsButton, handleLanguageButton, handleLanguageSelect, handleDMToggleButton } from './interface/settings.js';
import { handleStaffReportButton, handleStaffReportUserSelect, handleStaffReportModal, handleStaffReportRatingSelect, handleStaffReportCategorySelect, handleStaffReportContinue } from './interface/staffreport.js';
import { translate } from '../../i18n.js';

async function handleMenuButton(interaction) {
    const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
        const errorMsg = await translate('common.errors.memberNotFound', interaction.guild.id, interaction.user.id);
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({
                content: errorMsg,
                embeds: [],
                components: []
            });
        } else {
            await interaction.reply({
                content: errorMsg,
                flags: 64
            });
        }
        return;
    }

    if (!(await hasPermission(member, 'leveling'))) {
        const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'menu', interaction.user.id);
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({
                content: errorMessage,
                embeds: [],
                components: []
            });
        } else {
            await interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null);
        }
        return;
    }

    const buttons = [];

    if (await hasPermission(member, 'custom_supporter_role')) {
        buttons.push(new ButtonBuilder()
            .setCustomId('bot_custom_supporter_role')
            .setLabel('💎 Custom Supporter Role')
            .setStyle(ButtonStyle.Success));
    }

    if (await hasPermission(member, 'leveling')) {
        buttons.push(new ButtonBuilder()
            .setCustomId('bot_leveling')
            .setLabel('📈 Leveling')
            .setStyle(ButtonStyle.Success));
    }

    if (await hasPermission(member, 'giveaway')) {
        buttons.push(new ButtonBuilder()
            .setCustomId('bot_giveaway')
            .setLabel('🎉 Giveaway')
            .setStyle(ButtonStyle.Success));
    }

    if (await hasPermission(member, 'afk')) {
        buttons.push(new ButtonBuilder()
            .setCustomId('bot_afk')
            .setLabel('⏸️ AFK')
            .setStyle(ButtonStyle.Success));
    }

    if (await hasPermission(member, 'feedback')) {
        buttons.push(new ButtonBuilder()
            .setCustomId('bot_feedback')
            .setLabel('💬 Feedback')
            .setStyle(ButtonStyle.Success));
    }

    if (await hasPermission(member, 'staff_report')) {
        buttons.push(new ButtonBuilder()
            .setCustomId('bot_staff_report')
            .setLabel(await translate('staffReport.button', interaction.guild.id, interaction.user.id))
            .setStyle(ButtonStyle.Success));
    }

    if (buttons.length === 0) {
        const noAccessMsg = await translate('menu.noAccess', interaction.guild.id, interaction.user.id);
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({
                content: noAccessMsg,
                embeds: [],
                components: []
            });
        } else {
            await interaction.reply({
                content: noAccessMsg,
                flags: 64
            });
        }
        return;
    }

    const embedConfig = await getEmbedConfig(interaction.guild.id);
    const menuTitle = await translate('menu.title', interaction.guild.id, interaction.user.id);
    const menuDesc = await translate('menu.description', interaction.guild.id, interaction.user.id);

    const menuEmbed = new EmbedBuilder()
        .setColor(embedConfig.COLOR)
        .setTitle(menuTitle)
        .setDescription(menuDesc)
        .setFooter({ text: embedConfig.FOOTER })
        .setTimestamp();

    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
    }

    const settingsButton = new ButtonBuilder()
        .setCustomId('bot_settings')
        .setLabel(await translate('settings.title', interaction.guild.id, interaction.user.id))
        .setStyle(ButtonStyle.Secondary);

    if (rows.length === 0) {
        rows.push(new ActionRowBuilder().addComponents(settingsButton));
    } else {
        const lastRow = rows[rows.length - 1];
        if (lastRow.components.length < 5) {
            lastRow.addComponents(settingsButton);
        } else {
            rows.push(new ActionRowBuilder().addComponents(settingsButton));
        }
    }

    const isFromEphemeral = interaction.message?.flags?.has(64) || interaction.replied || interaction.deferred;

    if (isFromEphemeral) {
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({
                embeds: [menuEmbed],
                components: rows
            });
        } else {
            await interaction.update({
                embeds: [menuEmbed],
                components: rows
            });
        }
    } else {
        await interaction.reply({
            embeds: [menuEmbed],
            components: rows,
            flags: 64
        });
    }
}

export async function handleButtonInteraction(interaction, client) {
    const { customId } = interaction;
    const user = interaction.user;

    await logger.log(`🔘 Button clicked: "${customId}" by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`);

    switch (customId) {
        case 'bot_menu':
            await handleMenuButton(interaction);
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
        case 'bot_giveaway':
            await handleGiveawayButton(interaction);
            break;
        case 'bot_feedback':
            await handleFeedbackButton(interaction);
            break;
        case 'bot_staff_report':
            await handleStaffReportButton(interaction);
            break;
        case 'bot_afk':
            await handleAFKButton(interaction);
            break;
        case 'afk_remove':
            await handleRemoveAFKButton(interaction);
            break;
        case 'leaderboard_xp':
        case 'leaderboard_voice_total':
        case 'leaderboard_voice_active':
        case 'leaderboard_voice_afk':
        case 'leaderboard_chat':
            await handleLeaderboardButton(interaction);
            break;
        case 'settings_dm_toggle':
            await handleDMToggleButton(interaction);
            break;
        case 'bot_settings':
            await handleSettingsButton(interaction);
            break;
        case 'settings_language':
            await handleLanguageButton(interaction);
            break;
        case 'staff_report_back_to_staff':
            await handleStaffReportButton(interaction);
            break;
        default:
            if (customId.startsWith('staff_report_continue')) {
                await handleStaffReportContinue(interaction);
            } else if (customId.startsWith('giveaway_enter_')) {
                await handleGiveawayEnterButton(interaction);
            } else if (customId === 'giveaway_continue_form') {
                await handleGiveawaySkipRolesContinue(interaction);
            } else if (customId.startsWith('giveaway_finish_')) {
                await handleGiveawayFinish(interaction);
            } else if (customId.startsWith('giveaway_cancel_')) {
                await handleGiveawayCancel(interaction);
            } else {
                await logger.log(`🔍 Unknown button interaction: ${customId}`);
                const errorMsg = await translate('common.errors.unknownButton', interaction.guild?.id, interaction.user?.id);
                await interaction.reply({
                    content: errorMsg,
                    flags: 64
                }).catch(() => null);
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
        description: "Click **Menu** to access bot features based on your role permissions.",
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

export async function createInterfaceButtons(guildId = null, userId = null) {
    const menuLabel = '📋 Menu';
    const menuButton = new ButtonBuilder()
        .setCustomId('bot_menu')
        .setLabel(menuLabel)
        .setStyle(ButtonStyle.Primary);

    const buttonRow = new ActionRowBuilder()
        .addComponents(menuButton);

    return [buttonRow];
}

export async function sendInterfaceToChannel(targetChannel, interaction, client) {
    try {
        const interfaceEmbed = await createInterfaceEmbed(client, interaction.guild.id);
        const buttonRow = await createInterfaceButtons(interaction.guild.id, interaction.user.id);

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
                await logger.log(`❌ Button interaction error: ${error.message}`);

                try {
                    const errorMsg = await translate('common.errors.buttonError', interaction.guild?.id, interaction.user?.id);
                    await interaction.reply({
                        content: errorMsg,
                        flags: 64
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send button error response: ${replyError.message}`);
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
                await logger.log(`📝 Modal submitted: "${customId}" by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`);

                if (interaction.customId === 'custom_supporter_role_create') {
                    await handleCustomSupporterRoleModal(interaction);
                } else if (interaction.customId === 'feedback_submit') {
                    await handleFeedbackModal(interaction);
                } else if (interaction.customId === 'afk_set') {
                    await handleAFKModal(interaction);
                } else if (interaction.customId.startsWith('staff_report_submit')) {
                    await handleStaffReportModal(interaction);
                } else if (interaction.customId.startsWith('giveaway_create')) {
                    await handleGiveawayModal(interaction);
                } else {
                    await logger.log(`⚠️ Unknown modal: "${customId}" by ${user.tag} (${user.id})`);
                }
            } catch (error) {
                await logger.log(`❌ Modal submission error: ${error.message}`);

                try {
                    const errorMsg = await translate('common.errors.modalError', interaction.guild?.id, interaction.user?.id);
                    await interaction.reply({
                        content: errorMsg,
                        flags: 64
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send modal error response: ${replyError.message}`);
                }
            }
        } else if (interaction.isStringSelectMenu()) {

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
                const selectedValues = interaction.values;
                await logger.log(`📋 String select: "${customId}" → [${selectedValues.join(', ')}] by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`);

                if (customId === 'staff_report_select_user') {
                    await handleStaffReportUserSelect(interaction);
                } else if (customId.startsWith('staff_report_rating')) {
                    await handleStaffReportRatingSelect(interaction);
                } else if (customId.startsWith('staff_report_category')) {
                    await handleStaffReportCategorySelect(interaction);
                } else if (customId === 'settings_language_select') {
                    await handleLanguageSelect(interaction);
                } else {
                    await logger.log(`⚠️ Unknown string select: "${customId}" by ${user.tag} (${user.id})`);
                }
            } catch (error) {
                await logger.log(`❌ String select error: ${error.message}`);
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
                await logger.log(`📋 Channel selected: "${customId}" → [${selectedChannels.join(', ')}] by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`);
            } catch (error) {
                await logger.log(`❌ Channel selection error: ${error.message}`);

                try {
                    const errorMsg = await translate('common.errors.selectionError', interaction.guild?.id, interaction.user?.id);
                    await interaction.reply({
                        content: errorMsg,
                        flags: 64
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send selection error response: ${replyError.message}`);
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
                await logger.log(`👥 Role selected: "${customId}" → [${selectedRoles.join(', ')}] by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`);

                if (customId === 'giveaway_role_select') {
                    await handleGiveawayRoleSelect(interaction);
                } else {
                    await logger.log(`⚠️ Unknown role select: "${customId}" by ${user.tag} (${user.id})`);
                }
            } catch (error) {
                await logger.log(`❌ Role selection error in interface.js: ${error.message}`);
                await logger.log(`❌ Role selection error stack: ${error.stack}`);

                try {
                    const errorMsg = await translate('common.errors.selectionError', interaction.guild?.id, interaction.user?.id);
                    await interaction.reply({
                        content: errorMsg,
                        flags: 64
                    });
                } catch (replyError) {
                    await logger.log(`❌ Failed to send role selection error response: ${replyError.message}`);
                }
            }
        } else if (interaction.isUserSelectMenu()) {

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
                const selectedUsers = interaction.values;
                await logger.log(`👤 User selected: "${customId}" → [${selectedUsers.join(', ')}] by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`);

                if (customId === 'staff_report_select_user') {
                    await handleStaffReportUserSelect(interaction);
                } else {
                    await logger.log(`⚠️ Unknown user select: "${customId}" by ${user.tag} (${user.id})`);
                }
            } catch (error) {
                await logger.log(`❌ User selection error in interface.js: ${error.message}`);
                await logger.log(`❌ User selection error stack: ${error.stack}`);

                try {
                    const errorMsg = await translate('common.errors.selectionError', interaction.guild?.id, interaction.user?.id);
                    await interaction.reply({
                        content: errorMsg,
                        flags: 64
                    }).catch(() => null);
                } catch (replyError) {
                    await logger.log(`❌ Failed to send user selection error response: ${replyError.message}`);
                }
            }
        } else if (interaction.isStringSelectMenu()) {

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
                const selectedValues = interaction.values;
                await logger.log(`📋 String select: "${customId}" → [${selectedValues.join(', ')}] by ${user.tag} (${user.id}) in ${interaction.guild?.name || 'DM'}`);

                if (customId === 'settings_language_select') {
                    await handleLanguageSelect(interaction);
                } else {
                    await logger.log(`⚠️ Unknown string select: "${customId}" by ${user.tag} (${user.id})`);
                }
            } catch (error) {
                await logger.log(`❌ String selection error in interface.js: ${error.message}`);
                await logger.log(`❌ String selection error stack: ${error.stack}`);

                try {
                    const errorMsg = await translate('common.errors.selectionError', interaction.guild?.id, interaction.user?.id);
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply({
                            content: errorMsg,
                            components: [],
                            embeds: []
                        }).catch(() => null);
                    } else {
                        await interaction.reply({
                            content: errorMsg,
                            flags: 64
                        }).catch(() => null);
                    }
                } catch (replyError) {
                    await logger.log(`❌ Failed to send string selection error response: ${replyError.message}`);
                }
            }
        }
    });
    logger.log("🎮 Interface component initialized");
}

export default {
    init
};
