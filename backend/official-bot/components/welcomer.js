import { WELCOMER, getEmbedConfig, getBotConfig } from "../../config.js";
import { EmbedBuilder } from "discord.js";
import logger from "../../logger.js";
import db from "../../../database/database.js";

function replacePlaceholders(message, memberId, serverData, memberData) {
    const now = new Date();
    const profileCreatedAt = memberData?.profile_created_at ? new Date(memberData.profile_created_at) : null;
    const accountAge = profileCreatedAt ? Math.floor((now.getTime() - profileCreatedAt.getTime()) / (1000 * 60 * 60 * 24)) : 0;
    const accountAgeText = accountAge === 0 ? 'today' : accountAge === 1 ? '1 day ago' : `${accountAge} days ago`;

    return message
        .replace(/{user}/g, `<@${memberId}>`)
        .replace(/{server}/g, serverData?.name || 'Unknown Server')
        .replace(/{memberCount}/g, (serverData?.total_members || 0).toString())
        .replace(/{accountAge}/g, accountAgeText)
        .replace(/{date}/g, now.toLocaleDateString())
        .replace(/{time}/g, now.toLocaleTimeString());
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

        const serverData = await db.getServerByDiscordId(botConfig.id, member.guild.id);
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

        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        const welcomeMessage = replacePlaceholders(randomMessage, member.user.id, serverData, memberData);

        const embedConfig = await getEmbedConfig(member.guild.id);

        const profileCreatedAt = memberData.profile_created_at ? new Date(memberData.profile_created_at) : null;
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
                    value: `Member #${serverData.total_members || 0}`,
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
