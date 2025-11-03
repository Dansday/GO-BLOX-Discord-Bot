import { BOOSTER, getEmbedConfig } from "../../config.js";
import { EmbedBuilder } from "discord.js";
import logger from "../../logger.js";

async function thankBooster(member, client) {
    // Get booster channels from database
    const boosterChannelIds = await BOOSTER.getChannels(member.guild.id);
    
    // If no channels configured, skip
    if (!boosterChannelIds || boosterChannelIds.length === 0) {
        await logger.log(`⚠️ No booster channels configured for ${member.guild.name}, skipping booster message`);
        return;
    }

    // Get booster messages from database
    const messages = await BOOSTER.getMessages(member.guild.id);
    
    // If no messages configured, skip
    if (!messages || messages.length === 0) {
        await logger.log(`⚠️ No booster messages configured for ${member.guild.name}, skipping booster message`);
        return;
    }

    // Select a random message from the list
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    const thankMessage = randomMessage.replace("{user}", `<@${member.user.id}>`);
    const embedConfig = await getEmbedConfig(member.guild.id);

    // Send to all configured booster channels
    for (const boosterChannelId of boosterChannelIds) {
        const boosterChannel = client.channels.cache.get(boosterChannelId);
        if (!boosterChannel) {
            await logger.log(`❌ Booster channel not found: ${boosterChannelId}`);
            continue;
        }

        try {

        // Create booster thank you embed
        const boosterEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle("💎 Thank You for Boosting!")
            .setDescription(thankMessage)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields([
                {
                    name: "🚀 Boost Level",
                    value: `Level ${member.guild.premiumTier}`,
                    inline: true
                },
                {
                    name: "✨ Total Boosts",
                    value: `${member.guild.premiumSubscriptionCount || 0}`,
                    inline: true
                },
                {
                    name: "📅 Boosted Since",
                    value: member.premiumSince ? `<t:${Math.floor(member.premiumSince.getTime() / 1000)}:R>` : "Just now",
                    inline: false
                }
            ])
            .setFooter({ text: embedConfig.FOOTER })
            .setTimestamp();

            await boosterChannel.send({ embeds: [boosterEmbed] });
            await logger.log(`✅ Thanked booster ${member.user.tag} (${member.user.id}) in ${member.guild.name} (channel: ${boosterChannel.name})`);
        } catch (err) {
            await logger.log(`❌ Failed to thank booster ${member.user.tag} (${member.user.id}) in channel ${boosterChannelId}: ${err.message}`);
        }
    }
}

function init(client) {
    client.on("guildMemberUpdate", async (oldMember, newMember) => {
        // Check if member just started boosting
        const wasBoosting = oldMember.premiumSince !== null;
        const isBoosting = newMember.premiumSince !== null;

        // Only trigger if they just started boosting (wasn't boosting before, but is now)
        if (!wasBoosting && isBoosting) {
            await thankBooster(newMember, client);
        }
    });

    logger.log("💎 Booster component initialized");
}

export default { init };
