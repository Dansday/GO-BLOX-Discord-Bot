import { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder } from 'discord.js';
import { getEmbedConfig, GIVEAWAY, NOTIFICATIONS, getServerForCurrentBot } from '../../../config.js';
import logger from '../../../logger.js';
import { hasPermission, getPermissionDeniedMessage } from '../permissions.js';
import db from '../../../../database/database.js';
import { translate } from '../../../i18n.js';

export async function handleGiveawayButton(interaction) {
    try {
        const member = interaction.member;
        const guild = interaction.guild;
        const user = interaction.user;

        if (!(await hasPermission(member, 'giveaway'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'giveaway', interaction.user.id);
            await interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null);
            return;
        }

        const server = await getServerForCurrentBot(guild.id);
        const embedConfig = await getEmbedConfig(guild.id);

        let dbMember = await db.getMemberByDiscordId(server.id, user.id);
        if (!dbMember) {
            dbMember = await db.upsertMember(server.id, {
                id: user.id,
                username: user.username,
                display_name: user.displayName || user.username,
                avatar: user.avatar
            });
        }

        if (!dbMember || !dbMember.id) {
            const errorMsg = await translate('giveaway.errors.memberNotFound', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            });
            return;
        }

        const activeGiveaway = await db.getActiveGiveawayByMember(server.id, dbMember.id);

        if (activeGiveaway) {
            const finishLabel = await translate('giveaway.buttons.finish', interaction.guild.id, interaction.user.id);
            const finishButton = new ButtonBuilder()
                .setCustomId(`giveaway_finish_${activeGiveaway.id}`)
                .setLabel(finishLabel)
                .setStyle(ButtonStyle.Success);

            const backButton = new ButtonBuilder()
                .setCustomId('bot_menu')
                .setLabel('📋 Menu')
                .setStyle(ButtonStyle.Secondary);

            const buttonRow = new ActionRowBuilder().addComponents(finishButton, backButton);

            const activeTitle = await translate('giveaway.active.title', interaction.guild.id, interaction.user.id);
            const activeDescription = await translate('giveaway.active.description', interaction.guild.id, interaction.user.id, { title: activeGiveaway.title, prize: activeGiveaway.prize });
            const endsLabel = await translate('giveaway.active.ends', interaction.guild.id, interaction.user.id);
            const activeGiveawayEmbed = new EmbedBuilder()
                .setColor(embedConfig.COLOR)
                .setTitle(activeTitle)
                .setDescription(activeDescription)
                .addFields([
                    {
                        name: endsLabel,
                        value: (() => {
                            let endsAtDate;
                            if (activeGiveaway.ends_at instanceof Date) {
                                endsAtDate = activeGiveaway.ends_at;
                            } else {
                                const dateStr = String(activeGiveaway.ends_at).replace(' ', 'T') + 'Z';
                                endsAtDate = new Date(dateStr);
                            }
                            return `<t:${Math.floor(endsAtDate.getTime() / 1000)}:R>`;
                        })(),
                        inline: true
                    }
                ])
                .setTimestamp()
                .setFooter({ text: embedConfig.FOOTER });

            await interaction.update({
                embeds: [activeGiveawayEmbed],
                components: [buttonRow]
            });

            await logger.log(`🎉 Active giveaway options shown to ${member.user.tag} (${member.user.id}) for giveaway ${activeGiveaway.id}`);
            return;
        }

        const roleSelectPlaceholder = await translate('giveaway.create.roleSelectPlaceholder', interaction.guild.id, interaction.user.id);
        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId('giveaway_role_select')
            .setPlaceholder(roleSelectPlaceholder)
            .setMinValues(0)
            .setMaxValues(25);

        const continueLabel = await translate('giveaway.create.continueButton', interaction.guild.id, interaction.user.id);
        const continueButton = new ButtonBuilder()
            .setCustomId('giveaway_continue_form')
            .setLabel(continueLabel)
            .setStyle(ButtonStyle.Primary);

        const backButton = new ButtonBuilder()
            .setCustomId('bot_menu')
            .setLabel('📋 Menu')
            .setStyle(ButtonStyle.Secondary);

        const roleSelectRow = new ActionRowBuilder().addComponents(roleSelect);
        const buttonRow = new ActionRowBuilder().addComponents(continueButton, backButton);

        const createTitle = await translate('giveaway.create.title', interaction.guild.id, interaction.user.id);
        const step1Title = await translate('giveaway.create.step1Title', interaction.guild.id, interaction.user.id);
        const step1Description = await translate('giveaway.create.step1Description', interaction.guild.id, interaction.user.id);
        const roleSelectEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(createTitle)
            .setDescription(`${step1Title}\n\n${step1Description}`)
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.update({
            embeds: [roleSelectEmbed],
            components: [roleSelectRow, buttonRow]
        });

        await logger.log(`🎉 Giveaway role selector shown to ${member.user.tag} (${member.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error showing giveaway interface: ${error.message}`);
        const errorMsg = await translate('giveaway.errors.failed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.reply({
            content: errorMsg,
            flags: 64
        });
    }
}

export async function handleGiveawayRoleSelect(interaction) {
    try {
        if (!(await hasPermission(interaction.member, 'giveaway'))) {
            return;
        }

        const selectedRoles = interaction.values;

        await logger.log(`🔍 Role selection: ${selectedRoles.length} roles selected for giveaway by ${interaction.user.tag}`);

        const modalTitle = await translate('giveaway.create.title', interaction.guild.id, interaction.user.id);
        const modal = new ModalBuilder()
            .setCustomId(`giveaway_create_${selectedRoles.length > 0 ? selectedRoles.join('_') : 'none'}`)
            .setTitle(modalTitle);

        const titleLabel = await translate('giveaway.modal.titleLabel', interaction.guild.id, interaction.user.id);
        const titlePlaceholder = await translate('giveaway.modal.titlePlaceholder', interaction.guild.id, interaction.user.id);
        const titleInput = new TextInputBuilder()
            .setCustomId('giveaway_title')
            .setLabel(titleLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(titlePlaceholder)
            .setRequired(true)
            .setMaxLength(256);

        const prizeLabel = await translate('giveaway.modal.prizeLabel', interaction.guild.id, interaction.user.id);
        const prizePlaceholder = await translate('giveaway.modal.prizePlaceholder', interaction.guild.id, interaction.user.id);
        const prizeInput = new TextInputBuilder()
            .setCustomId('giveaway_prize')
            .setLabel(prizeLabel)
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(prizePlaceholder)
            .setRequired(true)
            .setMaxLength(2000);

        const durationLabel = await translate('giveaway.modal.durationLabel', interaction.guild.id, interaction.user.id);
        const durationPlaceholder = await translate('giveaway.modal.durationPlaceholder', interaction.guild.id, interaction.user.id);
        const durationInput = new TextInputBuilder()
            .setCustomId('giveaway_duration')
            .setLabel(durationLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(durationPlaceholder)
            .setRequired(true)
            .setMaxLength(10);

        const winnerCountLabel = await translate('giveaway.modal.winnerCountLabel', interaction.guild.id, interaction.user.id);
        const winnerCountPlaceholder = await translate('giveaway.modal.winnerCountPlaceholder', interaction.guild.id, interaction.user.id);
        const winnerCountInput = new TextInputBuilder()
            .setCustomId('giveaway_winner_count')
            .setLabel(winnerCountLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(winnerCountPlaceholder)
            .setRequired(false)
            .setMaxLength(3);

        const multipleEntriesLabel = await translate('giveaway.modal.multipleEntriesLabel', interaction.guild.id, interaction.user.id);
        const multipleEntriesPlaceholder = await translate('giveaway.modal.multipleEntriesPlaceholder', interaction.guild.id, interaction.user.id);
        const multipleEntriesInput = new TextInputBuilder()
            .setCustomId('giveaway_multiple_entries')
            .setLabel(multipleEntriesLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(multipleEntriesPlaceholder)
            .setRequired(false)
            .setMaxLength(3);

        const titleRow = new ActionRowBuilder().addComponents(titleInput);
        const prizeRow = new ActionRowBuilder().addComponents(prizeInput);
        const durationRow = new ActionRowBuilder().addComponents(durationInput);
        const winnerCountRow = new ActionRowBuilder().addComponents(winnerCountInput);
        const multipleEntriesRow = new ActionRowBuilder().addComponents(multipleEntriesInput);

        modal.addComponents(titleRow, prizeRow, durationRow, winnerCountRow, multipleEntriesRow);

        await interaction.showModal(modal);
        await logger.log(`🎉 Giveaway modal shown to ${interaction.user.tag} (${interaction.user.id}) with roles: ${selectedRoles.length > 0 ? selectedRoles.join(', ') : 'none'}`);

    } catch (error) {
        await logger.log(`❌ Role selection error: ${error.message}`);
        await logger.log(`❌ Role selection error stack: ${error.stack}`);
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: `❌ Failed to process role selection: ${error.message}`,
                    flags: 64
                });
            } else {
                await interaction.reply({
                    content: `❌ Failed to process role selection: ${error.message}`,
                    flags: 64
                });
            }
        } catch (err) {
            await logger.log(`❌ Failed to send error message: ${err.message}`);
        }
    }
}

export async function handleGiveawaySkipRolesContinue(interaction) {
    try {
        const modalTitle = await translate('giveaway.create.title', interaction.guild.id, interaction.user.id);
        const modal = new ModalBuilder()
            .setCustomId('giveaway_create_none')
            .setTitle(modalTitle);

        const titleLabel = await translate('giveaway.modal.titleLabel', interaction.guild.id, interaction.user.id);
        const titlePlaceholder = await translate('giveaway.modal.titlePlaceholder', interaction.guild.id, interaction.user.id);
        const titleInput = new TextInputBuilder()
            .setCustomId('giveaway_title')
            .setLabel(titleLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(titlePlaceholder)
            .setRequired(true)
            .setMaxLength(256);

        const prizeLabel = await translate('giveaway.modal.prizeLabel', interaction.guild.id, interaction.user.id);
        const prizePlaceholder = await translate('giveaway.modal.prizePlaceholder', interaction.guild.id, interaction.user.id);
        const prizeInput = new TextInputBuilder()
            .setCustomId('giveaway_prize')
            .setLabel(prizeLabel)
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(prizePlaceholder)
            .setRequired(true)
            .setMaxLength(2000);

        const durationLabel = await translate('giveaway.modal.durationLabel', interaction.guild.id, interaction.user.id);
        const durationPlaceholder = await translate('giveaway.modal.durationPlaceholder', interaction.guild.id, interaction.user.id);
        const durationInput = new TextInputBuilder()
            .setCustomId('giveaway_duration')
            .setLabel(durationLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(durationPlaceholder)
            .setRequired(true)
            .setMaxLength(10);

        const winnerCountLabel = await translate('giveaway.modal.winnerCountLabel', interaction.guild.id, interaction.user.id);
        const winnerCountPlaceholder = await translate('giveaway.modal.winnerCountPlaceholder', interaction.guild.id, interaction.user.id);
        const winnerCountInput = new TextInputBuilder()
            .setCustomId('giveaway_winner_count')
            .setLabel(winnerCountLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(winnerCountPlaceholder)
            .setRequired(false)
            .setMaxLength(3);

        const multipleEntriesLabel = await translate('giveaway.modal.multipleEntriesLabel', interaction.guild.id, interaction.user.id);
        const multipleEntriesPlaceholder = await translate('giveaway.modal.multipleEntriesPlaceholder', interaction.guild.id, interaction.user.id);
        const multipleEntriesInput = new TextInputBuilder()
            .setCustomId('giveaway_multiple_entries')
            .setLabel(multipleEntriesLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(multipleEntriesPlaceholder)
            .setRequired(false)
            .setMaxLength(3);

        const titleRow = new ActionRowBuilder().addComponents(titleInput);
        const prizeRow = new ActionRowBuilder().addComponents(prizeInput);
        const durationRow = new ActionRowBuilder().addComponents(durationInput);
        const winnerCountRow = new ActionRowBuilder().addComponents(winnerCountInput);
        const multipleEntriesRow = new ActionRowBuilder().addComponents(multipleEntriesInput);

        modal.addComponents(titleRow, prizeRow, durationRow, winnerCountRow, multipleEntriesRow);

        await interaction.showModal(modal);
        await logger.log(`🎉 Giveaway modal shown to ${interaction.user.tag} (${interaction.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error showing giveaway modal: ${error.message}`);
        await interaction.reply({
            content: `❌ Failed to open giveaway form: ${error.message}`,
            flags: 64
        });
    }
}

export async function handleGiveawayModal(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        const guild = interaction.guild;
        const user = interaction.user;
        const member = interaction.member;

        if (!(await hasPermission(member, 'giveaway'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'giveaway', interaction.user.id);
            await interaction.editReply({
                content: errorMessage
            }).catch(() => null);
            return;
        }

        const title = interaction.fields.getTextInputValue('giveaway_title').trim();
        const prize = interaction.fields.getTextInputValue('giveaway_prize').trim();
        const durationStr = interaction.fields.getTextInputValue('giveaway_duration').trim();
        const winnerCountStr = interaction.fields.getTextInputValue('giveaway_winner_count').trim() || '1';
        const multipleEntriesStr = interaction.fields.getTextInputValue('giveaway_multiple_entries').trim().toLowerCase() || 'no';

        if (!title || title.length === 0) {
            const errorMsg = await translate('giveaway.errors.invalidTitle', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        if (!prize || prize.length === 0) {
            const errorMsg = await translate('giveaway.errors.invalidPrize', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const duration = parseInt(durationStr);
        if (isNaN(duration) || duration <= 0) {
            const errorMsg = await translate('giveaway.errors.invalidDuration', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const winnerCount = parseInt(winnerCountStr) || 1;
        if (isNaN(winnerCount) || winnerCount <= 0) {
            const errorMsg = await translate('giveaway.errors.invalidWinnerCount', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const multipleEntriesAllowed = multipleEntriesStr === 'yes' || multipleEntriesStr === 'y' || multipleEntriesStr === 'true';

        let allowedRoles = null;
        if (interaction.customId.startsWith('giveaway_create_')) {
            const customIdParts = interaction.customId.replace('giveaway_create_', '').split('_');
            if (customIdParts[0] && customIdParts[0] !== 'none' && customIdParts[0].length > 0) {
                allowedRoles = customIdParts.filter(id => id && id !== 'none' && id.length > 0);
            }
        }


        let giveawayChannelId;
        try {
            giveawayChannelId = await GIVEAWAY.getChannel(guild.id);
        } catch (err) {
            await logger.log(`❌ Error getting giveaway channel: ${err.message}`);
            const errorMsg = await translate('giveaway.errors.channelError', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        if (!giveawayChannelId) {
            await logger.log(`❌ Giveaway channel not configured for server ${guild.id}`);
            const errorMsg = await translate('giveaway.errors.channelNotConfigured', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const giveawayChannel = guild.channels.cache.get(giveawayChannelId);
        if (!giveawayChannel) {
            await logger.log(`❌ Giveaway channel not found: ${giveawayChannelId}`);
            const errorMsg = await translate('giveaway.errors.channelNotFound', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const server = await getServerForCurrentBot(guild.id);
        const embedConfig = await getEmbedConfig(guild.id);

        let dbMember = await db.getMemberByDiscordId(server.id, user.id);
        if (!dbMember) {

            dbMember = await db.upsertMember(server.id, {
                id: user.id,
                username: user.username,
                display_name: user.displayName || user.username,
                avatar: user.avatar
            });
        }

        if (!dbMember || !dbMember.id) {
            const errorMsg = await translate('giveaway.errors.memberNotFound', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const activeGiveaway = await db.getActiveGiveawayByMember(server.id, dbMember.id);
        if (activeGiveaway) {
            const errorMsg = await translate('giveaway.errors.activeExists', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const now = new Date();
        const endsAt = new Date(now.getTime() + duration * 60 * 1000);
        const endsAtTimestamp = Math.floor(endsAt.getTime() / 1000);

        const giveawayData = {
            server_id: server.id,
            member_id: dbMember.id,
            title: title,
            prize: prize,
            duration_minutes: duration,
            allowed_roles: allowedRoles,
            multiple_entries_allowed: multipleEntriesAllowed,
            winner_count: winnerCount
        };

        const giveaway = await db.createGiveaway(giveawayData);

        const roleRestrictionNone = 'No role restrictions';
        const roleRestrictionText = allowedRoles && allowedRoles.length > 0
            ? allowedRoles.map(roleId => {
                const role = guild.roles.cache.get(roleId);
                return role ? `<@&${roleId}>` : `Role ${roleId}`;
            }).join(', ')
            : roleRestrictionNone;

        const entriesLabel = multipleEntriesAllowed ? 'Multiple entries allowed' : 'Single entry per member';
        const embedTitle = `🎉 ${title}`;
        const embedDescription = `**Prize:** ${prize}\n**Winner${winnerCount > 1 ? 's' : ''}:** ${winnerCount}\n**Entries:** ${entriesLabel}\n**Role Restrictions:** ${roleRestrictionText}`;
        const hostedByLabel = '👤 Hosted By';
        const endsLabel = '⏰ Ends';
        const giveawayEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(embedTitle)
            .setDescription(embedDescription)
            .addFields([
                {
                    name: hostedByLabel,
                    value: `<@${user.id}>`,
                    inline: true
                },
                {
                    name: endsLabel,
                    value: `<t:${endsAtTimestamp}:R>`,
                    inline: true
                }
            ])
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        const enterLabel = '🎉 Enter Giveaway';
        const enterButton = new ButtonBuilder()
            .setCustomId(`giveaway_enter_${giveaway.id}`)
            .setLabel(enterLabel)
            .setStyle(ButtonStyle.Success);

        const enterButtonRow = new ActionRowBuilder().addComponents(enterButton);

        const notificationRoleId = await NOTIFICATIONS.getNotificationRoleIdForChannel(guild.id, giveawayChannel.id).catch(() => null);
        const mentionContent = notificationRoleId ? `<@&${notificationRoleId}>` : undefined;
        const message = await giveawayChannel.send({
            content: mentionContent,
            embeds: [giveawayEmbed],
            components: [enterButtonRow]
        });

        await db.updateGiveawayMessageId(giveaway.id, message.id);

        const successTitle = await translate('giveaway.created.title', interaction.guild.id, interaction.user.id);
        const successDescription = await translate('giveaway.created.description', interaction.guild.id, interaction.user.id, { channel: giveawayChannel.toString() });
        const successEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(successTitle)
            .setDescription(successDescription)
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.editReply({
            embeds: [successEmbed],
            components: []
        });

        await logger.log(`✅ Giveaway created by ${user.tag} (${user.id}) - ID: ${giveaway.id}`);

    } catch (error) {
        await logger.log(`❌ Error processing giveaway: ${error.message}`);
        await logger.log(`❌ Stack: ${error.stack}`);
        const errorMsg = await translate('giveaway.errors.createFailed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.editReply({
            content: errorMsg
        });
    }
}


export async function handleGiveawayEnterButton(interaction) {
    try {
        const customId = interaction.customId;
        if (!customId.startsWith('giveaway_enter_')) {
            return;
        }

        await interaction.deferReply({ flags: 64 });

        const member = interaction.member;
        const guild = interaction.guild;
        const user = interaction.user;
        const message = interaction.message;

        if (!message || !message.embeds || message.embeds.length === 0) {
            const errorMsg = await translate('giveaway.errors.invalidMessage', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const giveawayIdStr = customId.replace('giveaway_enter_', '');
        const giveawayId = parseInt(giveawayIdStr);

        if (isNaN(giveawayId)) {
            const errorMsg = await translate('giveaway.errors.invalidId', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const server = await getServerForCurrentBot(guild.id);
        const giveaway = await db.getGiveawayById(giveawayId);

        if (!giveaway || giveaway.server_id !== server.id) {
            const errorMsg = await translate('giveaway.errors.notFound', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        if (giveaway.status !== 'active') {
            const errorMsg = await translate('giveaway.errors.ended', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        let endsAt;
        if (giveaway.ends_at instanceof Date) {
            endsAt = giveaway.ends_at;
        } else {
            const dateStr = String(giveaway.ends_at).replace(' ', 'T') + 'Z';
            endsAt = new Date(dateStr);
        }
        const now = new Date();
        if (endsAt <= now) {
            const errorMsg = await translate('giveaway.errors.ended', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }


        if (giveaway.allowed_roles !== null && Array.isArray(giveaway.allowed_roles) && giveaway.allowed_roles.length > 0) {
            const memberRoles = member.roles.cache.map(role => role.id);
            const hasAllRequiredRoles = giveaway.allowed_roles.every(roleId => memberRoles.includes(roleId));

            if (!hasAllRequiredRoles) {
                const roleMentions = giveaway.allowed_roles.map(roleId => {
                    const role = guild.roles.cache.get(roleId);
                    return role ? `<@&${roleId}>` : `Role ${roleId}`;
                }).join(', ');

                const errorMsg = await translate('giveaway.errors.roleRestriction', interaction.guild.id, interaction.user.id, { roles: roleMentions });
                await interaction.editReply({
                    content: errorMsg
                });
                return;
            }
        }

        const dbMember = await db.getMemberByDiscordId(server.id, user.id);
        if (!dbMember) {
            const errorMsg = await translate('giveaway.errors.memberNotFoundDB', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        if (giveaway.member_id === dbMember.id) {
            const creatorCanParticipate = await GIVEAWAY.getCreatorCanParticipate(guild.id);
            if (!creatorCanParticipate) {
                const errorMsg = await translate('giveaway.errors.cannotEnterOwn', interaction.guild.id, interaction.user.id);
                await interaction.editReply({
                    content: errorMsg
                });
                return;
            }
        }

        const entries = await db.getGiveawayEntries(giveaway.id);
        const existingEntry = entries.find(e => e.member_id === dbMember.id);

        if (existingEntry && !giveaway.multiple_entries_allowed) {
            const errorMsg = await translate('giveaway.errors.alreadyEntered', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        await db.addGiveawayEntry(giveaway.id, dbMember.id, giveaway.multiple_entries_allowed);

        const embedConfig = await getEmbedConfig(guild.id);
        const enteredTitle = await translate('giveaway.entered.title', interaction.guild.id, interaction.user.id);
        const enteredDescription = await translate('giveaway.entered.description', interaction.guild.id, interaction.user.id);
        const successEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(enteredTitle)
            .setDescription(enteredDescription)
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.editReply({
            embeds: [successEmbed]
        });

        await logger.log(`✅ ${user.tag} (${user.id}) entered giveaway ${giveaway.id}`);

    } catch (error) {
        await logger.log(`❌ Error processing giveaway entry: ${error.message}`);
        await interaction.editReply({
            content: `❌ **Failed to Enter Giveaway**\n\nError: ${error.message}`
        }).catch(() => null);
    }
}

export async function handleGiveawayFinish(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        const member = interaction.member;
        const guild = interaction.guild;
        const user = interaction.user;

        if (!(await hasPermission(member, 'giveaway'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'giveaway', interaction.user.id);
            await interaction.editReply({
                content: errorMessage
            }).catch(() => null);
            return;
        }

        const giveawayId = parseInt(interaction.customId.replace('giveaway_finish_', ''));
        if (isNaN(giveawayId)) {
            const errorMsg = await translate('giveaway.errors.invalidId', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const server = await getServerForCurrentBot(guild.id);
        const dbMember = await db.getMemberByDiscordId(server.id, user.id);
        if (!dbMember) {
            const errorMsg = await translate('giveaway.errors.memberNotFoundDB', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const giveaway = await db.getGiveawayById(giveawayId);
        if (!giveaway) {
            const errorMsg = await translate('giveaway.errors.notFound', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        if (giveaway.member_id !== dbMember.id) {
            const errorMsg = await translate('giveaway.errors.finishOwnOnly', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        if (giveaway.status !== 'active') {
            const errorMsg = await translate('giveaway.errors.finishNotActive', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        await db.markGiveawayEndedForce(giveawayId);

        let giveawayChannelId;
        try {
            giveawayChannelId = await GIVEAWAY.getChannel(guild.id);
        } catch (err) {
            await logger.log(`❌ Error getting giveaway channel: ${err.message}`);
            const errorMsg = await translate('giveaway.errors.finishChannelError', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        if (!giveawayChannelId) {
            const errorMsg = await translate('giveaway.errors.finishChannelNotConfigured', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const channel = guild.channels.cache.get(giveawayChannelId);
        if (!channel) {
            const errorMsg = await translate('giveaway.errors.finishChannelNotFound', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const message = await channel.messages.fetch(giveaway.discord_message_id).catch(() => null);
        if (message) {
            await message.edit({ components: [] }).catch(() => null);
        }

        const entries = await db.getGiveawayEntries(giveaway.id);
        const embedConfig = await getEmbedConfig(guild.id);

        if (entries.length === 0) {
            const noEntriesEmbed = new EmbedBuilder()
                .setColor(embedConfig.COLOR)
                .setTitle('🎉 Giveaway Ended')
                .setDescription(`**${giveaway.title}**\n\n❌ No entries! The giveaway has ended with no participants.`)
                .setTimestamp()
                .setFooter({ text: embedConfig.FOOTER });

            const noEntriesMention = await NOTIFICATIONS.getNotificationRoleIdForChannel(guild.id, channel.id).catch(() => null);
            await channel.send({
                content: noEntriesMention ? `<@&${noEntriesMention}>` : undefined,
                embeds: [noEntriesEmbed]
            }).catch(() => null);

            const successEmbed = new EmbedBuilder()
                .setColor(embedConfig.COLOR)
                .setTitle('✅ Giveaway Finished')
                .setDescription(`Your giveaway **"${giveaway.title}"** has been finished early.\n\nNo participants entered.`)
                .setTimestamp()
                .setFooter({ text: embedConfig.FOOTER });

            await interaction.editReply({
                embeds: [successEmbed]
            }).catch(() => null);

            await logger.log(`✅ Giveaway ${giveawayId} finished early by ${user.tag} (${user.id}) - No entries`);
            return;
        }

        const winners = await db.getRandomGiveawayWinners(giveaway.id, giveaway.winner_count);

        if (winners.length === 0) {
            const noWinnersEmbed = new EmbedBuilder()
                .setColor(embedConfig.COLOR)
                .setTitle('🎉 Giveaway Ended')
                .setDescription(`**${giveaway.title}**\n\n❌ Could not select winners.`)
                .setTimestamp()
                .setFooter({ text: embedConfig.FOOTER });

            const noWinnersMention = await NOTIFICATIONS.getNotificationRoleIdForChannel(guild.id, channel.id).catch(() => null);
            await channel.send({
                content: noWinnersMention ? `<@&${noWinnersMention}>` : undefined,
                embeds: [noWinnersEmbed]
            }).catch(() => null);

            const successEmbed = new EmbedBuilder()
                .setColor(embedConfig.COLOR)
                .setTitle('✅ Giveaway Finished')
                .setDescription(`Your giveaway **"${giveaway.title}"** has been finished early.\n\nCould not select winners.`)
                .setTimestamp()
                .setFooter({ text: embedConfig.FOOTER });

            await interaction.editReply({
                embeds: [successEmbed]
            }).catch(() => null);

            await logger.log(`✅ Giveaway ${giveawayId} finished early by ${user.tag} (${user.id}) - No winners selected`);
            return;
        }

        const winnerMentions = winners.map(w => `<@${w.discord_member_id}>`).join(', ');

        const winnerMemberIds = winners.map(w => w.member_id);
        await db.markGiveawayWinners(giveaway.id, winnerMemberIds);

        let description = `**${giveaway.title}**\n\n**Prize:** ${giveaway.prize}\n\n🎊 **Winner${winners.length > 1 ? 's' : ''}:** ${winnerMentions}\n\n`;

        if (winners.length < giveaway.winner_count) {
            description += `⚠️ *Only ${winners.length} winner${winners.length > 1 ? 's' : ''} selected (${giveaway.winner_count} requested) due to limited entries.*\n\n`;
        }

        description += `Congratulations! 🎉`;

        const winnersEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle('🎉 Giveaway Ended!')
            .setDescription(description)
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        const winnersMention = await NOTIFICATIONS.getNotificationRoleIdForChannel(guild.id, channel.id).catch(() => null);
        await channel.send({
            content: winnersMention ? `<@&${winnersMention}>` : undefined,
            embeds: [winnersEmbed]
        }).catch(() => null);

        const successEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle('✅ Giveaway Finished')
            .setDescription(`Your giveaway **"${giveaway.title}"** has been finished early.\n\n**Winners:** ${winnerMentions}`)
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.editReply({
            embeds: [successEmbed]
        }).catch(() => null);

        await logger.log(`✅ Giveaway ${giveawayId} finished early by ${user.tag} (${user.id}) - Winners: ${winners.map(w => w.discord_member_id).join(', ')}`);

    } catch (error) {
        await logger.log(`❌ Error finishing giveaway: ${error.message}`);
        await interaction.editReply({
            content: `❌ Failed to finish giveaway: ${error.message}`
        }).catch(() => null);
    }
}

async function processEndedGiveaways(client) {
        try {
            const endedGiveaways = await db.getEndedGiveaways();

            for (const giveaway of endedGiveaways) {
                try {
                    const server = await db.getServer(giveaway.server_id);
                    if (!server) continue;

                    const guild = client.guilds.cache.get(server.discord_server_id);
                    if (!guild) continue;

                    let giveawayChannelId;
                    try {
                        giveawayChannelId = await GIVEAWAY.getChannel(guild.id);
                    } catch (err) {
                        await logger.log(`❌ Error getting giveaway channel for server ${server.id}: ${err.message}`);
                        continue;
                    }

                    if (!giveawayChannelId) {
                        await logger.log(`⚠️ Giveaway channel not configured for server ${server.id}, skipping giveaway ${giveaway.id}`);
                        continue;
                    }

                    const channel = guild.channels.cache.get(giveawayChannelId);
                    if (!channel) {
                        await logger.log(`⚠️ Giveaway channel ${giveawayChannelId} not found in guild ${guild.id}, skipping giveaway ${giveaway.id}`);
                        continue;
                    }

                    const message = await channel.messages.fetch(giveaway.discord_message_id).catch(() => null);
                    if (!message) continue;

                    await db.markGiveawayEnded(giveaway.id);

                    const entries = await db.getGiveawayEntries(giveaway.id);

                    if (entries.length === 0) {

                        await message.edit({
                            components: []
                        });


                        const embedConfig = await getEmbedConfig(guild.id);
                        const noEntriesEmbed = new EmbedBuilder()
                            .setColor(embedConfig.COLOR)
                            .setTitle('🎉 Giveaway Ended')
                            .setDescription(`**${giveaway.title}**\n\n❌ No entries! The giveaway has ended with no participants.`)
                            .setTimestamp()
                            .setFooter({ text: embedConfig.FOOTER });

                        const noEntriesMention = await NOTIFICATIONS.getNotificationRoleIdForChannel(guild.id, channel.id).catch(() => null);
                        await channel.send({
                            content: noEntriesMention ? `<@&${noEntriesMention}>` : undefined,
                            embeds: [noEntriesEmbed]
                        });

                        await logger.log(`✅ Giveaway ${giveaway.id} ended with no entries`);
                        continue;
                    }

                    const winners = await db.getRandomGiveawayWinners(giveaway.id, giveaway.winner_count);

                    if (winners.length === 0) {

                        await message.edit({
                            components: []
                        });


                        const embedConfig = await getEmbedConfig(guild.id);
                        const noWinnersEmbed = new EmbedBuilder()
                            .setColor(embedConfig.COLOR)
                            .setTitle('🎉 Giveaway Ended')
                            .setDescription(`**${giveaway.title}**\n\n❌ Could not select winners.`)
                            .setTimestamp()
                            .setFooter({ text: embedConfig.FOOTER });

                        const noWinnersMention = await NOTIFICATIONS.getNotificationRoleIdForChannel(guild.id, channel.id).catch(() => null);
                        await channel.send({
                            content: noWinnersMention ? `<@&${noWinnersMention}>` : undefined,
                            embeds: [noWinnersEmbed]
                        });

                        await logger.log(`✅ Giveaway ${giveaway.id} ended but no winners could be selected`);
                        continue;
                    }

                    const winnerMentions = winners.map(w => `<@${w.discord_member_id}>`).join(', ');
                    const embedConfig = await getEmbedConfig(guild.id);

                    const winnerMemberIds = winners.map(w => w.member_id);
                    await db.markGiveawayWinners(giveaway.id, winnerMemberIds);

                    let description = `**${giveaway.title}**\n\n**Prize:** ${giveaway.prize}\n\n🎊 **Winner${winners.length > 1 ? 's' : ''}:** ${winnerMentions}\n\n`;

                    if (winners.length < giveaway.winner_count) {
                        description += `⚠️ *Only ${winners.length} winner${winners.length > 1 ? 's' : ''} selected (${giveaway.winner_count} requested) due to limited entries.*\n\n`;
                    }

                    description += `Congratulations! 🎉`;

                    const winnersEmbed = new EmbedBuilder()
                        .setColor(embedConfig.COLOR)
                        .setTitle('🎉 Giveaway Ended!')
                        .setDescription(description)
                        .setTimestamp()
                        .setFooter({ text: embedConfig.FOOTER });


                    await message.edit({
                        components: []
                    });

                    const winnersMention = await NOTIFICATIONS.getNotificationRoleIdForChannel(guild.id, channel.id).catch(() => null);
                    await channel.send({
                        content: winnersMention ? `<@&${winnersMention}>` : undefined,
                        embeds: [winnersEmbed]
                    });

                    await logger.log(`✅ Giveaway ${giveaway.id} ended - Winners: ${winners.map(w => w.discord_member_id).join(', ')}`);

                } catch (err) {
                    await logger.log(`❌ Error ending giveaway ${giveaway.id}: ${err.message}`);
                }
            }
        } catch (error) {
            await logger.log(`❌ Error checking ended giveaways: ${error.message}`);
        }
}

export function init(client) {
    processEndedGiveaways(client).then(() => {
        logger.log("✅ Checked for ended giveaways on startup");
    }).catch(err => {
        logger.log(`❌ Error processing ended giveaways on startup: ${err.message}`);
    });

    setInterval(() => {
        processEndedGiveaways(client);
    }, 60000);

    logger.log("🎉 Giveaway component initialized - Checking for ended giveaways every minute");
}

export default { init };
