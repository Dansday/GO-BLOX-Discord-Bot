import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { getEmbedConfig, NOTIFICATIONS } from '../../../config.js';
import { hasPermission, getPermissionDeniedMessage } from '../permissions.js';
import logger from '../../../logger.js';
import { translate } from '../../../i18n.js';

export async function handleNotificationsButton(interaction) {
    try {
        const member = interaction.member;

        if (!(await hasPermission(member, 'notifications'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'notifications', interaction.user.id);
            await interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null);
            return;
        }

        const config = await NOTIFICATIONS.getConfig(interaction.guild.id);
        if (!config) {
            const errorMsg = await translate('notifications.errors.notConfigured', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            }).catch(() => null);
            return;
        }

        const rolesWithCategory = await NOTIFICATIONS.getNotificationRolesWithCategory(interaction.guild.id);
        if (rolesWithCategory.length === 0) {
            const errorMsg = await translate('notifications.errors.noRoles', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            }).catch(() => null);
            return;
        }

        const embedConfig = await getEmbedConfig(interaction.guild.id);
        const title = await translate('notifications.title', interaction.guild.id, interaction.user.id);
        const description = await translate('notifications.description', interaction.guild.id, interaction.user.id);

        const notificationRoles = rolesWithCategory
            .map(({ discord_role_id }) => interaction.guild.roles.cache.get(discord_role_id))
            .filter(Boolean);

        if (notificationRoles.length === 0) {
            const errorMsg = await translate('notifications.errors.noRoles', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            }).catch(() => null);
            return;
        }

        const memberCurrentNotificationRoleIds = notificationRoles
            .filter(r => member.roles.cache.has(r.id))
            .map(r => r.id);

        const roleIdToCategory = new Map(rolesWithCategory.map(r => [r.discord_role_id, r.category_name || '']));
        const options = notificationRoles.slice(0, 25).map(role => ({
            label: (roleIdToCategory.get(role.id) || role.name).slice(0, 100),
            value: role.id,
            description: role.name.slice(0, 100),
            default: memberCurrentNotificationRoleIds.includes(role.id)
        }));

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('notifications_select')
            .setPlaceholder(await translate('notifications.selectPlaceholder', interaction.guild.id, interaction.user.id))
            .setMinValues(0)
            .setMaxValues(options.length)
            .addOptions(options);

        const selectRow = new ActionRowBuilder().addComponents(selectMenu);

        const backButton = new ButtonBuilder()
            .setCustomId('bot_menu')
            .setLabel('📋 Menu')
            .setStyle(ButtonStyle.Secondary);

        const backRow = new ActionRowBuilder().addComponents(backButton);

        const embed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(title)
            .setDescription(description)
            .setFooter({ text: embedConfig.FOOTER })
            .setTimestamp();

        const payload = { embeds: [embed], components: [selectRow, backRow] };
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply(payload).catch(() => null);
        } else {
            await interaction.update(payload).catch(() => interaction.reply({ ...payload, flags: 64 }).catch(() => null));
        }
    } catch (error) {
        logger.log(`❌ Notifications button error: ${error.message}`);
        await interaction.reply({
            content: `❌ ${error.message}`,
            flags: 64
        }).catch(() => null);
    }
}

export async function handleNotificationsSelect(interaction) {
    try {
        const member = interaction.member;

        if (!(await hasPermission(member, 'notifications'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'notifications', interaction.user.id);
            await interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null);
            return;
        }

        const config = await NOTIFICATIONS.getConfig(interaction.guild.id);
        if (!config) {
            const errorMsg = await translate('notifications.errors.notConfigured', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            }).catch(() => null);
            return;
        }

        const notificationRoleIds = new Set(await NOTIFICATIONS.getNotificationRoleIds(interaction.guild.id));
        const selectedIds = new Set(interaction.values || []);

        const toAdd = [...selectedIds].filter(id => notificationRoleIds.has(id) && !member.roles.cache.has(id));
        const toRemove = [...notificationRoleIds].filter(id => !selectedIds.has(id) && member.roles.cache.has(id));

        for (const roleId of toAdd) {
            try {
                await member.roles.add(roleId);
            } catch (err) {
                logger.log(`⚠️ Notifications: could not add role ${roleId} to ${member.user.tag}: ${err.message}`);
            }
        }
        for (const roleId of toRemove) {
            try {
                await member.roles.remove(roleId);
            } catch (err) {
                logger.log(`⚠️ Notifications: could not remove role ${roleId} from ${member.user.tag}: ${err.message}`);
            }
        }

        const successMsg = await translate('notifications.updated', interaction.guild.id, interaction.user.id);
        await interaction.reply({
            content: successMsg,
            flags: 64
        }).catch(() => null);

        await logger.log(`🔔 Notifications updated for ${member.user.tag}: +${toAdd.length} -${toRemove.length}`);
    } catch (error) {
        logger.log(`❌ Notifications select error: ${error.message}`);
        await interaction.reply({
            content: `❌ ${error.message}`,
            flags: 64
        }).catch(() => null);
    }
}
