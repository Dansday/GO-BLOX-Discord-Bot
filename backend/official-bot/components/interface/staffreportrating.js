import { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getEmbedConfig, STAFF_RATING, getBotConfig, PERMISSIONS } from '../../../config.js';
import logger from '../../../logger.js';
import { hasPermission, getPermissionDeniedMessage } from '../permissions.js';
import { translate } from '../../../i18n.js';
import db from '../../../../database/database.js';
import { updateStaffRatingRole } from '../staffreportrating.js';
import { parseMySQLDateTime } from '../../../utils.js';

const VALID_CATEGORIES = ['excellent', 'helpful', 'slow_response', 'unhelpful', 'rude', 'abuse'];
const CATEGORY_LABELS_EN = {
    helpful: '👍 Helpful',
    unhelpful: '👎 Unhelpful',
    abuse: '⚠️ Abuse of Power',
    slow_response: '⏰ Slow Response',
    excellent: '⭐ Excellent Service',
    rude: '😠 Rude Behavior'
};

async function getCategoryLabel(guildId, userId, category) {
    const key = `staffReport.categories.${category}`;
    return await translate(key, guildId, userId);
}

function getCategoryLabelEnglish(category) {
    return CATEGORY_LABELS_EN[category] ?? category;
}

async function buildStaffReportComponents(guild, userId, staffUserId, selectedRating, selectedCategory) {
    const ratingPlaceholder = await translate('staffReport.selectRatingPrompt', guild.id, userId);
    const categoryPlaceholder = await translate('staffReport.selectCategoryPrompt', guild.id, userId);

    const categoryOptions = await Promise.all(
        VALID_CATEGORIES.map(async category => ({
            label: await getCategoryLabel(guild.id, userId, category),
            value: category,
            default: selectedCategory === category
        }))
    );

    const ratingOptions = ['5', '4', '3', '2', '1'].map(value => ({
        label: `⭐ ${value}`,
        value,
        default: selectedRating === value
    }));

    const categorySelect = new StringSelectMenuBuilder()
        .setCustomId(`staff_report_category|${staffUserId}|${selectedRating || 'none'}`)
        .setPlaceholder(categoryPlaceholder)
        .addOptions(categoryOptions);

    const ratingSelect = new StringSelectMenuBuilder()
        .setCustomId(`staff_report_rating|${staffUserId}|${selectedCategory || 'none'}`)
        .setPlaceholder(ratingPlaceholder)
        .addOptions(ratingOptions);

    const continueButton = new ButtonBuilder()
        .setCustomId(`staff_report_continue|${staffUserId}|${selectedRating || 'none'}|${selectedCategory || 'none'}`)
        .setLabel(await translate('staffReport.buttons.continue', guild.id, userId))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!(selectedRating && selectedCategory));

    const backButton = new ButtonBuilder()
        .setCustomId('staff_report_back_to_staff')
        .setLabel(await translate('staffReport.buttons.changeStaff', guild.id, userId))
        .setStyle(ButtonStyle.Secondary);

    return [
        new ActionRowBuilder().addComponents(categorySelect),
        new ActionRowBuilder().addComponents(ratingSelect),
        new ActionRowBuilder().addComponents(continueButton, backButton)
    ];
}

async function renderStaffReportSetup(interaction, staffUserId, selectedRating, selectedCategory, staffMemberOverride = null) {
    const guild = interaction.guild;
    const staffMember = staffMemberOverride || await guild.members.fetch(staffUserId).catch(() => null);
    if (!staffMember) {
        const errorMsg = await translate('common.errors.memberNotFound', guild.id, interaction.user.id);
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: errorMsg, components: [] }).catch(() => null);
        } else {
            await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => null);
        }
        return;
    }

    const embedConfig = await getEmbedConfig(guild.id);
    const title = await translate('staffReport.title', guild.id, interaction.user.id);
    const staffLine = await translate('staffReport.status.staff', guild.id, interaction.user.id, { staff: `<@${staffUserId}>` });
    const categoryValue = selectedCategory ? await getCategoryLabel(guild.id, interaction.user.id, selectedCategory) : null;
    const categoryLine = categoryValue
        ? await translate('staffReport.status.categorySelected', guild.id, interaction.user.id, { category: categoryValue })
        : await translate('staffReport.status.categoryPending', guild.id, interaction.user.id);
    const ratingLine = selectedRating
        ? await translate('staffReport.status.ratingSelected', guild.id, interaction.user.id, { rating: selectedRating })
        : await translate('staffReport.status.ratingPending', guild.id, interaction.user.id);

    const embed = new EmbedBuilder()
        .setColor(embedConfig.COLOR)
        .setTitle(title)
        .setDescription([staffLine, categoryLine, ratingLine].join('\n'))
        .setTimestamp()
        .setFooter({ text: embedConfig.FOOTER });

    const components = await buildStaffReportComponents(guild, interaction.user.id, staffUserId, selectedRating, selectedCategory);

    await interaction.update({
        embeds: [embed],
        components
    });
}

async function buildStaffOptions(interaction) {
    const guild = interaction.guild;

    try {
        const perms = await PERMISSIONS.getPermissions(guild.id);
        const staffRoleIds = perms?.STAFF_ROLES?.filter(Boolean) || [];

        if (!staffRoleIds.length) {
            return { options: [], reason: 'no_config' };
        }

        const staffMembers = new Map();

        for (const roleId of staffRoleIds) {
            const role = guild.roles.cache.get(roleId);
        if (!role) continue;
            role.members.forEach(member => {
                if (!member.user.bot) {
                    staffMembers.set(member.id, member);
                }
            });
        }

        if (staffMembers.size === 0) {
            await guild.members.fetch({ withPresences: false }).catch(() => null);
            guild.members.cache.forEach(member => {
                if (member.user.bot) return;
                if (member.roles.cache.some(role => staffRoleIds.includes(role.id))) {
                    staffMembers.set(member.id, member);
                }
            });
        }

        if (staffMembers.size === 0) {
            return { options: [], reason: 'no_staff' };
        }

        const options = Array.from(staffMembers.values())
            .sort((a, b) => {
                const aPos = a.roles?.highest?.position ?? 0;
                const bPos = b.roles?.highest?.position ?? 0;
                return bPos - aPos;
            })
            .slice(0, 25)
            .map(member => {
                const baseLabel = member.displayName || member.user.globalName || member.user.username || member.user.tag || member.id;
                const label = baseLabel.slice(0, 100);
                return {
                    label,
                    value: member.id
                };
            });

        return { options, reason: null };
    } catch (error) {
        await logger.log(`❌ Failed to build staff options: ${error.message}`);
        return { options: [], reason: 'error' };
    }
}

function truncateDescription(text) {
    if (!text) {
        return '—';
    }
    if (text.length > 1024) {
        return `${text.slice(0, 1021)}...`;
    }
    return text;
}

function buildReportLogEmbed({
    embedConfig,
    title,
    staffUserId,
    rating,
    categoryLabel,
    description,
    reporterDisplay,
    statusText,
    reportId,
    color
}) {
    const embed = new EmbedBuilder()
        .setColor(color ?? embedConfig.COLOR)
        .setTitle(title)
        .addFields(
            {
                name: 'Staff Member',
                value: `<@${staffUserId}>`,
                inline: true
            },
            {
                name: 'Rating',
                value: `${rating}/5`,
                inline: true
            },
            {
                name: 'Category',
                value: categoryLabel,
                inline: true
            },
            {
                name: 'Reporter',
                value: reporterDisplay,
                inline: true
            },
            {
                name: 'Status',
                value: statusText,
                inline: true
            },
            {
                name: 'Description',
                value: truncateDescription(description),
                inline: false
            }
        )
        .setFooter({ text: `${embedConfig.FOOTER} • Report ID: #${reportId}` })
        .setTimestamp();
    return embed;
}

export async function handleStaffReportButton(interaction) {
    try {
        const member = interaction.member;

        if (!(await hasPermission(member, 'staff_report'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'staff_report', interaction.user.id);
            await interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null);
            return;
        }

        const config = await STAFF_RATING.getConfig(interaction.guild.id);
        if (!config) {
            const errorMsg = await translate('staffReport.errors.notConfigured', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            });
            return;
        }

        const selectStaffLabel = await translate('staffReport.selectStaff', interaction.guild.id, interaction.user.id);
        const selectStaffPlaceholder = await translate('staffReport.selectStaffPlaceholder', interaction.guild.id, interaction.user.id);

        const { options: staffOptions, reason: staffReason } = await buildStaffOptions(interaction);
        if (!staffOptions || staffOptions.length === 0) {
            const errorKey = staffReason === 'no_config'
                ? 'staffReport.errors.noStaffConfigured'
                : 'staffReport.errors.noStaffAvailable';
            const errorMsg = await translate(errorKey, interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            }).catch(() => null);
            return;
        }

        const staffSelect = new StringSelectMenuBuilder()
            .setCustomId('staff_report_select_user')
            .setPlaceholder(selectStaffPlaceholder)
            .addOptions(staffOptions);

        const menuButton = new ButtonBuilder()
            .setCustomId('bot_menu')
            .setLabel('📋 Menu')
            .setStyle(ButtonStyle.Secondary);

        const selectRow = new ActionRowBuilder().addComponents(staffSelect);
        const buttonRow = new ActionRowBuilder().addComponents(menuButton);

        const embedConfig = await getEmbedConfig(interaction.guild.id);
        const title = await translate('staffReport.title', interaction.guild.id, interaction.user.id);

        const embed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(title)
            .setDescription(selectStaffLabel)
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.update({
            embeds: [embed],
            components: [selectRow, buttonRow]
        });

        await logger.log(`📋 Staff report user selection shown to ${member.user.tag} (${member.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error showing staff report selection: ${error.message}`);
        const errorMsg = await translate('staffReport.errors.submitFailed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.reply({
            content: errorMsg,
            flags: 64
        }).catch(() => null);
    }
}

export async function handleStaffReportUserSelect(interaction) {
    try {
        const member = interaction.member;
        const selectedUserId = interaction.values[0];

        if (!(await hasPermission(member, 'staff_report'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'staff_report', interaction.user.id);
            await interaction.update({
                content: errorMessage,
                components: [],
                embeds: [],
                flags: 64
            }).catch(() => null);
            return;
        }

        if (selectedUserId === member.id) {
            const errorMsg = await translate('staffReport.errors.cannotReportSelf', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            });
            return;
        }

        const selectedMember = await interaction.guild.members.fetch(selectedUserId).catch(() => null);
        if (!selectedMember) {
            const errorMsg = await translate('common.errors.memberNotFound', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            });
            return;
        }

        const isStaff = await hasPermission(selectedMember, 'send_message');
        if (!isStaff) {
            const errorMsg = await translate('staffReport.errors.notStaff', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            });
            return;
        }

        const botConfig = getBotConfig();
        const server = await db.getServerByDiscordId(botConfig.id, interaction.guild.id);
        const reporterDbMember = await db.upsertMember(server.id, member);
        const staffDbMember = await db.upsertMember(server.id, selectedMember);

        const lastReport = await db.getLastStaffRatingReport(server.id, reporterDbMember.id, staffDbMember.id);
        if (lastReport) {
            const cooldownDays = await STAFF_RATING.getCooldownDays(interaction.guild.id);
            const lastRatedDate = parseMySQLDateTime(lastReport.reported_at);
            if (!lastRatedDate) {
                await logger.log(`⚠️ Could not parse reported_at for report ${lastReport.id}: ${lastReport.reported_at}`);
                const errorMsg = await translate('staffReport.errors.submitFailed', interaction.guild.id, interaction.user.id, { error: 'Invalid timestamp data' });
                await interaction.reply({
                    content: errorMsg,
                    flags: 64
                });
                return;
            }
            const lastRatedTime = lastRatedDate.getTime();
            const now = Date.now();
            const daysPassed = (now - lastRatedTime) / (1000 * 60 * 60 * 24);

            if (Number.isFinite(cooldownDays) && cooldownDays > 0 && daysPassed < cooldownDays) {
                const daysRemaining = Math.ceil(cooldownDays - daysPassed);
                const lastRatedStr = `<t:${Math.floor(lastRatedTime / 1000)}:R>`;

                const timeRemaining = daysRemaining;
                const timeUnitKey = daysRemaining === 1 ? 'common.timeUnits.day' : 'common.timeUnits.days';

                const timeUnit = await translate(timeUnitKey, interaction.guild.id, interaction.user.id);
                const errorMsg = await translate('staffReport.errors.onCooldown', interaction.guild.id, interaction.user.id, {
                    time: timeRemaining,
                    unit: timeUnit,
                    lastRated: lastRatedStr
                });
                await interaction.reply({
                    content: errorMsg,
                    flags: 64
                });
                return;
            }
        }

        await renderStaffReportSetup(interaction, selectedUserId, null, null, selectedMember);
        return;

    } catch (error) {
        await logger.log(`❌ Error handling staff report user selection: ${error.message}`);
        const errorMsg = await translate('staffReport.errors.submitFailed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.reply({
            content: errorMsg,
            flags: 64
        }).catch(() => null);
    }
}

export async function handleStaffReportRatingSelect(interaction) {
    try {
        const [, staffUserId, rawCategory] = interaction.customId.split('|');
        const selectedRating = interaction.values[0];
        const selectedCategory = rawCategory && rawCategory !== 'none' ? rawCategory : null;
        await renderStaffReportSetup(interaction, staffUserId, selectedRating, selectedCategory);
    } catch (error) {
        await logger.log(`❌ Error handling staff report rating select: ${error.message}`);
        const errorMsg = await translate('staffReport.errors.submitFailed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.reply({
            content: errorMsg,
            flags: 64
        }).catch(() => null);
    }
}

export async function handleStaffReportCategorySelect(interaction) {
    try {
        const [, staffUserId, rawRating] = interaction.customId.split('|');
        const selectedCategory = interaction.values[0];
        const selectedRating = rawRating && rawRating !== 'none' ? rawRating : null;
        await renderStaffReportSetup(interaction, staffUserId, selectedRating, selectedCategory);
    } catch (error) {
        await logger.log(`❌ Error handling staff report category select: ${error.message}`);
        const errorMsg = await translate('staffReport.errors.submitFailed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.reply({
            content: errorMsg,
            flags: 64
        }).catch(() => null);
    }
}

export async function handleStaffReportContinue(interaction) {
    try {
        const [, staffUserId, ratingValue, categoryValue] = interaction.customId.split('|');
        if (!ratingValue || ratingValue === 'none') {
            const errorMsg = await translate('staffReport.errors.missingRating', interaction.guild.id, interaction.user.id);
            await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => null);
            return;
        }
        if (!categoryValue || categoryValue === 'none') {
            const errorMsg = await translate('staffReport.errors.missingCategory', interaction.guild.id, interaction.user.id);
            await interaction.reply({ content: errorMsg, flags: 64 }).catch(() => null);
            return;
        }

        const modalTitle = await translate('staffReport.modal.title', interaction.guild.id, interaction.user.id);
        const modal = new ModalBuilder()
            .setCustomId(`staff_report_submit|${staffUserId}|${ratingValue}|${categoryValue}`)
            .setTitle(modalTitle);

        const descriptionLabel = await translate('staffReport.modal.descriptionLabel', interaction.guild.id, interaction.user.id);
        const descriptionPlaceholder = await translate('staffReport.modal.descriptionPlaceholder', interaction.guild.id, interaction.user.id);
        const descriptionInput = new TextInputBuilder()
            .setCustomId('description')
            .setLabel(descriptionLabel)
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(descriptionPlaceholder)
            .setRequired(true)
            .setMaxLength(1000);

        const anonymousLabel = await translate('staffReport.modal.anonymousLabel', interaction.guild.id, interaction.user.id);
        const anonymousPlaceholder = await translate('staffReport.modal.anonymousPlaceholder', interaction.guild.id, interaction.user.id);
        const anonymousInput = new TextInputBuilder()
            .setCustomId('anonymous')
            .setLabel(anonymousLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(anonymousPlaceholder)
            .setRequired(false)
            .setMaxLength(3);

        modal.addComponents(
            new ActionRowBuilder().addComponents(descriptionInput),
            new ActionRowBuilder().addComponents(anonymousInput)
        );

        await interaction.showModal(modal);
    } catch (error) {
        await logger.log(`❌ Error handling staff report continue: ${error.message}`);
        const errorMsg = await translate('staffReport.errors.submitFailed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.reply({
            content: errorMsg,
            flags: 64
                    }).catch(() => null);
                }
            }

export async function handleStaffReportModal(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        const member = interaction.member;
        const guild = interaction.guild;
        const user = interaction.user;

        if (!(await hasPermission(member, 'staff_report'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'staff_report', interaction.user.id);
            await interaction.editReply({
                content: errorMessage
            }).catch(() => null);
            return;
        }

        const [, staffUserId, ratingValue, categoryValue] = interaction.customId.split('|');
        const rating = parseInt(ratingValue, 10);
        const category = categoryValue;

        if (isNaN(rating) || rating < 1 || rating > 5) {
            const errorMsg = await translate('staffReport.errors.invalidRating', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        if (!VALID_CATEGORIES.includes(category)) {
            const errorMsg = await translate('staffReport.errors.invalidCategory', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const description = interaction.fields.getTextInputValue('description').trim();
        if (!description || description.length === 0) {
            const errorMsg = await translate('staffReport.errors.emptyDescription', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const anonymousValue = interaction.fields.getTextInputValue('anonymous')?.trim().toLowerCase() || 'no';
        const isAnonymous = anonymousValue === 'yes' || anonymousValue === 'ya';

        const botConfig = getBotConfig();
        const server = await db.getServerByDiscordId(botConfig.id, guild.id);

        const reporterDbMember = await db.upsertMember(server.id, member);
        const staffMember = await guild.members.fetch(staffUserId).catch(() => null);
        if (!staffMember) {
            const errorMsg = await translate('common.errors.memberNotFound', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const isStaff = await hasPermission(staffMember, 'send_message');
        if (!isStaff) {
            const errorMsg = await translate('staffReport.errors.notStaff', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const staffDbMember = await db.upsertMember(server.id, staffMember);

        const lastReport = await db.getLastStaffRatingReport(server.id, reporterDbMember.id, staffDbMember.id);
        if (lastReport) {
            const cooldownDays = await STAFF_RATING.getCooldownDays(interaction.guild.id);
            const lastRatedDate = parseMySQLDateTime(lastReport.reported_at);
            if (!lastRatedDate) {
                await logger.log(`⚠️ Could not parse reported_at for report ${lastReport.id}: ${lastReport.reported_at}`);
                const errorMsg = await translate('staffReport.errors.submitFailed', interaction.guild.id, interaction.user.id, { error: 'Invalid timestamp data' });
                await interaction.editReply({
                    content: errorMsg
                });
                return;
            }
            const lastRatedTime = lastRatedDate.getTime();
            const now = Date.now();
            const daysPassed = (now - lastRatedTime) / (1000 * 60 * 60 * 24);

            if (Number.isFinite(cooldownDays) && cooldownDays > 0 && daysPassed < cooldownDays) {
                const daysRemaining = Math.ceil(cooldownDays - daysPassed);
                const lastRatedStr = `<t:${Math.floor(lastRatedTime / 1000)}:R>`;

                const timeRemaining = daysRemaining;
                const timeUnitKey = daysRemaining === 1 ? 'common.timeUnits.day' : 'common.timeUnits.days';

                const timeUnit = await translate(timeUnitKey, interaction.guild.id, interaction.user.id);
                const errorMsg = await translate('staffReport.errors.onCooldown', interaction.guild.id, interaction.user.id, {
                    time: timeRemaining,
                    unit: timeUnit,
                    lastRated: lastRatedStr
                });
                await interaction.editReply({
                    content: errorMsg
                });
                return;
            }
        }

        const reportId = await db.createStaffRatingReport(
            server.id,
            reporterDbMember.id,
            staffDbMember.id,
            rating,
            category,
            description,
            isAnonymous
        );

        const embedConfig = await getEmbedConfig(interaction.guild.id);
        const successTitle = await translate('staffReport.submitted.title', interaction.guild.id, interaction.user.id);
        let successDescription = await translate('staffReport.submitted.description', interaction.guild.id, interaction.user.id);

        if (isAnonymous) {
            const anonymousText = await translate('staffReport.submitted.anonymous', interaction.guild.id, interaction.user.id);
            successDescription += anonymousText;
        }

        const successEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(successTitle)
            .setDescription(successDescription)
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.editReply({
            embeds: [successEmbed]
        });

        const reportChannelId = await STAFF_RATING.getReportChannel(guild.id);
        const categoryLabel = await getCategoryLabel(interaction.guild.id, interaction.user.id, category);
        if (reportChannelId) {
            const reportChannel = guild.channels.cache.get(reportChannelId) || await guild.channels.fetch(reportChannelId).catch(() => null);
            if (reportChannel && reportChannel.isTextBased()) {
                const reporterDisplay = isAnonymous ? 'Anonymous' : `<@${interaction.user.id}>`;
                const pendingTitle = '🕒 Pending Staff Report';
                const pendingStatus = 'Pending admin approval';
                const approveLabel = 'Approve Report';
                const rejectLabel = 'Reject Report';

                const logEmbed = buildReportLogEmbed({
                    embedConfig,
                    title: pendingTitle,
                    staffUserId,
                    rating,
                    categoryLabel,
                    description,
                    reporterDisplay,
                    statusText: pendingStatus,
                    reportId,
                    color: embedConfig.COLOR
                });

                const approveButton = new ButtonBuilder()
                    .setCustomId(`staff_report_approve|${reportId}`)
                    .setLabel(approveLabel)
                    .setStyle(ButtonStyle.Success);

                const rejectButton = new ButtonBuilder()
                    .setCustomId(`staff_report_reject|${reportId}`)
                    .setLabel(rejectLabel)
                    .setStyle(ButtonStyle.Danger);

                await reportChannel.send({
                    embeds: [logEmbed],
                    components: [new ActionRowBuilder().addComponents(approveButton, rejectButton)]
        }).catch(() => null);
            }
        }

        await logger.log(`✅ Staff report #${reportId} submitted by ${user.tag} (${user.id}) for staff ${staffMember.user.tag} (${staffUserId}) - Rating: ${rating}, Category: ${category}`);

    } catch (error) {
        await logger.log(`❌ Error processing staff report: ${error.message}`);
        await logger.log(`❌ Stack: ${error.stack}`);
        const errorMsg = await translate('staffReport.errors.submitFailed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.editReply({
            content: errorMsg
        });
    }
}

async function notifyReporterOfDecision(guild, report, translationKey, categoryLabel) {
    if (!report?.reporter_discord_id) {
        return;
    }
    const reporterUser = await guild.client.users.fetch(report.reporter_discord_id).catch(() => null);
    if (!reporterUser) {
        return;
    }
    const content = await translate(translationKey, guild.id, reporterUser.id, {
        staff: `<@${report.staff_discord_id}>`,
        rating: report.rating,
        category: categoryLabel,
        description: truncateDescription(report.description),
        server: guild.name
    });
    await reporterUser.send({
        content
    }).catch(() => null);
}

async function handleStaffReportDecision(interaction, decision) {
    try {
        await interaction.deferReply({ flags: 64 });

        const guild = interaction.guild;
        const moderator = interaction.member || await guild.members.fetch(interaction.user.id).catch(() => null);

        if (!moderator || !(await hasPermission(moderator, 'setup'))) {
            const errorMessage = await getPermissionDeniedMessage(guild, 'setup', interaction.user.id);
            await interaction.editReply({ content: errorMessage }).catch(() => null);
            return;
        }

        const [, reportIdStr] = interaction.customId.split('|');
        const reportId = parseInt(reportIdStr, 10);
        if (!Number.isFinite(reportId)) {
            await interaction.editReply({
                content: await translate('staffReport.errors.submitFailed', guild.id, interaction.user.id, { error: 'Invalid report ID' })
            }).catch(() => null);
            return;
        }

        const botConfig = getBotConfig();
        const server = await db.getServerByDiscordId(botConfig.id, guild.id);
        if (!server) {
            await interaction.editReply({
                content: await translate('staffReport.errors.submitFailed', guild.id, interaction.user.id, { error: 'Server not found' })
            }).catch(() => null);
            return;
        }

        const report = await db.getStaffReportById(server.id, reportId);
        if (!report) {
            await interaction.editReply({
                content: await translate('staffReport.errors.submitFailed', guild.id, interaction.user.id, { error: 'Report not found' })
            }).catch(() => null);
            return;
        }

        if (report.status !== 'pending') {
            await interaction.editReply({ content: '⚠️ This report has already been processed.' }).catch(() => null);
            if (interaction.message) {
                await interaction.message.edit({ components: [] }).catch(() => null);
            }
            return;
        }

        const embedConfig = await getEmbedConfig(guild.id);
        const categoryLabel = await getCategoryLabel(guild.id, interaction.user.id, report.category);
        const categoryLabelEnglish = getCategoryLabelEnglish(report.category);
        const reporterDisplay = report.is_anonymous ? 'Anonymous' : `<@${report.reporter_discord_id}>`;

        let statusText = 'Pending admin approval';
        let title = '🕒 Pending Staff Report';
        let replyMessage = '';
        let color = embedConfig.COLOR;

        if (decision === 'approve') {
            await db.updateStaffReportStatus(report.id, 'approved');
            const aggregate = await db.getStaffRatingAggregate(server.id, report.reported_staff_id);
            await db.upsertStaffRating(server.id, report.reported_staff_id, aggregate.average_rating || report.rating, aggregate.total_reports);
            await updateStaffRatingRole(guild, server.id, report.reported_staff_id, report.staff_discord_id, {
                rating: aggregate.average_rating || report.rating,
                total_reports: aggregate.total_reports
            }, {
                channelContext: {
                    category: categoryLabelEnglish,
                    feedback: report.description
                }
            });
            await notifyReporterOfDecision(guild, report, 'staffReport.dm.approved', categoryLabel);
            statusText = `Approved by <@${interaction.user.id}>`;
            title = '✅ Staff Report Approved';
            replyMessage = `✅ Report #${report.id} approved.`;
            color = 0x22c55e;
        } else {
            await db.updateStaffReportStatus(report.id, 'rejected');
            await notifyReporterOfDecision(guild, report, 'staffReport.dm.rejected', categoryLabel);
            statusText = `Rejected by <@${interaction.user.id}>`;
            title = '❌ Staff Report Rejected';
            replyMessage = `❌ Report #${report.id} rejected.`;
            color = 0xef4444;
        }

        const updatedEmbed = buildReportLogEmbed({
            embedConfig,
            title,
            staffUserId: report.staff_discord_id,
            rating: report.rating,
            categoryLabel,
            description: report.description,
            reporterDisplay,
            statusText,
            reportId: report.id,
            color
        });

        if (interaction.message) {
            await interaction.message.edit({
                embeds: [updatedEmbed],
                components: []
            }).catch(() => null);
        }

        if (!replyMessage) {
            replyMessage = decision === 'approve'
                ? `✅ Report #${report.id} approved.`
                : `❌ Report #${report.id} rejected.`;
        }
        await interaction.editReply({ content: replyMessage }).catch(() => null);

        await logger.log(`${decision === 'approve' ? '✅' : '⛔'} Staff report #${report.id} ${decision} by ${interaction.user.tag} (${interaction.user.id})`);
    } catch (error) {
        await logger.log(`❌ Error handling staff report decision: ${error.message}`);
        await interaction.editReply({
            content: await translate('staffReport.errors.submitFailed', interaction.guild.id, interaction.user.id, { error: error.message })
        }).catch(() => null);
    }
}

export async function handleStaffReportApprove(interaction) {
    await handleStaffReportDecision(interaction, 'approve');
}

export async function handleStaffReportReject(interaction) {
    await handleStaffReportDecision(interaction, 'reject');
}
