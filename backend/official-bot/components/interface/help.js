import { getEmbedConfig } from "../../../config.js";
import { EmbedBuilder } from "discord.js";
import { hasPermission } from "../permissions.js";

export async function handleHelpButton(interaction) {

    if (!(await hasPermission(interaction.member, 'help'))) {
        await interaction.reply({
            content: '❌ You don\'t have permission to view help.',
            flags: 64
        });
        return;
    }
    
    const embedConfig = await getEmbedConfig(interaction.guild.id);
    const helpEmbed = new EmbedBuilder()
        .setColor(embedConfig.COLOR)
        .setTitle("🤖 GO BLOX Bot Panel - Help")
        .setDescription("Welcome to the GO BLOX Bot interface! Use the buttons below to interact with the bot. All responses are private (ephemeral).")
        .addFields([
            {
                name: "📤 Send Message",
                value: "Send custom embed messages to any channel with optional role mentions.\n**Permission:** Staff+",
                inline: false
            },
            {
                name: "💎 Custom Supporter Role",
                value: "Create, edit, or delete a custom role with name, color, and icon. Role is automatically positioned between configured role constraints (role start and role end). Each user can have exactly one custom role. Roles are automatically cleaned up if they have no members or more than one member.\n**Permission:** Supporter+ or Staff+",
                inline: false
            },
            {
                name: "📈 Leveling",
                value: "View your leveling stats (level, XP, chat count, voice minutes, rank) and see the server leaderboard.\n**XP Formula:** +10 XP per eligible message (30 seconds cooldown), +20 XP per voice minute (minimum 1 minute per tick). **Note:** AFK users do not earn voice XP.\n**Level System:** Exponential XP curve - Level 2 requires 100 XP, Level 3 requires 200 XP, Level 4 requires 400 XP, and so on.\n**Features:**\n• Automatic level recalculation from XP\n• Level up DM notifications\n• Live rank calculation\n• AFK users don't earn voice XP\n**Permission:** Member+",
                inline: false
            },
            {
                name: "⏸️ AFK",
                value: "Set yourself as AFK with an optional message. Your nickname will be prefixed with [AFK]. If in voice channel, you'll be automatically muted and deafened. AFK status auto-removes when you send a message or unmute/undeafen in voice. When mentioned while AFK, you'll receive a DM notification. Your original display name will be restored when AFK is removed.\n**Permission:** Member+",
                inline: false
            },
            {
                name: "💬 Feedback",
                value: "Submit feedback, suggestions, or concerns to the server staff. All submissions are posted to the configured feedback channel with staff role mentions.\n**Permission:** Member+",
                inline: false
            },
            {
                name: "❓ Help",
                value: "Shows this help information.\n**Permission:** Member+",
                inline: false
            },
            {
                name: "🔐 Permissions Summary",
                value: "**Admin:** Full access\n**Staff:** All interfaces (Send Message, Custom Supporter Role, Leveling, AFK, Help, Feedback)\n**Supporter:** Custom Supporter Role (plus Member access)\n**Member:** Leveling, AFK, Help, Feedback",
                inline: false
            }
        ])
        .setFooter({ text: embedConfig.FOOTER })
        .setTimestamp();

    await interaction.reply({
        embeds: [helpEmbed],
        flags: 64
    });
}
