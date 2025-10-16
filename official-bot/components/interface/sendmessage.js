import { ModalBuilder, TextInputBuilder, ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType, AttachmentBuilder } from 'discord.js';
import { EMBED } from "../../../config.js";
import logger from "../../../logger.js";
import { replyWithAutoDelete } from "../../../utils.js";

// Handle send message button - shows channel selector first
export async function handleSendMessageButton(interaction, client) {
    try {
        // This is a staff-only feature, no additional permission checks needed

        // Create channel selector
        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('send_message_channel_select')
            .setPlaceholder('Select a channel to send the message to...')
            .setChannelTypes([0, 5]) // GuildText = 0, GuildAnnouncement = 5
            .setMinValues(1)
            .setMaxValues(1);

        const selectRow = new ActionRowBuilder().addComponents(channelSelect);

        await replyWithAutoDelete(interaction, {
            content: '📤 **Send Custom Message**\n\nPlease select the channel where you want to send the message:',
            components: [selectRow],
            flags: 64
        }, 300000); // 5 minutes

        await logger.log(`📤 Send message channel selector opened by ${interaction.user.tag} (${interaction.user.id})`);

    } catch (error) {
        await replyWithAutoDelete(interaction, {
            content: `❌ Failed to open send message form: ${error.message}`,
            flags: 64
        }, 300000); // 5 minutes
        await logger.log(`❌ Send message error: ${error.message}`);
    }
}

// Handle channel selection - shows role selector
export async function handleChannelSelection(interaction, client) {
    try {
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
export async function handleRoleSelection(interaction, client) {
    try {
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
            .setStyle(1) // Short
            .setPlaceholder('Enter the embed title...')
            .setRequired(true)
            .setMaxLength(256);

        // Description input
        const descriptionInput = new TextInputBuilder()
            .setCustomId('embed_description')
            .setLabel('Embed Description')
            .setStyle(2) // Paragraph
            .setPlaceholder('Enter the embed description...')
            .setRequired(true);

        // Image URL input
        const imageInput = new TextInputBuilder()
            .setCustomId('embed_image')
            .setLabel('Image URL')
            .setStyle(1) // Short
            .setPlaceholder('https://example.com/image.png')
            .setRequired(false);

        // Color input
        const colorInput = new TextInputBuilder()
            .setCustomId('embed_color')
            .setLabel('Embed Color (hex code)')
            .setStyle(1) // Short
            .setPlaceholder('Leave empty for default (FF0000)')
            .setRequired(false)
            .setMaxLength(7);

        // Footer input
        const footerInput = new TextInputBuilder()
            .setCustomId('embed_footer')
            .setLabel('Embed Footer')
            .setStyle(1) // Short
            .setPlaceholder('Leave empty for auto-generated footer with sender name')
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
export async function handleCompleteSetup(interaction, client) {
    try {
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
            .setStyle(1) // Short
            .setPlaceholder('Enter the embed title...')
            .setRequired(true)
            .setMaxLength(256);

        // Description input
        const descriptionInput = new TextInputBuilder()
            .setCustomId('embed_description')
            .setLabel('Embed Description')
            .setStyle(2) // Paragraph
            .setPlaceholder('Enter the embed description...')
            .setRequired(true);

        // Image URL input
        const imageInput = new TextInputBuilder()
            .setCustomId('embed_image')
            .setLabel('Image URL')
            .setStyle(1) // Short
            .setPlaceholder('https://example.com/image.png')
            .setRequired(false);

        // Color input
        const colorInput = new TextInputBuilder()
            .setCustomId('embed_color')
            .setLabel('Embed Color (hex code)')
            .setStyle(1) // Short
            .setPlaceholder('Leave empty for default (FF0000)')
            .setRequired(false)
            .setMaxLength(7);

        // Footer input
        const footerInput = new TextInputBuilder()
            .setCustomId('embed_footer')
            .setLabel('Embed Footer')
            .setStyle(1) // Short
            .setPlaceholder('Leave empty for auto-generated footer with sender name')
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
export async function handleSendMessageModal(interaction, client) {
    try {
        // This is a staff-only feature, no additional permission checks needed

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
        const targetChannel = await client.channels.fetch(channelId).catch(() => null);
        if (!targetChannel) {
            await replyWithAutoDelete(interaction, {
                content: '❌ Channel not found. Please try again.',
                flags: 64
            }, 300000); // 5 minutes
            return;
        }

        // Check if it's a text-based channel
        if (!targetChannel.isTextBased()) {
            await replyWithAutoDelete(interaction, {
                content: '❌ The specified channel is not a text channel.',
                flags: 64
            }, 300000); // 5 minutes
            return;
        }

        // Validate that both title and description are provided (now required)
        if (!title || !description) {
            await replyWithAutoDelete(interaction, {
                content: '❌ Both title and description are required for the embed.',
                flags: 64
            }, 300000); // 5 minutes
            return;
        }

        // Parse color - use config default if not provided
        let embedColor = EMBED.COLOR; // Use your default embed color from config
        if (colorInput) {
            // Remove # if present and convert to number
            const cleanColor = colorInput.replace('#', '');
            if (/^[0-9A-Fa-f]{6}$/.test(cleanColor)) {
                embedColor = parseInt(cleanColor, 16);
            } else if (colorInput.startsWith('0x') && /^0x[0-9A-Fa-f]{6}$/.test(colorInput)) {
                embedColor = parseInt(colorInput, 16);
            } else {
                await replyWithAutoDelete(interaction, {
                    content: '❌ Invalid color format. Please use hex format like #FF0000 or 0xFF0000.',
                    flags: 64
                }, 300000); // 5 minutes
                return;
            }
        }


        // Create embed with custom or auto-generated footer
        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTimestamp();

        // Set footer - use custom footer if provided, otherwise auto-generated
        if (footerInput && footerInput.trim()) {
            embed.setFooter({ text: footerInput.trim() });
        } else {
            embed.setFooter({
                text: `Message sent by ${interaction.member.displayName || interaction.user.displayName || interaction.user.username}`
            });
        }

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

        // Reply to the user with auto-delete
        await replyWithAutoDelete(interaction, {
            content: `✅ Custom message sent successfully to ${targetChannel}!`,
            flags: 64
        }, 300000); // 5 minutes

        await logger.log(`📤 Custom message sent by ${interaction.user.tag} (${interaction.user.id}) to ${targetChannel.name} (${targetChannel.id})`);

    } catch (error) {
        // Reply to the user with auto-delete for error
        await replyWithAutoDelete(interaction, {
            content: `❌ Failed to send message: ${error.message}`,
            flags: 64
        }, 300000); // 5 minutes

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
