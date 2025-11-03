import { LOGGER } from "./config.js";
import { formatTimestamp } from "./utils.js";

let logChannel = null;
let hasPermission = true; // Track if we have permission to log
let permissionWarningShown = false; // Track if we've already warned about missing permission

async function log(text) {
    if (!logChannel || !hasPermission) {
        // Still log to console if Discord logging isn't available
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
            // Only warn once when permission is lost
            if (!permissionWarningShown) {
                console.log(`⚠️  No permission to log to Discord channel. Logging to console only.`);
                permissionWarningShown = true;
            }
            // Still output to console for important logs
            const timestamp = formatTimestamp(Date.now(), true);
            console.log(`[${timestamp}] ${text}`);
        } else {
            // Other errors (network issues, etc.) - log but don't spam
            if (!err._logged) {
                console.error("Failed to log to Discord:", err.message || err);
                err._logged = true;
            }
            // Still output to console
            const timestamp = formatTimestamp(Date.now(), true);
            console.log(`[${timestamp}] ${text}`);
        }
    }
}

function init(client) {
    logChannel = client.channels.cache.get(LOGGER.CHANNELS);
    if (!logChannel) {
        console.error("Log channel not found!");
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
                console.log(`⚠️  Bot does not have permission to send messages in log channel`);
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
