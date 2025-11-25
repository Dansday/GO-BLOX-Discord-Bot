import { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getEmbedConfig, CUSTOM_SUPPORTER_ROLE, getBotConfig } from '../../../config.js';
import logger from '../../../logger.js';
import { hasPermission, getPermissionDeniedMessage } from '../permissions.js';
import db from '../../../../database/database.js';
import { translate } from '../../../i18n.js';


const supporterRoles = new Map();

async function cleanupInvalidRole(role) {
    try {
        await role.guild.members.fetch();
        const memberCount = role.members.size;

        if (memberCount === 0) {

            await role.delete(`Auto-cleanup: Custom role has no members`);
            await logger.log(`🗑️ Deleted unused custom role: ${role.name} (${role.id}) - no members`);
        } else if (memberCount > 1) {

            const members = Array.from(role.members.values());
            for (const member of members) {
                await member.roles.remove(role, `Auto-cleanup: Custom role has multiple members`);
            }
            await role.delete(`Auto-cleanup: Custom role has ${memberCount} members (should be exactly 1)`);
            await logger.log(`🗑️ Deleted invalid custom role: ${role.name} (${role.id}) - has ${memberCount} members (should be exactly 1)`);
        }

        for (const [userId, roleId] of supporterRoles.entries()) {
            if (roleId === role.id) {
                supporterRoles.delete(userId);
                break;
            }
        }
    } catch (err) {
        await logger.log(`⚠️ Could not cleanup invalid role ${role.name} (${role.id}): ${err.message}`);
    }
}

async function hasSupporterRole(member) {
    try {
        const botConfig = getBotConfig();
        if (!botConfig || !botConfig.id) {
            return { has: false };
        }

        const user = member.user || member;
        const discordMemberId = user?.id || member.id;

        const server = await db.getServerByDiscordId(botConfig.id, member.guild.id);
        if (!server) {
            return { has: false };
        }

        const result = await db.memberHasCustomSupporterRole(discordMemberId, server.id);

        if (result.has && result.role) {
            const role = member.guild.roles.cache.get(result.role.discord_role_id);
            if (role) {
                supporterRoles.set(member.id, role.id);
                return { has: true, role };
            }
        }

        return { has: false };
    } catch (error) {
        return { has: false };
    }
}

function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;

    const trimmed = url.trim();

    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        return false;
    }

    const lowerUrl = trimmed.toLowerCase();
    const validExtensions = ['.jpg', '.jpeg', '.png'];

    const hasExtension = validExtensions.some(ext => lowerUrl.endsWith(ext));

    if (!hasExtension) {

        const urlWithoutParams = lowerUrl.split('?')[0].split('#')[0];
        const hasExtensionInPath = validExtensions.some(ext => urlWithoutParams.endsWith(ext));
        if (hasExtensionInPath) {
            return true;
        }
    } else {
        return true;
    }


    return true;
}

function parseColor(colorInput) {
    if (!colorInput || colorInput.trim() === '') {
        return null;
    }

    const trimmed = colorInput.trim();

    if (trimmed.startsWith('#')) {
        const hex = trimmed.substring(1);
        if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
            return parseInt(hex, 16);
        }
    } else if (/^[0-9A-Fa-f]{6}$/.test(trimmed)) {
        return parseInt(trimmed, 16);
    }

    const decimal = parseInt(trimmed, 10);
    if (!isNaN(decimal) && decimal >= 0 && decimal <= 0xFFFFFF) {
        return decimal;
    }

    const colorNames = {
        'red': 0xFF0000,
        'green': 0x00FF00,
        'blue': 0x0000FF,
        'yellow': 0xFFFF00,
        'orange': 0xFFA500,
        'purple': 0x800080,
        'pink': 0xFFC0CB,
        'cyan': 0x00FFFF,
        'black': 0x000000,
        'white': 0xFFFFFF,
        'gray': 0x808080,
        'grey': 0x808080
    };

    if (colorNames[trimmed.toLowerCase()]) {
        return colorNames[trimmed.toLowerCase()];
    }

    return null;
}

async function getRolePosition(guild) {
    const constraints = await CUSTOM_SUPPORTER_ROLE.getRoleConstraints(guild.id);

    if (!constraints.ROLE_START || !constraints.ROLE_END) {
        throw new Error('Could not find role position constraints');
    }

    const startRole = guild.roles.cache.get(constraints.ROLE_START);
    const endRole = guild.roles.cache.get(constraints.ROLE_END);

    if (!startRole || !endRole) {
        throw new Error('Could not find role position constraints');
    }





    return endRole.position + 1;
}

export async function handleCustomSupporterRoleButton(interaction) {
    try {
        const member = interaction.member;

        if (!(await hasPermission(member, 'custom_supporter_role'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'custom_supporter_role', interaction.user.id);
            await interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null);
            return;
        }

        const { has, role: existingRole } = await hasSupporterRole(member);

        if (has && existingRole) {
            const editLabel = await translate('customSupporterRole.buttons.edit', interaction.guild.id, interaction.user.id);
            const deleteLabel = await translate('customSupporterRole.buttons.delete', interaction.guild.id, interaction.user.id);
            const editButton = new ButtonBuilder()
                .setCustomId('custom_supporter_role_edit')
                .setLabel(editLabel)
                .setStyle(ButtonStyle.Primary);

            const deleteButton = new ButtonBuilder()
                .setCustomId('custom_supporter_role_delete')
                .setLabel(deleteLabel)
                .setStyle(ButtonStyle.Danger);

            const menuButton = new ButtonBuilder()
                .setCustomId('bot_menu')
                .setLabel('📋 Menu')
                .setStyle(ButtonStyle.Secondary);

            const buttonRow = new ActionRowBuilder().addComponents(editButton, deleteButton, menuButton);

            const embedConfig = await getEmbedConfig(interaction.guild.id);
            const title = await translate('customSupporterRole.existing.title', interaction.guild.id, interaction.user.id);
            const description = await translate('customSupporterRole.existing.description', interaction.guild.id, interaction.user.id, { roleName: existingRole.name });
            const currentRoleLabel = await translate('customSupporterRole.existing.currentRole', interaction.guild.id, interaction.user.id);
            const embed = new EmbedBuilder()
                .setColor(embedConfig.COLOR)
                .setTitle(title)
                .setDescription(description)
                .addFields({
                    name: currentRoleLabel,
                    value: `<@&${existingRole.id}>`,
                    inline: false
                })
                .setTimestamp();

            await interaction.update({
                embeds: [embed],
                components: [buttonRow]
            });
            await logger.log(`💎 Supporter role options shown to ${member.user.tag} (${member.user.id})`);
            return;
        }

        const modalTitle = await translate('customSupporterRole.create.title', interaction.guild.id, interaction.user.id);
        const modal = new ModalBuilder()
            .setCustomId('custom_supporter_role_create')
            .setTitle(modalTitle);

        const nameLabel = await translate('customSupporterRole.create.nameLabel', interaction.guild.id, interaction.user.id);
        const namePlaceholder = await translate('customSupporterRole.create.namePlaceholder', interaction.guild.id, interaction.user.id);
        const nameInput = new TextInputBuilder()
            .setCustomId('role_name')
            .setLabel(nameLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(namePlaceholder)
            .setRequired(true)
            .setMaxLength(100);

        const colorLabel = await translate('customSupporterRole.create.colorLabel', interaction.guild.id, interaction.user.id);
        const colorPlaceholder = await translate('customSupporterRole.create.colorPlaceholder', interaction.guild.id, interaction.user.id);
        const colorInput = new TextInputBuilder()
            .setCustomId('role_color')
            .setLabel(colorLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(colorPlaceholder)
            .setRequired(false)
            .setMaxLength(20);

        const iconLabel = await translate('customSupporterRole.create.iconLabel', interaction.guild.id, interaction.user.id);
        const iconPlaceholder = await translate('customSupporterRole.create.iconPlaceholder', interaction.guild.id, interaction.user.id);
        const iconInput = new TextInputBuilder()
            .setCustomId('role_icon')
            .setLabel(iconLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(iconPlaceholder)
            .setRequired(false)
            .setMaxLength(500);

        const nameRow = new ActionRowBuilder().addComponents(nameInput);
        const colorRow = new ActionRowBuilder().addComponents(colorInput);
        const iconRow = new ActionRowBuilder().addComponents(iconInput);

        modal.addComponents(nameRow, colorRow, iconRow);

        await interaction.showModal(modal);
        await logger.log(`💎 Supporter role creation modal shown to ${member.user.tag} (${member.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error showing supporter role modal: ${error.message}`);
        const errorMsg = await translate('customSupporterRole.errors.failed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.reply({
            content: errorMsg,
            flags: 64
        });
    }
}

export async function handleEditCustomSupporterRole(interaction) {
    try {
        const member = interaction.member;

        if (!(await hasPermission(member, 'custom_supporter_role'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'custom_supporter_role', interaction.user.id);
            await interaction.update({
                content: errorMessage,
                components: [],
                embeds: [],
                flags: 64
            }).catch(() => interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null));
            return;
        }

        const { has, role: existingRole } = await hasSupporterRole(member);

        if (!has || !existingRole) {
            const errorMsg = await translate('customSupporterRole.errors.noRole', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            });
            return;
        }

        const editModalTitle = await translate('customSupporterRole.create.editTitle', interaction.guild.id, interaction.user.id);
        const modal = new ModalBuilder()
            .setCustomId('custom_supporter_role_create')
            .setTitle(editModalTitle);

        const currentName = existingRole.name;
        const currentColor = existingRole.hexColor;
        let currentIcon = '';
        if (existingRole.icon) {
            if (existingRole.unicodeEmoji) {
                currentIcon = existingRole.unicodeEmoji;
            } else {
                currentIcon = existingRole.iconURL({ extension: 'png', size: 256 }) || '';
            }
        }

        const nameInput = new TextInputBuilder()
            .setCustomId('role_name')
            .setLabel('Role Name')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter your custom role name...')
            .setRequired(true)
            .setMaxLength(100)
            .setValue(currentName);

        const colorInput = new TextInputBuilder()
            .setCustomId('role_color')
            .setLabel('Role Color (Hex/Decimal/Name)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#FF5733 or 16729395 or red (optional)')
            .setRequired(false)
            .setMaxLength(20)
            .setValue(currentColor);

        const iconInput = new TextInputBuilder()
            .setCustomId('role_icon')
            .setLabel('Role Icon (Emoji or Image URL)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('🔥 or https://example.com/icon.png (optional)')
            .setRequired(false)
            .setMaxLength(500)
            .setValue(currentIcon);

        const nameRow = new ActionRowBuilder().addComponents(nameInput);
        const colorRow = new ActionRowBuilder().addComponents(colorInput);
        const iconRow = new ActionRowBuilder().addComponents(iconInput);

        modal.addComponents(nameRow, colorRow, iconRow);

        await interaction.showModal(modal);
        await logger.log(`💎 Supporter role edit modal shown to ${member.user.tag} (${member.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error showing edit modal: ${error.message}`);
        const errorMsg = await translate('customSupporterRole.errors.editFailed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.reply({
            content: errorMsg,
            flags: 64
        });
    }
}

export async function handleDeleteCustomSupporterRole(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        const member = interaction.member;

        if (!(await hasPermission(member, 'custom_supporter_role'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'custom_supporter_role', interaction.user.id);
            await interaction.editReply({
                content: errorMessage
            }).catch(() => null);
            return;
        }

        const { has, role: existingRole } = await hasSupporterRole(member);

        if (!has || !existingRole) {
            const errorMsg = await translate('customSupporterRole.errors.noRoleDelete', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const roleName = existingRole.name;
        const roleId = existingRole.id;

        await member.roles.remove(existingRole, `User deleted their custom supporter role`);

        await existingRole.delete(`Custom supporter role deleted by ${member.user.tag} (${member.user.id})`);

        supporterRoles.delete(member.id);

        const embedConfig = await getEmbedConfig(interaction.guild.id);
        const deletedTitle = await translate('customSupporterRole.deleted.title', interaction.guild.id, interaction.user.id);
        const deletedDescription = await translate('customSupporterRole.deleted.description', interaction.guild.id, interaction.user.id, { roleName });
        const successEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(deletedTitle)
            .setDescription(deletedDescription)
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.editReply({
            embeds: [successEmbed],
        });

        await logger.log(`🗑️ Deleted custom supporter role "${roleName}" (${roleId}) for ${member.user.tag} (${member.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error deleting supporter role: ${error.message}`);
        const errorMsg = await translate('customSupporterRole.errors.deleteFailed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.editReply({
            content: errorMsg
        });
    }
}

export async function handleCustomSupporterRoleModal(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        const member = interaction.member;
        const guild = interaction.guild;

        if (!(await hasPermission(member, 'custom_supporter_role'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'custom_supporter_role', interaction.user.id);
            await interaction.editReply({
                content: errorMessage
            }).catch(() => null);
            return;
        }

        const { has: hasExistingRole, role: existingRole } = await hasSupporterRole(member);

        if (hasExistingRole && existingRole) {

            try {

                const roleName = interaction.fields.getTextInputValue('role_name').trim();
                const colorInput = interaction.fields.getTextInputValue('role_color')?.trim() || '';
                const iconInput = interaction.fields.getTextInputValue('role_icon')?.trim() || '';

                if (!roleName || roleName.length < 1 || roleName.length > 100) {
                    const errorMsg = await translate('customSupporterRole.errors.invalidName', interaction.guild.id, interaction.user.id);
                    await interaction.editReply({
                        content: errorMsg
                    });
                    return;
                }

                const roleColor = parseColor(colorInput);
                const updateData = {
                    name: roleName,
                    reason: `Custom supporter role updated for ${member.user.tag} (${member.user.id})`
                };

                if (roleColor !== null) {
                    updateData.color = roleColor;
                }

                await existingRole.edit(updateData);

                const trimmedIconInput = iconInput?.trim() || '';
                let iconStatus = 'unchanged';
                let iconError = null;

                if (trimmedIconInput) {

                    try {

                        if (trimmedIconInput.startsWith('http://') || trimmedIconInput.startsWith('https://')) {

                            const premiumTier = interaction.guild.premiumTier;
                            if (premiumTier < 2) {

                                iconStatus = 'failed';
                                iconError = 'This server needs Level 2 Server Boost to use custom role icons. You can use an emoji instead!';
                                await logger.log(`⚠️ Cannot set custom icon: Server needs Level 2 boost (current: ${premiumTier})`);
                            } else if (isValidImageUrl(trimmedIconInput)) {

                                await existingRole.setIcon(trimmedIconInput, { reason: updateData.reason });
                                await logger.log(`✅ Set role icon to image URL: ${trimmedIconInput}`);
                                iconStatus = 'updated';
                            } else {
                                await logger.log(`⚠️ Invalid image URL format. Must be JPG/PNG image URL (http:// or https://).`);
                                iconStatus = 'invalid';
                                iconError = 'Invalid URL format or file type';
                            }
                        } else {

                            await existingRole.edit({
                                unicodeEmoji: trimmedIconInput,
                                reason: updateData.reason
                            });
                            await logger.log(`✅ Set role icon to emoji: ${trimmedIconInput}`);
                            iconStatus = 'updated';
                        }
                    } catch (err) {
                        await logger.log(`⚠️ Could not set role icon: ${err.message}`);

                        if (err.message && err.message.includes('boost')) {
                            iconError = 'This server needs Level 2 Server Boost to use custom role icons. You can use an emoji instead!';
                        } else {
                            iconError = err.message;
                        }
                        await logger.log(`⚠️ Note: Role still updated successfully. Icon requires server boost level 2+ and accessible JPG/PNG image or valid emoji.`);
                        iconStatus = 'failed';
                    }
                } else if (existingRole.icon) {

                    try {
                        await existingRole.setIcon(null, { reason: updateData.reason });
                        await logger.log(`✅ Removed role icon`);
                        iconStatus = 'removed';
                    } catch (err) {
                        await logger.log(`⚠️ Could not remove role icon: ${err.message}`);
                        iconStatus = 'remove_failed';
                    }
                }

                let iconStatusKey = 'customSupporterRole.updated.iconStatusUnchanged';
                if (iconStatus === 'updated') iconStatusKey = 'customSupporterRole.updated.iconStatusUpdated';
                else if (iconStatus === 'removed') iconStatusKey = 'customSupporterRole.updated.iconStatusRemoved';
                else if (iconStatus === 'failed') iconStatusKey = 'customSupporterRole.updated.iconStatusFailed';
                else if (iconStatus === 'invalid') iconStatusKey = 'customSupporterRole.updated.iconStatusInvalid';
                const iconStatusText = await translate(iconStatusKey, interaction.guild.id, interaction.user.id);

                let iconWarningText = '';
                if (iconError) {
                    if (iconError.includes('boost')) {
                        iconWarningText = await translate('customSupporterRole.updated.iconWarningBoost', interaction.guild.id, interaction.user.id);
                    } else {
                        iconWarningText = await translate('customSupporterRole.updated.iconWarningGeneric', interaction.guild.id, interaction.user.id);
                    }
                }

                const embedConfig = await getEmbedConfig(interaction.guild.id);
                const updateDescription = await translate('customSupporterRole.updated.description', interaction.guild.id, interaction.user.id, {
                    roleName,
                    iconWarning: iconWarningText
                });
                const updatedTitle = await translate('customSupporterRole.updated.title', interaction.guild.id, interaction.user.id);
                const roleDetailsLabel = await translate('customSupporterRole.updated.roleDetails', interaction.guild.id, interaction.user.id);
                const roleDetailsValue = await translate('customSupporterRole.updated.roleDetailsValue', interaction.guild.id, interaction.user.id, {
                    name: roleName,
                    color: colorInput || 'Unchanged',
                    icon: iconStatusText
                });
                const roleLabel = await translate('customSupporterRole.updated.role', interaction.guild.id, interaction.user.id);
                const successEmbed = new EmbedBuilder()
                    .setColor(embedConfig.COLOR)
                    .setTitle(updatedTitle)
                    .setDescription(updateDescription)
                    .addFields([
                        {
                            name: roleDetailsLabel,
                            value: roleDetailsValue,
                            inline: false
                        },
                        {
                            name: roleLabel,
                            value: `<@&${existingRole.id}>`,
                            inline: true
                        }
                    ])
                    .setTimestamp()
                    .setFooter({ text: embedConfig.FOOTER });

                await interaction.editReply({
                    embeds: [successEmbed]
                });

                await logger.log(`✅ Updated custom supporter role "${roleName}" (${existingRole.id}) for ${member.user.tag} (${member.user.id})`);
                return;

            } catch (err) {
                await logger.log(`❌ Error updating supporter role: ${err.message}`);
                await logger.log(`❌ Stack: ${err.stack}`);

                try {
                    const errorMsg = await translate('customSupporterRole.errors.updateFailed', interaction.guild.id, interaction.user.id, { error: err.message });
                    await interaction.editReply({
                        content: errorMsg
                    });
                } catch (editErr) {

                }
                return;
            }
        }

        const roleName = interaction.fields.getTextInputValue('role_name').trim();
        const colorInput = interaction.fields.getTextInputValue('role_color')?.trim() || '';
        const iconInput = interaction.fields.getTextInputValue('role_icon')?.trim() || '';

        if (!roleName || roleName.length < 1 || roleName.length > 100) {
            const errorMsg = await translate('customSupporterRole.errors.invalidName', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const embedConfig = await getEmbedConfig(interaction.guild.id);
        const roleColor = parseColor(colorInput);
        const finalColor = roleColor !== null ? roleColor : embedConfig.COLOR;

        const trimmedIconInput = iconInput?.trim() || '';
        let iconStatus = 'none';
        let iconError = null;
        let iconToSet = null;
        let isEmojiIcon = false;

        if (trimmedIconInput) {

            if (trimmedIconInput.startsWith('http://') || trimmedIconInput.startsWith('https://')) {

                const premiumTier = guild.premiumTier;
                if (premiumTier < 2) {

                    const errorMsg = await translate('customSupporterRole.errors.boostRequired', interaction.guild.id, interaction.user.id);
                    await interaction.editReply({
                        content: errorMsg
                    });
                    return;
                }

                iconToSet = trimmedIconInput;
                isEmojiIcon = false;
            } else {

                iconToSet = trimmedIconInput;
                isEmojiIcon = true;
            }
        }

        const roleData = {
            name: roleName,
            color: finalColor,
            mentionable: false,
            hoist: true,
            reason: `Custom supporter role for ${member.user.tag} (${member.user.id})`
        };

        if (isEmojiIcon && iconToSet) {
            roleData.unicodeEmoji = iconToSet;
        }

        const position = await getRolePosition(guild);

        const newRole = await guild.roles.create(roleData);

        try {
            await newRole.setPosition(position, { reason: roleData.reason });
        } catch (err) {
            await logger.log(`⚠️ Could not set role position: ${err.message}`);
        }

        if (iconToSet && !isEmojiIcon) {
            try {

                if (isValidImageUrl(iconToSet)) {
                    await newRole.setIcon(iconToSet, { reason: roleData.reason });
                    await logger.log(`✅ Set role icon to image URL: ${iconToSet}`);
                    iconStatus = 'success';
                } else {
                    await logger.log(`⚠️ Invalid image URL format. Must be JPG/PNG image URL (http:// or https://). Role created without icon.`);
                    iconStatus = 'invalid';
                    iconError = 'Invalid URL format or file type';
                }
            } catch (err) {
                await logger.log(`⚠️ Could not set role icon: ${err.message}`);

                if (err.message && err.message.includes('boost')) {
                    iconError = 'This server needs Level 2 Server Boost to use custom role icons. You can use an emoji instead!';
                } else {
                    iconError = err.message;
                }
                await logger.log(`⚠️ Note: Role created successfully without icon. Icon requires server boost level 2+ and accessible JPG/PNG image.`);
                iconStatus = 'failed';
            }
        } else if (isEmojiIcon && iconToSet) {

            iconStatus = 'success';
            await logger.log(`✅ Set role icon to emoji during creation: ${iconToSet}`);
        }

        await member.roles.add(newRole, roleData.reason);

        supporterRoles.set(member.id, newRole.id);

        let iconStatusKey = 'customSupporterRole.created.iconStatusNone';
        if (iconStatus === 'success') iconStatusKey = 'customSupporterRole.created.iconStatusSet';
        else if (iconStatus === 'failed') iconStatusKey = 'customSupporterRole.created.iconStatusFailed';
        else if (iconStatus === 'invalid') iconStatusKey = 'customSupporterRole.created.iconStatusInvalid';
        const iconStatusText = await translate(iconStatusKey, interaction.guild.id, interaction.user.id);

        let iconWarningText = '';
        if (iconError) {
            if (iconError.includes('boost')) {
                iconWarningText = await translate('customSupporterRole.created.iconWarningBoost', interaction.guild.id, interaction.user.id);
            } else {
                iconWarningText = await translate('customSupporterRole.created.iconWarningGeneric', interaction.guild.id, interaction.user.id);
            }
        }

        const embedConfigForCreate = await getEmbedConfig(interaction.guild.id);
        const successTitle = await translate('customSupporterRole.created.title', interaction.guild.id, interaction.user.id);
        const description = await translate('customSupporterRole.created.description', interaction.guild.id, interaction.user.id, {
            roleName,
            iconWarning: iconWarningText
        });
        const roleDetailsLabel = await translate('customSupporterRole.created.roleDetails', interaction.guild.id, interaction.user.id);
        const roleDetailsValue = await translate('customSupporterRole.created.roleDetailsValue', interaction.guild.id, interaction.user.id, {
            name: roleName,
            color: colorInput || 'Default',
            icon: iconStatusText
        });
        const roleLabel = await translate('customSupporterRole.created.role', interaction.guild.id, interaction.user.id);

        const successEmbed = new EmbedBuilder()
            .setColor(embedConfigForCreate.COLOR)
            .setTitle(successTitle)
            .setDescription(description)
            .addFields([
                {
                    name: roleDetailsLabel,
                    value: roleDetailsValue,
                    inline: false
                },
                {
                    name: roleLabel,
                    value: `<@&${newRole.id}>`,
                    inline: true
                }
            ])
            .setTimestamp()
            .setFooter({ text: embedConfigForCreate.FOOTER });

        await interaction.editReply({
            embeds: [successEmbed]
        });

        await logger.log(`✅ Created custom supporter role "${roleName}" (${newRole.id}) for ${member.user.tag} (${member.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error creating supporter role: ${error.message}`);
        await logger.log(`❌ Stack: ${error.stack}`);

        try {
            let errorMessage = '';

            if (error.message && (error.message.includes('boost') || error.message.includes('Boost') || error.message.includes('more boosts'))) {
                errorMessage = `❌ **Server Boost Required**\n\n` +
                    `This server needs **Level 2 Server Boost** to create custom supporter roles with certain features.\n\n` +
                    `💡 **What you can do:**\n` +
                    `- Ask server administrators to boost the server to Level 2\n` +
                    `- Or contact server staff for assistance\n\n` +
                    `**Error details:** ${error.message}`;
            } else {
                errorMessage = `❌ **Failed to Create Role**\n\n` +
                    `Error: ${error.message}\n\n` +
                    `Please make sure:\n` +
                    `- The bot has permission to create roles\n` +
                    `- The bot has permission to manage roles\n` +
                    `- Role position constraints are valid`;
            }

            await interaction.editReply({
                content: errorMessage
            });
        } catch (err) {

            await logger.log(`❌ Failed to send error response: ${err.message}`);
        }
    }
}

async function removeCustomRoleIfNoPermission(member) {
    const { has, role } = await hasSupporterRole(member);
    if (!has || !role) {
        return;
    }

    if (await hasPermission(member, 'custom_supporter_role')) {
        return;
    }

    try {

        await member.roles.remove(role, `User lost permission for custom role`);

        await role.delete(`User ${member.user.tag} (${member.user.id}) lost permission for custom role`);

        supporterRoles.delete(member.id);

        await logger.log(`🗑️ Removed custom role ${role.name} (${role.id}) from ${member.user.tag} (${member.user.id}) - no longer has permission`);
    } catch (err) {
        await logger.log(`⚠️ Could not remove custom role for ${member.user.tag}: ${err.message}`);
    }
}

async function cleanupCustomRoles(client) {
    try {
        await logger.log(`🧹 Checking for custom roles to clean up...`);

        let cleanedCount = 0;

        for (const guild of client.guilds.cache.values()) {
            try {

                const constraints = await CUSTOM_SUPPORTER_ROLE.getRoleConstraints(guild.id);

                if (!constraints.ROLE_START || !constraints.ROLE_END) {
                    continue;
                }

                const startRole = guild.roles.cache.get(constraints.ROLE_START);
                const endRole = guild.roles.cache.get(constraints.ROLE_END);

                if (!startRole || !endRole) {
                    continue;
                }

                await guild.members.fetch();


                const customRoles = guild.roles.cache.filter(role =>
                    role.position < startRole.position &&
                    role.position > endRole.position &&
                    !role.managed
                );

                for (const role of customRoles.values()) {
                    try {
                        const memberCount = role.members.size;

                        if (memberCount !== 1) {
                            await cleanupInvalidRole(role);
                            if (memberCount === 0 || memberCount > 1) {
                                cleanedCount++;
                            }
                            continue;
                        }


                        let ownerId = null;
                        for (const [userId, roleId] of supporterRoles.entries()) {
                            if (roleId === role.id) {
                                ownerId = userId;
                                break;
                            }
                        }

                        if (!ownerId && role.members.size === 1) {
                            const member = role.members.first();
                            if (member) {
                                ownerId = member.id;

                                supporterRoles.set(ownerId, role.id);
                            }
                        }

                        if (ownerId) {
                            const owner = guild.members.cache.get(ownerId);
                            if (!owner) {

                                await cleanupInvalidRole(role);
                                cleanedCount++;
                                continue;
                            }

                            if (!(await hasPermission(owner, 'custom_supporter_role'))) {

                                try {
                                    await owner.roles.remove(role, `User lost permission for custom role`);
                                    await role.delete(`Auto-cleanup: Owner no longer has permission`);
                                    await logger.log(`🗑️ Deleted custom role: ${role.name} (${role.id}) - owner ${owner.user.tag} (${ownerId}) no longer has permission`);
                                    supporterRoles.delete(ownerId);
                                    cleanedCount++;
                                } catch (err) {
                                    await logger.log(`⚠️ Could not delete role ${role.name} (${role.id}): ${err.message}`);
                                }
                            }
                        }
                    } catch (err) {
                        await logger.log(`⚠️ Error checking role ${role.name} (${role.id}): ${err.message}`);
                    }
                }
            } catch (err) {
                await logger.log(`⚠️ Error checking guild ${guild.name} for cleanup: ${err.message}`);
            }
        }

        if (cleanedCount > 0) {
            await logger.log(`✅ Cleanup complete: Removed ${cleanedCount} custom role(s)`);
        } else {
            await logger.log(`✅ Cleanup complete: No roles to remove`);
        }
    } catch (err) {
        await logger.log(`❌ Error during custom role cleanup: ${err.message}`);
    }
}

async function scanAndValidateCustomRoles(client) {
    try {
        await logger.log(`🔍 Scanning for existing custom roles...`);

        let validatedCount = 0;

        for (const guild of client.guilds.cache.values()) {
            try {


                let constraints;
                try {
                    constraints = await CUSTOM_SUPPORTER_ROLE.getRoleConstraints(guild.id);
                } catch (error) {
                    if (error.message && error.message.includes('Server not found')) {

                        continue;
                    }
                    throw error;
                }

                if (!constraints.ROLE_START || !constraints.ROLE_END) {
                    continue;
                }

                const startRole = guild.roles.cache.get(constraints.ROLE_START);
                const endRole = guild.roles.cache.get(constraints.ROLE_END);

                if (!startRole || !endRole) {
                    continue;
                }

                await guild.members.fetch();


                const customRoles = guild.roles.cache.filter(role =>
                    role.position < startRole.position &&
                    role.position > endRole.position &&
                    !role.managed
                );

                for (const role of customRoles.values()) {
                    try {
                        const memberCount = role.members.size;

                        if (memberCount === 1) {

                            const member = role.members.first();
                            if (member) {
                                supporterRoles.set(member.id, role.id);
                                validatedCount++;
                                await logger.log(`✅ Found valid custom role: ${role.name} (${role.id}) for ${member.user.tag} (${member.id})`);
                            }
                        } else {

                            await cleanupInvalidRole(role);
                        }
                    } catch (err) {
                        await logger.log(`⚠️ Error validating role ${role.name} (${role.id}): ${err.message}`);
                    }
                }
            } catch (err) {
                await logger.log(`⚠️ Error scanning guild ${guild.name}: ${err.message}`);
            }
        }

        await logger.log(`✅ Scan complete: Validated ${validatedCount} custom role(s)`);
    } catch (err) {
        await logger.log(`❌ Error scanning custom roles: ${err.message}`);
    }
}

export function init(client) {

    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        try {

            const oldRoles = oldMember.roles.cache;
            const newRoles = newMember.roles.cache;

            if (oldRoles.size === newRoles.size && oldRoles.every(r => newRoles.has(r.id))) {
                return;
            }

            await removeCustomRoleIfNoPermission(newMember);
        } catch (err) {
            await logger.log(`❌ Error checking custom role permissions on member update: ${err.message}`);
        }
    });

    client.on('guildMemberRemove', async (member) => {
        try {
            const { has, role } = await hasSupporterRole(member);
            if (has && role) {


                setTimeout(async () => {
                    try {
                        const updatedRole = member.guild.roles.cache.get(role.id);
                        if (updatedRole && updatedRole.members.size === 0) {
                            await updatedRole.delete(`Auto-cleanup: Member left server and role has no members`);
                            await logger.log(`🗑️ Deleted custom role ${role.name} (${role.id}) - member left and role unused`);
                            supporterRoles.delete(member.id);
                        }
                    } catch (err) {

                    }
                }, 5000);
            }
        } catch (err) {
            await logger.log(`❌ Error checking custom role on member leave: ${err.message}`);
        }
    });



    setTimeout(async () => {
        await scanAndValidateCustomRoles(client);
    }, 10000);

    setInterval(async () => {
        await cleanupCustomRoles(client);
    }, 6 * 60 * 60 * 1000);

    logger.log("💎 Custom supporter role component initialized - Scanning, validation, and cleanup active");
}

export default { init };
