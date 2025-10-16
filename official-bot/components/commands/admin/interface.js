import { EMBED } from "../../../../config.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import logger from "../../../../logger.js";

// Command definition
export const commandDefinition = {
    name: 'interface',
    description: 'Send bot interface with buttons to target channel (Admin only)',
    options: [
        {
            name: 'channel',
            description: 'Target channel to send the interface to',
            type: 7, // CHANNEL type
            required: true
        }
    ]
};

// Command execution
export async function execute(interaction) {
    try {
        // Check if user has permission
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({
                content: '❌ You need Administrator permissions to use this command.',
                ephemeral: true
            });
            return;
        }

        const targetChannel = interaction.options.getChannel('channel');
        
        // Check if channel is a text channel
        if (!targetChannel.isTextBased()) {
            await interaction.reply({
                content: '❌ Please select a text channel.',
                ephemeral: true
            });
            return;
        }

        // Create the interface embed
        const interfaceEmbed = {
            color: EMBED.COLOR,
            title: "🤖 GOBLOX Bot Interface",
            description: "Use the buttons below to interact with the bot:",
            fields: [
                {
                    name: "📊 Status",
                    value: "Check bot status and uptime",
                    inline: true
                },
                {
                    name: "❓ Help",
                    value: "Show available commands",
                    inline: true
                },
                {
                    name: "⏸️ Pause/Resume",
                    value: "Pause or resume the bot",
                    inline: true
                }
            ],
            footer: {
                text: "GOBLOX Bot System • Use buttons to interact"
            },
            timestamp: new Date().toISOString()
        };

        // Create buttons
        const statusButton = new ButtonBuilder()
            .setCustomId('bot_status')
            .setLabel('📊 Status')
            .setStyle(ButtonStyle.Primary);

        const helpButton = new ButtonBuilder()
            .setCustomId('bot_help')
            .setLabel('❓ Help')
            .setStyle(ButtonStyle.Secondary);

        const pauseButton = new ButtonBuilder()
            .setCustomId('bot_pause')
            .setLabel('⏸️ Pause/Resume')
            .setStyle(ButtonStyle.Danger);

        // Create action row with buttons
        const buttonRow = new ActionRowBuilder()
            .addComponents(statusButton, helpButton, pauseButton);

        // Send the interface to the target channel
        await targetChannel.send({
            embeds: [interfaceEmbed],
            components: [buttonRow]
        });

        await interaction.reply({
            content: `✅ Bot interface sent to ${targetChannel}!`,
            ephemeral: true
        });

        await logger.log(`🎮 Bot interface sent to ${targetChannel.name} by ${interaction.user.tag} (${interaction.user.id})`);

    } catch (error) {
        await interaction.reply({
            content: `❌ Failed to send interface: ${error.message}`,
            ephemeral: true
        });
        await logger.log(`❌ Interface command failed: ${error.message}`);
    }
}
