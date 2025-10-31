import { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder } from 'discord.js';
import { EMBED, PERMISSIONS } from '../../../config.js';
import logger from '../../../logger.js';
import { hasPermission } from '../permissions.js';

// Feedback channel ID
const FEEDBACK_CHANNEL_ID = "1409858556164964432";

// Track user submissions (userId -> { count: number, submissions: [{ number, timestamp, message }] })
const userSubmissions = new Map();

// Record a submission
function recordSubmission(userId, submissionNumber, message) {
    const userData = userSubmissions.get(userId);
    const submission = {
        number: submissionNumber,
        timestamp: Date.now(),
        message: message
    };

    if (!userData) {
        userSubmissions.set(userId, { count: submissionNumber, submissions: [submission] });
    } else {
        userData.count = submissionNumber;
        userData.submissions.push(submission);
    }
}

// Handle feedback button click
export async function handleFeedbackButton(interaction) {
    try {
        const member = interaction.member;

        // Check permissions (members can use feedback)
        if (!hasPermission(member, 'feedback')) {
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
        if (!hasPermission(member, 'feedback')) {
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

        // Get feedback channel
        const feedbackChannel = guild.channels.cache.get(FEEDBACK_CHANNEL_ID);
        if (!feedbackChannel) {
            await logger.log(`❌ Feedback channel not found: ${FEEDBACK_CHANNEL_ID}`);
            await interaction.editReply({
                content: '❌ Failed to submit feedback: Feedback channel not configured.'
            });
            return;
        }

        // Get submission info before recording
        const userData = userSubmissions.get(user.id);
        const currentCount = userData ? userData.count : 0;
        const submissionNumber = currentCount + 1;

        // Record this submission
        recordSubmission(user.id, submissionNumber, feedbackMessage);

        // Create feedback embed
        const feedbackEmbed = new EmbedBuilder()
            .setColor(EMBED.COLOR)
            .setTitle(`💬 Feedback Submission #${submissionNumber}`)
            .setDescription(feedbackMessage.length > 4096 ? feedbackMessage.substring(0, 4093) + '...' : feedbackMessage)
            .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields([
                {
                    name: '👤 From',
                    value: `${user.tag} (${user.id})`,
                    inline: true
                },
                {
                    name: '📊 Submission Number',
                    value: `#${submissionNumber}`,
                    inline: true
                },
                {
                    name: '🕐 Submitted',
                    value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
                    inline: false
                }
            ])
            .setTimestamp()
            .setFooter({ text: guild.name });

        // Send to feedback channel with Staff role mention
        await feedbackChannel.send({
            content: `<@&${PERMISSIONS.STAFF_ROLE}>`,
            embeds: [feedbackEmbed]
        });

        // Confirm to user
        const successEmbed = new EmbedBuilder()
            .setColor(EMBED.COLOR)
            .setTitle('✅ Feedback Submitted!')
            .setDescription('Thank you for your feedback! Your submission has been received.')
            .setTimestamp()
            .setFooter({ text: guild.name });

        await interaction.editReply({
            embeds: [successEmbed]
        });

        await logger.log(`✅ Feedback submitted by ${user.tag} (${user.id}): Submission #${submissionNumber}`);

    } catch (error) {
        await logger.log(`❌ Error processing feedback: ${error.message}`);
        await logger.log(`❌ Stack: ${error.stack}`);
        await interaction.editReply({
            content: `❌ **Failed to Submit Feedback**\n\nError: ${error.message}\n\nPlease try again later.`
        });
    }
}
