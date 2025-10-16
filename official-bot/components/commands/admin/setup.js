import { sendInterfaceToChannel } from '../../interface.js';

// Command definition
export const commandDefinition = {
    name: 'setup',
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
export async function execute(interaction, client) {
    try {
        // Check if user has permission
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({
                content: '❌ You need Administrator permissions to use this command.',
                flags: 64
            });
            return;
        }

        const targetChannel = interaction.options.getChannel('channel');
        
        // Check if channel is a text channel
        if (!targetChannel.isTextBased()) {
            await interaction.reply({
                content: '❌ Please select a text channel.',
                flags: 64
            });
            return;
        }

        // Send interface using the interface component
        await sendInterfaceToChannel(targetChannel, interaction, client);

    } catch (error) {
        await interaction.reply({
            content: `❌ Failed to send interface: ${error.message}`,
            flags: 64
        });
    }
}
