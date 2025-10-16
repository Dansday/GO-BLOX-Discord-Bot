import logger from "../../../../logger.js";

// Command definition
export const commandDefinition = {
    name: 'pause',
    description: 'Pause/Resume the bot (Admin only)',
};

// Command execution
export async function execute(interaction, client) {
    try {
        // Check if user has permission
        if (!interaction.member.permissions.has('Administrator')) {
            await interaction.reply({ 
                content: '❌ You need Administrator permissions to use this command.',
                ephemeral: true
            });
            return;
        }

        // Toggle pause state
        client.isPaused = !client.isPaused;

        if (client.isPaused) {
            await interaction.reply({ 
                content: '⏸️ Bot has been **paused**. All commands are now unavailable except `/pause`.',
                ephemeral: true
            });
            await logger.log(`⏸️ Bot paused by ${interaction.user.tag} (${interaction.user.id})`);
        } else {
            await interaction.reply({ 
                content: '▶️ Bot has been **resumed**. All commands are now available.',
                ephemeral: true
            });
            await logger.log(`▶️ Bot resumed by ${interaction.user.tag} (${interaction.user.id})`);
        }

    } catch (error) {
        await interaction.reply({ 
            content: `❌ Failed to toggle pause state: ${error.message}`,
            ephemeral: true
        });
        await logger.log(`❌ Pause toggle failed: ${error.message}`);
    }
}
