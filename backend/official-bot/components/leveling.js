import { LEVELING, PERMISSIONS, getBotConfig } from "../../config.js";
import db from "../../../database/database.js";
import logger from "../../logger.js";

const recentMessages = new Map();
const voiceSessions = new Map();
const permissionCache = new Map();
let clientInstance = null;

const messageCooldownMs = (LEVELING?.MESSAGE?.COOLDOWN_SECONDS || 0) * 1000;
const voiceMinimumMinutes = Math.max(LEVELING?.VOICE?.MINIMUM_SESSION_MINUTES || 0, 0);
const BASE_XP = LEVELING?.REQUIREMENTS?.BASE_XP ?? 100;
const LEVEL_MULTIPLIER = LEVELING?.REQUIREMENTS?.MULTIPLIER ?? 1.3;

export function getLevelRequirement(level) {
    if (level <= 1) return 0;
    return BASE_XP * Math.pow(LEVEL_MULTIPLIER, level - 2);
}

export function calculateExperienceFromTotals({
    chatTotal = 0,
    voiceMinutesActive = 0,
    voiceMinutesAfk = 0
} = {}) {
    const chatXP = (LEVELING?.MESSAGE?.XP || 0) * Math.max(0, chatTotal);
    const voiceXP = (LEVELING?.VOICE?.XP_PER_MINUTE || 0) * Math.max(0, voiceMinutesActive);
    const afkXP = (LEVELING?.VOICE?.AFK_XP_PER_MINUTE || 0) * Math.max(0, voiceMinutesAfk);
    return chatXP + voiceXP + afkXP;
}

function getExperienceForMessage() {
    return LEVELING?.MESSAGE?.XP || 0;
}

function getExperienceForVoiceMinutes(minutes, isAFK = false) {
    if (!minutes || minutes <= 0) return 0;
    if (isAFK) {
        return (LEVELING?.VOICE?.AFK_XP_PER_MINUTE || 5) * minutes;
    }
    return (LEVELING?.VOICE?.XP_PER_MINUTE || 0) * minutes;
}

export function determineLevel(experience = 0) {
    if (experience <= 0) return 1;

    let level = 1;
    while (experience >= getLevelRequirement(level + 1)) {
        level += 1;
    }
    return level;
}

async function reconcileMemberExperience(memberId) {
    if (!memberId) {
        return null;
    }

    const levelData = await db.getMemberLevel(memberId);
    if (!levelData) {
        return null;
    }

    const expectedExperience = calculateExperienceFromTotals({
        chatTotal: levelData.chat_total ?? 0,
        voiceMinutesActive: levelData.voice_minutes_active ?? 0,
        voiceMinutesAfk: levelData.voice_minutes_afk ?? 0
    });

    const currentExperience = levelData.experience ?? 0;
    const updates = {};

    if (expectedExperience !== currentExperience) {
        updates.experienceIncrement = expectedExperience - currentExperience;
    }

    const expectedLevel = determineLevel(expectedExperience);
    if ((levelData.level ?? 1) !== expectedLevel) {
        updates.level = expectedLevel;
    }

    if (Object.keys(updates).length > 0) {
        const updatedStats = await db.updateMemberLevelStats(memberId, updates);
        if (updatedStats) {
            return updatedStats;
        }
    }

    if ((levelData.experience ?? 0) !== expectedExperience || (levelData.level ?? 1) !== expectedLevel) {
        return {
            ...levelData,
            experience: expectedExperience,
            level: expectedLevel
        };
    }

    return levelData;
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
        await logger.log(`❌ Leveling resolve failure for guild ${guild?.id}: ${error.message}`, guild?.id);
        return { server: null, dbMember: null, guildMember: null };
    }
}

const PERMISSION_CACHE_TTL_MS = 5 * 60 * 1000;

async function getMemberRoleIds(guildId) {
    const cached = permissionCache.get(guildId);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < PERMISSION_CACHE_TTL_MS) {
        return cached.roles;
    }

    try {
        const permissions = await PERMISSIONS.getPermissions(guildId);
        const roles = permissions?.MEMBER_ROLES || [];
        permissionCache.set(guildId, { timestamp: now, roles });
        return roles;
    } catch (error) {
        permissionCache.set(guildId, { timestamp: now, roles: [] });
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

async function handleLevelEvaluation(server, dbMember, currentStats, guildId) {
    if (!server || !dbMember || !currentStats) {
        return;
    }

    const expectedLevel = determineLevel(currentStats.experience || 0);

    if (expectedLevel !== currentStats.level) {
        const updatedStats = await db.updateMemberLevelStats(dbMember.id, { level: expectedLevel });
        const memberName = dbMember.display_name || dbMember.username || dbMember.discord_member_id || 'Unknown member';
        await logger.log(`⭐ ${memberName} reached level ${expectedLevel} in ${server.name}`, guildId);

        if (clientInstance && dbMember.discord_member_id) {
            try {
                const guild = clientInstance.guilds.cache.get(guildId);
                if (guild) {
                    const member = await guild.members.fetch(dbMember.discord_member_id).catch(() => null);
                    if (member && member.user) {
                        const dmChannel = await member.user.createDM().catch(() => null);
                        if (dmChannel) {
                            await dmChannel.send(`🎉 **Congratulations!** You've reached **Level ${expectedLevel}** in **${server.name}**!\n\nKeep up the great work! 🚀`);
                        }
                    }
                }
            } catch (error) {
                await logger.log(`⚠️ Failed to send level up DM to ${dbMember.discord_member_id}: ${error.message}`, guildId);
            }
        }

        return updatedStats;
    }

    return currentStats;
}

async function handleMessageCreate(message) {
    try {
        if (!message?.guild || message.author?.bot) return;

        const now = Date.now();
        const cooldownKey = `${message.guild.id}:${message.author.id}`;
        const lastMessageAt = recentMessages.get(cooldownKey);

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

        const xpGained = getExperienceForMessage();
        let stats = await db.updateMemberLevelStats(dbMember.id, {
            chatIncrement: 1,
            experienceIncrement: xpGained,
            chatRewardedAt: message.createdAt || new Date()
        });

        const reconciledStats = await reconcileMemberExperience(dbMember.id);
        if (reconciledStats) {
            stats = reconciledStats;
        }

        const memberName = dbMember.server_display_name || dbMember.display_name || dbMember.username || message.author.username;
        const currentLevel = determineLevel(stats.experience || 0);
        await logger.log(`💬 Chat XP: ${memberName} (${message.author.id}) gained +${xpGained} XP from chat | Total: ${stats.experience || 0} XP | Level: ${currentLevel}`, message.guild.id);

        await handleLevelEvaluation(server, dbMember, stats, message.guild.id);
        recentMessages.set(cooldownKey, now);
    } catch (error) {
        await logger.log(`❌ Leveling message handler error: ${error.message}`, message.guild?.id);
    }
}

async function startVoiceSession(state, resumed = false) {
    try {
        if (!state?.channelId || !state.guild) return;

        const { server, dbMember, guildMember } = await resolveServerAndMember(state.guild, state.member);

        if (!server || !dbMember || !guildMember) {
            return;
        }

        const eligible = await isMemberEligible(state.guild.id, guildMember);
        if (!eligible) {
            return;
        }

        await db.ensureMemberLevel(dbMember.id);
        const levelData = await db.getMemberLevel(dbMember.id);

        const sessionKey = `${state.guild.id}:${guildMember.id}`;
        const existingSession = voiceSessions.get(sessionKey);
        if (existingSession && existingSession.interval) {
            clearInterval(existingSession.interval);
        }

        const now = Date.now();
        let lastRewardedAtMs = levelData?.voice_rewarded_at ? new Date(levelData.voice_rewarded_at).getTime() : null;
        let hasRewarded = !!lastRewardedAtMs;
        let pendingMinutes = 0;
        const wasInVoice = !!lastRewardedAtMs;
        const resumeCatchupAllowed = resumed && wasInVoice;

        if (resumeCatchupAllowed && lastRewardedAtMs !== null) {
            const minutesSinceReward = Math.max(0, Math.floor((now - lastRewardedAtMs) / 60000));
            if (minutesSinceReward > 0) {
                const afkStatus = await db.getAFKStatus(server.id, dbMember.discord_member_id);
                const isAFK = !!afkStatus;
                const xpGained = getExperienceForVoiceMinutes(minutesSinceReward, isAFK);
                const updates = {
                    voiceMinutesTotalIncrement: minutesSinceReward,
                    experienceIncrement: xpGained,
                    voiceRewardedAt: new Date(now)
                };
                if (isAFK) {
                    updates.voiceMinutesAfkIncrement = minutesSinceReward;
                } else {
                    updates.voiceMinutesActiveIncrement = minutesSinceReward;
                }
                let stats = await db.updateMemberLevelStats(dbMember.id, updates);
                const reconciledStats = await reconcileMemberExperience(dbMember.id);
                if (reconciledStats) {
                    stats = reconciledStats;
                }

                lastRewardedAtMs = now;
                const memberName = dbMember.server_display_name || dbMember.display_name || dbMember.username || guildMember.displayName || guildMember.user.username;
                const currentLevel = determineLevel(stats.experience || 0);
                const xpType = isAFK ? "AFK Voice" : "Voice";
                await logger.log(`🎤 ${xpType} XP: ${memberName} (${guildMember.id}) gained +${xpGained} XP from ${minutesSinceReward} minute(s) [resume catch-up] | Total: ${stats.experience || 0} XP | Level: ${currentLevel}`, state.guild.id);

                await handleLevelEvaluation(server, dbMember, stats, state.guild.id);
            }
        }

        if (!lastRewardedAtMs) {
            await db.updateMemberLevelStats(dbMember.id, { voiceRewardedAt: new Date(now) });
            lastRewardedAtMs = now;
        }

        const interval = setInterval(async () => {
            await handleVoiceTick(sessionKey);
        }, 60 * 1000);

        voiceSessions.set(sessionKey, {
            serverId: server.id,
            serverName: server.name,
            memberId: dbMember.id,
            discordMemberId: guildMember.id,
            guildId: state.guild.id,
            interval,
            hasRewarded,
            pendingMinutes,
            lastRewardedAt: lastRewardedAtMs,
            joinedAt: now
        });
    } catch (error) {
        await logger.log(`❌ Leveling voice session start error: ${error.message}`, state.guild?.id);
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
            voiceRewardedAt: null
        });
    } catch (error) {
        await logger.log(`❌ Leveling voice session end error: ${error.message}`, state.guild?.id);
    }
}

async function handleVoiceTick(sessionKey) {
    const session = voiceSessions.get(sessionKey);
    if (!session) {
        return;
    }

    try {
        const botConfig = getBotConfig();
        if (!botConfig || !botConfig.id) {
            return;
        }

        const server = await db.getServerByDiscordId(botConfig.id, session.guildId);
        if (!server) {
            return;
        }

        const dbMember = await db.getMemberByDiscordId(server.id, session.discordMemberId);
        if (!dbMember) {
            return;
        }

        session.pendingMinutes = (session.pendingMinutes || 0) + 1;

        let minutesToReward = 0;
        if (!session.hasRewarded) {
            if (voiceMinimumMinutes <= 0) {
                minutesToReward = session.pendingMinutes;
                session.hasRewarded = true;
                session.pendingMinutes = 0;
            } else if (session.pendingMinutes >= voiceMinimumMinutes) {
                minutesToReward = session.pendingMinutes;
                session.hasRewarded = true;
                session.pendingMinutes = 0;
            } else {
                return;
            }
        } else {
            minutesToReward = session.pendingMinutes;
            session.pendingMinutes = 0;
        }

        if (minutesToReward <= 0) {
            return;
        }

        const afkStatus = await db.getAFKStatus(server.id, session.discordMemberId);
        const isAFK = !!afkStatus;
        const xpGained = getExperienceForVoiceMinutes(minutesToReward, isAFK);
        const now = new Date();
        const updatePayload = {
            voiceMinutesTotalIncrement: minutesToReward,
            experienceIncrement: xpGained,
            voiceRewardedAt: now
        };
        if (isAFK) {
            updatePayload.voiceMinutesAfkIncrement = minutesToReward;
        } else {
            updatePayload.voiceMinutesActiveIncrement = minutesToReward;
        }
        let stats = await db.updateMemberLevelStats(dbMember.id, updatePayload);

        session.lastRewardedAt = now.getTime();

        const memberName = dbMember.server_display_name || dbMember.display_name || dbMember.username || session.discordMemberId;
        const currentLevel = determineLevel(stats.experience || 0);
        const xpType = isAFK ? "AFK Voice" : "Voice";
        await logger.log(`🎤 ${xpType} XP: ${memberName} (${session.discordMemberId}) gained +${xpGained} XP from ${minutesToReward} minute(s) | Total: ${stats.experience || 0} XP | Level: ${currentLevel}`, session.guildId);

        const serverInfo = { id: session.serverId, name: session.serverName };
        const reconciledStats = await reconcileMemberExperience(dbMember.id);
        if (reconciledStats) {
            stats = reconciledStats;
        }
        await handleLevelEvaluation(serverInfo, dbMember, stats, session.guildId);
    } catch (error) {
        await logger.log(`❌ Leveling voice tick error: ${error.message}`, session.guildId);
    }
}

async function resumeVoiceSessions(client) {
    try {
        for (const guild of client.guilds.cache.values()) {
            let resumedCount = 0;
            for (const [, voiceState] of guild.voiceStates.cache) {
                if (voiceState.channelId && voiceState.member) {
                    try {
                        await startVoiceSession(voiceState, true);
                        resumedCount++;
                    } catch (err) {
                        await logger.log(`❌ Leveling: failed to resume voice session for ${voiceState.id}: ${err.message}`, guild.id);
                    }
                }
            }

            if (resumedCount > 0) {
                await logger.log(`📈 Leveling: Resumed ${resumedCount} voice session(s) for guild ${guild.name}`, guild.id);
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
    } else {
        client.once("ready", () => {
            resumeVoiceSessions(client);
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
            await logger.log(`❌ Leveling voice state update error: ${error.message}`, newState.guild?.id);
        }
    });

    logger.log("📈 Leveling component initialized");
}

export default { init };
