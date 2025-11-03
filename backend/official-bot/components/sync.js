import db from '../../../database/supabase.js';
import logger from '../../logger.js';
import { separateChannelsAndCategories, mapCategoriesForSync, mapChannelsForSync } from '../../utils.js';

let client = null;
let botId = null;
let syncInterval = null;

// Find bot in database by token or ID
async function findBotByToken(token) {
    try {
        // First try to use BOT_ID from environment (set by control panel)
        if (process.env.BOT_ID) {
            const bot = await db.getBot(process.env.BOT_ID);
            if (bot && bot.token === token) {
                return bot;
            }
        }

        // Fallback to searching by token
        const bots = await db.getAllBots();
        const bot = bots.find(b => b.token === token);
        return bot;
    } catch (error) {
        logger.log(`❌ Error finding bot: ${error.message}`);
        return null;
    }
}

// Sync server info, channels and roles for a guild
async function syncGuildData(guild) {
    try {
        if (!botId) {
            logger.log(`⚠️  Bot ID not set, skipping sync for guild: ${guild.name}`);
            return;
        }

        // Fetch complete guild data
        await guild.fetch();
        await guild.members.fetch();
        await guild.channels.fetch();
        await guild.roles.fetch();

        // Sync server info first
        const serverData = await db.upsertServer(botId, guild);

        if (!serverData) {
            logger.log(`⚠️  Failed to sync server info for ${guild.name}`);
            return;
        }

        const serverId = serverData.id;

        // Separate channels and categories (excludes threads automatically)
        const { categories, channels } = separateChannelsAndCategories(guild.channels.cache);

        // Sync categories first
        const categoryMap = await db.syncCategories(serverId, mapCategoriesForSync(categories));

        // Sync channels (with category reference)
        await db.syncChannels(serverId, mapChannelsForSync(channels), categoryMap);

        // Get all roles
        const roles = Array.from(guild.roles.cache.values());

        // Sync roles to database
        await db.syncRoles(serverId, roles.map(role => ({
            id: role.id,
            name: role.name,
            position: role.position,
            hexColor: role.hexColor,
            permissions: role.permissions
        })));

        logger.log(`✅ Synced server: ${guild.name} (${guild.memberCount} members, ${categories.length} categories, ${channels.length} channels, ${roles.length} roles)`);
    } catch (error) {
        logger.log(`❌ Error syncing guild data for ${guild.name}: ${error.message}`);
    }
}

// Sync all guilds the bot is in
async function syncAllGuilds() {
    if (!client) return;

    try {
        const guilds = client.guilds.cache;

        for (const [guildId, guild] of guilds) {
            await syncGuildData(guild);
        }
    } catch (error) {
        logger.log(`❌ Error syncing all guilds: ${error.message}`);
    }
}

// Update bot name and icon from Discord
async function updateBotInfo() {
    if (!botId || !client || !client.user) {
        return;
    }

    try {
        const avatarUrl = client.user.displayAvatarURL({ dynamic: true, size: 256 });
        // Use display name (globalName) if available, otherwise fall back to username
        const displayName = client.user.globalName || client.user.username;
        await db.updateBot(botId, {
            name: displayName,
            bot_icon: avatarUrl || null
        });
        logger.log(`✅ Updated bot name and icon from Discord: ${displayName}`);
    } catch (error) {
        logger.log(`⚠️  Failed to update bot info: ${error.message}`);
    }
}

async function init(discordClient, botToken) {
    client = discordClient;

    // Find bot in database by token
    const bot = await findBotByToken(botToken);
    if (!bot) {
        logger.log(`⚠️  Bot not found in database with token. Sync will be limited.`);
        logger.log(`💡 Create bot entry in database first`);
    } else {
        botId = bot.id;
        logger.log(`✅ Found bot in database: ${bot.name} (${bot.bot_type})`);

        // Update bot info immediately if client is already ready
        if (client.user) {
            await updateBotInfo();
        }
    }

    // Sync when bot is ready
    client.once('clientReady', async () => {
        // Update bot name and icon from Discord
        await updateBotInfo();

        // Small delay to ensure all components are initialized
        setTimeout(async () => {
            if (botId) {
                logger.log('🔄 Starting initial guild data sync...');
                await syncAllGuilds();
                logger.log('✅ Initial sync complete');
            }
        }, 2000);
    });

    // Sync when bot joins a new guild
    client.on('guildCreate', async (guild) => {
        logger.log(`🆕 Bot joined new guild: ${guild.name}`);
        await syncGuildData(guild);
    });

    // Sync when channels are created/updated/deleted
    client.on('channelCreate', async (channel) => {
        if (channel.guild) {
            await syncGuildData(channel.guild);
        }
    });

    client.on('channelUpdate', async (oldChannel, newChannel) => {
        if (newChannel.guild) {
            await syncGuildData(newChannel.guild);
        }
    });

    client.on('channelDelete', async (channel) => {
        if (channel.guild) {
            await syncGuildData(channel.guild);
        }
    });

    // Sync when roles are created/updated/deleted
    client.on('roleCreate', async (role) => {
        if (role.guild) {
            await syncGuildData(role.guild);
        }
    });

    client.on('roleUpdate', async (oldRole, newRole) => {
        if (newRole.guild) {
            await syncGuildData(newRole.guild);
        }
    });

    client.on('roleDelete', async (role) => {
        if (role.guild) {
            await syncGuildData(role.guild);
        }
    });

    // Real-time sync: Update server stats every 1 minute
    syncInterval = setInterval(async () => {
        if (botId) {
            await syncAllGuilds();
        }
    }, 60 * 1000); // 1 minute for real-time updates

    // Also sync on member count changes
    client.on('guildMemberAdd', async (member) => {
        if (member.guild && botId) {
            await syncGuildData(member.guild);
        }
    });

    client.on('guildMemberRemove', async (member) => {
        if (member.guild && botId) {
            await syncGuildData(member.guild);
        }
    });

    // Sync on server boost changes
    client.on('guildUpdate', async (oldGuild, newGuild) => {
        if (botId) {
            await syncGuildData(newGuild);
        }
    });

    logger.log('🔄 Sync component initialized');
}

function stop() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
}

export default { init, stop, syncGuildData, syncAllGuilds };
