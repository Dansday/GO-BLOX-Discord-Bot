import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getEmbedConfig, getBotConfig } from "../../../config.js";
import { hasPermission } from "../permissions.js";
import db from "../../../../database/database.js";
import logger from "../../../logger.js";
import { getLevelRequirement, determineLevel, calculateExperienceFromTotals, sendLevelChangeDM } from "../leveling.js";

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

    const recalculatedExperience = await calculateExperienceFromTotals({
        chatTotal: levelData.chat_total ?? 0,
        voiceMinutesActive: levelData.voice_minutes_active ?? 0,
        voiceMinutesAfk: levelData.voice_minutes_afk ?? 0
    }, guildId);

    const currentExperience = levelData.experience ?? 0;
    const updates = {};

    const voiceActive = levelData.voice_minutes_active ?? 0;
    const voiceAfk = levelData.voice_minutes_afk ?? 0;
    const expectedVoiceTotal = voiceActive + voiceAfk;
    const currentVoiceTotal = levelData.voice_minutes_total ?? 0;
    
    if (expectedVoiceTotal !== currentVoiceTotal) {
        updates.voiceMinutesActiveIncrement = 0;
        updates.voiceMinutesAfkIncrement = 0;
    }

    if (recalculatedExperience !== currentExperience) {
        updates.experienceIncrement = recalculatedExperience - currentExperience;
    }

    const recalculatedLevel = await determineLevel(recalculatedExperience, guildId);
    if ((levelData.level ?? 1) !== recalculatedLevel) {
        updates.level = recalculatedLevel;
    }

    if (Object.keys(updates).length > 0) {
        const updatedStats = await db.updateMemberLevelStats(levelData.member_id, updates);
        if (updatedStats) {
            if (recalculatedLevel > previousLevel && levelData.discord_member_id) {
                await sendLevelChangeDM(guildId, levelData.discord_member_id, serverName, recalculatedLevel);
            }
            return {
                ...levelData,
                ...updatedStats,
                experience: recalculatedExperience,
                level: recalculatedLevel
            };
        }
    }

    if ((levelData.experience ?? 0) !== recalculatedExperience || (levelData.level ?? 1) !== recalculatedLevel) {
        if (recalculatedLevel > previousLevel && levelData.discord_member_id) {
            await sendLevelChangeDM(guildId, levelData.discord_member_id, serverName, recalculatedLevel);
        }
        return {
            ...levelData,
            experience: recalculatedExperience,
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

async function buildLevelingEmbeds(server, memberLevelData, sortType = 'xp', guildId = null) {
    const actualGuildId = guildId || server.discord_server_id;
    const embedConfig = await getEmbedConfig(actualGuildId);

    const memberDisplayName = memberLevelData?.server_display_name || memberLevelData?.display_name || memberLevelData?.username || 'Unknown';
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
    const xpProgressText = `${formatNumber(Math.round(currentXP))} / ${formatNumber(Math.round(nextLevelRequirement))} XP`;

    const profileLines = [];
    profileLines.push(`• **Level:** ${currentLevel}`);
    profileLines.push(`• **Experience:** ${formatNumber(Math.round(currentXP))} XP`);
    profileLines.push(`• **Progress:** ${progressBar} (${xpProgressText})`);
    profileLines.push(`• **Chat Total:** ${formatNumber(memberLevelData?.chat_total ?? 0)}`);
    const voiceTotal = memberLevelData?.voice_minutes_total ?? 0;
    const voiceActive = memberLevelData?.voice_minutes_active ?? 0;
    const voiceAfk = memberLevelData?.voice_minutes_afk ?? 0;
    profileLines.push(`• **Voice Minutes (Total):** ${formatNumber(voiceTotal)}`);
    profileLines.push(`• ├ Active: ${formatNumber(voiceActive)}`);
    profileLines.push(`• └ AFK: ${formatNumber(voiceAfk)}`);
    profileLines.push(`• **Rank:** ${memberLevelData?.rank ? `#${memberLevelData.rank}` : "Unranked"}`);

    const profileEmbed = new EmbedBuilder()
        .setColor(embedConfig.COLOR)
        .setTitle("📈 Your Leveling Stats")
        .setDescription(`Stats for **${memberDisplayName}**`)
        .addFields(
            {
                name: "Your Progress",
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
            leaderboardTitle = "🎤 Top Voice (Total • Top 3)";
            break;
        case 'voice_active':
            leaderboardTitle = "🎤 Top Voice (Active • Top 3)";
            break;
        case 'voice_afk':
            leaderboardTitle = "🎤 Top Voice (AFK • Top 3)";
            break;
        case 'chat':
            leaderboardTitle = "💬 Top Chat (Top 3)";
            break;
        case 'xp':
        default:
            leaderboardTitle = "⭐ Top XP (Top 3)";
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
            const name = entry.server_display_name || entry.display_name || entry.username || entry.discord_member_id || `Member ${position}`;
            const xp = entry.experience || 0;
            const calculatedLevel = await determineLevel(xp, actualGuildId);
            const avatar = entry.avatar || null;

            let medal = "";
            let value = "";

            if (position === 1) {
                medal = "🥇";
                if (avatar) leaderboardEmbed.setThumbnail(avatar);
            } else if (position === 2) {
                medal = "🥈";
            } else if (position === 3) {
                medal = "🥉";
            }

            switch (sortType) {
                case 'voice_total': {
                    const totalMinutes = entry.voice_minutes_total || 0;
                    const activeMinutes = entry.voice_minutes_active || 0;
                    const afkMinutes = entry.voice_minutes_afk || 0;
                    value = `${medal} **${name}**\n${formatNumber(totalMinutes)} min total (Active ${formatNumber(activeMinutes)} • AFK ${formatNumber(afkMinutes)})`;
                    break;
                }
                case 'voice_active': {
                    const activeMinutes = entry.voice_minutes_active || 0;
                    value = `${medal} **${name}**\n${formatNumber(activeMinutes)} min active • Level ${calculatedLevel}`;
                    break;
                }
                case 'voice_afk': {
                    const afkMinutes = entry.voice_minutes_afk || 0;
                    value = `${medal} **${name}**\n${formatNumber(afkMinutes)} min AFK • Level ${calculatedLevel}`;
                    break;
                }
                case 'chat':
                    value = `${medal} **${name}**\n${formatNumber(entry.chat_total || 0)} messages`;
                    break;
                case 'xp':
                default:
                    value = `${medal} **${name}**\n${formatNumber(Math.round(xp))} XP • Level ${calculatedLevel}`;
                    break;
            }

            const fieldName = medal || '•';
            leaderboardEmbed.addFields({
                name: fieldName,
                value,
                inline: false
            });
        }
    } else {
        leaderboardEmbed.setDescription("No leveling data available yet.");
    }

    return { profileEmbed, leaderboardEmbed };
}

function createLeaderboardButtons(selectedType = 'xp') {
    const buttons = [
        new ButtonBuilder()
            .setCustomId('leaderboard_xp')
            .setLabel('⭐ Top XP')
            .setStyle(selectedType === 'xp' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('leaderboard_voice_total')
            .setLabel('🎤 Voice Total')
            .setStyle(selectedType === 'voice_total' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('leaderboard_voice_active')
            .setLabel('🎤 Voice Active')
            .setStyle(selectedType === 'voice_active' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('leaderboard_voice_afk')
            .setLabel('🎤 Voice AFK')
            .setStyle(selectedType === 'voice_afk' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('leaderboard_chat')
            .setLabel('💬 Top Chat')
            .setStyle(selectedType === 'chat' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    ];

    return new ActionRowBuilder().addComponents(...buttons);
}

export async function handleLevelingButton(interaction) {
    try {
        if (!(await hasPermission(interaction.member, "leveling"))) {
            await interaction.reply({
                content: "❌ You don't have permission to view leveling information.",
                flags: 64
            });
            return;
        }

        const server = await getServerForInteraction(interaction);
        if (!server) {
            await interaction.reply({
                content: "⚠️ This server is not registered with the bot. Please run a sync first.",
                flags: 64
            });
            return;
        }

        const guildMember = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!guildMember) {
            await interaction.reply({
                content: "❌ Failed to fetch member information. Please try again.",
                flags: 64
            });
            return;
        }

        const dbMember = await db.upsertMember(server.id, guildMember);
        if (!dbMember) {
            await interaction.reply({
                content: "❌ Failed to create member record. Please try again.",
                flags: 64
            });
            return;
        }

        await db.ensureMemberLevel(dbMember.id);

        let memberLevelData = await refreshMemberLevelData(server.id, interaction.user.id);
        await db.recalculateServerMemberRanks(server.id);
        memberLevelData = await db.getMemberLevelByDiscordId(server.id, interaction.user.id);

        const sortType = 'xp';
        const { profileEmbed, leaderboardEmbed } = await buildLevelingEmbeds(server, memberLevelData, sortType, interaction.guild.id);
        const buttons = createLeaderboardButtons(sortType);

        await interaction.reply({
            embeds: [profileEmbed, leaderboardEmbed],
            components: [buttons],
            flags: 64
        });
    } catch (error) {
        await logger.log(`❌ Leveling interface error: ${error.message}`);
        await interaction.reply({
            content: `❌ Failed to load leveling information: ${error.message}`,
            flags: 64
        }).catch(() => null);
    }
}

export async function handleLeaderboardButton(interaction) {
    try {
        if (!(await hasPermission(interaction.member, "leveling"))) {
            await interaction.update({
                content: "❌ You don't have permission to view leveling information.",
                components: [],
                flags: 64
            }).catch(() => interaction.reply({
                content: "❌ You don't have permission to view leveling information.",
                flags: 64
            }));
            return;
        }

        const server = await getServerForInteraction(interaction);
        if (!server) {
            await interaction.update({
                content: "⚠️ This server is not registered with the bot. Please run a sync first.",
                components: [],
                flags: 64
            }).catch(() => interaction.reply({
                content: "⚠️ This server is not registered with the bot. Please run a sync first.",
                flags: 64
            }));
            return;
        }

        const sortType = interaction.customId.replace('leaderboard_', '');

        await refreshMemberLevelData(server.id, interaction.user.id);
        await db.recalculateServerMemberRanks(server.id);

        const memberLevelData = await db.getMemberLevelByDiscordId(server.id, interaction.user.id);
        const { profileEmbed, leaderboardEmbed } = await buildLevelingEmbeds(server, memberLevelData, sortType, interaction.guild.id);
        const buttons = createLeaderboardButtons(sortType);

        await interaction.update({
            embeds: [profileEmbed, leaderboardEmbed],
            components: [buttons],
            flags: 64
        });
    } catch (error) {
        await logger.log(`❌ Leaderboard button error: ${error.message}`);
        await interaction.update({
            content: `❌ Failed to load leaderboard: ${error.message}`,
            flags: 64
        }).catch(() => null);
    }
}
