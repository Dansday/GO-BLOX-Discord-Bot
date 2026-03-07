import db from '../../../database/database.js';
import logger from '../../logger.js';

const GUILD_TEXT = 0;
const GUILD_NEWS = 5;

const guildSyncLock = new Set();

function isBetweenMarkers(role, startRole, endRole) {
    return role.position < startRole.position && role.position > endRole.position;
}

async function updateAllNotificationRolePositions(guild, startRole, endRole, channelList, roleByChannel) {
    const minPos = endRole.position + 1;
    const maxPos = startRole.position - 1;
    for (let i = 0; i < channelList.length; i++) {
        const channel = channelList[i];
        const roleId = roleByChannel[channel.id];
        if (!roleId) continue;
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;
        const targetPosition = Math.min(minPos + i, maxPos);
        if (role.position !== targetPosition) {
            await role.setPosition(targetPosition).catch(() => null);
        }
    }
}

export async function syncNotificationRoles(guild, serverId) {
    const guildId = guild?.id;
    if (guildId && guildSyncLock.has(guildId)) return;
    if (guildId) guildSyncLock.add(guildId);
    try {
        const row = await db.getServerSettings(serverId, 'notifications');
        const config = row?.settings || null;
        if (!config || !config.role_start || !config.role_end) {
            if (config && (config.role_start || config.role_end || (config.category_ids && config.category_ids.length > 0))) {
                logger.log(`🔔 Notifications (${guild.name}): skipped - role start and end must both be set`);
            }
            return;
        }
        const categoryIds = Array.isArray(config.category_ids) ? config.category_ids : [];
        if (categoryIds.length === 0) {
            logger.log(`🔔 Notifications (${guild.name}): skipped - no categories selected`);
            return;
        }

        const startRole = guild.roles.cache.get(config.role_start);
        const endRole = guild.roles.cache.get(config.role_end);
        if (!startRole || !endRole) {
            logger.log(`🔔 Notifications (${guild.name}): skipped - role start or end not found in server`);
            return;
        }

        const channelsInCategories = guild.channels.cache.filter(
            ch => ch.parentId && categoryIds.includes(ch.parentId) && (ch.type === GUILD_TEXT || ch.type === GUILD_NEWS)
        );
        const channelList = Array.from(channelsInCategories.values());

        const existingRows = await db.getNotificationRolesForServer(serverId);
        const roleByChannel = {};
        for (const r of existingRows) {
            roleByChannel[r.discord_channel_id] = r.discord_role_id;
        }

        const minPos = endRole.position + 1;
        const maxPos = Math.max(minPos, startRole.position - 1);
        const currentChannelIds = new Set(channelList.map(c => c.id));

        for (const [chId, roleId] of Object.entries(roleByChannel)) {
            if (!currentChannelIds.has(chId)) {
                try {
                    const role = guild.roles.cache.get(roleId);
                    if (role) await role.delete('Notification channel removed or category deselected');
                } catch (err) {
                    logger.log(`⚠️ Notifications: could not delete role ${roleId}: ${err.message}`);
                }
                await db.deleteNotificationRole(serverId, chId);
                delete roleByChannel[chId];
            }
        }

        for (let i = 0; i < channelList.length; i++) {
            const channel = channelList[i];
            let roleId = roleByChannel[channel.id];
            let role = roleId ? guild.roles.cache.get(roleId) : null;

            if (role) {
                if (role.name !== channel.name) await role.setName(channel.name).catch(() => null);
                continue;
            }

            const existingBetween = guild.roles.cache.find(
                r => r.name === channel.name && isBetweenMarkers(r, startRole, endRole) && r.id !== guild.id
            );
            if (existingBetween) {
                roleId = existingBetween.id;
                role = existingBetween;
                await db.upsertNotificationRole(serverId, channel.id, roleId);
                roleByChannel[channel.id] = roleId;
                continue;
            }

            const creationData = {
                name: channel.name,
                reason: 'Notification role (channel-based)',
                mentionable: false
            };
            creationData.position = endRole.position + 1;

            try {
                role = await guild.roles.create(creationData);
                await db.upsertRole(serverId, {
                    id: role.id,
                    name: role.name,
                    position: role.position,
                    hexColor: role.hexColor,
                    permissions: role.permissions
                });
                await db.upsertNotificationRole(serverId, channel.id, role.id);
                roleByChannel[channel.id] = role.id;
            } catch (err) {
                logger.log(`⚠️ Notifications: could not create role for #${channel.name}: ${err.message}`);
            }
        }

        await updateAllNotificationRolePositions(guild, startRole, endRole, channelList, roleByChannel);

        const ourRoleIds = new Set(Object.values(roleByChannel));
        const channelNames = new Set(channelList.map(c => c.name));

        const allRoles = guild.roles.cache.filter(r => r.id !== guild.id);
        for (const role of allRoles.values()) {
            if (!channelNames.has(role.name) || ourRoleIds.has(role.id)) continue;
            if (role.id === config.role_start || role.id === config.role_end) continue;
            if (!isBetweenMarkers(role, startRole, endRole)) continue;
            try {
                await role.delete('Notification orphan cleanup');
            } catch (err) {
                logger.log(`⚠️ Notifications: could not delete ${role.name}: ${err.message}`);
            }
        }
    } catch (error) {
        logger.log(`❌ Notifications sync error for guild ${guild?.name}: ${error.message}`);
    } finally {
        if (guildId) guildSyncLock.delete(guildId);
    }
}
