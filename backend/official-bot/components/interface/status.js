import { getEmbedConfig } from "../../../config.js";
import { EmbedBuilder } from "discord.js";
import { hasPermission } from "../permissions.js";

// Handle status button
export async function handleStatusButton(interaction) {
    // Check permissions (Admin, Staff, and Member)
    if (!(await hasPermission(interaction.member, 'status'))) {
        await interaction.reply({
            content: '❌ You don\'t have permission to view status.',
            flags: 64
        });
        return;
    }
    const guild = interaction.guild;
    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    const embedConfig = await getEmbedConfig(guild.id);
    const statusEmbed = new EmbedBuilder()
        .setColor(embedConfig.COLOR)
        .setTitle("📊 Bot Status")
        .addFields([
            {
                name: "🟢 Status",
                value: "🟢 Online",
                inline: true
            },
            {
                name: "⏰ Uptime",
                value: `${hours}h ${minutes}m ${seconds}s`,
                inline: false
            },
            {
                name: "👥 Total Members",
                value: `${guild.memberCount}`,
                inline: true
            },
            {
                name: "💎 Boosters",
                value: `${guild.premiumSubscriptionCount}`,
                inline: true
            }
        ])
        .setFooter({ text: embedConfig.FOOTER })
        .setTimestamp();

    await interaction.reply({
        embeds: [statusEmbed],
        flags: 64
    });
}
