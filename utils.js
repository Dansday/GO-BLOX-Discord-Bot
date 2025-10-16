// Common utility functions used across the application

/**
 * Format timestamp to Indonesian format
 * @param {number} [timestamp] - Optional timestamp to format. If not provided, uses current time
 * @param {boolean} [includeSeconds=false] - Whether to include seconds in the format
 * @returns {string} Formatted timestamp string
 */
export function formatTimestamp(timestamp = Date.now(), includeSeconds = false) {
    const formatter = new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: includeSeconds ? "2-digit" : undefined,
        hour12: false,
    });

    return formatter.format(new Date(timestamp)).replace(",", "");
}

/**
 * Reply to interaction with auto-delete functionality
 * @param {Object} interaction - Discord interaction object
 * @param {Object} options - Reply options (content, embeds, components, etc.)
 * @param {number} [deleteAfter=10000] - Time in milliseconds to auto-delete the message (default: 10 seconds)
 * @returns {Promise<Object>} The reply message object
 */
export async function replyWithAutoDelete(interaction, options, deleteAfter = 10000) {
    const replyMessage = await interaction.reply(options);
    
    // Auto-delete the message after specified time
    setTimeout(async () => {
        try {
            await replyMessage.delete();
        } catch (error) {
            // Message might already be deleted, ignore error
        }
    }, deleteAfter);
    
    return replyMessage;
}

