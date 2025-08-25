import fs from "fs";
import { WELCOMER } from "./config.js";
import logger from "./logger.js";

let welcomed = {};
if (fs.existsSync(WELCOMER.FILES.JSON)) {
    welcomed = JSON.parse(fs.readFileSync(WELCOMER.FILES.JSON, "utf8"));
}

function saveWelcomed() {
    fs.writeFileSync(WELCOMER.FILES.JSON, JSON.stringify(welcomed, null, 2));
}

function getRandomWelcome(userId) {
    const template = WELCOMER.MESSAGES[Math.floor(Math.random() * WELCOMER.MESSAGES.length)];
    return template.replace("{user}", `<@${userId}>`);
}

async function welcomeUser(member, channel) {
    const userId = member.id;
    if (welcomed[userId]) return;

    const message = getRandomWelcome(userId);

    try {
        await channel.send(message);
        welcomed[userId] = true;
        saveWelcomed();
        await logger.log(`✅ Welcomed ${member.user.tag} (${userId}) in ${member.guild.id}`);
    } catch (err) {
        await logger.log(`❌ Failed to welcome ${userId}: ${err.message}`);
    }
}

async function fetchHistoricalWelcomes(client) {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const [guildId, channelId] of Object.entries(WELCOMER.CHANNELS)) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;

        const channel = client.channels.cache.get(channelId);
        if (!channel) continue;

        try {
            const members = await guild.members.fetch();

            const recentJoins = members.filter(member => {
                return (
                    member.joinedTimestamp &&
                    member.joinedTimestamp >= oneDayAgo &&
                    !welcomed[member.id]
                );
            });

            const sorted = [...recentJoins.values()].sort(
                (a, b) => a.joinedTimestamp - b.joinedTimestamp
            );

            for (const member of sorted) {
                await welcomeUser(member, channel);
                await new Promise(res => setTimeout(res, 60000));
            }

            await logger.log(`✅ Historical welcoming complete for guild ${guild.name} (${sorted.length} members)`);
        } catch (err) {
            await logger.log(`❌ Error fetching members for ${guildId}: ${err.message}`);
        }
    }
}

function init(client) {
    client.on("guildMemberAdd", async (member) => {
        const guildId = member.guild.id;
        if (!WELCOMER.CHANNELS[guildId]) return;

        const channelId = WELCOMER.CHANNELS[guildId];
        const channel = client.channels.cache.get(channelId);
        if (!channel) return;

        await welcomeUser(member, channel);
    });

    fetchHistoricalWelcomes(client);
}

export default { init };
