import { EmbedBuilder } from "discord.js";
import { getMainChannel, getEmbedConfig, getBotConfig } from "../../config.js";
import logger from "../../logger.js";
import db from "../../../database/database.js";

async function sendModerationLog(client, embedData, guildId = null) {
    const mainChannel = await getMainChannel(guildId);
    const channel = client.channels.cache.get(mainChannel);
    if (!channel) {
        await logger.log(`❌ Main channel not found: ${mainChannel}`);
        return;
    }

    try {
        const embedConfig = await getEmbedConfig(guildId);
        const embed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(embedData.title)
            .setDescription(embedData.description)
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        if (embedData.thumbnail) {
            embed.setThumbnail(embedData.thumbnail);
        }

        if (embedData.fields && embedData.fields.length > 0) {
            embed.addFields(embedData.fields);
        }

        await channel.send({ embeds: [embed] });
        await logger.log(`✅ Sent moderation log: ${embedData.title} for ${embedData.userTag || "unknown"}`);
    } catch (err) {
        await logger.log(`❌ Failed to send moderation log: ${err.message}`);
    }
}

async function getAuditLogEntry(guild, action, targetId) {
    try {
        const auditLogs = await guild.fetchAuditLogs({
            limit: 1,
            type: action
        });

        const entry = auditLogs.entries.first();
        if (entry && entry.target.id === targetId) {
            return entry;
        }
        return null;
    } catch (err) {
        await logger.log(`⚠️ Could not fetch audit log for ${action}: ${err.message}`);
        return null;
    }
}

function init(client) {

    client.on("guildBanAdd", async (ban) => {
        try {
            const { guild, user } = ban;
            const botConfig = getBotConfig();
            if (!botConfig || !botConfig.id) {
                return;
            }

            const serverData = await db.getServerByDiscordId(botConfig.id, guild.id);
            if (!serverData) {
                return;
            }

            const memberData = await db.getMemberByDiscordId(serverData.id, user.id);
            if (!memberData) {
                await logger.log(`⚠️ Member not found in database for ${user.id}, skipping ban log`, guild.id);
                return;
            }
            if (!memberData.display_name && !memberData.username) {
                await logger.log(`⚠️ Member profile incomplete for ${user.id}, skipping ban log`, guild.id);
                return;
            }

            const memberName = memberData.display_name || memberData.username;
            const memberAvatar = memberData.avatar || null;

            const auditEntry = await getAuditLogEntry(guild, 22, user.id);
            const moderator = auditEntry?.executor || null;

            let moderatorName = "Unknown";
            if (moderator) {
                const moderatorData = await db.getMemberByDiscordId(serverData.id, moderator.id);
                if (moderatorData && (moderatorData.display_name || moderatorData.username)) {
                    moderatorName = moderatorData.display_name || moderatorData.username;
                }
            }

            const reason = ban.reason || auditEntry?.reason || "No reason provided";

            await sendModerationLog(client, {
                title: "🔨 Member Banned",
                description: `<@${user.id}> has been banned from the server.`,
                thumbnail: memberAvatar,
                userTag: memberName,
                fields: [
                    {
                        name: "👤 User",
                        value: memberName,
                        inline: true
                    },
                    {
                        name: "🛡️ Moderator",
                        value: moderatorName,
                        inline: true
                    },
                    {
                        name: "📝 Reason",
                        value: reason.length > 1024 ? reason.substring(0, 1021) + "..." : reason,
                        inline: false
                    }
                ]
            }, guild.id);
        } catch (err) {
            await logger.log(`❌ Error handling ban: ${err.message}`);
        }
    });

    client.on("guildMemberRemove", async (member) => {
        try {
            const botConfig = getBotConfig();
            if (!botConfig || !botConfig.id) {
                return;
            }

            const serverData = await db.getServerByDiscordId(botConfig.id, member.guild.id);
            if (!serverData) {
                return;
            }

            const memberData = await db.upsertMember(serverData.id, member);
            if (!memberData) {
                await logger.log(`⚠️ Member not found in database for ${member.user.id}, skipping kick log`, member.guild.id);
                return;
            }
            if (!memberData.display_name && !memberData.username) {
                await logger.log(`⚠️ Member profile incomplete for ${member.user.id}, skipping kick log`, member.guild.id);
                return;
            }

            const memberName = memberData.display_name || memberData.username;
            const memberAvatar = memberData.avatar || null;

            const banEntry = await getAuditLogEntry(member.guild, 22, member.user.id);

            if (banEntry && Date.now() - banEntry.createdTimestamp < 5000) {
                return;
            }

            const kickEntry = await getAuditLogEntry(member.guild, 20, member.user.id);

            if (!kickEntry) {
                return;
            }

            const moderator = kickEntry.executor || null;
            let moderatorName = "Unknown";
            if (moderator) {
                const moderatorData = await db.getMemberByDiscordId(serverData.id, moderator.id);
                if (moderatorData && (moderatorData.display_name || moderatorData.username)) {
                    moderatorName = moderatorData.display_name || moderatorData.username;
                }
            }

            const reason = kickEntry.reason || "No reason provided";
            const memberSince = memberData.member_since ? new Date(memberData.member_since) : null;
            const memberSinceTimestamp = memberSince ? Math.floor(memberSince.getTime() / 1000) : null;

            await sendModerationLog(client, {
                title: "👢 Member Kicked",
                description: `<@${member.user.id}> has been kicked from the server.`,
                thumbnail: memberAvatar,
                userTag: memberName,
                fields: [
                    {
                        name: "👤 User",
                        value: memberName,
                        inline: true
                    },
                    {
                        name: "🛡️ Moderator",
                        value: moderatorName,
                        inline: true
                    },
                    {
                        name: "📝 Reason",
                        value: reason.length > 1024 ? reason.substring(0, 1021) + "..." : reason,
                        inline: false
                    },
                    {
                        name: "📅 Member Since",
                        value: memberSinceTimestamp ? `<t:${memberSinceTimestamp}:R>` : "Unknown",
                        inline: false
                    }
                ]
            }, member.guild.id);
        } catch (err) {
            await logger.log(`❌ Error handling member remove: ${err.message}`);
        }
    });

    logger.log("🛡️ Moderation component initialized - Tracking bans and kicks");
}

export default { init };
