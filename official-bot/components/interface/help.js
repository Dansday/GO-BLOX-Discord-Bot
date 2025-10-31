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
        .setTitle("🤖 GO BLOX Bot Interface - Help")
        .setDescription("Welcome to the GO BLOX Bot interface! Use the buttons below to interact with the bot. All responses are private (ephemeral).")
        .addFields([
            {
                name: "📊 Status Button",
                value: "View bot status, uptime, and component information.\n**Permission:** Member+",
                inline: false
            },
            {
                name: "❓ Help Button",
                value: "Shows this help information for all available features.\n**Permission:** Member+",
                inline: false
            },
            {
                name: "💬 Feedback Button",
                value: "Submit feedback, suggestions, or concerns to the server staff. All submissions are logged with submission number and user information.\n**Permission:** Member+",
                inline: false
            },
            {
                name: "⏸️ Pause/Resume Button",
                value: "Pause or resume the bot's operations. When paused, all bot features are disabled except this button.\n**Permission:** Admin only",
                inline: false
            },
            {
                name: "📤 Send Message Button",
                value: "Send custom embed messages to any channel. Features:\n• Select target channel\n• Optionally mention roles\n• Custom title (required)\n• Custom description (optional)\n• Optional image URL\n• Optional color customization (hex/decimal/name)\n• Optional footer text (defaults to config footer if empty)\n**Permission:** Staff+",
                inline: false
            },
            {
                name: "📊 Inactive Members Button",
                value: "Find members who haven't chatted in the configured inactivity period (default: 90 days). Searches through all text and voice text channels in specified categories.\n**Permission:** Staff+",
                inline: false
            },
            {
                name: "💎 Custom Supporter Role Button",
                value: "Create, edit, or delete a custom role. Features:\n• Create: Set role name, color (hex/decimal/name), and icon (emoji or JPG/PNG image URL)\n• Edit: Modify your existing custom role\n• Delete: Remove your custom role\n• Role automatically positioned between Supporter and Staff roles\n• Auto-cleanup: Unused roles are automatically removed\n**Permission:** Supporter, Staff, or Admin",
                inline: false
            },
            {
                name: "🎮 How to Use",
                value: "Simply click any button above to interact with the bot. All button responses are private (ephemeral) - only you can see them.",
                inline: false
            },
            {
                name: "🔐 Permissions",
                value: "**Admin:** Full access to all features\n**Staff:** All features except Pause/Resume\n**Supporter:** Can use Custom Supporter Role, Status, and Help\n**Member:** Can use Status, Help, and Feedback",
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
