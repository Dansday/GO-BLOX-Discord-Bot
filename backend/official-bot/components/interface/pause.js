import logger from "../../../logger.js";
import { hasPermission } from "../permissions.js";

// Handle pause button
export async function handlePauseButton(interaction, client) {
    // Check if user has permission (Admin only)
    if (!(await hasPermission(interaction.member, 'pause'))) {
        await interaction.reply({
            content: '❌ You need Admin role to use this button.',
            flags: 64
        });
        return;
    }

    // Toggle pause state
    client.isPaused = !client.isPaused;

    if (client.isPaused) {
        await interaction.reply({
            content: '⏸️ Bot has been **paused**. All commands are now unavailable except the Pause/Resume button.',
            flags: 64
        });
        await logger.log(`⏸️ Bot paused by ${interaction.user.tag} (${interaction.user.id}) via button`);
    } else {
        await interaction.reply({
            content: '▶️ Bot has been **resumed**. All commands are now available.',
            flags: 64
        });
        await logger.log(`▶️ Bot resumed by ${interaction.user.tag} (${interaction.user.id}) via button`);
    }
}
