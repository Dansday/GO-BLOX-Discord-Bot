import { STAFF_RATING } from '../../config.js';
import logger from '../../logger.js';
import db from '../../../database/database.js';

function getRatingColor(rating) {
    const clamped = Math.max(1.0, Math.min(5.0, rating));
    const normalized = (clamped - 1.0) / 4.0;

    const red = 255;
    const green = Math.round(0 + (215 * normalized));
    const blue = Math.round(0 + (0 * normalized));

    return (red << 16) | (green << 8) | blue;
}

async function updateAllRatingRolePositions(guild, serverId) {
    const constraints = await STAFF_RATING.getRoleConstraints(guild.id);
    const endRole = constraints?.ROLE_END ? guild.roles.cache.get(constraints.ROLE_END) : null;
    if (!endRole) {
        return;
    }

    const allRatings = await db.getAllStaffRatings(serverId);

    for (let i = 0; i < allRatings.length; i++) {
        const rating = allRatings[i];
        if (!rating.rating_role_id) continue;

        const role = guild.roles.cache.get(rating.rating_role_id);
        if (!role) continue;

        const targetPosition = endRole.position + 1 + (allRatings.length - i - 1);

        if (role.position !== targetPosition) {
            await role.setPosition(targetPosition).catch(() => null);
        }
    }
}

async function ensureRatingRole(guild, serverId, member, ratingValue, ratingRecord) {
    const desiredName = `⭐ ${ratingValue.toFixed(1)} • Staff Rating`.slice(0, 100);
    const color = getRatingColor(ratingValue);
    const constraints = await STAFF_RATING.getRoleConstraints(guild.id);
    const endRole = constraints?.ROLE_END ? guild.roles.cache.get(constraints.ROLE_END) : null;

    let role = ratingRecord?.rating_role_id ? guild.roles.cache.get(ratingRecord.rating_role_id) : null;
    if (!role) {
        const creationData = {
            name: desiredName,
            color,
            reason: 'Staff rating role',
            mentionable: false
        };
        if (endRole) {
            creationData.position = endRole.position + 1;
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
    }

    await updateAllRatingRolePositions(guild, serverId);

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
