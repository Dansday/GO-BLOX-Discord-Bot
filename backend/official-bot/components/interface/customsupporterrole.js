import { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getEmbedConfig, CUSTOM_SUPPORTER_ROLE } from '../../../config.js';
import logger from '../../../logger.js';
import { hasPermission } from '../permissions.js';

// Store supporter roles created (userId -> roleId)
// In production, you might want to store this in a database
const supporterRoles = new Map();

// Check if member already has a custom supporter role
async function hasSupporterRole(member) {
    // Check our stored map first
    if (supporterRoles.has(member.id)) {
        const roleId = supporterRoles.get(member.id);
        const role = member.guild.roles.cache.get(roleId);
        if (role && member.roles.cache.has(roleId)) {
            return { has: true, role };
        }
        // Role might have been deleted, remove from map
        supporterRoles.delete(member.id);
    }

    // Get role constraints from database
    const constraints = await CUSTOM_SUPPORTER_ROLE.getRoleConstraints(member.guild.id);
    
    if (!constraints.ROLE_ABOVE || !constraints.ROLE_BELOW) {
        return { has: false };
    }

    // Check if member has any roles between the position constraints
    const aboveRole = member.guild.roles.cache.get(constraints.ROLE_ABOVE);
    const belowRole = member.guild.roles.cache.get(constraints.ROLE_BELOW);

    if (!aboveRole || !belowRole) {
        return { has: false };
    }

    // Get all roles between the constraints
    const allRoles = member.guild.roles.cache
        .filter(role => role.position < belowRole.position && role.position > aboveRole.position)
        .sort((a, b) => b.position - a.position);

    // Check if member has any of these roles
    for (const role of allRoles.values()) {
        if (member.roles.cache.has(role.id) && role.managed === false) {
            // For now, we'll assume any role in this position range belongs to a supporter
            supporterRoles.set(member.id, role.id);
            return { has: true, role };
        }
    }

    return { has: false };
}

// Validate image URL (must be http/https and JPG/PNG only)
function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;

    const trimmed = url.trim();

    // Must start with http:// or https://
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        return false;
    }

    // Check file extension (case insensitive) - only JPG/PNG
    const lowerUrl = trimmed.toLowerCase();
    const validExtensions = ['.jpg', '.jpeg', '.png'];

    // Check if URL ends with valid extension
    const hasExtension = validExtensions.some(ext => lowerUrl.endsWith(ext));

    // Also check if it has extension before query parameters
    if (!hasExtension) {
        // Try to find extension before ? or #
        const urlWithoutParams = lowerUrl.split('?')[0].split('#')[0];
        const hasExtensionInPath = validExtensions.some(ext => urlWithoutParams.endsWith(ext));
        if (hasExtensionInPath) {
            return true;
        }
    } else {
        return true;
    }

    // Some URLs might not have explicit extension but still be images
    // Allow it and let Discord validate
    return true;
}

// Parse color input (hex, decimal, or name)
function parseColor(colorInput) {
    if (!colorInput || colorInput.trim() === '') {
        return null; // Use default
    }

    const trimmed = colorInput.trim();

    // Try hex format (#RRGGBB or RRGGBB)
    if (trimmed.startsWith('#')) {
        const hex = trimmed.substring(1);
        if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
            return parseInt(hex, 16);
        }
    } else if (/^[0-9A-Fa-f]{6}$/.test(trimmed)) {
        return parseInt(trimmed, 16);
    }

    // Try decimal number
    const decimal = parseInt(trimmed, 10);
    if (!isNaN(decimal) && decimal >= 0 && decimal <= 0xFFFFFF) {
        return decimal;
    }

    // Try color names (basic colors)
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

    return null; // Invalid color, will use default
}

// Get role position between constraints
async function getRolePosition(guild) {
    const constraints = await CUSTOM_SUPPORTER_ROLE.getRoleConstraints(guild.id);
    
    if (!constraints.ROLE_ABOVE || !constraints.ROLE_BELOW) {
        throw new Error('Could not find role position constraints');
    }

    const aboveRole = guild.roles.cache.get(constraints.ROLE_ABOVE);
    const belowRole = guild.roles.cache.get(constraints.ROLE_BELOW);

    if (!aboveRole || !belowRole) {
        throw new Error('Could not find role position constraints');
    }

    // Position should be just above ROLE_ABOVE (so it appears above it)
    // Discord roles: higher position number = appears higher in list
    return aboveRole.position + 1;
}

// Handle custom supporter role button click
export async function handleCustomSupporterRoleButton(interaction) {
    try {
        const member = interaction.member;

        // Check permissions (supporters, staff, and admin can use this)
        if (!(await hasPermission(member, 'custom_supporter_role'))) {
            await interaction.reply({
                content: '❌ You don\'t have permission to create a custom role. Supporter, Staff, or Admin role required.',
                flags: 64
            });
            return;
        }

        // Check if member already has a custom supporter role
        const { has, role: existingRole } = await hasSupporterRole(member);

        // If user already has a custom role, show edit/delete options
        if (has && existingRole) {
            const editButton = new ButtonBuilder()
                .setCustomId('custom_supporter_role_edit')
                .setLabel('✏️ Edit Role')
                .setStyle(ButtonStyle.Primary);

            const deleteButton = new ButtonBuilder()
                .setCustomId('custom_supporter_role_delete')
                .setLabel('🗑️ Delete Role')
                .setStyle(ButtonStyle.Danger);

            const buttonRow = new ActionRowBuilder().addComponents(editButton, deleteButton);

            const embedConfig = await getEmbedConfig(interaction.guild.id);
            const embed = new EmbedBuilder()
                .setColor(embedConfig.COLOR)
                .setTitle('💎 Custom Supporter Role')
                .setDescription(`You already have a custom role: **${existingRole.name}**\n\nChoose an action:`)
                .addFields({
                    name: '📋 Current Role',
                    value: `<@&${existingRole.id}>`,
                    inline: false
                })
                .setTimestamp();

            await interaction.reply({
                embeds: [embed],
                components: [buttonRow],
                flags: 64
            });
            await logger.log(`💎 Supporter role options shown to ${member.user.tag} (${member.user.id})`);
            return;
        }

        // Show modal for role creation
        const modal = new ModalBuilder()
            .setCustomId('custom_supporter_role_create')
            .setTitle('💎 Create Custom Supporter Role');

        // Role name input
        const nameInput = new TextInputBuilder()
            .setCustomId('role_name')
            .setLabel('Role Name')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter your custom role name...')
            .setRequired(true)
            .setMaxLength(100);

        // Role color input
        const colorInput = new TextInputBuilder()
            .setCustomId('role_color')
            .setLabel('Role Color (Hex/Decimal/Name)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#FF5733 or 16729395 or red (optional)')
            .setRequired(false)
            .setMaxLength(20);

        // Role icon input (emoji or image URL - JPG/PNG)
        const iconInput = new TextInputBuilder()
            .setCustomId('role_icon')
            .setLabel('Role Icon (Emoji or Image URL)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('🔥 or https://example.com/icon.png (optional)')
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
        await interaction.reply({
            content: `❌ Failed to open role creation form: ${error.message}`,
            flags: 64
        });
    }
}

// Handle edit button click
export async function handleEditCustomSupporterRole(interaction) {
    try {
        const member = interaction.member;

        // Check permissions
        if (!hasPermission(member, 'custom_supporter_role')) {
            await interaction.reply({
                content: '❌ You don\'t have permission to edit a custom role.',
                flags: 64
            });
            return;
        }

        // Check if member has a custom supporter role
        const { has, role: existingRole } = await hasSupporterRole(member);

        if (!has || !existingRole) {
            await interaction.reply({
                content: '❌ You don\'t have a custom role to edit.',
                flags: 64
            });
            return;
        }

        // Show modal for role editing
        const modal = new ModalBuilder()
            .setCustomId('custom_supporter_role_create')
            .setTitle('💎 Edit Custom Supporter Role');

        // Get current role values
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

        // Role name input
        const nameInput = new TextInputBuilder()
            .setCustomId('role_name')
            .setLabel('Role Name')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter your custom role name...')
            .setRequired(true)
            .setMaxLength(100)
            .setValue(currentName);

        // Role color input
        const colorInput = new TextInputBuilder()
            .setCustomId('role_color')
            .setLabel('Role Color (Hex/Decimal/Name)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#FF5733 or 16729395 or red (optional)')
            .setRequired(false)
            .setMaxLength(20)
            .setValue(currentColor);

        // Role icon input (emoji or image URL - JPG/PNG)
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
        await interaction.reply({
            content: `❌ Failed to open edit form: ${error.message}`,
            flags: 64
        });
    }
}

// Handle delete button click
export async function handleDeleteCustomSupporterRole(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        const member = interaction.member;
        const guild = interaction.guild;

        // Check permissions
        if (!hasPermission(member, 'custom_supporter_role')) {
            await interaction.editReply({
                content: '❌ You don\'t have permission to delete a custom role.'
            });
            return;
        }

        // Check if member has a custom supporter role
        const { has, role: existingRole } = await hasSupporterRole(member);

        if (!has || !existingRole) {
            await interaction.editReply({
                content: '❌ You don\'t have a custom role to delete.'
            });
            return;
        }

        const roleName = existingRole.name;
        const roleId = existingRole.id;

        // Remove role from member
        await member.roles.remove(existingRole, `User deleted their custom supporter role`);

        // Delete the role
        await existingRole.delete(`Custom supporter role deleted by ${member.user.tag} (${member.user.id})`);

        // Remove from map
        supporterRoles.delete(member.id);

        const embedConfig = await getEmbedConfig(interaction.guild.id);
        const successEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle('✅ Custom Supporter Role Deleted')
            .setDescription(`Your custom role **${roleName}** has been deleted.`)
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.editReply({
            embeds: [successEmbed]
        });

        await logger.log(`🗑️ Deleted custom supporter role "${roleName}" (${roleId}) for ${member.user.tag} (${member.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error deleting supporter role: ${error.message}`);
        await interaction.editReply({
            content: `❌ Failed to delete role: ${error.message}`
        });
    }
}

// Handle custom supporter role modal submission
export async function handleCustomSupporterRoleModal(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        const member = interaction.member;
        const guild = interaction.guild;

        // Verify member still has permission
        if (!hasPermission(member, 'custom_supporter_role')) {
            await interaction.editReply({
                content: '❌ You don\'t have permission to create a custom role. Supporter, Staff, or Admin role required.'
            });
            return;
        }

        // Check if they already have a role - if so, edit it instead of creating new one
        const { has: hasExistingRole, role: existingRole } = await hasSupporterRole(member);

        if (hasExistingRole && existingRole) {
            // Edit existing role instead of creating new one
            try {
                // Get form data
                const roleName = interaction.fields.getTextInputValue('role_name').trim();
                const colorInput = interaction.fields.getTextInputValue('role_color')?.trim() || '';
                const iconInput = interaction.fields.getTextInputValue('role_icon')?.trim() || '';

                // Validate role name
                if (!roleName || roleName.length < 1 || roleName.length > 100) {
                    await interaction.editReply({
                        content: '❌ **Invalid Role Name**\n\nRole name must be between 1 and 100 characters.'
                    });
                    return;
                }

                // Parse color
                const roleColor = parseColor(colorInput);
                const updateData = {
                    name: roleName,
                    reason: `Custom supporter role updated for ${member.user.tag} (${member.user.id})`
                };

                // Only update color if provided and valid (use 'color' for editing, not 'colors')
                if (roleColor !== null) {
                    updateData.color = roleColor;
                }

                // Update the role
                await existingRole.edit(updateData);

                // Update or remove icon based on input (continue even if icon fails)
                const trimmedIconInput = iconInput?.trim() || '';
                let iconStatus = 'unchanged';
                let iconError = null;

                if (trimmedIconInput) {
                    // Icon provided - try to update (emoji or image URL)
                    try {
                        // Check if it's a URL or emoji
                        if (trimmedIconInput.startsWith('http://') || trimmedIconInput.startsWith('https://')) {
                            // It's a URL - validate and set
                            if (isValidImageUrl(trimmedIconInput)) {
                                await existingRole.setIcon(trimmedIconInput, { reason: updateData.reason });
                                await logger.log(`✅ Set role icon to image URL: ${trimmedIconInput}`);
                                iconStatus = 'updated';
                            } else {
                                await logger.log(`⚠️ Invalid image URL format. Must be JPG/PNG image URL (http:// or https://).`);
                                iconStatus = 'invalid';
                                iconError = 'Invalid URL format or file type';
                            }
                        } else {
                            // It's an emoji - use edit() with unicodeEmoji property
                            await existingRole.edit({
                                unicodeEmoji: trimmedIconInput,
                                reason: updateData.reason
                            });
                            await logger.log(`✅ Set role icon to emoji: ${trimmedIconInput}`);
                            iconStatus = 'updated';
                        }
                    } catch (err) {
                        await logger.log(`⚠️ Could not set role icon: ${err.message}`);
                        await logger.log(`⚠️ Note: Role still updated successfully. Icon requires server boost level 2+ and accessible JPG/PNG image or valid emoji.`);
                        iconStatus = 'failed';
                        iconError = err.message;
                    }
                } else if (existingRole.icon) {
                    // Icon field is empty and role has icon - remove it
                    try {
                        await existingRole.setIcon(null, { reason: updateData.reason });
                        await logger.log(`✅ Removed role icon`);
                        iconStatus = 'removed';
                    } catch (err) {
                        await logger.log(`⚠️ Could not remove role icon: ${err.message}`);
                        iconStatus = 'remove_failed';
                    }
                }

                // Create success embed
                let iconStatusText = 'Unchanged';
                if (iconStatus === 'updated') iconStatusText = 'Updated';
                else if (iconStatus === 'removed') iconStatusText = 'Removed';
                else if (iconStatus === 'failed') iconStatusText = `Failed (role updated without icon)`;
                else if (iconStatus === 'invalid') iconStatusText = 'Invalid format (role updated without icon)';

                const embedConfig = await getEmbedConfig(interaction.guild.id);
                const successEmbed = new EmbedBuilder()
                    .setColor(embedConfig.COLOR)
                    .setTitle('✅ Custom Supporter Role Updated!')
                    .setDescription(`Your custom role **${roleName}** has been updated!${iconError ? '\n\n⚠️ Note: Icon could not be set, but role was updated successfully.' : ''}`)
                    .addFields([
                        {
                            name: '🎨 Role Details',
                            value: `**Name:** ${roleName}\n**Color:** ${colorInput || 'Unchanged'}\n**Icon:** ${iconStatusText}`,
                            inline: false
                        },
                        {
                            name: '💎 Role',
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
                    await interaction.editReply({
                        content: `❌ **Failed to Update Role**\n\nError: ${err.message}\n\nPlease make sure:\n- The bot has permission to manage roles\n- Role constraints are valid`
                    });
                } catch (editErr) {
                    // Interaction might have already been replied to
                }
                return;
            }
        }

        // Get form data
        const roleName = interaction.fields.getTextInputValue('role_name').trim();
        const colorInput = interaction.fields.getTextInputValue('role_color')?.trim() || '';
        const iconInput = interaction.fields.getTextInputValue('role_icon')?.trim() || '';

        // Validate role name
        if (!roleName || roleName.length < 1 || roleName.length > 100) {
            await interaction.editReply({
                content: '❌ **Invalid Role Name**\n\nRole name must be between 1 and 100 characters.'
            });
            return;
        }

        // Parse color - always provide a valid color number
        const embedConfig = await getEmbedConfig(interaction.guild.id);
        const roleColor = parseColor(colorInput);
        const finalColor = roleColor !== null ? roleColor : embedConfig.COLOR;

        // Check icon type before creating role
        const trimmedIconInput = iconInput?.trim() || '';
        let iconStatus = 'none';
        let iconError = null;
        let iconToSet = null;
        let isEmojiIcon = false;

        if (trimmedIconInput) {
            // Check if it's a URL or emoji
            if (trimmedIconInput.startsWith('http://') || trimmedIconInput.startsWith('https://')) {
                // It's a URL
                iconToSet = trimmedIconInput;
                isEmojiIcon = false;
            } else {
                // It's an emoji
                iconToSet = trimmedIconInput;
                isEmojiIcon = true;
            }
        }

        // Prepare role options
        const roleData = {
            name: roleName,
            color: finalColor,
            mentionable: false,
            hoist: true, // Show members with this role separately
            reason: `Custom supporter role for ${member.user.tag} (${member.user.id})`
        };

        // Add unicodeEmoji if it's an emoji (can't be set with icon at same time)
        if (isEmojiIcon && iconToSet) {
            roleData.unicodeEmoji = iconToSet;
        }

        // Get position
        const position = await getRolePosition(guild);

        // Create the role
        const newRole = await guild.roles.create(roleData);

        // Set position (must be done after creation)
        try {
            await newRole.setPosition(position, { reason: roleData.reason });
        } catch (err) {
            await logger.log(`⚠️ Could not set role position: ${err.message}`);
        }

        // Set icon if it's an image URL (emoji was set during creation)
        if (iconToSet && !isEmojiIcon) {
            try {
                // Validate and set image URL
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
                await logger.log(`⚠️ Note: Role created successfully without icon. Icon requires server boost level 2+ and accessible JPG/PNG image.`);
                iconStatus = 'failed';
                iconError = err.message;
            }
        } else if (isEmojiIcon && iconToSet) {
            // Emoji was set during creation
            iconStatus = 'success';
            await logger.log(`✅ Set role icon to emoji during creation: ${iconToSet}`);
        }

        // Assign role to member
        await member.roles.add(newRole, roleData.reason);

        // Store in map
        supporterRoles.set(member.id, newRole.id);

        // Create success embed
        let iconStatusText = 'None';
        if (iconStatus === 'success') iconStatusText = 'Set';
        else if (iconStatus === 'failed') iconStatusText = 'Failed (role created without icon)';
        else if (iconStatus === 'invalid') iconStatusText = 'Invalid format (role created without icon)';

        const embedConfigForCreate = await getEmbedConfig(interaction.guild.id);
        const successEmbed = new EmbedBuilder()
            .setColor(embedConfigForCreate.COLOR)
            .setTitle('✅ Custom Supporter Role Created!')
            .setDescription(`Your custom role **${roleName}** has been created and assigned to you!${iconError ? '\n\n⚠️ Note: Icon could not be set, but role was created successfully.' : ''}`)
            .addFields([
                {
                    name: '🎨 Role Details',
                    value: `**Name:** ${roleName}\n**Color:** ${colorInput || 'Default'}\n**Icon:** ${iconStatusText}`,
                    inline: false
                },
                {
                    name: '💎 Role',
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
            await interaction.editReply({
                content: `❌ **Failed to Create Role**\n\nError: ${error.message}\n\nPlease make sure:\n- The bot has permission to create roles\n- The bot has permission to manage roles\n- Role position constraints are valid`
            });
        } catch (err) {
            // Interaction might have already been replied to
        }
    }
}

// Remove custom role if user no longer has permission
async function removeCustomRoleIfNoPermission(member) {
    const { has, role } = await hasSupporterRole(member);
    if (!has || !role) {
        return; // No custom role to remove
    }

    // Check if user still has permission
    if (await hasPermission(member, 'custom_supporter_role')) {
        return; // User still has permission, keep the role
    }

    // User lost permission, remove the custom role
    try {
        // Remove role from member
        await member.roles.remove(role, `User lost permission for custom role`);

        // Delete the role
        await role.delete(`User ${member.user.tag} (${member.user.id}) lost permission for custom role`);

        // Remove from map
        supporterRoles.delete(member.id);

        await logger.log(`🗑️ Removed custom role ${role.name} (${role.id}) from ${member.user.tag} (${member.user.id}) - no longer has permission`);
    } catch (err) {
        await logger.log(`⚠️ Could not remove custom role for ${member.user.tag}: ${err.message}`);
    }
}

// Clean up custom roles - removes roles with no members OR roles where owner lost permission
async function cleanupCustomRoles(client) {
    try {
        await logger.log(`🧹 Checking for custom roles to clean up...`);

        let cleanedCount = 0;

        // Check all guilds the bot is in
        for (const guild of client.guilds.cache.values()) {
            try {
                // Get role constraints from database for this guild
                const constraints = await CUSTOM_SUPPORTER_ROLE.getRoleConstraints(guild.id);
                
                if (!constraints.ROLE_ABOVE || !constraints.ROLE_BELOW) {
                    continue; // No constraints configured for this guild
                }

                const aboveRole = guild.roles.cache.get(constraints.ROLE_ABOVE);
                const belowRole = guild.roles.cache.get(constraints.ROLE_BELOW);

                if (!aboveRole || !belowRole) {
                    continue;
                }

                // Fetch all members to ensure cache is up to date before checking member counts
                // This prevents false positives where roles appear to have no members due to incomplete cache
                await guild.members.fetch();

                // Get all roles between the constraints
                const customRoles = guild.roles.cache.filter(role =>
                    role.position < belowRole.position &&
                    role.position > aboveRole.position &&
                    !role.managed // Exclude bot-managed roles
                );

                // Check each custom role
                for (const role of customRoles.values()) {
                    try {
                        // Get member count for this role (cache should now be accurate)
                        const members = role.members;
                        
                        // Check if role has no members
                        if (members.size === 0) {
                            // Role has no members, delete it
                            try {
                                await role.delete(`Auto-cleanup: Custom role has no members`);
                                await logger.log(`🗑️ Deleted unused custom role: ${role.name} (${role.id}) - no members`);
                                cleanedCount++;

                                // Remove from map if it exists
                                for (const [userId, roleId] of supporterRoles.entries()) {
                                    if (roleId === role.id) {
                                        supporterRoles.delete(userId);
                                        break;
                                    }
                                }
                            } catch (err) {
                                await logger.log(`⚠️ Could not delete unused role ${role.name} (${role.id}): ${err.message}`);
                            }
                            continue; // Skip permission check for roles with no members
                        }

                        // Role has members - check if owner still has permission
                        // Find the owner in our map
                        let ownerId = null;
                        for (const [userId, roleId] of supporterRoles.entries()) {
                            if (roleId === role.id) {
                                ownerId = userId;
                                break;
                            }
                        }

                        if (ownerId) {
                            // We know the owner, check their permission
                            const owner = guild.members.cache.get(ownerId);
                            if (!owner) {
                                // Owner no longer in guild, but role still has members
                                // Don't delete - let the guildMemberRemove handler handle it
                                continue;
                            }

                            // Check if owner still has permission
                            if (!(await hasPermission(owner, 'custom_supporter_role'))) {
                                // Owner lost permission, remove and delete role
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
                        // If role not in our map, we can't verify owner permission, so leave it alone
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

// Initialize - listen for member updates to check permissions
export function init(client) {
    // Monitor member role changes
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        try {
            // Check if roles changed
            const oldRoles = oldMember.roles.cache;
            const newRoles = newMember.roles.cache;

            // If roles didn't change, skip
            if (oldRoles.size === newRoles.size && oldRoles.every(r => newRoles.has(r.id))) {
                return;
            }

            // Check if user lost permission and remove custom role if needed
            await removeCustomRoleIfNoPermission(newMember);
        } catch (err) {
            await logger.log(`❌ Error checking custom role permissions on member update: ${err.message}`);
        }
    });

    // Monitor when members leave - check if they had a custom role
    client.on('guildMemberRemove', async (member) => {
        try {
            const { has, role } = await hasSupporterRole(member);
            if (has && role) {
                // Member left with a custom role - check if role is now unused
                // Wait a moment for Discord to update, then check
                setTimeout(async () => {
                    try {
                        const updatedRole = member.guild.roles.cache.get(role.id);
                        if (updatedRole && updatedRole.members.size === 0) {
                            await updatedRole.delete(`Auto-cleanup: Member left server and role has no members`);
                            await logger.log(`🗑️ Deleted custom role ${role.name} (${role.id}) - member left and role unused`);
                            supporterRoles.delete(member.id);
                        }
                    } catch (err) {
                        // Role might already be deleted
                    }
                }, 5000); // Wait 5 seconds
            }
        } catch (err) {
            await logger.log(`❌ Error checking custom role on member leave: ${err.message}`);
        }
    });

    // Run cleanup periodically (every 6 hours) - removes roles with no members OR without permission
    // Note: We do NOT run cleanup on startup to avoid deleting roles that still have members
    // (cache might not be fully loaded on startup, causing false positives)
    setInterval(async () => {
        await cleanupCustomRoles(client);
    }, 6 * 60 * 60 * 1000); // 6 hours in milliseconds

    logger.log("💎 Custom supporter role component initialized - Permission monitoring and cleanup active");
}

export default { init };
