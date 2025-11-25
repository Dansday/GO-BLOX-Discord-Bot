import { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder } from 'discord.js';
import { getEmbedConfig, FEEDBACK, getBotConfig } from '../../../config.js';
import logger from '../../../logger.js';
import { hasPermission, getPermissionDeniedMessage } from '../permissions.js';
import { translate } from '../../../i18n.js';
import db from '../../../../database/database.js';

export async function handleFeedbackButton(interaction) {
    try {
        const member = interaction.member;

        if (!(await hasPermission(member, 'feedback'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'feedback', interaction.user.id);
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

        const anonymousLabel = await translate('feedback.modal.anonymousLabel', interaction.guild.id, interaction.user.id);
        const anonymousPlaceholder = await translate('feedback.modal.anonymousPlaceholder', interaction.guild.id, interaction.user.id);
        const anonymousInput = new TextInputBuilder()
            .setCustomId('anonymous')
            .setLabel(anonymousLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(anonymousPlaceholder)
            .setRequired(false)
            .setMaxLength(3);

        modal.addComponents(
            new ActionRowBuilder().addComponents(feedbackInput),
            new ActionRowBuilder().addComponents(anonymousInput)
        );

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
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'feedback', interaction.user.id);
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

        const anonymousValue = interaction.fields.getTextInputValue('anonymous')?.trim().toLowerCase() || 'no';
        const isAnonymous = anonymousValue === 'yes' || anonymousValue === 'ya';

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

        const botConfig = getBotConfig();
        const server = await db.getServerByDiscordId(botConfig.id, guild.id);
        const dbMember = await db.upsertMember(server.id, member);

        await db.createFeedback(
            server.id,
            dbMember.id,
            feedbackMessage,
            isAnonymous
        );

        const embedConfig = await getEmbedConfig(interaction.guild.id);

        const feedbackEmbedTitle = '💬 Feedback Submission';
        const fromLabel = '👤 From';
        const submittedLabel = '🕐 Submitted';
        const feedbackEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(feedbackEmbedTitle)
            .setDescription(feedbackMessage.length > 4096 ? feedbackMessage.substring(0, 4093) + '...' : feedbackMessage)
            .setThumbnail(isAnonymous ? undefined : user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields([
                {
                    name: fromLabel,
                    value: isAnonymous ? 'Anonymous' : `<@${user.id}>`,
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
            const feedbackRoleId = await FEEDBACK.getRole(guild.id);
            if (feedbackRoleId) {
                staffMentions = `<@&${feedbackRoleId}>`;
            }
        } catch (err) {
            await logger.log(`⚠️  Error getting feedback role: ${err.message}`);
        }

        await feedbackChannel.send({
            content: staffMentions || undefined,
            embeds: [feedbackEmbed]
        });

        const successTitle = await translate('feedback.submitted.title', interaction.guild.id, interaction.user.id);
        let successDescription = await translate('feedback.submitted.description', interaction.guild.id, interaction.user.id);
        
        if (isAnonymous) {
            const anonymousText = await translate('feedback.submitted.anonymous', interaction.guild.id, interaction.user.id);
            successDescription += anonymousText;
        }

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
