import { BOOSTER, getEmbedConfig, getBotConfig } from "../../config.js";
import { EmbedBuilder } from "discord.js";
import logger from "../../logger.js";
import db from "../../../database/database.js";

async function thankBooster(member, client) {
    try {
        const botConfig = getBotConfig();
        if (!botConfig || !botConfig.id) {
            await logger.log(`⚠️ Bot config not available, skipping booster message`);
            return;
        }

        const boosterChannelIds = await BOOSTER.getChannels(member.guild.id);

        if (!boosterChannelIds || boosterChannelIds.length === 0) {
            await logger.log(`⚠️ No booster channels configured for ${member.guild.id}, skipping booster message`);
            return;
        }

        const serverData = await db.getServerByDiscordId(botConfig.id, member.guild.id);
        if (!serverData) {
            await logger.log(`⚠️ Server not found in database for ${member.guild.id}, skipping booster message`);
            return;
        }

        const memberData = await db.getMemberByDiscordId(serverData.id, member.user.id);
        if (!memberData) {
            await logger.log(`⚠️ Member not found in database for ${member.user.id}, skipping booster message`);
            return;
        }

        const messages = await BOOSTER.getMessages(member.guild.id);

        if (!messages || messages.length === 0) {
            await logger.log(`⚠️ No booster messages configured for ${member.guild.id}, skipping booster message`);
            return;
        }

        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        const thankMessage = randomMessage.replace("{user}", `<@${member.user.id}>`);
        const embedConfig = await getEmbedConfig(member.guild.id);

        for (const boosterChannelId of boosterChannelIds) {
            const boosterChannel = client.channels.cache.get(boosterChannelId);
            if (!boosterChannel) {
                await logger.log(`❌ Booster channel not found: ${boosterChannelId}`);
                continue;
            }

            try {
                const boosterEmbed = new EmbedBuilder()
                    .setColor(embedConfig.COLOR)
                    .setTitle("💎 Thank You for Boosting!")
                    .setDescription(thankMessage)
                    .setThumbnail(memberData.avatar || null)
                    .addFields([
                        {
                            name: "🚀 Boost Level",
                            value: `Level ${serverData.boost_level || 0}`,
                            inline: true
                        },
                        {
                            name: "✨ Total Boosts",
                            value: `${serverData.total_boosters || 0}`,
                            inline: true
                        },
                        {
                            name: "📅 Boosted Since",
                            value: memberData.booster_since ? `<t:${Math.floor(new Date(memberData.booster_since).getTime() / 1000)}:R>` : "Just now",
                            inline: false
                        }
                    ])
                    .setFooter({ text: embedConfig.FOOTER })
                    .setTimestamp();

                await boosterChannel.send({ embeds: [boosterEmbed] });
                const memberName = memberData.display_name || memberData.username || `User ${member.user.id}`;
                await logger.log(`✅ Thanked booster ${memberName} (${member.user.id}) in ${serverData.name} (channel: ${boosterChannel.name})`);
            } catch (err) {
                await logger.log(`❌ Failed to thank booster ${member.user.id} in channel ${boosterChannelId}: ${err.message}`);
            }
        }
    } catch (err) {
        await logger.log(`❌ Failed to thank booster ${member.user.id}: ${err.message}`);
    }
}

function init(client) {
    client.on("guildMemberUpdate", async (oldMember, newMember) => {
        try {
            const botConfig = getBotConfig();
            if (!botConfig || !botConfig.id) {
                return;
            }

            const wasBoosting = oldMember.premiumSince !== null;
            const isBoosting = newMember.premiumSince !== null;

            if (!wasBoosting && isBoosting) {
                const serverData = await db.getServerByDiscordId(botConfig.id, newMember.guild.id);
                if (serverData) {
                    await db.upsertMember(serverData.id, newMember);
                }
                await thankBooster(newMember, client);
            } else if (wasBoosting && !isBoosting) {
                const serverData = await db.getServerByDiscordId(botConfig.id, newMember.guild.id);
                if (serverData) {
                    await db.upsertMember(serverData.id, newMember);
                }
            }
        } catch (err) {
            await logger.log(`❌ Error handling booster update: ${err.message}`);
        }
    });

    logger.log("💎 Booster component initialized");
}

export default { init };
