import { LEVELING, PERMISSIONS, getBotConfig } from "../../config.js";
import db from "../../../database/database.js";
import logger from "../../logger.js";

const recentMessages = new Map();
const voiceSessions = new Map();
const permissionCache = new Map();

const levelThresholds = Array.isArray(LEVELING?.LEVELS)
    ? [...LEVELING.LEVELS].sort((a, b) => (a.required_xp || 0) - (b.required_xp || 0))
    : [{ level: 1, required_xp: 0 }];

const messageCooldownMs = (LEVELING?.MESSAGE?.COOLDOWN_SECONDS || 0) * 1000;
const voiceMinimumMinutes = Math.max(LEVELING?.VOICE?.MINIMUM_SESSION_MINUTES || 0, 0);

function getExperienceForMessage() {
    return LEVELING?.MESSAGE?.XP || 0;
}

function getExperienceForVoiceMinutes(minutes) {
    if (!minutes || minutes <= 0) return 0;
    return (LEVELING?.VOICE?.XP_PER_MINUTE || 0) * minutes;
}

function determineLevel(experience = 0) {
    if (!levelThresholds.length) return 1;
    let currentLevel = levelThresholds[0].level || 1;

    for (const threshold of levelThresholds) {
        const requiredXP = threshold.required_xp || 0;
        if (experience >= requiredXP) {
            currentLevel = threshold.level;
        } else {
            break;
        }
    }

    return currentLevel;
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
        console.error(`Leveling resolve failure for guild ${guild?.id}:`, error.message);
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
        console.error(`Leveling permission fetch failed for guild ${guildId}:`, error.message);
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
        console.error(`Leveling role check failed for guild ${guildId}:`, error.message);
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

        const stats = await db.updateMemberLevelStats(dbMember.id, {
            chatIncrement: 1,
            experienceIncrement: getExperienceForMessage(),
            lastMessageAt: message.createdAt || new Date()
        });

        await handleLevelEvaluation(server, dbMember, stats, message.guild.id);
        recentMessages.set(cooldownKey, now);
    } catch (error) {
        console.error('Leveling message handler error:', error.message);
    }
}

async function startVoiceSession(state) {
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

        const sessionKey = `${state.guild.id}:${guildMember.id}`;
        const existingSession = voiceSessions.get(sessionKey);
        if (existingSession && existingSession.interval) {
            clearInterval(existingSession.interval);
        }

        const interval = setInterval(async () => {
            await handleVoiceTick(sessionKey);
        }, 60 * 1000);

        voiceSessions.set(sessionKey, {
            startedAt: Date.now(),
            serverId: server.id,
            serverName: server.name,
            memberId: dbMember.id,
            discordMemberId: guildMember.id,
            guildId: state.guild.id,
            interval,
            trackedMinutes: 0
        });
    } catch (error) {
        console.error('Leveling voice session start error:', error.message);
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

        if (!session || !session.startedAt) {
            return;
        }

        if (session.interval) {
            clearInterval(session.interval);
        }

        voiceSessions.delete(sessionKey);

        const elapsedMs = Date.now() - session.startedAt;
        const totalElapsedMinutes = Math.floor(elapsedMs / 60000);

        if (totalElapsedMinutes > 0 && totalElapsedMinutes >= voiceMinimumMinutes) {
            const recordedMinutes = session.trackedMinutes || 0;
            const remainingMinutes = Math.max(0, totalElapsedMinutes - recordedMinutes);

            if (remainingMinutes > 0) {
                const stats = await db.updateMemberLevelStats(session.memberId, {
                    voiceMinutesIncrement: remainingMinutes,
                    experienceIncrement: getExperienceForVoiceMinutes(remainingMinutes)
                });

                const server = { id: session.serverId, name: guild.name };
                const dbMember = await db.getMemberByDiscordId(session.serverId, memberId);

                if (dbMember) {
                    await handleLevelEvaluation(server, dbMember, stats, guild.id);
                }
            }
        }
    } catch (error) {
        console.error('Leveling voice session end error:', error.message);
    }
}

async function handleVoiceTick(sessionKey) {
    const session = voiceSessions.get(sessionKey);
    if (!session) {
        return;
    }

    try {
        session.trackedMinutes = (session.trackedMinutes || 0) + 1;

        if (session.trackedMinutes >= voiceMinimumMinutes) {
            const stats = await db.updateMemberLevelStats(session.memberId, {
                voiceMinutesIncrement: 1,
                experienceIncrement: getExperienceForVoiceMinutes(1)
            });

            const dbMember = await db.getMemberByDiscordId(session.serverId, session.discordMemberId);
            if (!dbMember) {
                return;
            }

            const serverInfo = { id: session.serverId, name: session.serverName };
            await handleLevelEvaluation(serverInfo, dbMember, stats, session.guildId);
        }
    } catch (error) {
        console.error('Leveling voice tick error:', error.message);
    }
}

function init(client) {
    client.on("messageCreate", handleMessageCreate);

    client.on("voiceStateUpdate", async (oldState, newState) => {
        try {
            const oldChannel = oldState?.channelId;
            const newChannel = newState?.channelId;

            if (!oldChannel && newChannel) {
                await startVoiceSession(newState);
            } else if (oldChannel && !newChannel) {
                await endVoiceSession(oldState);
            } else if (oldChannel && newChannel && oldChannel !== newChannel) {
                await endVoiceSession(oldState);
                await startVoiceSession(newState);
            }
        } catch (error) {
            console.error('Leveling voice state update error:', error.message);
        }
    });

    logger.log("📈 Leveling component initialized");
}

export default { init };

