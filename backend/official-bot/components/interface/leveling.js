import { EmbedBuilder } from "discord.js";
import { getEmbedConfig, getBotConfig } from "../../../config.js";
import { hasPermission } from "../permissions.js";
import db from "../../../../database/database.js";
import logger from "../../../logger.js";

function formatNumber(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "0";
    }
    return value.toLocaleString();
}

function formatLeaderboardRow(entry, index) {
    const position = entry.rank || index + 1;
    const name = entry.server_display_name || entry.display_name || entry.username || entry.discord_member_id || `Member ${position}`;
    return `${position}. **${name}** — LVL ${entry.level || 1} • ${formatNumber(entry.experience || 0)} XP`;
}

async function getServerForInteraction(interaction) {
    const botConfig = getBotConfig();
    if (!botConfig || !botConfig.id) {
        return null;
    }
    return await db.getServerByDiscordId(botConfig.id, interaction.guild.id);
}

export async function handleLevelingButton(interaction) {
    try {
        if (!(await hasPermission(interaction.member, "leveling"))) {
            await interaction.reply({
                content: "❌ You don't have permission to view leveling information.",
                flags: 64
            });
            return;
        }

        const server = await getServerForInteraction(interaction);
        if (!server) {
            await interaction.reply({
                content: "⚠️ This server is not registered with the bot. Please run a sync first.",
                flags: 64
            });
            return;
        }

        const embedConfig = await getEmbedConfig(interaction.guild.id);

        await db.recalculateServerMemberRanks(server.id);

        const memberLevelData = await db.getMemberLevelByDiscordId(server.id, interaction.user.id);
        const leaderboard = await db.getServerLeaderboard(server.id, 10);

        const memberDisplayName = memberLevelData?.server_display_name || memberLevelData?.display_name || memberLevelData?.username || interaction.user.username;

        const profileLines = [];
        profileLines.push(`• **Level:** ${memberLevelData?.level ?? 1}`);
        profileLines.push(`• **Experience:** ${formatNumber(memberLevelData?.experience ?? 0)} XP`);
        profileLines.push(`• **Chats Logged:** ${formatNumber(memberLevelData?.chat_count ?? 0)}`);
        profileLines.push(`• **Voice Minutes:** ${formatNumber(memberLevelData?.voice_minutes ?? 0)}`);
        profileLines.push(`• **Rank:** ${memberLevelData?.rank ? `#${memberLevelData.rank}` : "Unranked"}`);

        const leaderboardText = leaderboard && leaderboard.length > 0
            ? leaderboard.map((entry, idx) => formatLeaderboardRow(entry, idx)).join("\n")
            : "No leveling data available yet.";

        const levelingEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle("📈 Leveling Overview")
            .setDescription("Track your leveling progress and see the top members in this server.")
            .addFields(
                {
                    name: `Your Stats (${memberDisplayName})`,
                    value: profileLines.join("\n"),
                    inline: false
                },
                {
                    name: "🏆 Leaderboard (Top 10)",
                    value: leaderboardText,
                    inline: false
                }
            )
            .setFooter({ text: embedConfig.FOOTER })
            .setTimestamp();

        await interaction.reply({
            embeds: [levelingEmbed],
            flags: 64
        });
    } catch (error) {
        await logger.log(`❌ Leveling interface error: ${error.message}`, interaction.guild?.id);
        await interaction.reply({
            content: `❌ Failed to load leveling information: ${error.message}`,
            flags: 64
        }).catch(() => null);
    }
}

