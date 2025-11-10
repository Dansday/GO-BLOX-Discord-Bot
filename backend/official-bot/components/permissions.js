import { PERMISSIONS } from "../../config.js";

const permissionsCache = new Map();

async function getGuildPermissions(guildId) {
    if (permissionsCache.has(guildId)) {
        return permissionsCache.get(guildId);
    }

    try {
        const perms = await PERMISSIONS.getPermissions(guildId);
        permissionsCache.set(guildId, perms);
        return perms;
    } catch (error) {

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

async function isAdmin(member) {
    const perms = await getGuildPermissions(member.guild.id);
    return await PERMISSIONS.hasAnyRole(member, perms.ADMIN_ROLES);
}

async function isStaff(member) {
    const perms = await getGuildPermissions(member.guild.id);
    return await PERMISSIONS.hasAnyRole(member, perms.STAFF_ROLES);
}

async function isMember(member) {
    const perms = await getGuildPermissions(member.guild.id);
    return await PERMISSIONS.hasAnyRole(member, perms.MEMBER_ROLES);
}

async function isSupporter(member) {
    const perms = await getGuildPermissions(member.guild.id);
    return await PERMISSIONS.hasAnyRole(member, perms.SUPPORTER_ROLES);
}

export async function hasPermission(member, action) {

    if (await isAdmin(member)) {
        return true;
    }


    if (await isStaff(member)) {
        return action !== 'setup';
    }

    if (await isSupporter(member)) {
        return action === 'custom_supporter_role';
    }

    if (await isMember(member)) {
        return action === 'help' || action === 'feedback' || action === 'afk' || action === 'leveling';
    }

    return false;
}

