import { PERMISSIONS } from "../../config.js";
import { translate } from "../../i18n.js";

async function getGuildPermissions(guildId) {
    try {
        const perms = await PERMISSIONS.getPermissions(guildId);
        return perms;
    } catch (error) {
        const emptyPerms = {
            ADMIN_ROLES: [],
            STAFF_ROLES: [],
            SUPPORTER_ROLES: [],
            MEMBER_ROLES: []
        };
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
    const isAdminMember = await isAdmin(member);
    const isStaffMember = await isStaff(member);
    const isSupporterMember = await isSupporter(member);
    const isMemberRole = await isMember(member);

    if (isAdminMember) {
        return true;
    }

    if (isStaffMember) {
        return action !== 'setup';
    }

    if (action === 'send_message') {
        return isStaffMember || isAdminMember;
    }

    if (action === 'custom_supporter_role') {
        return isSupporterMember || isStaffMember || isAdminMember;
    }

    if (action === 'feedback' || action === 'afk' || action === 'leveling' || action === 'giveaway' || action === 'settings' || action === 'staff_report') {
        return isMemberRole || isSupporterMember || isStaffMember || isAdminMember;
    }

    return false;
}

export async function getRequiredRolesForAction(guild, action) {
    try {
        const perms = await getGuildPermissions(guild.id);
        const roleNames = [];

        if (action === 'setup') {
            if (perms.ADMIN_ROLES && perms.ADMIN_ROLES.length > 0) {
                perms.ADMIN_ROLES.forEach(roleId => {
                    const role = guild.roles.cache.get(roleId);
                    if (role) roleNames.push(role.name);
                });
            }
            return roleNames.length > 0 ? roleNames : ['Admin'];
        }

        if (action === 'send_message') {
            if (perms.STAFF_ROLES && perms.STAFF_ROLES.length > 0) {
                perms.STAFF_ROLES.forEach(roleId => {
                    const role = guild.roles.cache.get(roleId);
                    if (role) roleNames.push(role.name);
                });
            }
            if (perms.ADMIN_ROLES && perms.ADMIN_ROLES.length > 0) {
                perms.ADMIN_ROLES.forEach(roleId => {
                    const role = guild.roles.cache.get(roleId);
                    if (role) roleNames.push(role.name);
                });
            }
            return roleNames.length > 0 ? roleNames : ['Staff or Admin'];
        }

        if (action === 'custom_supporter_role') {
            if (perms.SUPPORTER_ROLES && perms.SUPPORTER_ROLES.length > 0) {
                perms.SUPPORTER_ROLES.forEach(roleId => {
                    const role = guild.roles.cache.get(roleId);
                    if (role) roleNames.push(role.name);
                });
            }
            if (perms.STAFF_ROLES && perms.STAFF_ROLES.length > 0) {
                perms.STAFF_ROLES.forEach(roleId => {
                    const role = guild.roles.cache.get(roleId);
                    if (role) roleNames.push(role.name);
                });
            }
            if (perms.ADMIN_ROLES && perms.ADMIN_ROLES.length > 0) {
                perms.ADMIN_ROLES.forEach(roleId => {
                    const role = guild.roles.cache.get(roleId);
                    if (role) roleNames.push(role.name);
                });
            }
            return roleNames.length > 0 ? roleNames : ['Supporter, Staff, or Admin'];
        }

        if (action === 'feedback' || action === 'afk' || action === 'leveling' || action === 'giveaway' || action === 'settings' || action === 'staff_report' || action === 'menu') {
            if (perms.MEMBER_ROLES && perms.MEMBER_ROLES.length > 0) {
                perms.MEMBER_ROLES.forEach(roleId => {
                    const role = guild.roles.cache.get(roleId);
                    if (role) roleNames.push(role.name);
                });
            }
            if (perms.SUPPORTER_ROLES && perms.SUPPORTER_ROLES.length > 0) {
                perms.SUPPORTER_ROLES.forEach(roleId => {
                    const role = guild.roles.cache.get(roleId);
                    if (role) roleNames.push(role.name);
                });
            }
            if (perms.STAFF_ROLES && perms.STAFF_ROLES.length > 0) {
                perms.STAFF_ROLES.forEach(roleId => {
                    const role = guild.roles.cache.get(roleId);
                    if (role) roleNames.push(role.name);
                });
            }
            if (perms.ADMIN_ROLES && perms.ADMIN_ROLES.length > 0) {
                perms.ADMIN_ROLES.forEach(roleId => {
                    const role = guild.roles.cache.get(roleId);
                    if (role) roleNames.push(role.name);
                });
            }
            return roleNames.length > 0 ? roleNames : ['Member, Supporter, Staff, or Admin'];
        }

        return ['Unknown'];
    } catch (error) {
        return ['Unknown'];
    }
}

export async function getPermissionDeniedMessage(guild, action, userId = null) {
    const requiredRoles = await getRequiredRolesForAction(guild, action);
    const roleList = requiredRoles.length > 0 
        ? requiredRoles.map(role => `**${role}**`).join(', ')
        : 'the required role';

    const actionNames = {
        'send_message': 'Send Message',
        'custom_supporter_role': 'Custom Supporter Role',
        'feedback': 'Feedback',
        'afk': 'AFK',
        'leveling': 'Leveling',
        'giveaway': 'Giveaway',
        'settings': 'Settings',
        'staff_report': 'Staff Report',
        'menu': 'Menu',
        'setup': 'Setup'
    };

    const actionName = actionNames[action] || action;

    const title = await translate('permissions.denied.title', guild.id, userId);
    const description = await translate('permissions.denied.description', guild.id, userId, { action: actionName, roles: roleList });
    const footer = await translate('permissions.denied.footer', guild.id, userId);

    return `${title}\n\n${description}\n\n${footer}`;
}