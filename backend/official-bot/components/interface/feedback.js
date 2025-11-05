import { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder } from 'discord.js';
import { getEmbedConfig, PERMISSIONS, FEEDBACK } from '../../../config.js';
import logger from '../../../logger.js';
import { hasPermission } from '../permissions.js';

// Handle feedback button click
export async function handleFeedbackButton(interaction) {
    try {
        const member = interaction.member;

        // Check permissions (members can use feedback)
        if (!(await hasPermission(member, 'feedback'))) {
            await interaction.reply({
                content: '❌ You don\'t have permission to submit feedback. Member role required.',
                flags: 64
            });
            return;
        }

        // Create modal for feedback
        const modal = new ModalBuilder()
            .setCustomId('feedback_submit')
            .setTitle('💬 Submit Feedback');

        const feedbackInput = new TextInputBuilder()
            .setCustomId('feedback_message')
            .setLabel('Your Feedback')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Please share your feedback, suggestions, or concerns...')
            .setRequired(true)
            .setMaxLength(2000);

        const feedbackRow = new ActionRowBuilder().addComponents(feedbackInput);
        modal.addComponents(feedbackRow);

        await interaction.showModal(modal);
        await logger.log(`💬 Feedback modal shown to ${member.user.tag} (${member.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error showing feedback modal: ${error.message}`);
        await interaction.reply({
            content: `❌ Failed to open feedback form: ${error.message}`,
            flags: 64
        });
    }
}

// Handle feedback modal submission
export async function handleFeedbackModal(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        const member = interaction.member;
        const guild = interaction.guild;
        const user = interaction.user;

        // Check permissions
        if (!(await hasPermission(member, 'feedback'))) {
            await interaction.editReply({
                content: '❌ You don\'t have permission to submit feedback. Member role required.'
            });
            return;
        }

        // Get feedback message
        const feedbackMessage = interaction.fields.getTextInputValue('feedback_message').trim();

        if (!feedbackMessage || feedbackMessage.length === 0) {
            await interaction.editReply({
                content: '❌ **Invalid Feedback**\n\nFeedback message cannot be empty.'
            });
            return;
        }

        // Get feedback channel from database
        let feedbackChannelId;
        try {
            feedbackChannelId = await FEEDBACK.getChannel(guild.id);
        } catch (err) {
            await logger.log(`❌ Error getting feedback channel: ${err.message}`);
            await interaction.editReply({
                content: '❌ Failed to submit feedback: Error retrieving feedback channel configuration.'
            });
            return;
        }

        if (!feedbackChannelId) {
            await logger.log(`❌ Feedback channel not configured for server ${guild.id}`);
            await interaction.editReply({
                content: '❌ Failed to submit feedback: Feedback channel not configured.'
            });
            return;
        }

        const feedbackChannel = guild.channels.cache.get(feedbackChannelId);
        if (!feedbackChannel) {
            await logger.log(`❌ Feedback channel not found: ${feedbackChannelId}`);
            await interaction.editReply({
                content: '❌ Failed to submit feedback: Feedback channel not found.'
            });
            return;
        }

        // Get embed config
        const embedConfig = await getEmbedConfig(interaction.guild.id);

        // Create feedback embed
        const feedbackEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle('💬 Feedback Submission')
            .setDescription(feedbackMessage.length > 4096 ? feedbackMessage.substring(0, 4093) + '...' : feedbackMessage)
            .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields([
                {
                    name: '👤 From',
                    value: `${user.tag} (${user.id})`,
                    inline: true
                },
                {
                    name: '🕐 Submitted',
                    value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
                    inline: true
                }
            ])
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        // Get staff roles from permissions configuration
        let staffMentions = '';
        try {
            const permissions = await PERMISSIONS.getPermissions(guild.id);
            const staffRoles = permissions.STAFF_ROLES || [];
            
            if (staffRoles.length > 0) {
                // Mention all staff roles
                staffMentions = staffRoles.map(roleId => `<@&${roleId}>`).join(' ');
            }
        } catch (err) {
            await logger.log(`⚠️  Error getting staff roles for feedback: ${err.message}`);
        }

        // Send to feedback channel with Staff role mentions
        await feedbackChannel.send({
            content: staffMentions || undefined, // Only include content if there are staff roles
            embeds: [feedbackEmbed]
        });

        // Confirm to user
        const successEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle('✅ Feedback Submitted!')
            .setDescription('Thank you for your feedback! Your submission has been received.')
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.editReply({
            embeds: [successEmbed]
        });

        await logger.log(`✅ Feedback submitted by ${user.tag} (${user.id})`);

    } catch (error) {
        await logger.log(`❌ Error processing feedback: ${error.message}`);
        await logger.log(`❌ Stack: ${error.stack}`);
        await interaction.editReply({
            content: `❌ **Failed to Submit Feedback**\n\nError: ${error.message}\n\nPlease try again later.`
        });
    }
}
