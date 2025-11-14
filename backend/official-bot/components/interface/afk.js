import { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getEmbedConfig, getBotConfig } from '../../../config.js';
import logger from '../../../logger.js';
import { hasPermission, getPermissionDeniedMessage } from '../permissions.js';
import db from '../../../../database/database.js';

function stripAfkPrefix(name) {
    if (!name || typeof name !== 'string') return '';
    return name.replace(/^\s*(\[AFK\]\s*)+/gi, '').trim();
}

export async function getAFKStatus(userId, guildId) {
    try {
        const botConfig = getBotConfig();
        if (!botConfig || !botConfig.id) {
            return null;
        }

        const serverData = await db.getServerByDiscordId(botConfig.id, guildId);
        if (!serverData) {
            return null;
        }

        return await db.getAFKStatus(serverData.id, userId);
    } catch (error) {
        return null;
    }
}

async function setAFK(member, message, shouldDeafen = true) {
    try {
        const botConfig = getBotConfig();
        if (!botConfig || !botConfig.id) {
            return;
        }

        const serverData = await db.getServerByDiscordId(botConfig.id, member.guild.id);
        if (!serverData) {
            return;
        }

        const userId = member.id;
        await db.upsertMember(serverData.id, member);
        const memberData = await db.getMemberByDiscordId(serverData.id, userId);
        const existingName =
            member.nickname ||
            memberData?.server_display_name ||
            memberData?.display_name ||
            member.user.globalName ||
            member.user.displayName ||
            member.user.username;
        const baseName = stripAfkPrefix(existingName) || member.user.globalName || member.user.displayName || member.user.username;
        const nameToUse = baseName || member.user.username;

        if (member.voice.channel) {
            try {
                await member.voice.setMute(true);
                await logger.log(`🔇 Muted ${member.id} in voice channel (AFK)`);
            } catch (err) {
                await logger.log(`⚠️ Could not mute ${member.id} in voice channel: ${err.message}`);
            }

            if (shouldDeafen) {
                try {
                    await member.voice.setDeaf(true);
                    await logger.log(`🔇 Deafened ${member.id} in voice channel (AFK)`);
                } catch (err) {
                    await logger.log(`⚠️ Could not deafen ${member.id} in voice channel: ${err.message}`);
                }
            }
        }

        await db.setAFKStatus(serverData.id, userId, {
            message: message || 'Away'
        });

        try {
            const newNickname = `[AFK] ${nameToUse}`;
            if (newNickname.length <= 32) {
                await member.setNickname(newNickname);
            }
            await db.upsertMember(serverData.id, member);
        } catch (err) {
            await logger.log(`⚠️ Could not update nickname for ${member.id}: ${err.message}`);
        }
    } catch (error) {
        await logger.log(`❌ Error setting AFK: ${error.message}`);
    }
}

export async function removeAFK(member, reason = '') {
    try {
        const botConfig = getBotConfig();
        if (!botConfig || !botConfig.id) {
            return false;
        }

        const serverData = await db.getServerByDiscordId(botConfig.id, member.guild.id);
        if (!serverData) {
            return false;
        }

        const userId = member.id;
        const afkData = await db.getAFKStatus(serverData.id, userId);

        if (!afkData) {
            return false;
        }

        if (member.voice.channel) {
            try {
                await member.voice.setMute(false);
                await logger.log(`🔊 Unmuted ${member.id} in voice channel (AFK removed)`);
            } catch (err) {
                await logger.log(`⚠️ Could not unmute ${member.id} in voice channel: ${err.message}`);
            }

            try {
                await member.voice.setDeaf(false);
                await logger.log(`🔊 Undeafened ${member.id} in voice channel (AFK removed)`);
            } catch (err) {
                await logger.log(`⚠️ Could not undeafen ${member.id} in voice channel: ${err.message}`);
            }
        }

        try {
            const memberData = await db.getMemberByDiscordId(serverData.id, userId);
            const storedName =
                memberData?.server_display_name ||
                memberData?.display_name ||
                member.user.globalName ||
                member.user.displayName ||
                member.user.username;
            const restoredName = stripAfkPrefix(storedName);

            if (restoredName && restoredName.length <= 32) {
                await member.setNickname(restoredName);
            } else {
                await member.setNickname(null);
            }
            await db.upsertMember(serverData.id, member);
        } catch (err) {
            try {
                await member.setNickname(null);
                await db.upsertMember(serverData.id, member);
            } catch (err2) {
                await logger.log(`⚠️ Could not restore nickname for ${member.id}: ${err2.message}`);
            }
        }

        await db.removeAFKStatus(serverData.id, userId);

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

        await logger.log(`✅ Removed AFK status for ${member.id} - Was AFK for ${durationText}${reason ? ` - ${reason}` : ''}`);

        return true;
    } catch (error) {
        await logger.log(`❌ Error removing AFK: ${error.message}`);
        return false;
    }
}

export async function handleAFKButton(interaction) {
    try {
        const member = interaction.member;

        if (!(await hasPermission(member, 'afk'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'afk');
            await interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null);
            return;
        }

        const afkData = await getAFKStatus(member.id, member.guild.id);

        if (afkData) {

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
            await logger.log(`⏸️ AFK status shown to ${member.id}`);
            return;
        }

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
        await logger.log(`⏸️ AFK modal shown to ${member.id}`);

    } catch (error) {
        await logger.log(`❌ Error showing AFK modal: ${error.message}`);
        await interaction.reply({
            content: `❌ Failed to open AFK form: ${error.message}`,
            flags: 64
        });
    }
}

export async function handleAFKModal(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        const member = interaction.member;

        if (!(await hasPermission(member, 'afk'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'afk');
            await interaction.editReply({
                content: errorMessage
            }).catch(() => null);
            return;
        }

        const afkMessage = interaction.fields.getTextInputValue('afk_message')?.trim() || 'Away';

        const deafenValue = interaction.fields.getTextInputValue('afk_deafen')?.trim().toLowerCase();
        const shouldDeafen = deafenValue !== 'no';

        await setAFK(member, afkMessage, shouldDeafen);

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

        await logger.log(`✅ AFK status set for ${member.id}: "${afkMessage}"${shouldDeafen ? ' (will be deafened)' : ' (not deafened)'}`);

    } catch (error) {
        await logger.log(`❌ Error setting AFK: ${error.message}`);
        await interaction.editReply({
            content: `❌ **Failed to Set AFK**\n\nError: ${error.message}\n\nPlease try again later.`
        });
    }
}

export async function handleRemoveAFKButton(interaction) {
    try {
        const member = interaction.member;

        if (!(await hasPermission(member, 'afk'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'afk');
            await interaction.update({
                content: errorMessage,
                components: [],
                embeds: [],
                flags: 64
            }).catch(() => interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null));
            return;
        }

        const wasAFK = await removeAFK(member, 'Manually removed');

        if (!wasAFK) {
            await interaction.reply({
                content: '❌ You are not currently AFK.',
                flags: 64
            });
            return;
        }

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

        await logger.log(`✅ AFK manually removed by ${member.id}`);

    } catch (error) {
        await logger.log(`❌ Error removing AFK: ${error.message}`);
        await interaction.reply({
            content: `❌ **Failed to Remove AFK**\n\nError: ${error.message}\n\nPlease try again later.`,
            flags: 64
        });
    }
}

export function init(client) {

    client.on('messageCreate', async (message) => {

        if (message.author.bot || !message.guild) {
            return;
        }

        try {
            const member = message.member;
            if (!member) {
                return;
            }

            const botConfig = getBotConfig();
            if (!botConfig?.id) {
                return;
            }

            const serverData = await db.getServerByDiscordId(botConfig.id, message.guild.id);
            if (!serverData) {
                return;
            }

            const senderData = await db.getMemberByDiscordId(serverData.id, member.id);
            if (!senderData) {
                await logger.log(`⚠️ Unable to notify mention for ${member.id}: sender not found in database`);
                return;
            }

            const senderDisplayName = senderData.server_display_name || senderData.display_name;
            if (!senderDisplayName) {
                await logger.log(`⚠️ Sender display name missing in database for ${member.id}, skipping AFK DM`);
                return;
            }

            const afkData = await getAFKStatus(member.id, member.guild.id);
            if (afkData) {
                await removeAFK(member, 'Sent a message');

                try {
                    const welcomeMsg = await message.channel.send(`✅ Welcome back, ${member}! Your AFK status has been removed.`);
                    setTimeout(() => welcomeMsg.delete().catch(() => { }), 5000);
                } catch (err) {

                }
            }

            if (message.mentions.members && message.mentions.members.size > 0) {
                for (const [mentionedId, mentionedMember] of message.mentions.members) {

                    if (mentionedId === member.id) {
                        continue;
                    }

                    const mentionedAFKData = await getAFKStatus(mentionedId, member.guild.id);
                    if (mentionedAFKData) {
                        try {

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

                            let afkMessage = `⏸️ ${mentionedMember} is currently AFK`;
                            if (mentionedAFKData.message && mentionedAFKData.message !== 'Away') {
                                afkMessage += `: **${mentionedAFKData.message}**`;
                            }
                            afkMessage += ` (for ${durationText})`;

                            const afkNotice = await message.reply(afkMessage);
                            setTimeout(() => afkNotice.delete().catch(() => { }), 10000);

                            try {
                                const dmMessage = `📬 You were mentioned by ${senderDisplayName} in **${message.guild.name}** (#${message.channel.name})\n\n**Message:** ${message.content.substring(0, 200)}${message.content.length > 200 ? '...' : ''}`;
                                await mentionedMember.send(dmMessage);
                            } catch (dmErr) {
                                await logger.log(`⚠️ Could not DM ${mentionedMember.id} about mention: ${dmErr.message}`);
                            }
                        } catch (err) {
                            await logger.log(`⚠️ Could not send AFK notice for ${mentionedMember.id}: ${err.message}`);
                        }
                    }
                }
            }
        } catch (err) {
            await logger.log(`❌ Error checking AFK in messageCreate: ${err.message}`);
        }
    });

    client.on('voiceStateUpdate', async (oldState, newState) => {

        if (!newState.guild || newState.member?.user.bot) {
            return;
        }

        try {

            const wasSelfMuted = oldState.mute && !oldState.serverMute;
            const isSelfUnmuted = !newState.mute && !newState.serverMute;

            const wasSelfDeafened = oldState.deaf && !oldState.serverDeaf;
            const isSelfUndeafened = !newState.deaf && !newState.serverDeaf;

            if ((wasSelfMuted && isSelfUnmuted) || (wasSelfDeafened && isSelfUndeafened)) {

                const afkData = await getAFKStatus(newState.member.id, newState.guild.id);
                if (afkData) {
                    await removeAFK(newState.member, 'Self-unmuted/undeafened in voice channel');
                }
            }



        } catch (err) {
            await logger.log(`❌ Error checking AFK in voiceStateUpdate: ${err.message}`);
        }
    });

    logger.log("⏸️ AFK component initialized - Auto-removal active");
}

export default { init };
