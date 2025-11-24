import { STAFF_RATING } from '../../config.js';
import logger from '../../logger.js';
import db from '../../../database/database.js';

function getRatingColor(rating) {
    const r = rating.toFixed(1);
    const colors = {
        '1.0': 0xFF0000, '1.1': 0xFF1100, '1.2': 0xFF2200, '1.3': 0xFF3300, '1.4': 0xFF4400,
        '1.5': 0xFF5500, '1.6': 0xFF6600, '1.7': 0xFF7700, '1.8': 0xFF8800, '1.9': 0xFF9900,
        '2.0': 0xFFAA00, '2.1': 0xFFBB00, '2.2': 0xFFCC00, '2.3': 0xFFDD00, '2.4': 0xFFEE00,
        '2.5': 0xFFFF00, '2.6': 0xEEFF00, '2.7': 0xDDFF00, '2.8': 0xCCFF00, '2.9': 0xBBFF00,
        '3.0': 0xAAFF00, '3.1': 0x99FF00, '3.2': 0x88FF00, '3.3': 0x77FF00, '3.4': 0x66FF00,
        '3.5': 0x55FF00, '3.6': 0x44FF00, '3.7': 0x33FF00, '3.8': 0x22FF00, '3.9': 0x11FF00,
        '4.0': 0x00FF00, '4.1': 0x00FF22, '4.2': 0x00FF44, '4.3': 0x00FF66, '4.4': 0x00FF88,
        '4.5': 0x00FFAA, '4.6': 0x00FFCC, '4.7': 0x00FFEE, '4.8': 0x00EEFF, '4.9': 0x00DDFF,
        '5.0': 0xFFD700
    };
    return colors[r] || 0x808080;
}

async function ensureRatingRole(guild, serverId, member, ratingValue, ratingRecord) {
    const nameBase = member.displayName || member.user.globalName || member.user.username || member.user.tag || member.id;
    const desiredName = `⭐ ${ratingValue.toFixed(1)} • ${nameBase}`.slice(0, 100);
    const color = getRatingColor(ratingValue);
    const constraints = await STAFF_RATING.getRoleConstraints(guild.id);
    const startRole = constraints?.ROLE_START ? guild.roles.cache.get(constraints.ROLE_START) : null;
    const endRole = constraints?.ROLE_END ? guild.roles.cache.get(constraints.ROLE_END) : null;
    const targetPosition = endRole ? endRole.position + 1 : null;
    let role = ratingRecord?.rating_role_id ? guild.roles.cache.get(ratingRecord.rating_role_id) : null;
    if (!role) {
        const creationData = {
            name: desiredName,
            color,
            reason: 'Staff rating role',
            mentionable: false
        };
        if (targetPosition !== null) {
            creationData.position = targetPosition;
        }
        role = await guild.roles.create(creationData);
        await db.upsertRole(serverId, {
            id: role.id,
            name: role.name,
            position: role.position,
            hexColor: role.hexColor,
            permissions: role.permissions
        });
    } else {
        await role.edit({
            name: desiredName,
            color
        });
        if (targetPosition !== null && role.position !== targetPosition) {
            await role.setPosition(targetPosition).catch(() => null);
        }
    }
    return role;
}

export async function updateStaffRatingRole(guild, serverId, staffMemberId, staffDiscordId, stats = null) {
    try {
        const member = await guild.members.fetch(staffDiscordId).catch(() => null);
        if (!member) {
            return { updated: false, reason: 'member_not_found' };
        }
        let ratingRecord = await db.getStaffRating(serverId, staffMemberId);
        let totalReports = stats?.total_reports ?? ratingRecord?.total_reports ?? 0;
        let averageRating = stats?.rating ?? ratingRecord?.current_rating ?? 0;
        if (stats === null || stats.rating === undefined || stats.total_reports === undefined) {
            const aggregate = await db.getStaffRatingAggregate(serverId, staffMemberId);
            totalReports = aggregate.total_reports;
            averageRating = aggregate.average_rating || 0;
        }
        if (!totalReports || totalReports <= 0) {
            if (ratingRecord?.rating_role_id) {
                const role = guild.roles.cache.get(ratingRecord.rating_role_id);
                if (role) {
                    await member.roles.remove(role.id).catch(() => null);
                }
            }
            await db.upsertStaffRating(serverId, staffMemberId, 0, 0, null);
            await db.clearMemberRatingRole(staffMemberId);
            return { updated: false, reason: 'no_reports' };
        }
        const rounded = Math.round((averageRating || 0) * 10) / 10;
        const clamped = Math.max(1, Math.min(5, rounded));
        ratingRecord = await db.upsertStaffRating(serverId, staffMemberId, clamped, totalReports, ratingRecord?.rating_role_id || null);
        const role = await ensureRatingRole(guild, serverId, member, clamped, ratingRecord);
        await db.upsertStaffRating(serverId, staffMemberId, clamped, totalReports, role.id);
        await db.markMemberRatingRole(serverId, staffMemberId, role.id);
        if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role.id, 'Staff rating updated');
        }
        const ratingChannelId = await STAFF_RATING.getRatingChannel(guild.id);
        if (ratingChannelId) {
            const channel = guild.channels.cache.get(ratingChannelId) || await guild.channels.fetch(ratingChannelId).catch(() => null);
            if (channel && channel.isTextBased()) {
                await channel.send({
                    content: `⭐ **Staff Rating Updated**\n<@${staffDiscordId}> now has a **${clamped.toFixed(1)}/5.0** rating (${totalReports} reports)`
                }).catch(() => null);
            }
        }
        await member.send({
            content: `⭐ Your staff rating in **${guild.name}** is now **${clamped.toFixed(1)}/5.0** (${totalReports} reports).`
        }).catch(() => null);
        return {
            updated: true,
            rating: clamped,
            total_reports: totalReports,
            role_name: role.name
        };
    } catch (error) {
        await logger.log(`❌ Error updating staff rating role: ${error.message}`);
        return { updated: false, reason: 'error', error: error.message };
    }
}

export function init() {
    logger.log('🌟 Staff rating component ready');
}

export default { init, updateStaffRatingRole };

