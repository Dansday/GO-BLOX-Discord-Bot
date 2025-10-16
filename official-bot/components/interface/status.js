import { EMBED } from "../../../config.js";

// Handle status button
export async function handleStatusButton(interaction) {
    const statusEmbed = {
        color: EMBED.COLOR,
        title: "📊 Bot Status",
        fields: [
            {
                name: "🟢 Bot Status",
                value: "🟢 Online",
                inline: true
            },
            {
                name: "⏰ Uptime",
                value: `${Math.floor(process.uptime())} seconds`,
                inline: true
            },
            {
                name: "📡 Webhook Server",
                value: "Active",
                inline: true
            },
            {
                name: "🔧 Components",
                value: "Forwarder, Welcomer, Interface",
                inline: false
            },
            {
                name: "🎮 Interface",
                value: "✅ Button interface active",
                inline: false
            }
        ],
        timestamp: new Date().toISOString()
    };

    await interaction.reply({
        embeds: [statusEmbed],
        ephemeral: true
    });
}
