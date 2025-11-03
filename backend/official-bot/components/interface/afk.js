import { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getEmbedConfig } from '../../../config.js';
import logger from '../../../logger.js';
import { hasPermission } from '../permissions.js';

// Store AFK status (userId -> { message, timestamp, originalNickname, wasMutedByBot, wasDeafenedByBot })
const afkUsers = new Map();

// Get AFK status for a user
export function getAFKStatus(userId) {
    return afkUsers.get(userId) || null;
}

// Set user as AFK
async function setAFK(member, message, shouldDeafen = true) {
    const userId = member.id;
    const originalNickname = member.nickname || member.user.username;

    // Check if user is in a voice channel
    let wasMutedByBot = false;
    let wasDeafenedByBot = false;
    if (member.voice.channel) {
        try {
            // Mute the user in voice channel
            await member.voice.setMute(true);
            wasMutedByBot = true;
            await logger.log(`🔇 Muted ${member.user.tag} (${member.user.id}) in voice channel (AFK)`);
        } catch (err) {
            await logger.log(`⚠️ Could not mute ${member.user.tag} in voice channel: ${err.message}`);
        }

        // Only deafen if user chose to be deafened
        if (shouldDeafen) {
            try {
                // Deafen the user in voice channel
                await member.voice.setDeaf(true);
                wasDeafenedByBot = true;
                await logger.log(`🔇 Deafened ${member.user.tag} (${member.user.id}) in voice channel (AFK)`);
            } catch (err) {
                await logger.log(`⚠️ Could not deafen ${member.user.tag} in voice channel: ${err.message}`);
            }
        }
    }

    // Store AFK status
    afkUsers.set(userId, {
        message: message || 'Away',
        timestamp: Date.now(),
        originalNickname: originalNickname,
        wasMutedByBot: wasMutedByBot,
        wasDeafenedByBot: wasDeafenedByBot
    });

    // Update nickname with [AFK] prefix
    try {
        const newNickname = `[AFK] ${originalNickname}`;
        if (newNickname.length <= 32) {
            await member.setNickname(newNickname);
        }
    } catch (err) {
        await logger.log(`⚠️ Could not update nickname for ${member.user.tag}: ${err.message}`);
    }
}

// Remove AFK status
export async function removeAFK(member, reason = '') {
    const userId = member.id;
    const afkData = afkUsers.get(userId);

    if (!afkData) {
        return false; // Not AFK
    }

    // Unmute if we muted them
    if (afkData.wasMutedByBot && member.voice.channel) {
        try {
            await member.voice.setMute(false);
            await logger.log(`🔊 Unmuted ${member.user.tag} (${member.user.id}) in voice channel (AFK removed)`);
        } catch (err) {
            await logger.log(`⚠️ Could not unmute ${member.user.tag} in voice channel: ${err.message}`);
        }
    }

    // Undeafen if we deafened them
    if (afkData.wasDeafenedByBot && member.voice.channel) {
        try {
            await member.voice.setDeaf(false);
            await logger.log(`🔊 Undeafened ${member.user.tag} (${member.user.id}) in voice channel (AFK removed)`);
        } catch (err) {
            await logger.log(`⚠️ Could not undeafen ${member.user.tag} in voice channel: ${err.message}`);
        }
    }

    // Restore original nickname
    try {
        await member.setNickname(afkData.originalNickname);
    } catch (err) {
        // If nickname can't be set, try clearing it
        try {
            await member.setNickname(null);
        } catch (err2) {
            await logger.log(`⚠️ Could not restore nickname for ${member.user.tag}: ${err2.message}`);
        }
    }

    // Remove from map
    afkUsers.delete(userId);

    const duration = Math.floor((Date.now() - afkData.timestamp) / 1000);
    const minutes = Math.floor(duration / 60);
    const hours = Math.floor(minutes / 60);

    let durationText = '';
    if (hours > 0) {
        durationText = `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        durationText = `${minutes}m`;
    } else {
        durationText = `${duration}s`;
    }

    await logger.log(`✅ Removed AFK status for ${member.user.tag} (${member.user.id}) - Was AFK for ${durationText}${reason ? ` - ${reason}` : ''}`);

    return true;
}

// Handle AFK button click
export async function handleAFKButton(interaction) {
    try {
        const member = interaction.member;

        // Check permissions (members can use AFK)
        if (!(await hasPermission(member, 'afk'))) {
            await interaction.reply({
                content: '❌ You don\'t have permission to use AFK.',
                flags: 64
            });
            return;
        }

        // Check if user is already AFK
        const afkData = afkUsers.get(member.id);

        if (afkData) {
            // Show options to remove AFK
            const removeButton = new ButtonBuilder()
                .setCustomId('afk_remove')
                .setLabel('🔄 Remove AFK')
                .setStyle(ButtonStyle.Primary);

            const buttonRow = new ActionRowBuilder().addComponents(removeButton);

            const duration = Math.floor((Date.now() - afkData.timestamp) / 1000);
            const minutes = Math.floor(duration / 60);
            const hours = Math.floor(minutes / 60);

            let durationText = '';
            if (hours > 0) {
                durationText = `${hours}h ${minutes % 60}m`;
            } else if (minutes > 0) {
                durationText = `${minutes}m`;
            } else {
                durationText = `${duration}s`;
            }

            const embedConfig = await getEmbedConfig(interaction.guild.id);
            const embed = new EmbedBuilder()
                .setColor(embedConfig.COLOR)
                .setTitle('⏸️ You are currently AFK')
                .setDescription(`**Status:** ${afkData.message}\n**Duration:** ${durationText}`)
                .addFields({
                    name: '💡 How to remove',
                    value: '• Click the button below to remove AFK\n• Send any message (auto-removes AFK and unmutes)\n• AFK removal will automatically unmute you if bot muted you',
                    inline: false
                })
                .setTimestamp()
                .setFooter({ text: embedConfig.FOOTER });

            await interaction.reply({
                embeds: [embed],
                components: [buttonRow],
                flags: 64
            });
            await logger.log(`⏸️ AFK status shown to ${member.user.tag} (${member.user.id})`);
            return;
        }

        // Show modal to set AFK
        const modal = new ModalBuilder()
            .setCustomId('afk_set')
            .setTitle('⏸️ Set AFK Status');

        const messageInput = new TextInputBuilder()
            .setCustomId('afk_message')
            .setLabel('AFK Message (Optional)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., Taking a break, Studying, etc.')
            .setRequired(false)
            .setMaxLength(100);

        const deafenInput = new TextInputBuilder()
            .setCustomId('afk_deafen')
            .setLabel('Deafen in Voice? (yes/no, default: yes)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('yes or no (leave empty for yes)')
            .setRequired(false)
            .setMaxLength(3);

        const messageRow = new ActionRowBuilder().addComponents(messageInput);
        const deafenRow = new ActionRowBuilder().addComponents(deafenInput);
        modal.addComponents(messageRow, deafenRow);

        await interaction.showModal(modal);
        await logger.log(`⏸️ AFK modal shown to ${member.user.tag} (${member.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error showing AFK modal: ${error.message}`);
        await interaction.reply({
            content: `❌ Failed to open AFK form: ${error.message}`,
            flags: 64
        });
    }
}

// Handle AFK modal submission
export async function handleAFKModal(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        const member = interaction.member;

        // Check permissions
        if (!hasPermission(member, 'afk')) {
            await interaction.editReply({
                content: '❌ You don\'t have permission to use AFK.'
            });
            return;
        }

        // Get AFK message
        const afkMessage = interaction.fields.getTextInputValue('afk_message')?.trim() || 'Away';

        // Get deafen preference (default to true if not specified or if value is "yes")
        const deafenValue = interaction.fields.getTextInputValue('afk_deafen')?.trim().toLowerCase();
        const shouldDeafen = deafenValue !== 'no';

        // Set AFK
        await setAFK(member, afkMessage, shouldDeafen);

        // Confirm to user
        const voiceInfo = member.voice.channel
            ? (shouldDeafen ? 'You will be muted and deafened in voice.' : 'You will be muted in voice (not deafened).')
            : '';

        const embedConfig = await getEmbedConfig(interaction.guild.id);
        const embed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle('✅ AFK Status Set!')
            .setDescription(`You're now marked as AFK: **${afkMessage}**${voiceInfo ? `\n\n${voiceInfo}` : ''}`)
            .addFields({
                name: '💡 How to remove',
                value: '• Send any message (auto-removes AFK and unmutes)\n• Click AFK button and remove (will unmute if bot muted you)\n• Removing AFK automatically unmutes you if you were muted by the bot',
                inline: false
            })
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.editReply({
            embeds: [embed]
        });

        await logger.log(`✅ AFK status set for ${member.user.tag} (${member.user.id}): "${afkMessage}"${shouldDeafen ? ' (will be deafened)' : ' (not deafened)'}`);

    } catch (error) {
        await logger.log(`❌ Error setting AFK: ${error.message}`);
        await interaction.editReply({
            content: `❌ **Failed to Set AFK**\n\nError: ${error.message}\n\nPlease try again later.`
        });
    }
}

// Handle remove AFK button
export async function handleRemoveAFKButton(interaction) {
    try {
        const member = interaction.member;

        // Check permissions
        if (!hasPermission(member, 'afk')) {
            await interaction.reply({
                content: '❌ You don\'t have permission to use AFK.',
                flags: 64
            });
            return;
        }

        // Remove AFK
        const wasAFK = await removeAFK(member, 'Manually removed');

        if (!wasAFK) {
            await interaction.reply({
                content: '❌ You are not currently AFK.',
                flags: 64
            });
            return;
        }

        // Confirm removal
        const embedConfig = await getEmbedConfig(interaction.guild.id);
        const embed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle('✅ AFK Status Removed!')
            .setDescription('Welcome back! Your AFK status has been removed.')
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.reply({
            embeds: [embed],
            flags: 64
        });

        await logger.log(`✅ AFK manually removed by ${member.user.tag} (${member.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error removing AFK: ${error.message}`);
        await interaction.reply({
            content: `❌ **Failed to Remove AFK**\n\nError: ${error.message}\n\nPlease try again later.`,
            flags: 64
        });
    }
}

// Initialize AFK component with event listeners
export function init(client) {
    // Remove AFK when user sends any message
    client.on('messageCreate', async (message) => {
        // Ignore bots and DMs
        if (message.author.bot || !message.guild) {
            return;
        }

        try {
            const member = message.member;
            if (!member) {
                return;
            }

            // Check if user is AFK (message sender)
            const afkData = getAFKStatus(member.id);
            if (afkData) {
                await removeAFK(member, 'Sent a message');

                // Send welcome back message
                try {
                    const welcomeMsg = await message.channel.send(`✅ Welcome back, ${member}! Your AFK status has been removed.`);
                    setTimeout(() => welcomeMsg.delete().catch(() => { }), 5000); // Auto-delete after 5 seconds
                } catch (err) {
                    // Silent fail if we can't send message
                }
            }

            // Check if message mentions any AFK users
            if (message.mentions.members && message.mentions.members.size > 0) {
                for (const [mentionedId, mentionedMember] of message.mentions.members) {
                    // Skip if mentioning self
                    if (mentionedId === member.id) {
                        continue;
                    }

                    // Check if mentioned user is AFK
                    const mentionedAFKData = getAFKStatus(mentionedId);
                    if (mentionedAFKData) {
                        try {
                            // Calculate AFK duration
                            const duration = Math.floor((Date.now() - mentionedAFKData.timestamp) / 1000);
                            const minutes = Math.floor(duration / 60);
                            const hours = Math.floor(minutes / 60);

                            let durationText = '';
                            if (hours > 0) {
                                durationText = `${hours}h ${minutes % 60}m`;
                            } else if (minutes > 0) {
                                durationText = `${minutes}m`;
                            } else {
                                durationText = `${duration}s`;
                            }

                            // Build AFK message
                            let afkMessage = `⏸️ ${mentionedMember} is currently AFK`;
                            if (mentionedAFKData.message && mentionedAFKData.message !== 'Away') {
                                afkMessage += `: **${mentionedAFKData.message}**`;
                            }
                            afkMessage += ` (for ${durationText})`;

                            // Send reply (auto-deletes after 10 seconds)
                            const afkNotice = await message.reply(afkMessage);
                            setTimeout(() => afkNotice.delete().catch(() => { }), 10000); // Auto-delete after 10 seconds

                            // DM the AFK user that they were mentioned
                            try {
                                const dmMessage = `📬 You were mentioned by ${member.user.tag} in **${message.guild.name}** (#${message.channel.name})\n\n**Message:** ${message.content.substring(0, 200)}${message.content.length > 200 ? '...' : ''}`;
                                await mentionedMember.send(dmMessage);
                            } catch (dmErr) {
                                // User might have DMs disabled, log but don't fail
                                await logger.log(`⚠️ Could not DM ${mentionedMember.user.tag} about mention: ${dmErr.message}`);
                            }
                        } catch (err) {
                            await logger.log(`⚠️ Could not send AFK notice for ${mentionedMember.user.tag}: ${err.message}`);
                        }
                    }
                }
            }
        } catch (err) {
            await logger.log(`❌ Error checking AFK in messageCreate: ${err.message}`);
        }
    });

    // Remove AFK when user unmutes in voice (only for self-mute, server mute requires bot to unmute)
    client.on('voiceStateUpdate', async (oldState, newState) => {
        // Ignore if not in a guild or if user is a bot
        if (!newState.guild || newState.member?.user.bot) {
            return;
        }

        try {
            // Check if user was self-muted and now unmuted (not server mute - users can control self-mute)
            const wasSelfMuted = oldState.mute && !oldState.serverMute;
            const isSelfUnmuted = !newState.mute && !newState.serverMute;

            // Check if user was self-deafened and now undeafened
            const wasSelfDeafened = oldState.deaf && !oldState.serverDeaf;
            const isSelfUndeafened = !newState.deaf && !newState.serverDeaf;

            if ((wasSelfMuted && isSelfUnmuted) || (wasSelfDeafened && isSelfUndeafened)) {
                // User self-unmuted or self-undeafened - check if they're AFK
                const afkData = getAFKStatus(newState.member.id);
                if (afkData) {
                    await removeAFK(newState.member, 'Self-unmuted/undeafened in voice channel');
                }
            }

            // Note: Server mute/deafen (setMute/setDeaf) can only be removed by the bot
            // So when bot mutes/deafens them for AFK, they must remove AFK to be unmuted/undeafened
            // removeAFK() function handles the unmuting/undeafening automatically
        } catch (err) {
            await logger.log(`❌ Error checking AFK in voiceStateUpdate: ${err.message}`);
        }
    });

    logger.log("⏸️ AFK component initialized - Auto-removal active");
}

export default { init };
