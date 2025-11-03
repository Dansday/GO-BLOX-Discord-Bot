// Common utility functions used across the application

/**
 * Format timestamp to Indonesian format
 * @param {number} [timestamp] - Optional timestamp to format. If not provided, uses current time
 * @param {boolean} [includeSeconds=false] - Whether to include seconds in the format
 * @returns {string} Formatted timestamp string
 */
// Extract and separate channels, categories, and filter out threads
// Handles both numeric types (discord.js) and string constants (discord.js-selfbot-v13)
export function separateChannelsAndCategories(guildChannels) {
    // Convert to array first
    const channelsArray = Array.from(guildChannels.values());

    // Helper function to check if a channel is a thread
    const isThreadType = (type) => {
        // Check numeric types: 11 = GUILD_PUBLIC_THREAD, 12 = GUILD_PRIVATE_THREAD, 13 = GUILD_NEWS_THREAD
        if (typeof type === 'number') {
            return type === 11 || type === 12 || type === 13;
        }
        // Check string constants
        if (typeof type === 'string') {
            return type === 'GUILD_PUBLIC_THREAD' ||
                type === 'GUILD_PRIVATE_THREAD' ||
                type === 'GUILD_NEWS_THREAD';
        }
        return false;
    };

    // Helper function to check if a channel is a category
    const isCategoryType = (type) => {
        if (typeof type === 'number') {
            return type === 4; // GUILD_CATEGORY
        }
        if (typeof type === 'string') {
            return type === 'GUILD_CATEGORY';
        }
        return false;
    };

    // Helper function to check if a channel is text or news
    const isTextOrNewsType = (type) => {
        if (typeof type === 'number') {
            return type === 0 || type === 5; // GUILD_TEXT or GUILD_NEWS
        }
        if (typeof type === 'string') {
            return type === 'GUILD_TEXT' || type === 'GUILD_NEWS';
        }
        return false;
    };

    // Exclude threads - check both isThread() method and type
    const allChannels = channelsArray.filter(ch => {
        // Check if it's a thread using the method (if available)
        const isThreadMethod = ch.isThread ? ch.isThread() : false;

        // Check by type
        const isThreadByType = isThreadType(ch.type);

        return !isThreadMethod && !isThreadByType;
    });

    // Separate categories - these go to categories table
    const categories = allChannels.filter(ch => {
        return isCategoryType(ch.type);
    });

    // Only include GUILD_TEXT and GUILD_NEWS for channels table
    // Exclude all other types (voice, stage, forum, etc.)
    const channels = allChannels.filter(ch => {
        return isTextOrNewsType(ch.type);
    });

    return { categories, channels };
}

// Map categories for database sync
export function mapCategoriesForSync(categories) {
    return categories.map(cat => ({
        id: cat.id,
        name: cat.name
    }));
}

// Map channels for database sync
export function mapChannelsForSync(channels) {
    return channels.map(ch => ({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        parent_id: ch.parentId || null
    }));
}

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
