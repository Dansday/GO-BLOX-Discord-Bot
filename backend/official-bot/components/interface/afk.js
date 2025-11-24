import { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getEmbedConfig, getBotConfig } from '../../../config.js';
import logger from '../../../logger.js';
import { hasPermission, getPermissionDeniedMessage } from '../permissions.js';
import db from '../../../../database/database.js';
import { translate } from '../../../i18n.js';

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

            const removeButtonLabel = await translate('afk.buttons.remove', interaction.guild.id, interaction.user.id);
            const removeButton = new ButtonBuilder()
                .setCustomId('afk_remove')
                .setLabel(removeButtonLabel)
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
            const currentTitle = await translate('afk.current.title', interaction.guild.id, interaction.user.id);
            const currentDescription = await translate('afk.current.description', interaction.guild.id, interaction.user.id, { message: afkData.message, duration: durationText });
            const howToRemoveName = await translate('afk.current.howToRemove', interaction.guild.id, interaction.user.id);
            const howToRemoveValue = await translate('afk.current.howToRemoveValue', interaction.guild.id, interaction.user.id);
            const embed = new EmbedBuilder()
                .setColor(embedConfig.COLOR)
                .setTitle(currentTitle)
                .setDescription(currentDescription)
                .addFields({
                    name: howToRemoveName,
                    value: howToRemoveValue,
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

        const modalTitle = await translate('afk.title', interaction.guild.id, interaction.user.id);
        const modal = new ModalBuilder()
            .setCustomId('afk_set')
            .setTitle(modalTitle);

        const messageLabel = await translate('afk.modal.messageLabel', interaction.guild.id, interaction.user.id);
        const messagePlaceholder = await translate('afk.modal.messagePlaceholder', interaction.guild.id, interaction.user.id);
        const messageInput = new TextInputBuilder()
            .setCustomId('afk_message')
            .setLabel(messageLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(messagePlaceholder)
            .setRequired(false)
            .setMaxLength(100);

        const deafenLabel = await translate('afk.modal.deafenLabel', interaction.guild.id, interaction.user.id);
        const deafenPlaceholder = await translate('afk.modal.deafenPlaceholder', interaction.guild.id, interaction.user.id);
        const deafenInput = new TextInputBuilder()
            .setCustomId('afk_deafen')
            .setLabel(deafenLabel)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(deafenPlaceholder)
            .setRequired(false)
            .setMaxLength(3);

        const messageRow = new ActionRowBuilder().addComponents(messageInput);
        const deafenRow = new ActionRowBuilder().addComponents(deafenInput);
        modal.addComponents(messageRow, deafenRow);

        await interaction.showModal(modal);
        await logger.log(`⏸️ AFK modal shown to ${member.id}`);

    } catch (error) {
        await logger.log(`❌ Error showing AFK modal: ${error.message}`);
        const errorMsg = await translate('afk.errors.failed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.reply({
            content: errorMsg,
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

        let voiceInfo = '';
        if (member.voice.channel) {
            if (shouldDeafen) {
                voiceInfo = await translate('afk.set.voiceMutedDeafened', interaction.guild.id, interaction.user.id);
            } else {
                voiceInfo = await translate('afk.set.voiceMutedOnly', interaction.guild.id, interaction.user.id);
            }
        }

        const embedConfig = await getEmbedConfig(interaction.guild.id);
        const setTitle = await translate('afk.set.title', interaction.guild.id, interaction.user.id);
        const setDescription = await translate('afk.set.description', interaction.guild.id, interaction.user.id, { message: afkMessage, voiceInfo });
        const howToRemoveName = await translate('afk.set.howToRemove', interaction.guild.id, interaction.user.id);
        const howToRemoveValue = await translate('afk.set.howToRemoveValue', interaction.guild.id, interaction.user.id);
        const embed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(setTitle)
            .setDescription(setDescription)
            .addFields({
                name: howToRemoveName,
                value: howToRemoveValue,
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
        const errorMsg = await translate('afk.errors.setFailed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.editReply({
            content: errorMsg
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
            const errorMsg = await translate('afk.errors.notAFK', interaction.guild.id, interaction.user.id);
            await interaction.reply({
                content: errorMsg,
                flags: 64
            });
            return;
        }

        const embedConfig = await getEmbedConfig(interaction.guild.id);
        const removedTitle = await translate('afk.removed.title', interaction.guild.id, interaction.user.id);
        const removedDescription = await translate('afk.removed.description', interaction.guild.id, interaction.user.id);
        const embed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(removedTitle)
            .setDescription(removedDescription)
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.reply({
            embeds: [embed],
            flags: 64
        });

        await logger.log(`✅ AFK manually removed by ${member.id}`);

    } catch (error) {
        await logger.log(`❌ Error removing AFK: ${error.message}`);
        const errorMsg = await translate('afk.errors.removeFailed', interaction.guild.id, interaction.user.id, { error: error.message });
        await interaction.reply({
            content: errorMsg,
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
                    const welcomeMsgText = await translate('afk.messages.welcomeBack', member.guild.id, member.id, { member: member.toString() });
                    const welcomeMsg = await message.channel.send(welcomeMsgText);
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

                            let afkMessage;
                            if (mentionedAFKData.message && mentionedAFKData.message !== 'Away') {
                                afkMessage = `⏸️ ${mentionedMember.toString()} is currently AFK: **${mentionedAFKData.message}** (for ${durationText})`;
                            } else {
                                afkMessage = `⏸️ ${mentionedMember.toString()} is currently AFK (for ${durationText})`;
                            }

                            const afkNotice = await message.reply(afkMessage);
                            setTimeout(() => afkNotice.delete().catch(() => { }), 10000);

                            try {
                                const dmMessageText = await translate('afk.messages.dmMentioned', member.guild.id, mentionedMember.id, { 
                                    sender: senderDisplayName, 
                                    server: message.guild.name, 
                                    channel: message.channel.name,
                                    message: message.content.substring(0, 200) + (message.content.length > 200 ? '...' : '')
                                });
                                await mentionedMember.send(dmMessageText);
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
