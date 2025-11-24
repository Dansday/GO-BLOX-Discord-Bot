import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getEmbedConfig, getBotConfig } from "../../../config.js";
import { hasPermission, getPermissionDeniedMessage } from "../permissions.js";
import db from "../../../../database/database.js";
import logger from "../../../logger.js";
import { getLevelRequirement, determineLevel, sendLevelChangeDM, sendLevelUpNotification } from "../leveling.js";
import { translate } from "../../../i18n.js";

const PROGRESS_BAR_SLOTS = 10;

function buildProgressBar(ratio) {
    const filledSlots = Math.round(ratio * PROGRESS_BAR_SLOTS);
    const emptySlots = PROGRESS_BAR_SLOTS - filledSlots;
    return `${"█".repeat(Math.max(0, filledSlots))}${"░".repeat(Math.max(0, emptySlots))}`;
}

function formatNumber(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "0";
    }
    return value.toLocaleString();
}

async function refreshMemberLevelData(serverId, discordMemberId) {
    if (!serverId || !discordMemberId) {
        return null;
    }

    const levelData = await db.getMemberLevelByDiscordId(serverId, discordMemberId);
    if (!levelData) {
        return null;
    }

    const previousLevel = levelData.level ?? 1;
    const dmPreference = levelData.dm_notifications_enabled;
    const notificationsEnabled = !(dmPreference === false || dmPreference === 0);

    const botConfig = getBotConfig();
    let guildId = null;
    let serverName = null;
    if (botConfig && botConfig.id) {
        const servers = await db.getServersForBot(botConfig.id);
        const foundServer = servers.find(s => s.id === serverId);
        if (foundServer) {
            guildId = foundServer.discord_server_id;
            serverName = foundServer.name || null;
        }
    }

    if (!guildId) {
        return levelData;
    }

    const currentExperience = levelData.experience ?? 0;
    const recalculatedLevel = await determineLevel(currentExperience, guildId);
    const updates = {};

    if ((levelData.level ?? 1) !== recalculatedLevel) {
        updates.level = recalculatedLevel;
    }

    if (Object.keys(updates).length > 0) {
        const updatedStats = await db.updateMemberLevelStats(levelData.member_id, updates);
        if (updatedStats) {
            if (recalculatedLevel > previousLevel && levelData.discord_member_id) {
                await sendLevelUpNotification(guildId, levelData.discord_member_id, serverName, recalculatedLevel);
                if (notificationsEnabled) {
                    await sendLevelChangeDM(guildId, levelData.discord_member_id, serverName, recalculatedLevel);
                }
            }
            return {
                ...levelData,
                ...updatedStats,
                level: recalculatedLevel
            };
        }
    }

    if ((levelData.level ?? 1) !== recalculatedLevel) {
        if (recalculatedLevel > previousLevel && levelData.discord_member_id) {
            await sendLevelUpNotification(guildId, levelData.discord_member_id, serverName, recalculatedLevel);
            if (notificationsEnabled) {
                await sendLevelChangeDM(guildId, levelData.discord_member_id, serverName, recalculatedLevel);
            }
        }
        return {
            ...levelData,
            level: recalculatedLevel
        };
    }

    return levelData;
}

async function getServerForInteraction(interaction) {
    const botConfig = getBotConfig();
    if (!botConfig || !botConfig.id) {
        return null;
    }
    return await db.getServerByDiscordId(botConfig.id, interaction.guild.id);
}

async function buildLevelingEmbeds(server, memberLevelData, sortType = 'xp', guildId = null, userId = null) {
    const actualGuildId = guildId || server.discord_server_id;
    const actualUserId = userId || memberLevelData?.discord_member_id;
    const embedConfig = await getEmbedConfig(actualGuildId);

    const memberDisplayName = memberLevelData?.server_display_name || memberLevelData?.display_name || memberLevelData?.username || await translate('leveling.profile.unknown', actualGuildId, actualUserId);
    const currentXP = memberLevelData?.experience ?? 0;
    const calculatedLevel = await determineLevel(currentXP, actualGuildId);

    const currentLevel = calculatedLevel;
    const nextLevel = currentLevel + 1;
    const currentLevelRequirement = await getLevelRequirement(currentLevel, actualGuildId);
    const nextLevelRequirement = await getLevelRequirement(nextLevel, actualGuildId);
    const xpRange = nextLevelRequirement - currentLevelRequirement;
    const xpIntoLevel = Math.max(0, currentXP - currentLevelRequirement);
    const progressRatio = xpRange > 0 ? Math.max(0, Math.min(1, xpIntoLevel / xpRange)) : 0;
    const progressBar = buildProgressBar(progressRatio);
    const xpLabel = await translate('leveling.profile.xp', actualGuildId, actualUserId);
    const xpProgressText = `${formatNumber(Math.round(currentXP))} / ${formatNumber(Math.round(nextLevelRequirement))} ${xpLabel}`;

    const levelLabel = await translate('leveling.profile.level', actualGuildId, actualUserId);
    const experienceLabel = await translate('leveling.profile.experience', actualGuildId, actualUserId);
    const progressLabel = await translate('leveling.profile.progress', actualGuildId, actualUserId);
    const chatTotalLabel = await translate('leveling.profile.chatTotal', actualGuildId, actualUserId);
    const voiceMinutesLabel = await translate('leveling.profile.voiceMinutes', actualGuildId, actualUserId);
    const voiceActiveLabel = await translate('leveling.profile.voiceActive', actualGuildId, actualUserId);
    const voiceAfkLabel = await translate('leveling.profile.voiceAfk', actualGuildId, actualUserId);
    const rankLabel = await translate('leveling.profile.rank', actualGuildId, actualUserId);
    const unrankedText = await translate('leveling.profile.unranked', actualGuildId, actualUserId);
    const minLabel = await translate('leveling.profile.minutes', actualGuildId, actualUserId);

    const profileLines = [];
    profileLines.push(`• **${levelLabel}:** ${currentLevel}`);
    profileLines.push(`• **${experienceLabel}:** ${formatNumber(Math.round(currentXP))} ${xpLabel}`);
    profileLines.push(`• **${progressLabel}:** ${progressBar} (${xpProgressText})`);
    profileLines.push(`• **${chatTotalLabel}:** ${formatNumber(memberLevelData?.chat_total ?? 0)}`);
    const voiceTotal = memberLevelData?.voice_minutes_total ?? 0;
    const voiceActive = memberLevelData?.voice_minutes_active ?? 0;
    const voiceAfk = memberLevelData?.voice_minutes_afk ?? 0;
    profileLines.push(`• **${voiceMinutesLabel}:** ${formatNumber(voiceTotal)} ${minLabel}`);
    profileLines.push(`• ├ ${voiceActiveLabel}: ${formatNumber(voiceActive)} ${minLabel}`);
    profileLines.push(`• └ ${voiceAfkLabel}: ${formatNumber(voiceAfk)} ${minLabel}`);
    profileLines.push(`• **${rankLabel}:** ${memberLevelData?.rank ? `#${memberLevelData.rank}` : unrankedText}`);

    const profileTitle = await translate('leveling.profile.title', actualGuildId, actualUserId);
    const yourProgressLabel = await translate('leveling.profile.yourProgress', actualGuildId, actualUserId);
    const statsDescription = await translate('leveling.profile.description', actualGuildId, actualUserId, { member: memberDisplayName });

    const profileEmbed = new EmbedBuilder()
        .setColor(embedConfig.COLOR)
        .setTitle(profileTitle)
        .setDescription(statsDescription)
        .addFields(
            {
                name: yourProgressLabel,
                value: profileLines.join("\n"),
                inline: false
            }
        )
        .setFooter({ text: embedConfig.FOOTER })
        .setTimestamp();

    const leaderboard = await db.getServerLeaderboard(server.id, 3, sortType);

    let leaderboardTitle;
    switch (sortType) {
        case 'voice_total':
            leaderboardTitle = await translate('leveling.leaderboard.topVoiceTotal', actualGuildId, actualUserId);
            break;
        case 'voice_active':
            leaderboardTitle = await translate('leveling.leaderboard.topVoiceActive', actualGuildId, actualUserId);
            break;
        case 'voice_afk':
            leaderboardTitle = await translate('leveling.leaderboard.topVoiceAfk', actualGuildId, actualUserId);
            break;
        case 'chat':
            leaderboardTitle = await translate('leveling.leaderboard.topChat', actualGuildId, actualUserId);
            break;
        case 'xp':
        default:
            leaderboardTitle = await translate('leveling.leaderboard.topXp', actualGuildId, actualUserId);
            break;
    }

    const leaderboardEmbed = new EmbedBuilder()
        .setColor(embedConfig.COLOR)
        .setTitle(leaderboardTitle)
        .setFooter({ text: embedConfig.FOOTER })
        .setTimestamp();

    if (leaderboard && leaderboard.length > 0) {
        for (let i = 0; i < Math.min(3, leaderboard.length); i++) {
            const entry = leaderboard[i];
            const position = i + 1;
            const memberText = await translate('leveling.leaderboard.member', actualGuildId, actualUserId, { position });
            const name = entry.server_display_name || entry.display_name || entry.username || entry.discord_member_id || memberText;
            const xp = entry.experience || 0;
            const calculatedLevel = await determineLevel(xp, actualGuildId);
            const avatar = entry.avatar || null;

            let medal = "";
            if (position === 1) {
                medal = "🥇";
                if (avatar) leaderboardEmbed.setThumbnail(avatar);
            } else if (position === 2) {
                medal = "🥈";
            } else if (position === 3) {
                medal = "🥉";
            }

            let value = "";

            switch (sortType) {
                case 'voice_total': {
                    const totalMinutes = entry.voice_minutes_total || 0;
                    const activeMinutes = entry.voice_minutes_active || 0;
                    const afkMinutes = entry.voice_minutes_afk || 0;
                    const minTotalText = await translate('leveling.leaderboard.minTotal', actualGuildId, actualUserId);
                    const activeLabel = await translate('leveling.profile.voiceActive', actualGuildId, actualUserId);
                    const afkLabel = await translate('leveling.profile.voiceAfk', actualGuildId, actualUserId);
                    value = `${medal} **${name}**\n${formatNumber(totalMinutes)} ${minTotalText} (${activeLabel} ${formatNumber(activeMinutes)} • ${afkLabel} ${formatNumber(afkMinutes)})`;
                    break;
                }
                case 'voice_active': {
                    const activeMinutes = entry.voice_minutes_active || 0;
                    const minActiveText = await translate('leveling.leaderboard.minActive', actualGuildId, actualUserId);
                    value = `${medal} **${name}**\n${formatNumber(activeMinutes)} ${minActiveText}`;
                    break;
                }
                case 'voice_afk': {
                    const afkMinutes = entry.voice_minutes_afk || 0;
                    const minAfkText = await translate('leveling.leaderboard.minAfk', actualGuildId, actualUserId);
                    value = `${medal} **${name}**\n${formatNumber(afkMinutes)} ${minAfkText}`;
                    break;
                }
                case 'chat': {
                    const messagesText = await translate('leveling.leaderboard.messages', actualGuildId, actualUserId);
                    value = `${medal} **${name}**\n${formatNumber(entry.chat_total || 0)} ${messagesText}`;
                    break;
                }
                case 'xp':
                default:
                    value = `${medal} **${name}**\n${formatNumber(Math.round(xp))} ${xpLabel}`;
                    break;
            }

            leaderboardEmbed.addFields({
                name: '\u200b',
                value,
                inline: false
            });
        }
    } else {
        const noDataText = await translate('leveling.leaderboard.noData', actualGuildId, actualUserId);
        leaderboardEmbed.setDescription(noDataText);
    }

    return { profileEmbed, leaderboardEmbed };
}

async function createLeaderboardButtons(selectedType = 'xp', guildId = null, userId = null) {
    const topXpLabel = await translate('leveling.buttons.topXp', guildId, userId);
    const voiceTotalLabel = await translate('leveling.buttons.voiceTotal', guildId, userId);
    const voiceActiveLabel = await translate('leveling.buttons.voiceActive', guildId, userId);
    const voiceAfkLabel = await translate('leveling.buttons.voiceAfk', guildId, userId);
    const topChatLabel = await translate('leveling.buttons.topChat', guildId, userId);

    const buttons = [
        new ButtonBuilder()
            .setCustomId('leaderboard_xp')
            .setLabel(topXpLabel)
            .setStyle(selectedType === 'xp' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('leaderboard_voice_total')
            .setLabel(voiceTotalLabel)
            .setStyle(selectedType === 'voice_total' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('leaderboard_voice_active')
            .setLabel(voiceActiveLabel)
            .setStyle(selectedType === 'voice_active' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('leaderboard_voice_afk')
            .setLabel(voiceAfkLabel)
            .setStyle(selectedType === 'voice_afk' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('leaderboard_chat')
            .setLabel(topChatLabel)
            .setStyle(selectedType === 'chat' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    ];

    return new ActionRowBuilder().addComponents(...buttons);
}

async function createDmToggleRow(dmEnabled = true, guildId = null, userId = null) {
    const dmOnLabel = await translate('leveling.buttons.dmOn', guildId, userId);
    const dmOffLabel = await translate('leveling.buttons.dmOff', guildId, userId);
    const toggleButton = new ButtonBuilder()
        .setCustomId('leveling_dm_toggle')
        .setLabel(dmEnabled ? dmOnLabel : dmOffLabel)
        .setStyle(dmEnabled ? ButtonStyle.Success : ButtonStyle.Secondary);

    const menuButton = new ButtonBuilder()
        .setCustomId('bot_menu')
        .setLabel('📋 Menu')
        .setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder().addComponents(toggleButton, menuButton);
}

export async function handleLevelingButton(interaction) {
    try {
        if (!(await hasPermission(interaction.member, "leveling"))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'leveling');
            await interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null);
            return;
        }

        const server = await getServerForInteraction(interaction);
        if (!server) {
            const errorMsg = await translate('leveling.errors.notRegistered', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            });
            return;
        }

        const guildMember = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!guildMember) {
            const errorMsg = await translate('leveling.errors.memberNotFound', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            });
            return;
        }

        const dbMember = await db.upsertMember(server.id, guildMember);
        if (!dbMember) {
            const errorMsg = await translate('leveling.errors.createRecordFailed', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            });
            return;
        }

        await db.ensureMemberLevel(dbMember.id);

        let memberLevelData = await refreshMemberLevelData(server.id, interaction.user.id);
        await db.recalculateServerMemberRanks(server.id);
        memberLevelData = await db.getMemberLevelByDiscordId(server.id, interaction.user.id);

        const sortType = 'xp';
        const { profileEmbed, leaderboardEmbed } = await buildLevelingEmbeds(server, memberLevelData, sortType, interaction.guild.id, interaction.user.id);
        const buttons = await createLeaderboardButtons(sortType, interaction.guild.id, interaction.user.id);
        const dmRow = await createDmToggleRow(!(memberLevelData?.dm_notifications_enabled === false || memberLevelData?.dm_notifications_enabled === 0), interaction.guild.id, interaction.user.id);

        await interaction.update({
            embeds: [profileEmbed, leaderboardEmbed],
            components: [buttons, dmRow]
        });
    } catch (error) {
        await logger.log(`❌ Leveling interface error: ${error.message}`);
        const errorMsg = await translate('leveling.errors.loadFailed', interaction.guild?.id, interaction.user?.id, { error: error.message });
        await interaction.reply({
            content: errorMsg,
            flags: 64
        }).catch(() => null);
    }
}

export async function handleLeaderboardButton(interaction) {
    try {
        if (!(await hasPermission(interaction.member, "leveling"))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'leveling');
            await interaction.update({
                content: errorMessage,
                components: [],
                embeds: [],
                flags: 64
            }).catch(() => interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null));
            return;
        }

        const server = await getServerForInteraction(interaction);
        if (!server) {
            const errorMsg = await translate('leveling.errors.notRegistered', interaction.guild.id, interaction.user.id);
            await interaction.update({
                content: errorMsg,
                components: [],
                flags: 64
            }).catch(() => interaction.reply({
                content: errorMsg,
                flags: 64
            }));
            return;
        }

        const sortType = interaction.customId.replace('leaderboard_', '');

        await refreshMemberLevelData(server.id, interaction.user.id);
        await db.recalculateServerMemberRanks(server.id);

        const memberLevelData = await db.getMemberLevelByDiscordId(server.id, interaction.user.id);
        const { profileEmbed, leaderboardEmbed } = await buildLevelingEmbeds(server, memberLevelData, sortType, interaction.guild.id, interaction.user.id);
        const buttons = await createLeaderboardButtons(sortType, interaction.guild.id, interaction.user.id);
        const dmRow = await createDmToggleRow(!(memberLevelData?.dm_notifications_enabled === false || memberLevelData?.dm_notifications_enabled === 0), interaction.guild.id, interaction.user.id);

        await interaction.update({
            embeds: [profileEmbed, leaderboardEmbed],
            components: [buttons, dmRow]
        });
    } catch (error) {
        await logger.log(`❌ Leaderboard button error: ${error.message}`);
        const errorMsg = await translate('leveling.errors.leaderboardFailed', interaction.guild?.id, interaction.user?.id, { error: error.message });
        await interaction.update({
            content: errorMsg,
            flags: 64
        }).catch(() => null);
    }
}

export async function handleDmToggleButton(interaction) {
    try {
        if (!(await hasPermission(interaction.member, "leveling"))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'leveling');
            await interaction.update({
                content: errorMessage,
                components: [],
                embeds: [],
                flags: 64
            }).catch(() => interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null));
            return;
        }

        const server = await getServerForInteraction(interaction);
        if (!server) {
            const errorMsg = await translate('leveling.errors.notRegistered', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            }).catch(() => null);
            return;
        }

        const guildMember = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!guildMember) {
            const errorMsg = await translate('leveling.errors.memberNotFound', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            }).catch(() => null);
            return;
        }

        const dbMember = await db.upsertMember(server.id, guildMember);
        if (!dbMember) {
            const errorMsg = await translate('leveling.errors.createRecordFailed', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            }).catch(() => null);
            return;
        }

        await db.ensureMemberLevel(dbMember.id);

        let memberLevelData = await db.getMemberLevelByDiscordId(server.id, interaction.user.id);
        if (!memberLevelData) {
            const errorMsg = await translate('leveling.errors.noData', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            }).catch(() => null);
            return;
        }

        const currentlyEnabled = !(memberLevelData.dm_notifications_enabled === false || memberLevelData.dm_notifications_enabled === 0);
        await db.setMemberLevelDMPreference(memberLevelData.member_id, !currentlyEnabled);

        memberLevelData = await db.getMemberLevelByDiscordId(server.id, interaction.user.id);

        let sortType = 'xp';
        const leaderboardRow = interaction.message?.components?.[0];
        if (leaderboardRow && Array.isArray(leaderboardRow.components)) {
            for (const component of leaderboardRow.components) {
                if (component.style === ButtonStyle.Primary && typeof component.customId === 'string' && component.customId.startsWith('leaderboard_')) {
                    sortType = component.customId.replace('leaderboard_', '');
                    break;
                }
            }
        }

        const { profileEmbed, leaderboardEmbed } = await buildLevelingEmbeds(server, memberLevelData, sortType, interaction.guild.id, interaction.user.id);
        const buttons = await createLeaderboardButtons(sortType, interaction.guild.id, interaction.user.id);
        const dmRow = await createDmToggleRow(!(memberLevelData?.dm_notifications_enabled === false || memberLevelData?.dm_notifications_enabled === 0), interaction.guild.id, interaction.user.id);

        await interaction.update({
            embeds: [profileEmbed, leaderboardEmbed],
            components: [buttons, dmRow]
        });
    } catch (error) {
        await logger.log(`❌ Leveling DM toggle error: ${error.message}`);
        const errorMsg = await translate('leveling.errors.dmToggleFailed', interaction.guild?.id, interaction.user?.id, { error: error.message });
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({
                content: errorMsg
            }).catch(() => null);
        } else {
            await interaction.reply({
                content: errorMsg,
                flags: 64
            }).catch(() => null);
        }
    }
}
