import { WELCOMER, getEmbedConfig } from "../../config.js";
import { EmbedBuilder } from "discord.js";
import logger from "../../logger.js";

// Replace placeholders in message
function replacePlaceholders(message, member, guild) {
    const now = new Date();
    const accountAge = Math.floor((now.getTime() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
    const accountAgeText = accountAge === 0 ? 'today' : accountAge === 1 ? '1 day ago' : `${accountAge} days ago`;
    
    return message
        .replace(/{user}/g, `<@${member.user.id}>`)
        .replace(/{server}/g, guild.name)
        .replace(/{memberCount}/g, guild.memberCount.toString())
        .replace(/{accountAge}/g, accountAgeText)
        .replace(/{date}/g, now.toLocaleDateString())
        .replace(/{time}/g, now.toLocaleTimeString());
}

async function welcomeUser(member, client) {
    try {
        // Get welcome channels from database
        const welcomeChannelIds = await WELCOMER.getChannels(member.guild.id);
        
        if (!welcomeChannelIds || welcomeChannelIds.length === 0) {
            await logger.log(`⚠️ No welcome channels configured for ${member.guild.name}, skipping welcome message`);
            return;
        }

        // Fetch member to ensure we have full data
        try {
            await member.fetch();
        } catch (err) {
            await logger.log(`⚠️ Could not fetch member ${member.user.tag}: ${err.message}`);
        }

        // Get welcome messages from database
        const messages = await WELCOMER.getMessages(member.guild.id);
        
        // If no messages configured, skip welcome
        if (!messages || messages.length === 0) {
            await logger.log(`⚠️ No welcome messages configured for ${member.guild.name}, skipping welcome message`);
            return;
        }
        
        // Select a random message from the list
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        const welcomeMessage = replacePlaceholders(randomMessage, member, member.guild);
        
        const embedConfig = await getEmbedConfig(member.guild.id);

        // Create simple welcome embed
        const welcomeEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle("🎉 Welcome to the Server!")
            .setDescription(welcomeMessage)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields([
                {
                    name: "📅 Account Created",
                    value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
                    inline: true
                },
                {
                    name: "👥 Member Count",
                    value: `Member #${member.guild.memberCount}`,
                    inline: true
                }
            ])
            .setFooter({ text: embedConfig.FOOTER })
            .setTimestamp();

        // Send to all configured welcome channels
        for (const channelId of welcomeChannelIds) {
            const welcomeChannel = client.channels.cache.get(channelId);
            if (welcomeChannel) {
                try {
                    await welcomeChannel.send({ embeds: [welcomeEmbed] });
                    await logger.log(`✅ Welcomed ${member.user.tag} (${member.user.id}) in ${member.guild.name} to channel ${welcomeChannel.name}`);
                } catch (err) {
                    await logger.log(`❌ Failed to send welcome message to channel ${channelId}: ${err.message}`);
                }
            } else {
                await logger.log(`❌ Welcome channel not found: ${channelId}`);
            }
        }
    } catch (err) {
        await logger.log(`❌ Failed to welcome ${member.user.tag} (${member.user.id}): ${err.message}`);
    }
}

function init(client) {
    client.on("guildMemberAdd", async (member) => {
        // Log that member joined event was received
        await logger.log(`👤 Member join event: ${member.user.tag} (${member.user.id}) joined ${member.guild.name}`);
        await welcomeUser(member, client);
    });

    logger.log("👋 Welcomer component initialized");
}

export default { init };
