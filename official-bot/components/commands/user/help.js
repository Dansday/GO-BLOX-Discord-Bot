import { EMBED } from "../../../../config.js";

// Command definition
export const commandDefinition = {
    name: 'help',
    description: 'Show available slash commands',
};

// Command execution
export async function execute(interaction) {
    // Get available commands directly from the main commands system
    const { default: commandsSystem } = await import('../../commands.js');
    const availableCommands = commandsSystem.getSlashCommands();
    const commandList = availableCommands.map(cmd => `\`/${cmd}\``).join(', ');

    const helpEmbed = {
        color: EMBED.COLOR,
        title: "🤖 GOBLOX Bot Slash Commands",
        description: "Available slash commands:",
        fields: [
            {
                name: "Commands",
                value: commandList || "No commands available",
                inline: false
            },
            {
                name: "Usage",
                value: "Use `/command` to execute a slash command",
                inline: false
            }
        ],
        timestamp: new Date().toISOString()
    };

    await interaction.reply({
        embeds: [helpEmbed],
        ephemeral: true
    });
}
