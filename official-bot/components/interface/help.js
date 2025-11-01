import { EMBED } from "../../../config.js";
import { EmbedBuilder } from "discord.js";
import { hasPermission } from "../permissions.js";

// Handle help button
export async function handleHelpButton(interaction) {
    // Check permissions (Admin, Staff, and Member)
    if (!hasPermission(interaction.member, 'help')) {
        await interaction.reply({
            content: '❌ You don\'t have permission to view help.',
            flags: 64
        });
        return;
    }
    const helpEmbed = new EmbedBuilder()
        .setColor(EMBED.COLOR)
        .setTitle("🤖 GO BLOX Bot Panel - Help")
        .setDescription("Welcome to the GO BLOX Bot interface! Use the buttons below to interact with the bot. All responses are private (ephemeral).")
        .addFields([
            {
                name: "📤 Send Message",
                value: "Send custom embed messages to any channel with optional role mentions.\n**Permission:** Staff+",
                inline: false
            },
            {
                name: "📊 Inactive Members",
                value: "Find members who haven't chatted in the configured inactivity period (90 days).\n**Permission:** Staff+",
                inline: false
            },
            {
                name: "⏸️ Pause/Resume",
                value: "Pause or resume the bot's operations.\n**Permission:** Admin+",
                inline: false
            },
            {
                name: "💎 Custom Supporter Role",
                value: "Create, edit, or delete a custom role with name, color, and icon.\n**Permission:** Supporter+ or Staff+",
                inline: false
            },
            {
                name: "⏸️ AFK",
                value: "Set yourself as AFK with an optional message. Your nickname will be prefixed with [AFK]. If in voice channel, you'll be automatically muted and deafened. AFK status auto-removes when you send a message or unmute/undeafen in voice. When mentioned while AFK, you'll receive a DM notification.\n**Permission:** Member+",
                inline: false
            },
            {
                name: "📊 Status",
                value: "View bot status, uptime, and server information.\n**Permission:** Member+",
                inline: false
            },
            {
                name: "❓ Help",
                value: "Shows this help information.\n**Permission:** Member+",
                inline: false
            },
            {
                name: "💬 Feedback",
                value: "Submit feedback, suggestions, or concerns to the server staff.\n**Permission:** Member+",
                inline: false
            },
            {
                name: "🔐 Permissions Summary",
                value: "**Admin:** Full access\n**Staff:** All except Pause/Resume\n**Supporter:** Custom Supporter Role, Status, Help\n**Member:** AFK, Status, Help, Feedback",
                inline: false
            }
        ])
        .setFooter({ text: EMBED.FOOTER })
        .setTimestamp();

    await interaction.reply({
        embeds: [helpEmbed],
        flags: 64
    });
}
