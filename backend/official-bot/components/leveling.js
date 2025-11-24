import { getLevelingSettings, PERMISSIONS, getBotConfig, getEmbedConfig } from "../../config.js";
import db from "../../../database/database.js";
import logger from "../../logger.js";
import { EmbedBuilder } from "discord.js";
import { parseMySQLDateTime } from "../../utils.js";

const recentMessages = new Map();
const voiceSessions = new Map();
let clientInstance = null;

export async function getLevelRequirement(level, guildId) {
    if (!guildId) {
        throw new Error('guildId is required for level requirement calculation');
    }
    if (level <= 1) return 0;

    const settings = await getLevelingSettings(guildId);
    const baseXP = settings.REQUIREMENTS.BASE_XP;
    const multiplier = settings.REQUIREMENTS.MULTIPLIER;

    if (multiplier === 1) {
        return baseXP * (level - 1);
    } else {
        return baseXP * (Math.pow(multiplier, level - 1) - 1) / (multiplier - 1);
    }
}


async function getExperienceForMessage(guildId) {
    if (!guildId) {
        throw new Error('guildId is required for message XP');
    }
    const settings = await getLevelingSettings(guildId);
    return settings.MESSAGE.XP;
}

async function getExperienceForVoiceMinutes(minutes, isAFK = false, guildId) {
    if (!guildId) {
        throw new Error('guildId is required for voice XP');
    }
    if (!minutes || minutes <= 0) return 0;

    const settings = await getLevelingSettings(guildId);
    const afkXPPerMin = settings.VOICE.AFK_XP_PER_MINUTE;
    const voiceXPPerMin = settings.VOICE.XP_PER_MINUTE;

    if (isAFK) {
        return afkXPPerMin * minutes;
    }
    return voiceXPPerMin * minutes;
}

async function getMessageCooldownMs(guildId) {
    if (!guildId) {
        throw new Error('guildId is required for message cooldown');
    }
    const settings = await getLevelingSettings(guildId);
    return settings.MESSAGE.COOLDOWN_SECONDS * 1000;
}

async function getVoiceCooldownMs(guildId) {
    if (!guildId) {
        throw new Error('guildId is required for voice cooldown');
    }
    const settings = await getLevelingSettings(guildId);
    return settings.VOICE.COOLDOWN_SECONDS * 1000;
}

export async function determineLevel(experience = 0, guildId) {
    if (!guildId) {
        throw new Error('guildId is required for level determination');
    }
    if (experience <= 0) return 1;

    let level = 1;
    while (experience >= await getLevelRequirement(level + 1, guildId)) {
        level += 1;
    }
    return level;
}

async function resolveServerAndMember(guild, memberLike) {
    if (!guild) {
        return { server: null, dbMember: null, guildMember: null };
    }

    try {
        const botConfig = getBotConfig();
        if (!botConfig || !botConfig.id) {
            return { server: null, dbMember: null, guildMember: null };
        }

        const server = await db.getServerByDiscordId(botConfig.id, guild.id);
        if (!server) {
            return { server: null, dbMember: null, guildMember: null };
        }

        let guildMember = memberLike;
        const candidateIds = new Set();

        if (guildMember?.id) {
            candidateIds.add(guildMember.id);
        }
        if (guildMember?.user?.id) {
            candidateIds.add(guildMember.user.id);
        }

        if (!guildMember || typeof guildMember.user === 'undefined') {
            for (const candidateId of candidateIds) {
                try {
                    guildMember = await guild.members.fetch({ user: candidateId, cache: true });
                    break;
                } catch {
                    guildMember = null;
                }
            }
        }

        if (!guildMember) {
            for (const candidateId of candidateIds) {
                try {
                    guildMember = await guild.members.fetch(candidateId);
                    break;
                } catch {
                    guildMember = null;
                }
            }
        }

        if (!guildMember) {
            return { server, dbMember: null, guildMember: null };
        }

        const dbMember = await db.upsertMember(server.id, guildMember);

        return { server, dbMember, guildMember };
    } catch (error) {
        await logger.log(`❌ Leveling resolve failure for guild ${guild?.id}: ${error.message}`);
        return { server: null, dbMember: null, guildMember: null };
    }
}

async function getMemberRoleIds(guildId) {
    try {
        const permissions = await PERMISSIONS.getPermissions(guildId);
        const roles = permissions?.MEMBER_ROLES || [];
        return roles;
    } catch (error) {
        return [];
    }
}

async function isMemberEligible(guildId, guildMember) {
    if (!guildId || !guildMember) {
        return false;
    }

    const memberRoles = await getMemberRoleIds(guildId);
    if (!memberRoles || memberRoles.length === 0) {
        return false;
    }

    try {
        return await PERMISSIONS.hasAnyRole(guildMember, memberRoles);
    } catch (error) {
        return false;
    }
}

export async function sendLevelChangeDM(guildId, discordMemberId, serverName, newLevel, contextLabel = "level-change") {
    if (!clientInstance || !guildId || !discordMemberId || !newLevel) {
        return false;
    }

    try {
        const guild = clientInstance.guilds.cache.get(guildId);
        if (!guild) {
            return false;
        }

        const member = await guild.members.fetch(discordMemberId);
        if (!member || !member.user) {
            return false;
        }

        const dmChannel = await member.user.createDM();

        const targetServerName = serverName;
        await dmChannel.send(`🎉 **Congratulations!** You've reached **Level ${newLevel}** in **${targetServerName}**!\n\nKeep up the great work! 🚀`);
        await logger.log(`⭐ Sent level change DM (${contextLabel}) to ${discordMemberId} for level ${newLevel} in ${targetServerName}`);
        return true;
    } catch (error) {
        await logger.log(`⚠️ Failed to send level change DM (${contextLabel}) to ${discordMemberId}: ${error.message}`);
        return false;
    }
}

export async function sendLevelUpNotification(guildId, discordMemberId, serverName, newLevel, contextLabel = "level-change") {
    if (!clientInstance || !guildId || !discordMemberId || !newLevel) {
        return false;
    }

    try {
        const guild = clientInstance.guilds.cache.get(guildId);
        if (!guild) {
            return false;
        }

        const member = await guild.members.fetch(discordMemberId);
        if (!member || !member.user) {
            return false;
        }

        const settings = await getLevelingSettings(guildId);
        const levelUpChannelId = settings.LEVEL_UP_CHANNEL_ID;

        if (!levelUpChannelId) {
            return false;
        }

        const channel = await guild.channels.fetch(levelUpChannelId);
        if (!channel) {
            return false;
        }

        const botConfig = getBotConfig();
        if (!botConfig || !botConfig.id) {
            return false;
        }
        const server = await db.getServerByDiscordId(botConfig.id, guildId);
        if (!server) {
            return false;
        }
        const dbMember = await db.getMemberByDiscordId(server.id, discordMemberId);
        if (!dbMember) {
            return false;
        }
        const levelStats = await db.getMemberLevel(dbMember.id);
        if (!levelStats) {
            return false;
        }

        await db.recalculateServerMemberRanks(server.id);
        const memberWithRank = await db.getMemberLevelByDiscordId(server.id, discordMemberId);
        const rank = memberWithRank?.rank ?? null;

        const embedConfig = await getEmbedConfig(guildId);

        const embed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(`🎉 Level Up!`)
            .setDescription(`${member} has reached **Level ${newLevel}**!`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '📊 Total XP', value: `${(levelStats.experience ?? 0).toLocaleString()}`, inline: true },
                { name: '🏆 Rank', value: rank ? `#${rank}` : 'Unranked', inline: true }
            )
            .setFooter({ text: embedConfig.FOOTER || serverName })
            .setTimestamp();

        await channel.send({ embeds: [embed] });
        await logger.log(`⭐ Sent level up notification (${contextLabel}) to channel ${levelUpChannelId} for ${discordMemberId} level ${newLevel} in ${serverName}`);
        return true;
    } catch (error) {
        await logger.log(`⚠️ Failed to send level up notification (${contextLabel}) to ${discordMemberId}: ${error.message}`);
        return false;
    }
}

async function deriveBaselineLevel({ previousLevel, previousExperience, storedLevel }, guildId) {
    if (typeof previousLevel === "number" && !Number.isNaN(previousLevel)) {
        return previousLevel;
    }

    if (typeof previousExperience === "number" && !Number.isNaN(previousExperience)) {
        try {
            return await determineLevel(previousExperience, guildId);
        } catch {
        }
    }

    if (typeof storedLevel === "number" && !Number.isNaN(storedLevel)) {
        return storedLevel;
    }

    return 1;
}

async function handleLevelEvaluation(server, dbMember, currentStats, guildId, context = {}) {
    if (!server || !dbMember || !currentStats) {
        return currentStats;
    }

    const { previousLevel = null, previousExperience = null, reason = "unknown" } = context;
    const expectedLevel = await determineLevel(currentStats.experience || 0, guildId);

    let storedLevel = currentStats.level;
    if (typeof storedLevel === "string") {
        const parsed = parseInt(storedLevel, 10);
        storedLevel = Number.isNaN(parsed) ? null : parsed;
    } else if (typeof storedLevel !== "number" || Number.isNaN(storedLevel)) {
        storedLevel = null;
    }

    const baselineLevel = await deriveBaselineLevel({ previousLevel, previousExperience, storedLevel }, guildId);

    let finalStats = currentStats;
    if (storedLevel !== expectedLevel) {
        const updatedStats = await db.updateMemberLevelStats(dbMember.id, { level: expectedLevel });
        if (updatedStats) {
            finalStats = updatedStats;
            storedLevel = updatedStats.level ?? expectedLevel;
        }
        const memberName = dbMember.display_name || dbMember.username || dbMember.discord_member_id || 'Unknown member';
        await logger.log(`⭐ Level stored update (${reason}): ${memberName} -> level ${expectedLevel} in ${server.name}`);
    }

    const dmPreference = finalStats?.dm_notifications_enabled;
    const notificationsEnabled = !(dmPreference === false || dmPreference === 0);

    if (expectedLevel > baselineLevel) {
        const memberName = dbMember.server_display_name || dbMember.display_name || dbMember.username || dbMember.discord_member_id || "Unknown member";

        if (dbMember.discord_member_id) {
            await sendLevelUpNotification(guildId, dbMember.discord_member_id, server.name, expectedLevel, `level-eval:${reason}`);
        }

        if (!notificationsEnabled) {
            await logger.log(`🔕 Level up detected (${reason}) for ${memberName} but DM notifications are disabled`);
        } else if (dbMember.discord_member_id) {
            await sendLevelChangeDM(guildId, dbMember.discord_member_id, server.name, expectedLevel, `level-eval:${reason}`);
        }
    }

    return finalStats;
}

async function handleMessageCreate(message) {
    try {
        if (!message?.guild || message.author?.bot) return;

        const now = Date.now();
        const cooldownKey = `${message.guild.id}:${message.author.id}`;
        const lastMessageAt = recentMessages.get(cooldownKey);
        const guildId = message.guild.id;

        const messageCooldownMs = await getMessageCooldownMs(guildId);
        if (messageCooldownMs > 0 && lastMessageAt && (now - lastMessageAt) < messageCooldownMs) {
            return;
        }

        const memberReference = message.member || { id: message.author.id, user: message.author };
        const { server, dbMember, guildMember } = await resolveServerAndMember(message.guild, memberReference);

        if (!server || !dbMember || !guildMember) {
            return;
        }

        const eligible = await isMemberEligible(message.guild.id, guildMember);
        if (!eligible) {
            return;
        }

        await db.ensureMemberLevel(dbMember.id);
        const previousStats = await db.getMemberLevel(dbMember.id);
        const xpGained = await getExperienceForMessage(guildId);
        const stats = await db.updateMemberLevelStats(dbMember.id, {
            chatIncrement: 1,
            experienceIncrement: xpGained,
            chatRewardedAt: message.createdAt ? new Date(message.createdAt) : new Date()
        });

        const memberName = dbMember.server_display_name || dbMember.display_name || dbMember.username || message.author.username;
        const currentLevel = await determineLevel(stats.experience || 0, guildId);
        await logger.log(`💬 Chat XP: ${memberName} (${message.author.id}) gained +${xpGained} XP from chat | Total: ${stats.experience || 0} XP | Level: ${currentLevel}`);

        await handleLevelEvaluation(server, dbMember, stats, message.guild.id, {
            previousLevel: previousStats?.level ?? null,
            previousExperience: previousStats?.experience ?? null,
            reason: "message"
        });
        recentMessages.set(cooldownKey, now);
    } catch (error) {
        await logger.log(`❌ Leveling message handler error: ${error.message}`);
    }
}

async function awardVoiceXP(server, dbMember, guildMember, minutes, isAFK, guildId, reason, previousStats = null) {
    const oldStats = previousStats || await db.getMemberLevel(dbMember.id);
    const xpGained = await getExperienceForVoiceMinutes(minutes, isAFK, guildId);
    const updates = {
        experienceIncrement: xpGained,
        voiceRewardedAt: new Date(),
        isInVoice: true
    };
    if (isAFK) {
        updates.voiceMinutesAfkIncrement = minutes;
    } else {
        updates.voiceMinutesActiveIncrement = minutes;
    }

    const stats = await db.updateMemberLevelStats(dbMember.id, updates);
    const memberName = dbMember.server_display_name || dbMember.display_name || dbMember.username || guildMember.displayName || guildMember.user.username;
    const currentLevel = await determineLevel(stats.experience || 0, guildId);
    const xpType = isAFK ? "AFK Voice" : "Voice";
    await logger.log(`🎤 ${xpType} XP: ${memberName} (${guildMember.id}) gained +${xpGained} XP${minutes > 1 ? ` from ${minutes} minute(s) [resume catch-up]` : ''} | Total: ${stats.experience || 0} XP | Level: ${currentLevel}`);

    return await handleLevelEvaluation(server, dbMember, stats, guildId, {
        previousLevel: oldStats?.level ?? null,
        previousExperience: oldStats?.experience ?? null,
        reason
    });
}

async function startVoiceSession(state, resumed = false) {
    try {
        if (!state?.channelId || !state.guild) return;

        const { server, dbMember, guildMember } = await resolveServerAndMember(state.guild, state.member);
        if (!server || !dbMember || !guildMember) return;

        const eligible = await isMemberEligible(state.guild.id, guildMember);
        if (!eligible) return;

        await db.ensureMemberLevel(dbMember.id);
        const levelData = await db.getMemberLevel(dbMember.id);
        const wasMarkedInVoice = !!(levelData?.is_in_voice);
        let lastRewardedAtMs = null;
        if (levelData?.voice_rewarded_at) {
            if (levelData.voice_rewarded_at instanceof Date) {
                lastRewardedAtMs = levelData.voice_rewarded_at.getTime();
            } else {
                const parsedDate = parseMySQLDateTime(levelData.voice_rewarded_at);
                lastRewardedAtMs = parsedDate ? parsedDate.getTime() : null;
            }
        }

        const sessionKey = `${state.guild.id}:${guildMember.id}`;
        const existingSession = voiceSessions.get(sessionKey);
        if (existingSession?.interval) {
            clearInterval(existingSession.interval);
        }

        const now = Date.now();
        const guildId = state.guild.id;
        const voiceCooldownMs = await getVoiceCooldownMs(guildId);

        if (lastRewardedAtMs === null) {
            await db.updateMemberLevelStats(dbMember.id, {
                isInVoice: true,
                voiceRewardedAt: new Date()
            });
        } else {
            await db.updateMemberLevelStats(dbMember.id, { isInVoice: true });
        }

        let finalLastRewardedAt = lastRewardedAtMs || now;

        if (resumed && wasMarkedInVoice && lastRewardedAtMs !== null) {
            const minutesSinceReward = Math.max(0, Math.floor((now - lastRewardedAtMs) / 60000));
            if (minutesSinceReward > 0) {
                const afkStatus = await db.getAFKStatus(server.id, dbMember.discord_member_id);
                await awardVoiceXP(server, dbMember, guildMember, minutesSinceReward, !!afkStatus, guildId, "voice-resume-catchup", levelData);
                finalLastRewardedAt = now;
            }
        } else if (lastRewardedAtMs !== null && (now - lastRewardedAtMs) >= voiceCooldownMs) {
            const afkStatus = await db.getAFKStatus(server.id, dbMember.discord_member_id);
            await awardVoiceXP(server, dbMember, guildMember, 1, !!afkStatus, guildId, resumed && wasMarkedInVoice ? "voice-resume-interval" : "voice-start-interval", levelData);
            finalLastRewardedAt = now;
        }

        const tickInterval = Math.min(Math.max(voiceCooldownMs || 1000, 1000), 5000);
        const interval = setInterval(async () => {
            await handleVoiceTick(sessionKey);
        }, tickInterval);

        voiceSessions.set(sessionKey, {
            serverId: server.id,
            serverName: server.name,
            memberId: dbMember.id,
            discordMemberId: guildMember.id,
            guildId: state.guild.id,
            interval,
            lastRewardedAt: finalLastRewardedAt,
            joinedAt: now
        });
    } catch (error) {
        await logger.log(`❌ Leveling voice session start error: ${error.message}`);
    }
}

async function endVoiceSession(state) {
    try {
        const guild = state.guild;
        if (!guild) return;

        const memberId = state.member?.id || state.id;
        if (!memberId) return;

        const sessionKey = `${guild.id}:${memberId}`;
        const session = voiceSessions.get(sessionKey);

        if (session && session.interval) {
            clearInterval(session.interval);
        }

        voiceSessions.delete(sessionKey);

        const botConfig = getBotConfig();
        if (!botConfig || !botConfig.id) {
            return;
        }

        const server = await db.getServerByDiscordId(botConfig.id, guild.id);
        if (!server) {
            return;
        }

        const dbMember = await db.getMemberByDiscordId(server.id, memberId);
        if (!dbMember) {
            return;
        }
        await db.updateMemberLevelStats(dbMember.id, {
            isInVoice: false
        });
    } catch (error) {
        await logger.log(`❌ Leveling voice session end error: ${error.message}`);
    }
}

async function handleVoiceTick(sessionKey) {
    const session = voiceSessions.get(sessionKey);
    if (!session) return;

    try {
        const botConfig = getBotConfig();
        if (!botConfig?.id) return;

        const server = await db.getServerByDiscordId(botConfig.id, session.guildId);
        if (!server) return;

        const dbMember = await db.getMemberByDiscordId(server.id, session.discordMemberId);
        if (!dbMember) return;

        const guildId = session.guildId;
        const voiceCooldownMs = await getVoiceCooldownMs(guildId);
        const now = Date.now();
        const lastRewardedAt = session.lastRewardedAt || 0;

        if ((now - lastRewardedAt) < voiceCooldownMs) return;

        const levelSnapshot = await db.getMemberLevel(dbMember.id);
        const afkStatus = await db.getAFKStatus(server.id, session.discordMemberId);
        const serverInfo = { id: session.serverId, name: session.serverName };
        const guildMember = {
            id: session.discordMemberId,
            displayName: dbMember.server_display_name || dbMember.display_name || dbMember.username,
            user: { username: dbMember.username }
        };

        await awardVoiceXP(serverInfo, dbMember, guildMember, 1, !!afkStatus, guildId, "voice-tick", levelSnapshot);
        session.lastRewardedAt = now;
    } catch (error) {
        await logger.log(`❌ Leveling voice tick error: ${error.message}`);
    }
}

async function recalculateAllMemberLevels(client) {
    try {
        const botConfig = getBotConfig();
        if (!botConfig || !botConfig.id) {
            await logger.log('⚠️ Bot config not available, skipping level recalculation');
            return;
        }

        const servers = await db.getServersForBot(botConfig.id);
        if (!servers || servers.length === 0) {
            await logger.log('ℹ️ No servers found, skipping level recalculation');
            return;
        }

        await logger.log(`🔄 Starting level recalculation for ${servers.length} server(s)...`);
        let totalRecalculated = 0;
        let totalFixed = 0;

        for (const server of servers) {
            try {
                const guild = client.guilds.cache.get(server.discord_server_id);
                if (!guild) {
                    continue;
                }

                const members = await db.getServerMembersList(server.id);
                if (!members || members.length === 0) {
                    continue;
                }

                let serverRecalculated = 0;
                let serverFixed = 0;

                for (const member of members) {
                    if (!member.id || !member.experience) {
                        continue;
                    }

                    const levelData = await db.getMemberLevel(member.id);
                    if (!levelData) {
                        continue;
                    }

                    const currentLevel = levelData.level ?? 1;
                    const expectedLevel = await determineLevel(levelData.experience ?? 0, guild.id);

                    if (currentLevel !== expectedLevel) {
                        await db.updateMemberLevelStats(member.id, { level: expectedLevel });
                        serverFixed++;
                        totalFixed++;
                    }
                    serverRecalculated++;
                    totalRecalculated++;
                }

                if (serverRecalculated > 0) {
                    await db.recalculateServerMemberRanks(server.id);
                    await logger.log(`✅ Recalculated ${serverRecalculated} member(s) in ${server.name} (${serverFixed} level(s) corrected)`);
                }
            } catch (error) {
                await logger.log(`❌ Error recalculating levels for server ${server.name}: ${error.message}`);
            }
        }

        await logger.log(`✅ Level recalculation complete: ${totalRecalculated} member(s) checked, ${totalFixed} level(s) corrected`);
    } catch (error) {
        await logger.log(`❌ Error during level recalculation: ${error.message}`);
    }
}

async function resumeVoiceSessions(client) {
    try {
        const botConfig = getBotConfig();
        if (!botConfig?.id) return;

        for (const guild of client.guilds.cache.values()) {
            let resumedCount = 0;
            const activeVoiceMemberIds = new Set();

            for (const [, voiceState] of guild.voiceStates.cache) {
                if (voiceState.channelId && voiceState.member) {
                    activeVoiceMemberIds.add(voiceState.member.id);
                    try {
                        await startVoiceSession(voiceState, true);
                        resumedCount++;
                    } catch (err) {
                        await logger.log(`❌ Leveling: failed to resume voice session for ${voiceState.id}: ${err.message}`);
                    }
                }
            }

            const server = await db.getServerByDiscordId(botConfig.id, guild.id);
            if (server) {
                const membersWithFlag = await db.getMembersWithInVoiceFlag(server.id);
                const staleMemberIds = membersWithFlag
                    .filter(m => !activeVoiceMemberIds.has(m.discord_member_id))
                    .map(m => m.member_id);

                if (staleMemberIds.length > 0) {
                    for (const memberId of staleMemberIds) {
                        await db.updateMemberLevelStats(memberId, { isInVoice: false });
                    }
                    await logger.log(`🧹 Leveling: Cleaned up ${staleMemberIds.length} stale is_in_voice flag(s) for guild ${guild.name}`);
                }
            }
        }
    } catch (error) {
        await logger.log(`❌ Leveling resume error: ${error.message}`);
    }
}

function init(client) {
    clientInstance = client;
    client.on("messageCreate", handleMessageCreate);

    if (client.isReady()) {
        resumeVoiceSessions(client);
        setTimeout(() => recalculateAllMemberLevels(client), 5000);
    } else {
        client.once("ready", () => {
            resumeVoiceSessions(client);
            setTimeout(() => recalculateAllMemberLevels(client), 5000);
        });
    }

    client.on("voiceStateUpdate", async (oldState, newState) => {
        try {
            const oldChannel = oldState?.channelId;
            const newChannel = newState?.channelId;

            if (!oldChannel && newChannel) {
                await startVoiceSession(newState, false);
            } else if (oldChannel && !newChannel) {
                await endVoiceSession(oldState);
            } else if (oldChannel && newChannel && oldChannel !== newChannel) {
                await endVoiceSession(oldState);
                await startVoiceSession(newState, false);
            }
        } catch (error) {
            await logger.log(`❌ Leveling voice state update error: ${error.message}`);
        }
    });

    logger.log("📈 Leveling component initialized");
}

export default { init };
