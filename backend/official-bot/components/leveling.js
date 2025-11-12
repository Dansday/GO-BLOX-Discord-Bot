import { getLevelingSettings, PERMISSIONS, getBotConfig } from "../../config.js";
import db from "../../../database/database.js";
import logger from "../../logger.js";

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

    return baseXP * Math.pow(multiplier, level - 2);
}

export async function calculateExperienceFromTotals({
    chatTotal = 0,
    voiceMinutesActive = 0,
    voiceMinutesAfk = 0
} = {}, guildId) {
    if (!guildId) {
        throw new Error('guildId is required for experience calculation');
    }

    const settings = await getLevelingSettings(guildId);
    const messageXP = settings.MESSAGE.XP;
    const voiceXPPerMin = settings.VOICE.XP_PER_MINUTE;
    const afkXPPerMin = settings.VOICE.AFK_XP_PER_MINUTE;

    const chatXP = messageXP * Math.max(0, chatTotal);
    const voiceXP = voiceXPPerMin * Math.max(0, voiceMinutesActive);
    const afkXP = afkXPPerMin * Math.max(0, voiceMinutesAfk);
    return chatXP + voiceXP + afkXP;
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

async function reconcileMemberExperience(memberId, guildId = null) {
    if (!memberId) {
        return null;
    }

    const levelData = await db.getMemberLevel(memberId);
    if (!levelData) {
        return null;
    }

    const expectedExperience = await calculateExperienceFromTotals({
        chatTotal: levelData.chat_total ?? 0,
        voiceMinutesActive: levelData.voice_minutes_active ?? 0,
        voiceMinutesAfk: levelData.voice_minutes_afk ?? 0
    }, guildId);

    const currentExperience = levelData.experience ?? 0;
    const updates = {};

    if (expectedExperience !== currentExperience) {
        updates.experienceIncrement = expectedExperience - currentExperience;
    }

    const expectedLevel = await determineLevel(expectedExperience, guildId);
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

async function handleLevelEvaluation(server, dbMember, currentStats, guildId) {
    if (!server || !dbMember || !currentStats) {
        return;
    }

    const expectedLevel = await determineLevel(currentStats.experience || 0, guildId);

    if (expectedLevel !== currentStats.level) {
        const updatedStats = await db.updateMemberLevelStats(dbMember.id, { level: expectedLevel });
        const memberName = dbMember.display_name || dbMember.username || dbMember.discord_member_id || 'Unknown member';
        await logger.log(`⭐ ${memberName} reached level ${expectedLevel} in ${server.name}`);

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
                await logger.log(`⚠️ Failed to send level up DM to ${dbMember.discord_member_id}: ${error.message}`);
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

        const xpGained = await getExperienceForMessage(guildId);
        let stats = await db.updateMemberLevelStats(dbMember.id, {
            chatIncrement: 1,
            experienceIncrement: xpGained,
            chatRewardedAt: message.createdAt || new Date()
        });

        const reconciledStats = await reconcileMemberExperience(dbMember.id, guildId);
        if (reconciledStats) {
            stats = reconciledStats;
        }

        const memberName = dbMember.server_display_name || dbMember.display_name || dbMember.username || message.author.username;
        const currentLevel = await determineLevel(stats.experience || 0, guildId);
        await logger.log(`💬 Chat XP: ${memberName} (${message.author.id}) gained +${xpGained} XP from chat | Total: ${stats.experience || 0} XP | Level: ${currentLevel}`);

        await handleLevelEvaluation(server, dbMember, stats, message.guild.id);
        recentMessages.set(cooldownKey, now);
    } catch (error) {
        await logger.log(`❌ Leveling message handler error: ${error.message}`);
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
        const wasInVoice = !!lastRewardedAtMs;
        const resumeCatchupAllowed = resumed && wasInVoice;

        const guildId = state.guild.id;
        const voiceCooldownMs = await getVoiceCooldownMs(guildId);
        
        let catchupAwarded = false;
        if (resumeCatchupAllowed && lastRewardedAtMs !== null) {
            const minutesSinceReward = Math.max(0, Math.floor((now - lastRewardedAtMs) / 60000));
            if (minutesSinceReward > 0) {
                const afkStatus = await db.getAFKStatus(server.id, dbMember.discord_member_id);
                const isAFK = !!afkStatus;
                const xpGained = await getExperienceForVoiceMinutes(minutesSinceReward, isAFK, guildId);
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
                const reconciledStats = await reconcileMemberExperience(dbMember.id, guildId);
                if (reconciledStats) {
                    stats = reconciledStats;
                }

                lastRewardedAtMs = now;
                catchupAwarded = true;
                const memberName = dbMember.server_display_name || dbMember.display_name || dbMember.username || guildMember.displayName || guildMember.user.username;
                const currentLevel = await determineLevel(stats.experience || 0, guildId);
                const xpType = isAFK ? "AFK Voice" : "Voice";
                await logger.log(`🎤 ${xpType} XP: ${memberName} (${guildMember.id}) gained +${xpGained} XP from ${minutesSinceReward} minute(s) [resume catch-up] | Total: ${stats.experience || 0} XP | Level: ${currentLevel}`);

                await handleLevelEvaluation(server, dbMember, stats, state.guild.id);
            }
        }
        
        if (!catchupAwarded && (!lastRewardedAtMs || (now - lastRewardedAtMs) >= voiceCooldownMs)) {
            const afkStatus = await db.getAFKStatus(server.id, dbMember.discord_member_id);
            const isAFK = !!afkStatus;
            const xpGained = await getExperienceForVoiceMinutes(1, isAFK, guildId);
            const updates = {
                voiceMinutesTotalIncrement: 1,
                experienceIncrement: xpGained,
                voiceRewardedAt: new Date(now)
            };
            if (isAFK) {
                updates.voiceMinutesAfkIncrement = 1;
            } else {
                updates.voiceMinutesActiveIncrement = 1;
            }
            let stats = await db.updateMemberLevelStats(dbMember.id, updates);
            const reconciledStats = await reconcileMemberExperience(dbMember.id, guildId);
            if (reconciledStats) {
                stats = reconciledStats;
            }

            lastRewardedAtMs = now;
            const memberName = dbMember.server_display_name || dbMember.display_name || dbMember.username || guildMember.displayName || guildMember.user.username;
            const currentLevel = await determineLevel(stats.experience || 0, guildId);
            const xpType = isAFK ? "AFK Voice" : "Voice";
            const logMessage = resumed && wasInVoice 
                ? `🎤 ${xpType} XP: ${memberName} (${guildMember.id}) gained +${xpGained} XP [resume] | Total: ${stats.experience || 0} XP | Level: ${currentLevel}`
                : `🎤 ${xpType} XP: ${memberName} (${guildMember.id}) gained +${xpGained} XP [join] | Total: ${stats.experience || 0} XP | Level: ${currentLevel}`;
            await logger.log(logMessage);

            await handleLevelEvaluation(server, dbMember, stats, state.guild.id);
        } else if (!lastRewardedAtMs) {
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
            lastRewardedAt: lastRewardedAtMs,
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
            voiceRewardedAt: null
        });
    } catch (error) {
        await logger.log(`❌ Leveling voice session end error: ${error.message}`);
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

        const guildId = session.guildId;
        const voiceCooldownMs = await getVoiceCooldownMs(guildId);
        const now = Date.now();
        const lastRewardedAt = session.lastRewardedAt || 0;

        if ((now - lastRewardedAt) < voiceCooldownMs) {
            return;
        }

        const afkStatus = await db.getAFKStatus(server.id, session.discordMemberId);
        const isAFK = !!afkStatus;
        const xpGained = await getExperienceForVoiceMinutes(1, isAFK, guildId);
        const nowDate = new Date();
        const updatePayload = {
            voiceMinutesTotalIncrement: 1,
            experienceIncrement: xpGained,
            voiceRewardedAt: nowDate
        };
        if (isAFK) {
            updatePayload.voiceMinutesAfkIncrement = 1;
        } else {
            updatePayload.voiceMinutesActiveIncrement = 1;
        }
        let stats = await db.updateMemberLevelStats(dbMember.id, updatePayload);

        session.lastRewardedAt = now;

        const memberName = dbMember.server_display_name || dbMember.display_name || dbMember.username || session.discordMemberId;
        const currentLevel = await determineLevel(stats.experience || 0, guildId);
        const xpType = isAFK ? "AFK Voice" : "Voice";
        await logger.log(`🎤 ${xpType} XP: ${memberName} (${session.discordMemberId}) gained +${xpGained} XP | Total: ${stats.experience || 0} XP | Level: ${currentLevel}`);

        const serverInfo = { id: session.serverId, name: session.serverName };
        const reconciledStats = await reconcileMemberExperience(dbMember.id, guildId);
        if (reconciledStats) {
            stats = reconciledStats;
        }
        await handleLevelEvaluation(serverInfo, dbMember, stats, session.guildId);
    } catch (error) {
        await logger.log(`❌ Leveling voice tick error: ${error.message}`);
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
                        await logger.log(`❌ Leveling: failed to resume voice session for ${voiceState.id}: ${err.message}`);
                    }
                }
            }

            if (resumedCount > 0) {
                await logger.log(`📈 Leveling: Resumed ${resumedCount} voice session(s) for guild ${guild.name}`);
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
            await logger.log(`❌ Leveling voice state update error: ${error.message}`);
        }
    });

    logger.log("📈 Leveling component initialized");
}

export default { init };
