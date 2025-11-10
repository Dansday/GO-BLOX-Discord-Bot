import { LEVELING, PERMISSIONS, getBotConfig } from "../../config.js";
import db from "../../../database/database.js";
import logger from "../../logger.js";

const recentMessages = new Map();
const voiceSessions = new Map();
const permissionCache = new Map();
let clientInstance = null;

const messageCooldownMs = (LEVELING?.MESSAGE?.COOLDOWN_SECONDS || 0) * 1000;
const voiceMinimumMinutes = Math.max(LEVELING?.VOICE?.MINIMUM_SESSION_MINUTES || 0, 0);
const BASE_XP = 100;

export function getLevelRequirement(level) {
    if (level <= 1) return 0;
    return BASE_XP * Math.pow(2, level - 2);
}

function getExperienceForMessage() {
    return LEVELING?.MESSAGE?.XP || 0;
}

function getExperienceForVoiceMinutes(minutes) {
    if (!minutes || minutes <= 0) return 0;
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

        const stats = await db.updateMemberLevelStats(dbMember.id, {
            chatIncrement: 1,
            experienceIncrement: getExperienceForMessage(),
            lastMessageAt: message.createdAt || new Date()
        });

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
        let sessionStartTime = now;
        let elapsedMinutes = 0;

        if (resumed && levelData?.voice_session_started_at) {
            sessionStartTime = new Date(levelData.voice_session_started_at).getTime();
            elapsedMinutes = Math.max(0, Math.floor((now - sessionStartTime) / 60000));

            if (elapsedMinutes > 0) {
                const afkStatus = await db.getAFKStatus(server.id, dbMember.discord_member_id);
                if (!afkStatus) {
                    const stats = await db.updateMemberLevelStats(dbMember.id, {
                        voiceMinutesIncrement: elapsedMinutes,
                        experienceIncrement: getExperienceForVoiceMinutes(elapsedMinutes)
                    });
                    await handleLevelEvaluation(server, dbMember, stats, state.guild.id);
                    await logger.log(`📈 Resumed voice tracking for ${guildMember.id}: awarded ${elapsedMinutes} minutes, continuing to track`, state.guild.id);
                } else {
                    await logger.log(`⏸️ Skipped voice XP for ${guildMember.id}: user is AFK`, state.guild.id);
                }
            }

            await db.updateMemberLevelStats(dbMember.id, {
                voiceSessionStartedAt: new Date(now)
            });
            sessionStartTime = now;
        } else {
            await db.updateMemberLevelStats(dbMember.id, {
                voiceSessionStartedAt: new Date(now)
            });
        }

        const interval = setInterval(async () => {
            await handleVoiceTick(sessionKey);
        }, 60 * 1000);

        voiceSessions.set(sessionKey, {
            startedAt: sessionStartTime,
            serverId: server.id,
            serverName: server.name,
            memberId: dbMember.id,
            discordMemberId: guildMember.id,
            guildId: state.guild.id,
            interval,
            trackedMinutes: 0
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

        const levelData = await db.getMemberLevel(dbMember.id);
        if (!levelData || !levelData.voice_session_started_at) {
            return;
        }

        const sessionStartTime = new Date(levelData.voice_session_started_at).getTime();
        const now = Date.now();
        const elapsedMs = now - sessionStartTime;
        const totalElapsedMinutes = Math.floor(elapsedMs / 60000);

        if (totalElapsedMinutes > 0 && totalElapsedMinutes >= voiceMinimumMinutes) {
            const recordedMinutes = session?.trackedMinutes || 0;
            const remainingMinutes = Math.max(0, totalElapsedMinutes - recordedMinutes);

            if (remainingMinutes > 0) {
                const stats = await db.updateMemberLevelStats(dbMember.id, {
                    voiceMinutesIncrement: remainingMinutes,
                    experienceIncrement: getExperienceForVoiceMinutes(remainingMinutes),
                    voiceSessionStartedAt: null
                });

                await handleLevelEvaluation(server, dbMember, stats, guild.id);
            } else {
                await db.updateMemberLevelStats(dbMember.id, {
                    voiceSessionStartedAt: null
                });
            }
        } else {
            await db.updateMemberLevelStats(dbMember.id, {
                voiceSessionStartedAt: null
            });
        }
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

        const levelData = await db.getMemberLevel(dbMember.id);
        if (!levelData || !levelData.voice_session_started_at) {
            return;
        }

        session.trackedMinutes = (session.trackedMinutes || 0) + 1;

        if (session.trackedMinutes >= voiceMinimumMinutes) {
            const afkStatus = await db.getAFKStatus(server.id, session.discordMemberId);
            if (!afkStatus) {
                const stats = await db.updateMemberLevelStats(dbMember.id, {
                    voiceMinutesIncrement: 1,
                    experienceIncrement: getExperienceForVoiceMinutes(1)
                });

                const serverInfo = { id: session.serverId, name: session.serverName };
                await handleLevelEvaluation(serverInfo, dbMember, stats, session.guildId);
            }
        }
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
