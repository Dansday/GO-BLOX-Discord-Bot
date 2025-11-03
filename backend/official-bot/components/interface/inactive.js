import { EmbedBuilder } from 'discord.js';
import { getEmbedConfig, ACTIVITY_TRACKER } from '../../../config.js';
import logger from '../../../logger.js';
import { hasPermission } from '../permissions.js';

// Get all members who never chatted or haven't chatted in the configured inactivity period
async function getNeverChattedMembers(guild) {
    const neverChattedMembers = [];

    // Fetch all members
    await guild.members.fetch();

    // Allowed categories from config
    const allowedCategories = ACTIVITY_TRACKER.ALLOWED_CATEGORIES;

    // Get all text channels and voice channel text channels in allowed categories
    const channelsToSearch = Array.from(guild.channels.cache.filter(channel => {
        // Must be in allowed categories
        if (!channel.parentId || !allowedCategories.includes(channel.parentId)) {
            return false;
        }

        // Include text-based channels (text, voice text, announcement)
        // Exclude threads
        return channel.isTextBased() && !channel.isThread();
    }).values());

    // Calculate inactivity threshold from config
    const now = Date.now();
    const inactivityDays = ACTIVITY_TRACKER.INACTIVITY_DAYS;
    const inactivityThreshold = now - (inactivityDays * 24 * 60 * 60 * 1000);

    // Track last message timestamp for each member (within inactivity threshold)
    const memberLastMessage = new Map();

    logger.log(`🔍 Searching through ${channelsToSearch.length} channels in categories ${allowedCategories.join(', ')} for messages in the last ${inactivityDays} days...`);

    let totalRequests = 0;
    let totalMessagesProcessed = 0;

    // Search through all channels, going back based on inactivity threshold
    for (let channelIndex = 0; channelIndex < channelsToSearch.length; channelIndex++) {
        const channel = channelsToSearch[channelIndex];
        try {
            let lastMessageId = null;
            let hasMoreMessages = true;
            let channelRequests = 0;
            let channelMessagesProcessed = 0;

            logger.log(`📡 Channel ${channelIndex + 1}/${channelsToSearch.length}: Starting search in #${channel.name}...`);

            // Keep fetching messages until we go back past inactivity threshold or run out
            // Note: Discord API allows max 100 messages per request, so we paginate
            // We fetch 100, then fetch next 100, and so on until we cover all inactivity period
            while (hasMoreMessages) {
                const options = { limit: 100 }; // Discord's maximum per request
                if (lastMessageId) {
                    options.before = lastMessageId; // Fetch older messages
                }

                totalRequests++;
                channelRequests++;
                logger.log(`  → Request #${totalRequests} for #${channel.name} (Channel request #${channelRequests})`);

                const messages = await channel.messages.fetch(options);

                if (messages.size === 0) {
                    hasMoreMessages = false;
                    logger.log(`  ✓ Finished #${channel.name}: No more messages (${channelRequests} requests, ${channelMessagesProcessed} messages processed)`);
                    break;
                }

                channelMessagesProcessed += messages.size;
                totalMessagesProcessed += messages.size;

                // Process messages in this batch
                let foundAnyInRange = false;
                for (const message of messages.values()) {
                    // If message is older than inactivity threshold, stop fetching from this channel
                    if (message.createdTimestamp < inactivityThreshold) {
                        hasMoreMessages = false;
                        logger.log(`  ✓ Finished #${channel.name}: Reached ${inactivityDays}-day limit (${channelRequests} requests, ${channelMessagesProcessed} messages processed)`);
                        break;
                    }

                    foundAnyInRange = true;

                    if (!message.author.bot && message.member) {
                        const userId = message.author.id;
                        const existingTimestamp = memberLastMessage.get(userId);

                        // Keep the most recent message timestamp
                        if (!existingTimestamp || message.createdTimestamp > existingTimestamp) {
                            memberLastMessage.set(userId, message.createdTimestamp);
                        }
                    }

                    // Update lastMessageId for next fetch
                    lastMessageId = message.id;
                }

                // If no messages in range, stop
                if (!foundAnyInRange) {
                    hasMoreMessages = false;
                    logger.log(`  ✓ Finished #${channel.name}: No messages in range (${channelRequests} requests, ${channelMessagesProcessed} messages processed)`);
                }

                // Log progress every 5 requests
                if (channelRequests % 5 === 0 && hasMoreMessages) {
                    logger.log(`  ⏳ #${channel.name} progress: ${channelRequests} requests, ${channelMessagesProcessed} messages processed...`);
                }

                // Small delay to avoid rate limits
                if (hasMoreMessages) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            if (channelRequests > 0) {
                logger.log(`✅ Completed #${channel.name}: ${channelRequests} requests, ${channelMessagesProcessed} messages`);
            }
        } catch (error) {
            logger.log(`⚠️ Could not fetch messages from ${channel.name}: ${error.message}`);
        }
    }

    logger.log(`✅ Finished searching. Found activity for ${memberLastMessage.size} members.`);
    logger.log(`📊 Request Summary: ${totalRequests} total API requests made, ${totalMessagesProcessed} messages processed across ${channelsToSearch.length} channels`);

    // Rate limit warning (Discord allows ~50 requests per second, but we're being conservative)
    if (totalRequests > 100) {
        logger.log(`⚠️ Warning: Made ${totalRequests} requests. Discord rate limit is ~50/sec. If this is slow, consider reducing channel count.`);
    }

    // Find members who never chatted OR chatted more than inactivity threshold ago
    for (const [userId, member] of guild.members.cache) {
        if (member.user.bot) continue;

        const lastMessageTime = memberLastMessage.get(userId);

        // Never chatted OR chatted more than inactivity threshold ago
        if (!lastMessageTime || lastMessageTime < inactivityThreshold) {
            neverChattedMembers.push({
                member,
                lastChatTime: lastMessageTime || member.user.createdTimestamp,
                neverChatted: !lastMessageTime
            });
        }
    }

    return neverChattedMembers;
}

// Handle inactive button - directly searches all channels
export async function handleInactiveButton(interaction, client) {
    try {
        // Check permissions (Admin and Staff only)
        if (!(await hasPermission(interaction.member, 'inactive'))) {
            await interaction.reply({
                content: '❌ You don\'t have permission to view this list. Admin or Staff role required.',
                flags: 64
            });
            return;
        }

        await interaction.deferReply({ flags: 64 });

        const guild = interaction.guild;

        const inactivityDays = ACTIVITY_TRACKER.INACTIVITY_DAYS;
        const months = Math.floor(inactivityDays / 30);

        // Show loading message
        await interaction.editReply({
            content: `🔍 **Searching message history in all channels (last ${inactivityDays} days${months >= 3 ? ` / ${months} months` : ''})...**\nThis may take a moment...`
        });

        const results = await getNeverChattedMembers(guild);

        if (results.length === 0) {
            await interaction.editReply({
                content: `✅ **No Members Found**\n\nAll members have sent a message in the last ${inactivityDays} days${months >= 3 ? ` (${months} months)` : ''}!`
            });
            return;
        }

        // Calculate days since last chat
        const now = Date.now();
        let memberList = '';

        for (const { member, lastChatTime, neverChatted } of results) {
            const daysSince = Math.floor((now - lastChatTime) / (24 * 60 * 60 * 1000));

            const memberLine = neverChatted
                ? `• ${member.user.tag} (<@${member.user.id}>) - Never chatted\n`
                : `• ${member.user.tag} (<@${member.user.id}>) - ${daysSince} days ago\n`;

            if ((memberList + memberLine).length > 2000) {
                break;
            }
            memberList += memberLine;
        }

        const embedConfig = await getEmbedConfig(interaction.guild.id);
        const inactiveEmbed = new EmbedBuilder()
            .setColor(embedConfig.COLOR)
            .setTitle(`📊 Members Who Never/No Recent Chat (${results.length} total)`)
            .setDescription(memberList || 'No members found')
            .addFields([
                {
                    name: '🔍 Search Period',
                    value: `Last ${ACTIVITY_TRACKER.INACTIVITY_DAYS} days${Math.floor(ACTIVITY_TRACKER.INACTIVITY_DAYS / 30) >= 3 ? ` (${Math.floor(ACTIVITY_TRACKER.INACTIVITY_DAYS / 30)} months)` : ''} across all channels`,
                    inline: false
                }
            ])
            .setTimestamp()
            .setFooter({ text: embedConfig.FOOTER });

        await interaction.editReply({ embeds: [inactiveEmbed] });

        await logger.log(`📊 Never/recent chat members list requested by ${interaction.user.tag} - Found ${results.length} members`);

    } catch (error) {
        await logger.log(`❌ Error handling inactive button: ${error.message}`);
        try {
            await interaction.editReply({
                content: `❌ **Error**: Failed to get list.\n\n**Error**: ${error.message}`
            });
        } catch (err) {
            // Interaction might have already been replied to
        }
    }
}
