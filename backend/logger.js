import { formatTimestamp } from "./utils.js";

let logChannel = null;
let hasPermission = true; // Track if we have permission to log
let permissionWarningShown = false; // Track if we've already warned about missing permission

async function log(text, guildId = null) {
    // If no channel set up, silently return (no console logging)
    if (!logChannel || !hasPermission) {
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
            // Silently stop logging (no console output)
        } else {
            // Other errors (network issues, etc.) - silently fail
            if (!err._logged) {
                err._logged = true;
            }
        }
    }
}

function init(client, channelId = null) {
    // If no channel ID provided, silently return (no console logging)
    if (!channelId) {
        return;
    }

    logChannel = client.channels.cache.get(channelId);
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
