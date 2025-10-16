import { EMBED } from "../../../config.js";
import logger from "../../../logger.js";
import { replyWithAutoDelete } from "../../../utils.js";

// Handle help button
export async function handleHelpButton(interaction) {
    const helpEmbed = {
        color: EMBED.COLOR,
        title: "🤖 GOBLOX Bot Interface",
        description: "Welcome to the GOBLOX Bot interface! Use the buttons to interact with the bot:",
        fields: [
            {
                name: "📊 Status Button",
                value: "Shows bot status, uptime, and component information.",
                inline: false
            },
            {
                name: "❓ Help Button",
                value: "Shows this help information.",
                inline: false
            },
            {
                name: "⏸️ Pause/Resume Button",
                value: "Pauses or resumes the bot (Admin only).",
                inline: false
            },
            {
                name: "📤 Send Message Button",
                value: "Send custom embeds to any channel with title (required), description (required), image URL, color, footer, and role mentions. Step-by-step process: Select channel → Choose role (optional) → Fill embed details → Send.",
                inline: false
            },
            {
                name: "🎮 How to Use",
                value: "Simply click any button above to interact with the bot. All responses are private to you.",
                inline: false
            }
        ],
        footer: {
            text: "GOBLOX Bot System • Interface-based interaction"
        },
        timestamp: new Date().toISOString()
    };

    await replyWithAutoDelete(interaction, {
        embeds: [helpEmbed],
        flags: 64
    });

    await logger.log(`❓ Help button clicked by ${interaction.user.tag} (${interaction.user.id})`);
}
