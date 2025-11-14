import { ModalBuilder, TextInputBuilder, ActionRowBuilder, EmbedBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle, TextInputStyle } from 'discord.js';
import { getEmbedConfig } from "../../../config.js";
import logger from "../../../logger.js";
import { hasPermission, getPermissionDeniedMessage } from "../permissions.js";

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

export async function handleSendMessageButton(interaction) {
    try {

        if (!(await hasPermission(interaction.member, 'send_message'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'send_message');
            await interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null);
            return;
        }

        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('send_message_channel_select')
            .setPlaceholder('Select a channel to send the message to...')
            .setChannelTypes([0, 5])
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

export async function handleChannelSelection(interaction) {
    try {

        if (!(await hasPermission(interaction.member, 'send_message'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'send_message');
            await interaction.update({
                content: errorMessage,
                components: [],
                flags: 64
            }).catch(() => interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null));
            return;
        }

        const selectedChannel = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(selectedChannel);

        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId(`send_message_role_select_${selectedChannel}`)
            .setPlaceholder('Select a role to mention (optional)...')
            .setMinValues(0)
            .setMaxValues(1);

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

export async function handleRoleSelection(interaction) {
    try {

        if (!(await hasPermission(interaction.member, 'send_message'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'send_message');
            await interaction.update({
                content: errorMessage,
                components: [],
                flags: 64
            }).catch(() => interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null));
            return;
        }

        const selectedRoles = interaction.values;
        const channelId = interaction.customId.replace('send_message_role_select_', '');
        const channel = interaction.guild.channels.cache.get(channelId);

        await logger.log(`🔍 Role selection: ${selectedRoles.length} roles selected for channel ${channelId} by ${interaction.user.tag}`);

        const modal = new ModalBuilder()
            .setCustomId(`send_message_modal_${channelId}_${selectedRoles.length > 0 ? selectedRoles[0] : 'none'}`)
            .setTitle(`📤 Send Message to #${channel?.name || 'Unknown'}`);

        const titleInput = new TextInputBuilder()
            .setCustomId('embed_title')
            .setLabel('Embed Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter the embed title...')
            .setRequired(true)
            .setMaxLength(256);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('embed_description')
            .setLabel('Embed Description (Optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Enter the embed description (optional)...')
            .setRequired(false);

        const imageInput = new TextInputBuilder()
            .setCustomId('embed_image')
            .setLabel('Image URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/image.png')
            .setRequired(false);

        const colorInput = new TextInputBuilder()
            .setCustomId('embed_color')
            .setLabel('Embed Color (Hex/Decimal/Name)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#FF5733 or 16729395 or red (optional)')
            .setRequired(false)
            .setMaxLength(20);

        const footerInput = new TextInputBuilder()
            .setCustomId('embed_footer')
            .setLabel('Embed Footer Text')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Leave empty to use default footer (optional)')
            .setRequired(false)
            .setMaxLength(2048);

        const titleRow = new ActionRowBuilder().addComponents(titleInput);
        const descriptionRow = new ActionRowBuilder().addComponents(descriptionInput);
        const imageRow = new ActionRowBuilder().addComponents(imageInput);
        const colorRow = new ActionRowBuilder().addComponents(colorInput);
        const footerRow = new ActionRowBuilder().addComponents(footerInput);

        modal.addComponents(titleRow, descriptionRow, imageRow, colorRow, footerRow);

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

export async function handleCompleteSetup(interaction) {
    try {

        if (!(await hasPermission(interaction.member, 'send_message'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'send_message');
            await interaction.update({
                content: errorMessage,
                components: [],
                flags: 64
            }).catch(() => interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null));
            return;
        }

        const channelId = interaction.customId.replace('send_message_complete_', '');
        const channel = interaction.guild.channels.cache.get(channelId);

        await logger.log(`🔍 Complete setup: skipping role selection for channel ${channelId} by ${interaction.user.tag}`);

        const modal = new ModalBuilder()
            .setCustomId(`send_message_modal_${channelId}_none`)
            .setTitle(`📤 Send Message to #${channel?.name || 'Unknown'}`);

        const titleInput = new TextInputBuilder()
            .setCustomId('embed_title')
            .setLabel('Embed Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter the embed title...')
            .setRequired(true)
            .setMaxLength(256);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('embed_description')
            .setLabel('Embed Description (Optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Enter the embed description (optional)...')
            .setRequired(false);

        const imageInput = new TextInputBuilder()
            .setCustomId('embed_image')
            .setLabel('Image URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/image.png')
            .setRequired(false);

        const colorInput = new TextInputBuilder()
            .setCustomId('embed_color')
            .setLabel('Embed Color (Hex/Decimal/Name)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#FF5733 or 16729395 or red (optional)')
            .setRequired(false)
            .setMaxLength(20);

        const footerInput = new TextInputBuilder()
            .setCustomId('embed_footer')
            .setLabel('Embed Footer Text')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Leave empty to use default footer (optional)')
            .setRequired(false)
            .setMaxLength(2048);

        const titleRow = new ActionRowBuilder().addComponents(titleInput);
        const descriptionRow = new ActionRowBuilder().addComponents(descriptionInput);
        const imageRow = new ActionRowBuilder().addComponents(imageInput);
        const colorRow = new ActionRowBuilder().addComponents(colorInput);
        const footerRow = new ActionRowBuilder().addComponents(footerInput);

        modal.addComponents(titleRow, descriptionRow, imageRow, colorRow, footerRow);

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

export async function handleSendMessageModal(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        if (!(await hasPermission(interaction.member, 'send_message'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'send_message');
            await interaction.editReply({
                content: errorMessage
            }).catch(() => null);
            return;
        }

        const customIdParts = interaction.customId.replace('send_message_modal_', '').split('_');
        const channelId = customIdParts[0];
        const selectedRole = customIdParts[1];

        const title = interaction.fields.getTextInputValue('embed_title') || null;
        const description = interaction.fields.getTextInputValue('embed_description') || null;
        const imageUrl = interaction.fields.getTextInputValue('embed_image') || null;
        const colorInput = interaction.fields.getTextInputValue('embed_color') || null;
        const footerInput = interaction.fields.getTextInputValue('embed_footer') || null;

        const targetChannel = await interaction.client.channels.fetch(channelId).catch(() => null);
        if (!targetChannel) {
            await interaction.reply({
                content: '❌ Channel not found. Please try again.',
                flags: 64
            });
            return;
        }

        if (!targetChannel.isTextBased()) {
            await interaction.reply({
                content: '❌ The specified channel is not a text channel.',
                flags: 64
            });
            return;
        }

        if (!title || !title.trim()) {
            await interaction.reply({
                content: '❌ Title is required for the embed.',
                flags: 64
            });
            return;
        }

        const embedConfig = await getEmbedConfig(interaction.guild.id);

        let embedColor = embedConfig.COLOR;
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

        const footerText = (footerInput && footerInput.trim()) ? footerInput.trim() : embedConfig.FOOTER;

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setFooter({ text: footerText })
            .setTimestamp();

        if (title) embed.setTitle(title);
        if (description) embed.setDescription(description);

        if (imageUrl) {
            embed.setImage(imageUrl);
        }

        let content = '';
        if (selectedRole && selectedRole !== 'none') {
            const role = interaction.guild.roles.cache.get(selectedRole);
            if (role) {
                content = `<@&${selectedRole}>`;
            }
        }

        const messageOptions = {
            content: content || undefined,
            embeds: [embed]
        };

        await targetChannel.send(messageOptions);

        await interaction.reply({
            content: `✅ Custom message sent successfully to ${targetChannel}!`,
            flags: 64
        });

        await logger.log(`📤 Custom message sent by ${interaction.user.tag} (${interaction.user.id}) to ${targetChannel.name} (${targetChannel.id})`);

    } catch (error) {

        await interaction.reply({
            content: `❌ Failed to send message: ${error.message}`,
            flags: 64
        });

        await logger.log(`❌ Send message error: ${error.message}`);
    }
}

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}
