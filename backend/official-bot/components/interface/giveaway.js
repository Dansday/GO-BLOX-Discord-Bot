import { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, EmbedBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder } from 'discord.js';
import { getEmbedConfig, GIVEAWAY, getServerForCurrentBot } from '../../../config.js';
import logger from '../../../logger.js';
import { hasPermission, getPermissionDeniedMessage } from '../permissions.js';
import db from '../../../../database/database.js';

const pendingGiveawayRoles = new Map();

export async function handleGiveawayButton(interaction) {
    try {
        const member = interaction.member;
        const guild = interaction.guild;

        if (!(await hasPermission(member, 'giveaway'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'giveaway');
            await interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(() => null);
            return;
        }

        const embedConfig = await getEmbedConfig(guild.id);

        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId('giveaway_role_select')
            .setPlaceholder('Select roles that can enter (optional)...')
            .setMinValues(0)
            .setMaxValues(25);

        const continueButton = new ButtonBuilder()
            .setCustomId('giveaway_continue_form')
            .setLabel('Continue to Form')
            .setStyle(ButtonStyle.Primary);

        const roleSelectRow = new ActionRowBuilder().addComponents(roleSelect);
        const buttonRow = new ActionRowBuilder().addComponents(continueButton);

        const roleSelectEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle('🎉 Create Giveaway')
            .setDescription('**Step 1 of 2: Select Roles (Optional)**\n\nSelect roles that can enter this giveaway from the dropdown below. Leave empty or click "Continue to Form" to allow all roles.')
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.reply({
            embeds: [roleSelectEmbed],
            components: [roleSelectRow, buttonRow],
            flags: 64
        });

        await logger.log(`🎉 Giveaway role selector shown to ${member.user.tag} (${member.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error showing giveaway role selector: ${error.message}`);
        await interaction.reply({
            content: `❌ Failed to open giveaway form: ${error.message}`,
            flags: 64
        });
    }
}

export async function handleGiveawayRoleSelect(interaction) {
    try {
        if (!(await hasPermission(interaction.member, 'giveaway'))) {
            return;
        }

        const selectedRoles = interaction.values;
        const userId = interaction.user.id;

        pendingGiveawayRoles.set(userId, selectedRoles.length > 0 ? selectedRoles : null);

        await logger.log(`🔍 Role selection: ${selectedRoles.length} roles selected for giveaway by ${interaction.user.tag}`);

        const modal = new ModalBuilder()
            .setCustomId(`giveaway_create_${selectedRoles.length > 0 ? selectedRoles.join('_') : 'none'}`)
            .setTitle('🎉 Create Giveaway');

        const titleInput = new TextInputBuilder()
            .setCustomId('giveaway_title')
            .setLabel('Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter giveaway title...')
            .setRequired(true)
            .setMaxLength(256);

        const prizeInput = new TextInputBuilder()
            .setCustomId('giveaway_prize')
            .setLabel('Prize')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('What is the prize?')
            .setRequired(true)
            .setMaxLength(2000);

        const durationInput = new TextInputBuilder()
            .setCustomId('giveaway_duration')
            .setLabel('Duration (minutes)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., 60 for 1 hour, 1440 for 1 day')
            .setRequired(true)
            .setMaxLength(10);

        const winnerCountInput = new TextInputBuilder()
            .setCustomId('giveaway_winner_count')
            .setLabel('Number of Winners')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('How many winners? (default: 1)')
            .setRequired(false)
            .setMaxLength(3);

        const multipleEntriesInput = new TextInputBuilder()
            .setCustomId('giveaway_multiple_entries')
            .setLabel('Multiple Entries Allowed? (yes/no)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('yes or no (default: no)')
            .setRequired(false)
            .setMaxLength(3);

        const titleRow = new ActionRowBuilder().addComponents(titleInput);
        const prizeRow = new ActionRowBuilder().addComponents(prizeInput);
        const durationRow = new ActionRowBuilder().addComponents(durationInput);
        const winnerCountRow = new ActionRowBuilder().addComponents(winnerCountInput);
        const multipleEntriesRow = new ActionRowBuilder().addComponents(multipleEntriesInput);

        modal.addComponents(titleRow, prizeRow, durationRow, winnerCountRow, multipleEntriesRow);

        await interaction.showModal(modal);
        await logger.log(`🎉 Giveaway modal shown to ${interaction.user.tag} (${interaction.user.id}) with roles: ${selectedRoles.length > 0 ? selectedRoles.join(', ') : 'none'}`);

    } catch (error) {
        await logger.log(`❌ Role selection error: ${error.message}`);
        await logger.log(`❌ Role selection error stack: ${error.stack}`);
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: `❌ Failed to process role selection: ${error.message}`,
                    flags: 64
                });
            } else {
                await interaction.reply({
                    content: `❌ Failed to process role selection: ${error.message}`,
                    flags: 64
                });
            }
        } catch (err) {
            await logger.log(`❌ Failed to send error message: ${err.message}`);
        }
    }
}

export async function handleGiveawaySkipRolesContinue(interaction) {
    try {
        const userId = interaction.user.id;
        pendingGiveawayRoles.set(userId, null);

        const modal = new ModalBuilder()
            .setCustomId('giveaway_create_none')
            .setTitle('🎉 Create Giveaway');

        const titleInput = new TextInputBuilder()
            .setCustomId('giveaway_title')
            .setLabel('Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter giveaway title...')
            .setRequired(true)
            .setMaxLength(256);

        const prizeInput = new TextInputBuilder()
            .setCustomId('giveaway_prize')
            .setLabel('Prize')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('What is the prize?')
            .setRequired(true)
            .setMaxLength(2000);

        const durationInput = new TextInputBuilder()
            .setCustomId('giveaway_duration')
            .setLabel('Duration (minutes)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., 60 for 1 hour, 1440 for 1 day')
            .setRequired(true)
            .setMaxLength(10);

        const winnerCountInput = new TextInputBuilder()
            .setCustomId('giveaway_winner_count')
            .setLabel('Number of Winners')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('How many winners? (default: 1)')
            .setRequired(false)
            .setMaxLength(3);

        const multipleEntriesInput = new TextInputBuilder()
            .setCustomId('giveaway_multiple_entries')
            .setLabel('Multiple Entries Allowed? (yes/no)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('yes or no (default: no)')
            .setRequired(false)
            .setMaxLength(3);

        const titleRow = new ActionRowBuilder().addComponents(titleInput);
        const prizeRow = new ActionRowBuilder().addComponents(prizeInput);
        const durationRow = new ActionRowBuilder().addComponents(durationInput);
        const winnerCountRow = new ActionRowBuilder().addComponents(winnerCountInput);
        const multipleEntriesRow = new ActionRowBuilder().addComponents(multipleEntriesInput);

        modal.addComponents(titleRow, prizeRow, durationRow, winnerCountRow, multipleEntriesRow);

        await interaction.showModal(modal);
        await logger.log(`🎉 Giveaway modal shown to ${interaction.user.tag} (${interaction.user.id})`);

    } catch (error) {
        await logger.log(`❌ Error showing giveaway modal: ${error.message}`);
        await interaction.reply({
            content: `❌ Failed to open giveaway form: ${error.message}`,
            flags: 64
        });
    }
}

export async function handleGiveawayModal(interaction) {
    try {
        await interaction.deferReply({ flags: 64 });

        const guild = interaction.guild;
        const user = interaction.user;
        const member = interaction.member;

        if (!(await hasPermission(member, 'giveaway'))) {
            const errorMessage = await getPermissionDeniedMessage(interaction.guild, 'giveaway');
            await interaction.editReply({
                content: errorMessage
            }).catch(() => null);
            return;
        }

        const title = interaction.fields.getTextInputValue('giveaway_title').trim();
        const prize = interaction.fields.getTextInputValue('giveaway_prize').trim();
        const durationStr = interaction.fields.getTextInputValue('giveaway_duration').trim();
        const winnerCountStr = interaction.fields.getTextInputValue('giveaway_winner_count').trim() || '1';
        const multipleEntriesStr = interaction.fields.getTextInputValue('giveaway_multiple_entries').trim().toLowerCase() || 'no';

        if (!title || title.length === 0) {
            await interaction.editReply({
                content: '❌ **Invalid Giveaway**\n\nTitle cannot be empty.'
            });
            return;
        }

        if (!prize || prize.length === 0) {
            await interaction.editReply({
                content: '❌ **Invalid Giveaway**\n\nPrize cannot be empty.'
            });
            return;
        }

        const duration = parseInt(durationStr);
        if (isNaN(duration) || duration <= 0) {
            await interaction.editReply({
                content: '❌ **Invalid Giveaway**\n\nDuration must be a positive number (in minutes).'
            });
            return;
        }

        const winnerCount = parseInt(winnerCountStr) || 1;
        if (isNaN(winnerCount) || winnerCount <= 0) {
            await interaction.editReply({
                content: '❌ **Invalid Giveaway**\n\nWinner count must be a positive number.'
            });
            return;
        }

        const multipleEntriesAllowed = multipleEntriesStr === 'yes' || multipleEntriesStr === 'y' || multipleEntriesStr === 'true';

        // Get roles from customId
        let allowedRoles = null;
        if (interaction.customId.startsWith('giveaway_create_')) {
            const customIdParts = interaction.customId.replace('giveaway_create_', '').split('_');
            if (customIdParts[0] && customIdParts[0] !== 'none' && customIdParts[0].length > 0) {
                allowedRoles = customIdParts.filter(id => id && id !== 'none' && id.length > 0);
            }
        }
        // If customId is just 'giveaway_create', allowedRoles stays null (all roles allowed)

        let giveawayChannelId;
        try {
            giveawayChannelId = await GIVEAWAY.getChannel(guild.id);
        } catch (err) {
            await logger.log(`❌ Error getting giveaway channel: ${err.message}`);
            await interaction.editReply({
                content: '❌ Failed to create giveaway: Error retrieving giveaway channel configuration.'
            });
            return;
        }

        if (!giveawayChannelId) {
            await logger.log(`❌ Giveaway channel not configured for server ${guild.id}`);
            await interaction.editReply({
                content: '❌ Failed to create giveaway: Giveaway channel not configured. Please configure it in the panel.'
            });
            return;
        }

        const giveawayChannel = guild.channels.cache.get(giveawayChannelId);
        if (!giveawayChannel) {
            await logger.log(`❌ Giveaway channel not found: ${giveawayChannelId}`);
            await interaction.editReply({
                content: '❌ Failed to create giveaway: Giveaway channel not found.'
            });
            return;
        }

        const server = await getServerForCurrentBot(guild.id);
        const embedConfig = await getEmbedConfig(guild.id);

        // Get or create member in database
        let dbMember = await db.getMemberByDiscordId(server.id, user.id);
        if (!dbMember) {
            // Create member if doesn't exist
            dbMember = await db.upsertMember(server.id, {
                id: user.id,
                username: user.username,
                display_name: user.displayName || user.username,
                avatar: user.avatar
            });
        }

        if (!dbMember || !dbMember.id) {
            await interaction.editReply({
                content: '❌ Failed to create giveaway: Could not retrieve member information.'
            });
            return;
        }

        const endsAt = new Date(Date.now() + duration * 60 * 1000);
        const endsAtTimestamp = Math.floor(endsAt.getTime() / 1000);

        const giveawayData = {
            server_id: server.id,
            member_id: dbMember.id,
            title: title,
            prize: prize,
            duration_minutes: duration,
            allowed_roles: allowedRoles,
            multiple_entries_allowed: multipleEntriesAllowed,
            winner_count: winnerCount
        };

        const giveaway = await db.createGiveaway(giveawayData);

        const roleRestrictionText = allowedRoles && allowedRoles.length > 0
            ? allowedRoles.map(roleId => {
                const role = guild.roles.cache.get(roleId);
                return role ? `<@&${roleId}>` : `Role ${roleId}`;
            }).join(', ')
            : 'None (All roles)';

        const giveawayEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(`🎉 ${title}`)
            .setDescription(`**Prize:** ${prize}\n\n**Duration:** <t:${endsAtTimestamp}:R> (<t:${endsAtTimestamp}:F>)\n**Winners:** ${winnerCount}\n**Multiple Entries:** ${multipleEntriesAllowed ? 'Yes' : 'No'}\n**Role Restrictions:** ${roleRestrictionText}`)
            .addFields([
                {
                    name: '👤 Hosted by',
                    value: `<@${user.id}>`,
                    inline: true
                },
                {
                    name: '⏰ Ends',
                    value: `<t:${endsAtTimestamp}:R>`,
                    inline: true
                }
            ])
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        const enterButton = new ButtonBuilder()
            .setCustomId(`giveaway_enter_${giveaway.id}`)
            .setLabel('🎉 Enter Giveaway')
            .setStyle(ButtonStyle.Success);

        const enterButtonRow = new ActionRowBuilder().addComponents(enterButton);

        const message = await giveawayChannel.send({
            embeds: [giveawayEmbed],
            components: [enterButtonRow]
        });

        await db.updateGiveawayMessageId(giveaway.id, message.id);

        const successEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle('✅ Giveaway Created!')
            .setDescription(`Your giveaway has been created and posted in ${giveawayChannel}!`)
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.editReply({
            embeds: [successEmbed],
            components: []
        });

        await logger.log(`✅ Giveaway created by ${user.tag} (${user.id}) - ID: ${giveaway.id}`);

    } catch (error) {
        await logger.log(`❌ Error processing giveaway: ${error.message}`);
        await logger.log(`❌ Stack: ${error.stack}`);
        await interaction.editReply({
            content: `❌ **Failed to Create Giveaway**\n\nError: ${error.message}\n\nPlease try again later.`
        });
    }
}


export async function handleGiveawayEnterButton(interaction) {
    try {
        const customId = interaction.customId;
        if (!customId.startsWith('giveaway_enter_')) {
            return;
        }

        await interaction.deferReply({ flags: 64 });

        const member = interaction.member;
        const guild = interaction.guild;
        const user = interaction.user;
        const message = interaction.message;

        if (!message || !message.embeds || message.embeds.length === 0) {
            await interaction.editReply({
                content: '❌ Invalid giveaway message.'
            });
            return;
        }

        const giveawayIdStr = customId.replace('giveaway_enter_', '');
        const giveawayId = parseInt(giveawayIdStr);

        if (isNaN(giveawayId)) {
            await interaction.editReply({
                content: '❌ Invalid giveaway ID.'
            });
            return;
        }

        const server = await getServerForCurrentBot(guild.id);
        const giveaway = await db.getGiveawayById(giveawayId);

        if (!giveaway || giveaway.server_id !== server.id) {
            await interaction.editReply({
                content: '❌ Giveaway not found or has already ended.'
            });
            return;
        }

        if (giveaway.status !== 'active') {
            await interaction.editReply({
                content: '❌ This giveaway has already ended.'
            });
            return;
        }

        const endsAt = new Date(giveaway.ends_at);
        if (endsAt <= new Date()) {
            await interaction.editReply({
                content: '❌ This giveaway has already ended.'
            });
            return;
        }

        // Check role restrictions (only if allowed_roles is not null and has values)
        if (giveaway.allowed_roles !== null && Array.isArray(giveaway.allowed_roles) && giveaway.allowed_roles.length > 0) {
            const memberRoles = member.roles.cache.map(role => role.id);
            const hasAllowedRole = giveaway.allowed_roles.some(roleId => memberRoles.includes(roleId));

            if (!hasAllowedRole) {
                const roleMentions = giveaway.allowed_roles.map(roleId => {
                    const role = guild.roles.cache.get(roleId);
                    return role ? `<@&${roleId}>` : `Role ${roleId}`;
                }).join(', ');

                await interaction.editReply({
                    content: `❌ **Role Restriction**\n\nThis giveaway is restricted to the following roles:\n${roleMentions}\n\nYou need at least one of these roles to enter.`
                });
                return;
            }
        }

        const dbMember = await db.getMemberByDiscordId(server.id, user.id);
        if (!dbMember) {
            await interaction.editReply({
                content: '❌ Member not found in database. Please try again later.'
            });
            return;
        }

        // Prevent creator from entering their own giveaway
        if (giveaway.member_id === dbMember.id) {
            await interaction.editReply({
                content: '❌ You cannot enter your own giveaway!'
            });
            return;
        }

        const entries = await db.getGiveawayEntries(giveaway.id);
        const existingEntry = entries.find(e => e.member_id === dbMember.id);

        if (existingEntry && !giveaway.multiple_entries_allowed) {
            await interaction.editReply({
                content: '❌ You have already entered this giveaway!'
            });
            return;
        }

        await db.addGiveawayEntry(giveaway.id, dbMember.id, user.id, giveaway.multiple_entries_allowed);

        const embedConfig = await getEmbedConfig(guild.id);
        const successEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle('✅ Entered Giveaway!')
            .setDescription('You have successfully entered the giveaway! Good luck! 🍀')
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.editReply({
            embeds: [successEmbed]
        });

        await logger.log(`✅ ${user.tag} (${user.id}) entered giveaway ${giveaway.id}`);

    } catch (error) {
        await logger.log(`❌ Error processing giveaway entry: ${error.message}`);
        await interaction.editReply({
            content: `❌ **Failed to Enter Giveaway**\n\nError: ${error.message}`
        }).catch(() => null);
    }
}

export function init(client) {
    setInterval(async () => {
        try {
            const endedGiveaways = await db.getEndedGiveaways();

            for (const giveaway of endedGiveaways) {
                try {
                    const server = await db.getServer(giveaway.server_id);
                    if (!server) continue;

                    const guild = client.guilds.cache.get(server.discord_server_id);
                    if (!guild) continue;

                    let giveawayChannelId;
                    try {
                        giveawayChannelId = await GIVEAWAY.getChannel(guild.id);
                    } catch (err) {
                        await logger.log(`❌ Error getting giveaway channel for server ${server.id}: ${err.message}`);
                        continue;
                    }

                    if (!giveawayChannelId) {
                        await logger.log(`⚠️ Giveaway channel not configured for server ${server.id}, skipping giveaway ${giveaway.id}`);
                        continue;
                    }

                    const channel = guild.channels.cache.get(giveawayChannelId);
                    if (!channel) {
                        await logger.log(`⚠️ Giveaway channel ${giveawayChannelId} not found in guild ${guild.id}, skipping giveaway ${giveaway.id}`);
                        continue;
                    }

                    const message = await channel.messages.fetch(giveaway.discord_message_id).catch(() => null);
                    if (!message) continue;

                    const entries = await db.getGiveawayEntries(giveaway.id);

                    if (entries.length === 0) {
                        // Remove enter button from original message
                        await message.edit({
                            components: []
                        });

                        // Send new message for no entries
                        const embedConfig = await getEmbedConfig(guild.id);
                        const noEntriesEmbed = new EmbedBuilder()
                            .setColor(embedConfig.COLOR)
                            .setTitle('🎉 Giveaway Ended')
                            .setDescription(`**${giveaway.title}**\n\n❌ No entries! The giveaway has ended with no participants.`)
                            .setTimestamp()
                            .setFooter({ text: embedConfig.FOOTER });

                        await channel.send({
                            embeds: [noEntriesEmbed]
                        });

                        await db.markGiveawayEnded(giveaway.id);

                        // Cleanup entries (should be 0 but cleanup anyway)
                        await db.cleanupGiveawayEntries(giveaway.id);
                        await logger.log(`✅ Giveaway ${giveaway.id} ended with no entries`);
                        continue;
                    }

                    const winners = await db.getRandomGiveawayWinners(giveaway.id, giveaway.winner_count);

                    if (winners.length === 0) {
                        // Remove enter button from original message
                        await message.edit({
                            components: []
                        });

                        // Send new message for no winners
                        const embedConfig = await getEmbedConfig(guild.id);
                        const noWinnersEmbed = new EmbedBuilder()
                            .setColor(embedConfig.COLOR)
                            .setTitle('🎉 Giveaway Ended')
                            .setDescription(`**${giveaway.title}**\n\n❌ Could not select winners.`)
                            .setTimestamp()
                            .setFooter({ text: embedConfig.FOOTER });

                        await channel.send({
                            embeds: [noWinnersEmbed]
                        });

                        await db.markGiveawayEnded(giveaway.id);

                        // Cleanup entries after giveaway ends
                        const deletedEntries = await db.cleanupGiveawayEntries(giveaway.id);
                        await logger.log(`✅ Giveaway ${giveaway.id} ended but no winners could be selected - Cleaned up ${deletedEntries} entries`);
                        continue;
                    }

                    const winnerMentions = winners.map(w => `<@${w.discord_member_id}>`).join(', ');
                    const embedConfig = await getEmbedConfig(guild.id);

                    let description = `**${giveaway.title}**\n\n**Prize:** ${giveaway.prize}\n\n🎊 **Winner${winners.length > 1 ? 's' : ''}:** ${winnerMentions}\n\n`;

                    if (winners.length < giveaway.winner_count) {
                        description += `⚠️ *Only ${winners.length} winner${winners.length > 1 ? 's' : ''} selected (${giveaway.winner_count} requested) due to limited entries.*\n\n`;
                    }

                    description += `Congratulations! 🎉`;

                    const winnersEmbed = new EmbedBuilder()
                        .setColor(embedConfig.COLOR)
                        .setTitle('🎉 Giveaway Ended!')
                        .setDescription(description)
                        .setTimestamp()
                        .setFooter({ text: embedConfig.FOOTER });

                    // Remove enter button from original message (keep original embed unchanged)
                    await message.edit({
                        components: []
                    });

                    // Send new message for winners announcement
                    await channel.send({
                        embeds: [winnersEmbed]
                    });

                    await db.markGiveawayEnded(giveaway.id);

                    // Cleanup entries after winners are announced
                    const deletedEntries = await db.cleanupGiveawayEntries(giveaway.id);
                    await logger.log(`✅ Giveaway ${giveaway.id} ended - Winners: ${winners.map(w => w.discord_member_id).join(', ')} - Cleaned up ${deletedEntries} entries`);

                } catch (err) {
                    await logger.log(`❌ Error ending giveaway ${giveaway.id}: ${err.message}`);
                }
            }
        } catch (error) {
            await logger.log(`❌ Error checking ended giveaways: ${error.message}`);
        }
    }, 60000);

    logger.log("🎉 Giveaway component initialized - Checking for ended giveaways every minute");
}

export default { init };
