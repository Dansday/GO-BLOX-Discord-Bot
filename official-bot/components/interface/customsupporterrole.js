import { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder } from 'discord.js';
import { EMBED, CUSTOM_SUPPORTER_ROLE } from '../../../config.js';
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

    // Check if member has any roles between the position constraints
    const aboveRole = member.guild.roles.cache.get(CUSTOM_SUPPORTER_ROLE.ROLE_ABOVE);
    const belowRole = member.guild.roles.cache.get(CUSTOM_SUPPORTER_ROLE.ROLE_BELOW);

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
    const aboveRole = guild.roles.cache.get(CUSTOM_SUPPORTER_ROLE.ROLE_ABOVE);
    const belowRole = guild.roles.cache.get(CUSTOM_SUPPORTER_ROLE.ROLE_BELOW);

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
        if (!hasPermission(member, 'custom_supporter_role')) {
            await interaction.reply({
                content: '❌ You don\'t have permission to create a custom role. Supporter, Staff, or Admin role required.',
                flags: 64
            });
            return;
        }

        // Check if member already has a custom supporter role
        const { has, role: existingRole } = await hasSupporterRole(member);

        // Show modal for role creation/update
        const modal = new ModalBuilder()
            .setCustomId('custom_supporter_role_create')
            .setTitle(has ? '💎 Edit Custom Supporter Role' : '💎 Create Custom Supporter Role');

        // Get current role values for editing
        const currentName = has && existingRole ? existingRole.name : '';
        const currentColor = has && existingRole ? existingRole.hexColor : '';
        // Icon is not easily retrievable as string, so leave empty
        const currentIcon = '';

        // Role name input
        const nameInput = new TextInputBuilder()
            .setCustomId('role_name')
            .setLabel('Role Name')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter your custom role name...')
            .setRequired(true)
            .setMaxLength(100)
            .setValue(currentName); // Pre-fill with current name if editing

        // Role color input
        const colorInput = new TextInputBuilder()
            .setCustomId('role_color')
            .setLabel('Role Color (Hex/Decimal/Name)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#FF5733 or 16729395 or red (optional)')
            .setRequired(false)
            .setMaxLength(20)
            .setValue(currentColor); // Pre-fill with current color if editing

        // Role icon input (emoji)
        const iconInput = new TextInputBuilder()
            .setCustomId('role_icon')
            .setLabel('Role Icon (Emoji)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('🔥 or leave empty (optional)')
            .setRequired(false)
            .setMaxLength(50)
            .setValue(currentIcon); // Pre-fill with current icon if editing

        const nameRow = new ActionRowBuilder().addComponents(nameInput);
        const colorRow = new ActionRowBuilder().addComponents(colorInput);
        const iconRow = new ActionRowBuilder().addComponents(iconInput);

        modal.addComponents(nameRow, colorRow, iconRow);

        await interaction.showModal(modal);
        await logger.log(`💎 Supporter role modal shown to ${member.user.tag} (${member.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error showing supporter role modal: ${error.message}`);
        await interaction.reply({
            content: `❌ Failed to open role creation form: ${error.message}`,
            flags: 64
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

                // Update icon if provided
                if (iconInput) {
                    try {
                        let emojiToSet = iconInput.trim();
                        if (emojiToSet.startsWith('<:') && emojiToSet.endsWith('>')) {
                            await logger.log(`⚠️ Custom emoji format detected but not supported. Use Unicode emojis like 🔥 or ⭐`);
                        } else {
                            await existingRole.setIcon(emojiToSet, { reason: updateData.reason });
                            await logger.log(`✅ Set role icon to: ${emojiToSet}`);
                        }
                    } catch (err) {
                        await logger.log(`⚠️ Could not set role icon: ${err.message}`);
                        await logger.log(`⚠️ Note: Role icons require server boost level 2 or higher`);
                    }
                } else if (existingRole.icon) {
                    // If icon input is empty but role has icon, remove it
                    try {
                        await existingRole.setIcon(null, { reason: updateData.reason });
                        await logger.log(`✅ Removed role icon`);
                    } catch (err) {
                        await logger.log(`⚠️ Could not remove role icon: ${err.message}`);
                    }
                }

                // Create success embed
                const successEmbed = new EmbedBuilder()
                    .setColor(EMBED.COLOR)
                    .setTitle('✅ Custom Supporter Role Updated!')
                    .setDescription(`Your custom role **${roleName}** has been updated!`)
                    .addFields([
                        {
                            name: '🎨 Role Details',
                            value: `**Name:** ${roleName}\n**Color:** ${colorInput || 'Unchanged'}\n**Icon:** ${iconInput || 'Unchanged'}`,
                            inline: false
                        },
                        {
                            name: '💎 Role',
                            value: `<@&${existingRole.id}>`,
                            inline: true
                        }
                    ])
                    .setTimestamp()
                    .setFooter({ text: guild.name });

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
        const roleColor = parseColor(colorInput);
        const finalColor = roleColor !== null ? roleColor : EMBED.COLOR;

        // Prepare role options
        // Note: Using 'color' instead of 'colors' - the deprecation warning may be misleading
        const roleData = {
            name: roleName,
            color: finalColor,
            mentionable: false,
            hoist: true, // Show members with this role separately
            reason: `Custom supporter role for ${member.user.tag} (${member.user.id})`
        };

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

        // Set icon if provided (Unicode emoji only - requires server boost level 2+)
        if (iconInput) {
            try {
                let emojiToSet = iconInput.trim();

                // Remove <:emoji:123456789> format if present (custom emojis need different handling)
                if (emojiToSet.startsWith('<:') && emojiToSet.endsWith('>')) {
                    await logger.log(`⚠️ Custom emoji format detected but not supported. Use Unicode emojis like 🔥 or ⭐`);
                } else {
                    // Set as Unicode emoji (just pass the emoji string directly)
                    // Discord.js will handle Unicode emojis automatically
                    await newRole.setIcon(emojiToSet, { reason: roleData.reason });
                    await logger.log(`✅ Set role icon to: ${emojiToSet}`);
                }
            } catch (err) {
                await logger.log(`⚠️ Could not set role icon: ${err.message}`);
                await logger.log(`⚠️ Note: Role icons require server boost level 2 or higher`);
                // Icon setting failed, continue without it - role will still be created
            }
        }

        // Assign role to member
        await member.roles.add(newRole, roleData.reason);

        // Store in map
        supporterRoles.set(member.id, newRole.id);

        // Create success embed
        const successEmbed = new EmbedBuilder()
            .setColor(EMBED.COLOR)
            .setTitle('✅ Custom Supporter Role Created!')
            .setDescription(`Your custom role **${roleName}** has been created and assigned to you!`)
            .addFields([
                {
                    name: '🎨 Role Details',
                    value: `**Name:** ${roleName}\n**Color:** ${colorInput || 'Default'}\n**Icon:** ${iconInput || 'None'}`,
                    inline: false
                },
                {
                    name: '💎 Role',
                    value: `<@&${newRole.id}>`,
                    inline: true
                }
            ])
            .setTimestamp()
            .setFooter({ text: guild.name });

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
    if (hasPermission(member, 'custom_supporter_role')) {
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

// Initialize - listen for member updates to check permissions
export function init(client) {
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

    logger.log("💎 Custom supporter role component initialized - Permission monitoring active");
}

export default { init };
