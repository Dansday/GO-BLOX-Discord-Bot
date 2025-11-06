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

    // Helper function to check if a channel is text, news, voice, or stage
    const isTextOrNewsType = (type) => {
        if (typeof type === 'number') {
            return type === 0 || type === 5 || type === 2 || type === 13; // GUILD_TEXT, GUILD_NEWS, GUILD_VOICE, GUILD_STAGE_VOICE
        }
        if (typeof type === 'string') {
            return type === 'GUILD_TEXT' || type === 'GUILD_NEWS' || type === 'GUILD_VOICE' || type === 'GUILD_STAGE_VOICE';
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

    // Include GUILD_TEXT, GUILD_NEWS, GUILD_VOICE, and GUILD_STAGE_VOICE for channels table
    // Exclude all other types (forum, etc.)
    const channels = allChannels.filter(ch => {
        return isTextOrNewsType(ch.type);
    });

    return { categories, channels };
}

// Map categories for database sync
export function mapCategoriesForSync(categories) {
    return categories.map(cat => ({
        id: cat.id,
        name: cat.name,
        position: cat.position !== undefined ? cat.position : null
    }));
}

// Map channels for database sync
export function mapChannelsForSync(channels) {
    return channels.map(ch => {
        // Convert channel type to string for consistent storage
        let typeValue = ch.type;
        if (typeof ch.type === 'number') {
            // Convert numeric types to string representation
            const typeMap = {
                0: 'GUILD_TEXT',
                1: 'DM',
                2: 'GUILD_VOICE',
                3: 'GROUP_DM',
                4: 'GUILD_CATEGORY',
                5: 'GUILD_NEWS',
                10: 'GUILD_NEWS_THREAD',
                11: 'GUILD_PUBLIC_THREAD',
                12: 'GUILD_PRIVATE_THREAD',
                13: 'GUILD_STAGE_VOICE',
                15: 'GUILD_FORUM',
                16: 'GUILD_MEDIA'
            };
            typeValue = typeMap[ch.type] || String(ch.type);
        } else if (typeof ch.type === 'string') {
            // Already a string, use as-is
            typeValue = ch.type;
        } else {
            // Fallback to string conversion
            typeValue = String(ch.type);
        }

        return {
            id: ch.id,
            name: ch.name,
            type: typeValue,
            parent_id: ch.parentId || null,
            position: ch.position !== undefined ? ch.position : null
        };
    });
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
