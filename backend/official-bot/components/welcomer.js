import { WELCOMER, getEmbedConfig, getBotConfig } from "../../config.js";
import { EmbedBuilder } from "discord.js";
import logger from "../../logger.js";
import db from "../../../database/database.js";
import { parseMySQLDateTime } from "../../utils.js";
function replacePlaceholders(message, memberId, serverData, memberData, memberCount) {
    const now = new Date();
    let profileCreatedAt = null;
    if (memberData?.profile_created_at) {
        if (memberData.profile_created_at instanceof Date) {
            profileCreatedAt = memberData.profile_created_at;
        } else {
            profileCreatedAt = parseMySQLDateTime(memberData.profile_created_at);
        }
    }
    const accountAge = profileCreatedAt ? Math.floor((now.getTime() - profileCreatedAt.getTime()) / (1000 * 60 * 60 * 24)) : 0;
    const accountAgeText = accountAge === 0 ? 'today' : accountAge === 1 ? '1 day ago' : `${accountAge} days ago`;

    return message
        .replace(/{user}/g, `<@${memberId}>`)
        .replace(/{server}/g, serverData?.name || 'Unknown Server')
        .replace(/{memberCount}/g, (memberCount || 0).toString())
        .replace(/{accountAge}/g, accountAgeText);
}

async function welcomeUser(member, client) {
    try {
        const botConfig = getBotConfig();
        if (!botConfig || !botConfig.id) {
            await logger.log(`⚠️ Bot config not available, skipping welcome message`);
            return;
        }

        const welcomeChannelIds = await WELCOMER.getChannels(member.guild.id);

        if (!welcomeChannelIds || welcomeChannelIds.length === 0) {
            await logger.log(`⚠️ No welcome channels configured for ${member.guild.id}, skipping welcome message`);
            return;
        }

        try {
            await member.guild.fetch();
        } catch (fetchError) {
            await logger.log(`⚠️ Failed to fetch guild ${member.guild.id} before welcome: ${fetchError.message}`);
        }

        const serverData = await db.upsertServer(botConfig.id, member.guild);
        if (!serverData) {
            await logger.log(`⚠️ Server not found in database for ${member.guild.id}, skipping welcome message`);
            return;
        }

        const memberData = await db.upsertMember(serverData.id, member) || await db.getMemberByDiscordId(serverData.id, member.user.id);
        if (!memberData) {
            await logger.log(`⚠️ Member not found in database for ${member.user.id}, skipping welcome message`);
            return;
        }

        const messages = await WELCOMER.getMessages(member.guild.id);

        if (!messages || messages.length === 0) {
            await logger.log(`⚠️ No welcome messages configured for ${member.guild.id}, skipping welcome message`);
            return;
        }

        const guildMemberCount = member.guild?.memberCount ?? (serverData?.total_members || 0);
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        const welcomeMessage = replacePlaceholders(randomMessage, member.user.id, serverData, memberData, guildMemberCount);

        const embedConfig = await getEmbedConfig(member.guild.id);

        let profileCreatedAt = null;
        if (memberData.profile_created_at) {
            if (memberData.profile_created_at instanceof Date) {
                profileCreatedAt = memberData.profile_created_at;
            } else {
                profileCreatedAt = parseMySQLDateTime(memberData.profile_created_at);
            }
        }
        const accountCreatedTimestamp = profileCreatedAt ? Math.floor(profileCreatedAt.getTime() / 1000) : Math.floor(Date.now() / 1000);

        const welcomeEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle("🎉 Welcome to the Server!")
            .setDescription(welcomeMessage)
            .setThumbnail(memberData.avatar || null)
            .addFields([
                {
                    name: "📅 Account Created",
                    value: `<t:${accountCreatedTimestamp}:R>`,
                    inline: true
                },
                {
                    name: "👥 Member Count",
                    value: `Member #${guildMemberCount || 0}`,
                    inline: true
                }
            ])
            .setFooter({ text: embedConfig.FOOTER })
            .setTimestamp();

        for (const channelId of welcomeChannelIds) {
            const welcomeChannel = client.channels.cache.get(channelId);
            if (welcomeChannel) {
                try {
                    await welcomeChannel.send({ embeds: [welcomeEmbed] });
                    const memberName = memberData.display_name || memberData.username || `User ${member.user.id}`;
                    await logger.log(`✅ Welcomed ${memberName} (${member.user.id}) in ${serverData.name} to channel ${welcomeChannel.name}`);
                } catch (err) {
                    await logger.log(`❌ Failed to send welcome message to channel ${channelId}: ${err.message}`);
                }
            } else {
                await logger.log(`❌ Welcome channel not found: ${channelId}`);
            }
        }
    } catch (err) {
        await logger.log(`❌ Failed to welcome ${member.user.id}: ${err.message}`);
    }
}

function init(client) {
    client.on("guildMemberAdd", async (member) => {
        const botConfig = getBotConfig();
        if (botConfig && botConfig.id) {
            try {
                const serverData = await db.getServerByDiscordId(botConfig.id, member.guild.id);
                if (serverData) {
                    const memberData = await db.getMemberByDiscordId(serverData.id, member.user.id);
                    const memberName = memberData ? (memberData.display_name || memberData.username) : `User ${member.user.id}`;
                    await logger.log(`👤 Member join event: ${memberName} (${member.user.id}) joined ${serverData.name}`);
                } else {
                    await logger.log(`👤 Member join event: User ${member.user.id} joined ${member.guild.id}`);
                }
            } catch (err) {
                await logger.log(`👤 Member join event: User ${member.user.id} joined ${member.guild.id}`);
            }
        } else {
            await logger.log(`👤 Member join event: User ${member.user.id} joined ${member.guild.id}`);
        }
        await welcomeUser(member, client);
    });

    logger.log("👋 Welcomer component initialized");
}

export default { init };
