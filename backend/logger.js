import { formatTimestamp } from "./utils.js";
import { getLoggerChannel } from "./config.js";

let logChannel = null;
let logChannelId = null;
let clientInstance = null;
let hasPermission = true; // Track if we have permission to log
let permissionWarningShown = false; // Track if we've already warned about missing permission

async function log(text, guildId = null) {
    // If guildId is provided, get the logger channel for that specific server
    if (guildId && clientInstance) {
        try {
            const serverLoggerChannelId = await getLoggerChannel(guildId);
            if (serverLoggerChannelId) {
                const serverLogChannel = clientInstance.channels.cache.get(serverLoggerChannelId);
                if (serverLogChannel) {
                    try {
                        const timestamp = formatTimestamp(Date.now(), true);
                        await serverLogChannel.send(`[${timestamp}] ${text}`);
                        return;
                    } catch (err) {
                        // Fall through to default logger or console.log if server-specific logger fails
                    }
                }
            }
        } catch (error) {
            // Logger channel not configured for this server, fall through to default logger
        }
    }

    // Use default logger channel if no guildId provided or server-specific logger failed
    if (!logChannel || !hasPermission) {
        // Fallback to console.log if logger channel is not set
        const timestamp = formatTimestamp(Date.now(), true);
        console.log(`[${timestamp}] ${text}`);
        return;
    }

    try {
        const timestamp = formatTimestamp(Date.now(), true);
        await logChannel.send(`[${timestamp}] ${text}`);
    } catch (err) {
        // Handle permission errors gracefully (especially for selfbots)
        if (err.code === 50001 || err.code === 50013) {
            // Missing Access (50001) or Missing Permissions (50013)
            hasPermission = false;
        }
        // Fallback to console.log for any error
        const timestamp = formatTimestamp(Date.now(), true);
        console.log(`[${timestamp}] ${text}`);
    }
}

function init(client, channelId = null) {
    // Store client instance for dynamic logging
    clientInstance = client;

    // If no channel ID provided, silently return (no console logging)
    if (!channelId) {
        return;
    }

    logChannel = client.channels.cache.get(channelId);
    logChannelId = channelId;
    if (!logChannel) {
        hasPermission = false;
        return;
    }

    // Check if bot has permission to send messages in the channel
    try {
        // For selfbots, permissions might not be available, so we'll catch errors when trying to send
        if (logChannel.guild && logChannel.permissionsFor && client.user) {
            const permissions = logChannel.permissionsFor(client.user);
            if (permissions && !permissions.has('SendMessages')) {
                hasPermission = false;
            }
        }
    } catch (permErr) {
        // Can't check permissions (selfbots), will try when logging
        hasPermission = true;
    }
}

export default {
    init,
    log
};
