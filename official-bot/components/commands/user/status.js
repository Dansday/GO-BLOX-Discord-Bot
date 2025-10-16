import { EMBED } from "../../../../config.js";

// Command definition
export const commandDefinition = {
    name: 'status',
    description: 'Show bot status and uptime',
};

// Command execution
export async function execute(interaction) {
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
                value: "Forwarder, Welcomer, Slash Commands",
                inline: false
            },
            {
                name: "🎮 Commands",
                value: "✅ All commands available",
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
