import { ModalBuilder, TextInputBuilder, ActionRowBuilder, EmbedBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle, TextInputStyle } from 'discord.js';
import { EMBED } from "../../../config.js";
import logger from "../../../logger.js";
import { hasPermission } from "../permissions.js";

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

// Handle send message button - shows channel selector first
export async function handleSendMessageButton(interaction) {
    try {
        // Check permissions (Admin and Staff only)
        if (!hasPermission(interaction.member, 'send_message')) {
            await interaction.reply({
                content: '❌ You don\'t have permission to send messages. Admin or Staff role required.',
                flags: 64
            });
            return;
        }

        // Create channel selector
        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('send_message_channel_select')
            .setPlaceholder('Select a channel to send the message to...')
            .setChannelTypes([0, 5]) // GuildText = 0, GuildAnnouncement = 5
            .setMinValues(1)
            .setMaxValues(1);

        const selectRow = new ActionRowBuilder().addComponents(channelSelect);

        await interaction.reply({
            content: '📤 **Send Custom Message**\n\nPlease select the channel where you want to send the message:',
            components: [selectRow],
            flags: 64
        });
    } catch (error) {
        await interaction.reply({
            content: `❌ Failed to open send message form: ${error.message}`,
            flags: 64
        });
        await logger.log(`❌ Send message error: ${error.message}`);
    }
}

// Handle channel selection - shows role selector
export async function handleChannelSelection(interaction) {
    try {
        // Check permissions
        if (!hasPermission(interaction.member, 'send_message')) {
            await interaction.update({
                content: '❌ You don\'t have permission to send messages.',
                components: []
            });
            return;
        }

        const selectedChannel = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(selectedChannel);

        // Create role selector (like channel selector)
        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId(`send_message_role_select_${selectedChannel}`)
            .setPlaceholder('Select a role to mention (optional)...')
            .setMinValues(0) // Allow no selection
            .setMaxValues(1); // Only 1 role

        // Create "Complete Setup" button to skip role selection
        const completeButton = new ButtonBuilder()
            .setCustomId(`send_message_complete_${selectedChannel}`)
            .setLabel('Complete Setup')
            .setStyle(ButtonStyle.Success);

        const selectRow = new ActionRowBuilder().addComponents(roleSelect);
        const buttonRow = new ActionRowBuilder().addComponents(completeButton);

        await interaction.update({
            content: `📤 **Send Message to #${channel?.name || 'Unknown'}**\n\nSelect a role to mention (optional) or click "Complete Setup" to skip:`,
            components: [selectRow, buttonRow]
        });

        await logger.log(`📤 Role selector opened for channel ${selectedChannel} by ${interaction.user.tag} (${interaction.user.id})`);

    } catch (error) {
        await logger.log(`❌ Channel selection error: ${error.message}`);

        // Try to respond with ephemeral reply if update fails
        try {
            await interaction.reply({
                content: `❌ Failed to open role selector: ${error.message}`,
                flags: 64
            });
        } catch (replyError) {
            await logger.log(`❌ Failed to send error response: ${replyError.message}`);
        }
    }
}

// Handle role selection - shows message composition interface
export async function handleRoleSelection(interaction) {
    try {
        // Check permissions
        if (!hasPermission(interaction.member, 'send_message')) {
            await interaction.update({
                content: '❌ You don\'t have permission to send messages.',
                components: []
            });
            return;
        }

        const selectedRoles = interaction.values;
        const channelId = interaction.customId.replace('send_message_role_select_', '');
        const channel = interaction.guild.channels.cache.get(channelId);

        // Log after getting the data to save time
        await logger.log(`🔍 Role selection: ${selectedRoles.length} roles selected for channel ${channelId} by ${interaction.user.tag}`);

        // Show modal directly for embed configuration
        const modal = new ModalBuilder()
            .setCustomId(`send_message_modal_${channelId}_${selectedRoles.length > 0 ? selectedRoles[0] : 'none'}`)
            .setTitle(`📤 Send Message to #${channel?.name || 'Unknown'}`);

        // Title input
        const titleInput = new TextInputBuilder()
            .setCustomId('embed_title')
            .setLabel('Embed Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter the embed title...')
            .setRequired(true)
            .setMaxLength(256);

        // Description input
        const descriptionInput = new TextInputBuilder()
            .setCustomId('embed_description')
            .setLabel('Embed Description (Optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Enter the embed description (optional)...')
            .setRequired(false);

        // Image URL input
        const imageInput = new TextInputBuilder()
            .setCustomId('embed_image')
            .setLabel('Image URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/image.png')
            .setRequired(false);

        // Color input
        const colorInput = new TextInputBuilder()
            .setCustomId('embed_color')
            .setLabel('Embed Color (Hex/Decimal/Name)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#FF5733 or 16729395 or red (optional)')
            .setRequired(false)
            .setMaxLength(20);

        // Footer input
        const footerInput = new TextInputBuilder()
            .setCustomId('embed_footer')
            .setLabel('Embed Footer Text')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Leave empty to use default footer (optional)')
            .setRequired(false)
            .setMaxLength(2048);

        // Add inputs to modal (max 5 components allowed)
        const titleRow = new ActionRowBuilder().addComponents(titleInput);
        const descriptionRow = new ActionRowBuilder().addComponents(descriptionInput);
        const imageRow = new ActionRowBuilder().addComponents(imageInput);
        const colorRow = new ActionRowBuilder().addComponents(colorInput);
        const footerRow = new ActionRowBuilder().addComponents(footerInput);

        modal.addComponents(titleRow, descriptionRow, imageRow, colorRow, footerRow);

        // Show the modal immediately - no delays
        await interaction.showModal(modal);

        await logger.log(`📤 Modal shown successfully for channel ${channelId} with role ${selectedRoles.length > 0 ? selectedRoles[0] : 'none'} by ${interaction.user.tag}`);

    } catch (error) {
        await logger.log(`❌ Role selection error: ${error.message}`);
        await logger.log(`❌ Role selection error stack: ${error.stack}`);

        await interaction.reply({
            content: `❌ Failed to process role selection: ${error.message}`,
            flags: 64
        });
    }
}

// Handle complete setup button (skip role selection)
export async function handleCompleteSetup(interaction) {
    try {
        // Check permissions
        if (!hasPermission(interaction.member, 'send_message')) {
            await interaction.update({
                content: '❌ You don\'t have permission to send messages.',
                components: []
            });
            return;
        }

        const channelId = interaction.customId.replace('send_message_complete_', '');
        const channel = interaction.guild.channels.cache.get(channelId);

        // Log after getting the data to save time
        await logger.log(`🔍 Complete setup: skipping role selection for channel ${channelId} by ${interaction.user.tag}`);

        // Show modal directly for embed configuration
        const modal = new ModalBuilder()
            .setCustomId(`send_message_modal_${channelId}_none`)
            .setTitle(`📤 Send Message to #${channel?.name || 'Unknown'}`);

        // Title input
        const titleInput = new TextInputBuilder()
            .setCustomId('embed_title')
            .setLabel('Embed Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter the embed title...')
            .setRequired(true)
            .setMaxLength(256);

        // Description input
        const descriptionInput = new TextInputBuilder()
            .setCustomId('embed_description')
            .setLabel('Embed Description (Optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Enter the embed description (optional)...')
            .setRequired(false);

        // Image URL input
        const imageInput = new TextInputBuilder()
            .setCustomId('embed_image')
            .setLabel('Image URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/image.png')
            .setRequired(false);

        // Color input
        const colorInput = new TextInputBuilder()
            .setCustomId('embed_color')
            .setLabel('Embed Color (Hex/Decimal/Name)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#FF5733 or 16729395 or red (optional)')
            .setRequired(false)
            .setMaxLength(20);

        // Footer input
        const footerInput = new TextInputBuilder()
            .setCustomId('embed_footer')
            .setLabel('Embed Footer Text')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Leave empty to use default footer (optional)')
            .setRequired(false)
            .setMaxLength(2048);

        // Add inputs to modal (max 5 components allowed)
        const titleRow = new ActionRowBuilder().addComponents(titleInput);
        const descriptionRow = new ActionRowBuilder().addComponents(descriptionInput);
        const imageRow = new ActionRowBuilder().addComponents(imageInput);
        const colorRow = new ActionRowBuilder().addComponents(colorInput);
        const footerRow = new ActionRowBuilder().addComponents(footerInput);

        modal.addComponents(titleRow, descriptionRow, imageRow, colorRow, footerRow);

        // Show the modal immediately - no delays
        await interaction.showModal(modal);

        await logger.log(`📤 Modal shown successfully for channel ${channelId} without role mention by ${interaction.user.tag}`);

    } catch (error) {
        await logger.log(`❌ Complete setup error: ${error.message}`);
        await logger.log(`❌ Complete setup error stack: ${error.stack}`);

        await interaction.reply({
            content: `❌ Failed to complete setup: ${error.message}`,
            flags: 64
        });
    }
}

// Handle modal submission
export async function handleSendMessageModal(interaction) {
    try {
        // Check permissions
        if (!hasPermission(interaction.member, 'send_message')) {
            await interaction.reply({
                content: '❌ You don\'t have permission to send messages.',
                flags: 64
            });
            return;
        }

        // Extract channel ID and role from modal customId
        const customIdParts = interaction.customId.replace('send_message_modal_', '').split('_');
        const channelId = customIdParts[0];
        const selectedRole = customIdParts[1];

        // Get form data
        const title = interaction.fields.getTextInputValue('embed_title') || null;
        const description = interaction.fields.getTextInputValue('embed_description') || null;
        const imageUrl = interaction.fields.getTextInputValue('embed_image') || null;
        const colorInput = interaction.fields.getTextInputValue('embed_color') || null;
        const footerInput = interaction.fields.getTextInputValue('embed_footer') || null;

        // Get the target channel
        const targetChannel = await interaction.client.channels.fetch(channelId).catch(() => null);
        if (!targetChannel) {
            await interaction.reply({
                content: '❌ Channel not found. Please try again.',
                flags: 64
            });
            return;
        }

        // Check if it's a text-based channel
        if (!targetChannel.isTextBased()) {
            await interaction.reply({
                content: '❌ The specified channel is not a text channel.',
                flags: 64
            });
            return;
        }

        // Validate that at least title is provided (title is required)
        if (!title || !title.trim()) {
            await interaction.reply({
                content: '❌ Title is required for the embed.',
                flags: 64
            });
            return;
        }

        // Parse color - use config default if not provided
        let embedColor = EMBED.COLOR;
        if (colorInput && colorInput.trim()) {
            const parsedColor = parseColor(colorInput.trim());
            if (parsedColor !== null) {
                embedColor = parsedColor;
            } else {
                await interaction.reply({
                    content: '❌ Invalid color format. Please use hex (#FF0000), decimal (16711680), or color name (red).',
                    flags: 64
                });
                return;
            }
        }


        // Determine footer text - use custom footer if provided, otherwise use config default
        const footerText = (footerInput && footerInput.trim()) ? footerInput.trim() : EMBED.FOOTER;

        // Create embed with footer (custom or default)
        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setFooter({ text: footerText })
            .setTimestamp();

        if (title) embed.setTitle(title);
        if (description) embed.setDescription(description);

        // Handle image URL - set image if provided
        if (imageUrl) {
            embed.setImage(imageUrl);
        }

        // Prepare message content with role mentions
        let content = '';
        if (selectedRole && selectedRole !== 'none') {
            const role = interaction.guild.roles.cache.get(selectedRole);
            if (role) {
                content = `<@&${selectedRole}>`; // Always try to mention, Discord will handle mentionable status
            }
        }

        // Send the message
        const messageOptions = {
            content: content || undefined,
            embeds: [embed]
        };

        await targetChannel.send(messageOptions);

        // Reply to the user
        await interaction.reply({
            content: `✅ Custom message sent successfully to ${targetChannel}!`,
            flags: 64
        });

        await logger.log(`📤 Custom message sent by ${interaction.user.tag} (${interaction.user.id}) to ${targetChannel.name} (${targetChannel.id})`);

    } catch (error) {
        // Reply to the user with error
        await interaction.reply({
            content: `❌ Failed to send message: ${error.message}`,
            flags: 64
        });

        await logger.log(`❌ Send message error: ${error.message}`);
    }
}

// Helper function to validate URL
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}
