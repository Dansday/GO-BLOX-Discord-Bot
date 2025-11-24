import { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder } from 'discord.js';
import { getEmbedConfig, PERMISSIONS, FEEDBACK } from '../../../config.js';
import logger from '../../../logger.js';
import { hasPermission, getPermissionDeniedMessage } from '../permissions.js';
import { translate } from '../../../i18n.js';

export async function handleFeedbackButton(interaction) {
    try {
        const member = interaction.member;

        if (!(await hasPermission(member, 'feedback'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'feedback');
            await interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null);
            return;
        }

        const modalTitle = await translate('feedback.modal.title', interaction.guild.id, interaction.user.id);
        const modal = new ModalBuilder()
            .setCustomId('feedback_submit')
            .setTitle(modalTitle);

        const feedbackLabel = await translate('feedback.modal.label', interaction.guild.id, interaction.user.id);
        const feedbackPlaceholder = await translate('feedback.modal.placeholder', interaction.guild.id, interaction.user.id);
        const feedbackInput = new TextInputBuilder()
            .setCustomId('feedback_message')
            .setLabel(feedbackLabel)
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(feedbackPlaceholder)
            .setRequired(true)
            .setMaxLength(2000);

        const feedbackRow = new ActionRowBuilder().addComponents(feedbackInput);
        modal.addComponents(feedbackRow);

        await interaction.showModal(modal);
        await logger.log(`💬 Feedback modal shown to ${member.user.tag} (${member.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error showing feedback modal: ${error.message}`);
        const errorMsg = await translate('feedback.errors.failed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.reply({
            content: errorMsg,
            flags: 64
        });
    }
}

export async function handleFeedbackModal(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        const member = interaction.member;
        const guild = interaction.guild;
        const user = interaction.user;

        if (!(await hasPermission(member, 'feedback'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'feedback');
            await interaction.editReply({
                content: errorMessage
            }).catch(() => null);
            return;
        }

        const feedbackMessage = interaction.fields.getTextInputValue('feedback_message').trim();

        if (!feedbackMessage || feedbackMessage.length === 0) {
            const errorMsg = await translate('feedback.errors.invalid', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        let feedbackChannelId;
        try {
            feedbackChannelId = await FEEDBACK.getChannel(guild.id);
        } catch (err) {
            await logger.log(`❌ Error getting feedback channel: ${err.message}`);
            const errorMsg = await translate('feedback.errors.channelError', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        if (!feedbackChannelId) {
            await logger.log(`❌ Feedback channel not configured for server ${guild.id}`);
            const errorMsg = await translate('feedback.errors.channelNotConfigured', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const feedbackChannel = guild.channels.cache.get(feedbackChannelId);
        if (!feedbackChannel) {
            await logger.log(`❌ Feedback channel not found: ${feedbackChannelId}`);
            const errorMsg = await translate('feedback.errors.channelNotFound', interaction.guild.id, interaction.user.id);
            await interaction.editReply({
                content: errorMsg
            });
            return;
        }

        const embedConfig = await getEmbedConfig(interaction.guild.id);

        const feedbackEmbedTitle = '💬 Feedback Submission';
        const fromLabel = '👤 From';
        const submittedLabel = '🕐 Submitted';
        const feedbackEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(feedbackEmbedTitle)
            .setDescription(feedbackMessage.length > 4096 ? feedbackMessage.substring(0, 4093) + '...' : feedbackMessage)
            .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields([
                {
                    name: fromLabel,
                    value: `${user.tag} (${user.id})`,
                    inline: true
                },
                {
                    name: submittedLabel,
                    value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
                    inline: true
                }
            ])
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        let staffMentions = '';
        try {
            const permissions = await PERMISSIONS.getPermissions(guild.id);
            const staffRoles = permissions.STAFF_ROLES || [];
            
            if (staffRoles.length > 0) {

                staffMentions = staffRoles.map(roleId => `<@&${roleId}>`).join(' ');
            }
        } catch (err) {
            await logger.log(`⚠️  Error getting staff roles for feedback: ${err.message}`);
        }

        await feedbackChannel.send({
            content: staffMentions || undefined,
            embeds: [feedbackEmbed]
        });

        const successTitle = await translate('feedback.submitted.title', interaction.guild.id, interaction.user.id);
        const successDescription = await translate('feedback.submitted.description', interaction.guild.id, interaction.user.id);
        const successEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(successTitle)
            .setDescription(successDescription)
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.editReply({
            embeds: [successEmbed]
        });

        await logger.log(`✅ Feedback submitted by ${user.tag} (${user.id})`);

    } catch (error) {
        await logger.log(`❌ Error processing feedback: ${error.message}`);
        await logger.log(`❌ Stack: ${error.stack}`);
        const errorMsg = await translate('feedback.errors.submitFailed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.editReply({
            content: errorMsg
        });
    }
}
