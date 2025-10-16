import logger from "../../../logger.js";

// Handle pause button
export async function handlePauseButton(interaction, client) {
    // Check if user has permission
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ You need Administrator permissions to use this button.',
            ephemeral: true
        });
        return;
    }

    // Toggle pause state
    client.isPaused = !client.isPaused;

    if (client.isPaused) {
        await interaction.reply({
            content: '⏸️ Bot has been **paused**. All commands are now unavailable except the Pause/Resume button.',
            ephemeral: true
        });
        await logger.log(`⏸️ Bot paused by ${interaction.user.tag} (${interaction.user.id}) via button`);
    } else {
        await interaction.reply({
            content: '▶️ Bot has been **resumed**. All commands are now available.',
            ephemeral: true
        });
        await logger.log(`▶️ Bot resumed by ${interaction.user.tag} (${interaction.user.id}) via button`);
    }
}
