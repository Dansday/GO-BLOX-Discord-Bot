import { PERMISSIONS } from "../../config.js";

// Cache for permissions per guild
const permissionsCache = new Map();

// Get permissions for a guild (with caching)
async function getGuildPermissions(guildId) {
    if (permissionsCache.has(guildId)) {
        return permissionsCache.get(guildId);
    }

    try {
        const perms = await PERMISSIONS.getPermissions(guildId);
        permissionsCache.set(guildId, perms);
        return perms;
    } catch (error) {
        // If permissions not configured, return empty arrays
        const emptyPerms = {
            ADMIN_ROLES: [],
            STAFF_ROLES: [],
            SUPPORTER_ROLES: [],
            MEMBER_ROLES: []
        };
        permissionsCache.set(guildId, emptyPerms);
        return emptyPerms;
    }
}

// Check if user has admin role
async function isAdmin(member) {
    const perms = await getGuildPermissions(member.guild.id);
    return await PERMISSIONS.hasAnyRole(member, perms.ADMIN_ROLES);
}

// Check if user has staff role
async function isStaff(member) {
    const perms = await getGuildPermissions(member.guild.id);
    return await PERMISSIONS.hasAnyRole(member, perms.STAFF_ROLES);
}

// Check if user has member role
async function isMember(member) {
    const perms = await getGuildPermissions(member.guild.id);
    return await PERMISSIONS.hasAnyRole(member, perms.MEMBER_ROLES);
}

// Check if user has supporter role
async function isSupporter(member) {
    const perms = await getGuildPermissions(member.guild.id);
    return await PERMISSIONS.hasAnyRole(member, perms.SUPPORTER_ROLES);
}

// Check permission for specific action
export async function hasPermission(member, action) {
    // Admin has all permissions
    if (await isAdmin(member)) {
        return true;
    }

    // Staff permissions: all interfaces except pause (including custom supporter role)
    // Actions: status, help, send_message, inactive, custom_supporter_role (but not pause or setup)
    if (await isStaff(member)) {
        return action !== 'pause' && action !== 'setup';
    }

    // Supporter permissions: can create custom roles
    if (await isSupporter(member)) {
        return action === 'custom_supporter_role';
    }

    // Member permissions: status, help, feedback, afk
    if (await isMember(member)) {
        return action === 'status' || action === 'help' || action === 'feedback' || action === 'afk';
    }

    // No permission
    return false;
}

// Clear cache for a guild (call when permissions are updated)
export function clearPermissionsCache(guildId) {
    permissionsCache.delete(guildId);
}
