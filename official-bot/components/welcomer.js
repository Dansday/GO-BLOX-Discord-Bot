import { WELCOMER, EMBED } from "../../config.js";
import logger from "../../logger.js";

function getRandomMessage() {
    const messages = WELCOMER.MESSAGES;
    return messages[Math.floor(Math.random() * messages.length)];
}

async function welcomeUser(member, client) {
    const welcomeChannelId = WELCOMER.CHANNELS[member.guild.id];
    if (!welcomeChannelId) {
        await logger.log(`❌ No welcome channel configured for guild ${member.guild.id}`);
        return;
    }

    const welcomeChannel = client.channels.cache.get(welcomeChannelId);
    if (!welcomeChannel) {
        await logger.log(`❌ Welcome channel not found: ${welcomeChannelId}`);
        return;
    }

    try {
        const welcomeMessage = getRandomMessage().replace("{user}", `<@${member.user.id}>`);

        // Create simple welcome embed
        const welcomeEmbed = {
            color: EMBED.COLOR,
            title: "🎉 Welcome to the Server!",
            description: welcomeMessage,
            thumbnail: {
                url: member.user.displayAvatarURL({ dynamic: true, size: 256 })
            },
            fields: [
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
            ],
            timestamp: new Date().toISOString()
        };

        await welcomeChannel.send({ embeds: [welcomeEmbed] });
        await logger.log(`✅ Welcomed ${member.user.tag} (${member.user.id}) in ${member.guild.name}`);
    } catch (err) {
        await logger.log(`❌ Failed to welcome ${member.user.tag} (${member.user.id}): ${err.message}`);
    }
}

function init(client) {
    client.on("guildMemberAdd", async (member) => {
        await welcomeUser(member, client);
    });
}

export default { init };
