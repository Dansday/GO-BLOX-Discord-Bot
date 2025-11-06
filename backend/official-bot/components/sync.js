import db from '../../../database/database.js';
import logger from '../../logger.js';
import { getLoggerChannel } from '../../config.js';
import { separateChannelsAndCategories, mapCategoriesForSync, mapChannelsForSync } from '../../utils.js';

let client = null;
let botId = null;
let syncCheckInterval = null;
let loggerInitialized = false;

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

        // Initialize logger with channel from this server if not already initialized
        if (!loggerInitialized && client) {
            try {
                const loggerChannelId = await getLoggerChannel(guild.id);
                if (loggerChannelId) {
                    logger.init(client, loggerChannelId);
                    loggerInitialized = true;
                    logger.log(`✅ Logger initialized with channel from ${guild.name}`);
                }
            } catch (error) {
                // Logger channel not configured for this server, continue
            }
        }

        // Separate channels and categories (excludes threads automatically)
        const { categories, channels } = separateChannelsAndCategories(guild.channels.cache);

        // Sync categories first
        const categoryMap = await db.syncCategories(serverId, mapCategoriesForSync(categories));

        // Sync channels (with category reference)
        await db.syncChannels(serverId, mapChannelsForSync(channels), categoryMap);

        // Get all roles, excluding @everyone (role.id === guild.id)
        const roles = Array.from(guild.roles.cache.values()).filter(role => role.id !== guild.id);

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
        logger.log(`🔄 Official bot sync started: ${guilds.size} server(s)`);

        let completed = 0;
        for (const [guildId, guild] of guilds) {
            await syncGuildData(guild);
            completed++;
        }
        
        logger.log(`✅ Official bot sync completed: ${completed}/${guilds.size} server(s)`);
    } catch (error) {
        logger.log(`❌ Error syncing all guilds: ${error.message}`);
    }
}

// Mark all servers as synced (update last_accessed) to prevent immediate re-sync after bot start
async function markAllServersAsSynced() {
    if (!botId) return;

    try {
        const servers = await db.getServersForBot(botId);
        if (!servers || servers.length === 0) return;

        const serverIds = servers.map(s => s.id);

        // Mark all servers as synced using database function
        await db.markServersAsSynced(serverIds);

        logger.log(`✅ Marked ${serverIds.length} server(s) as synced (30-minute cooldown active)`);
    } catch (error) {
        logger.log(`⚠️  Error marking servers as synced: ${error.message}`);
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
        return;
    }
    
    botId = bot.id;
    logger.log(`✅ Found bot in database: ${bot.name} (${bot.bot_type})`);

    // Update bot info immediately if client is already ready
    if (client.user) {
        await updateBotInfo();
    }

    // Since sync.init() is called from within clientReady handler, client is already ready
    // Sync immediately after a short delay to ensure all components are initialized
    setTimeout(async () => {
        if (botId) {
            logger.log('🔄 Starting initial guild data sync...');
            // Always sync on first bot start (regardless of last_accessed)
            await syncAllGuilds();
            logger.log('✅ Initial sync complete');

            // Check if this official bot has connected selfbots - wait for them to sync too
            const allBots = await db.getAllBots();
            const connectedSelfbots = allBots.filter(b => b.bot_type === 'selfbot' && b.connect_to === botId);
            
            if (connectedSelfbots.length > 0) {
                logger.log(`⏳ Waiting for ${connectedSelfbots.length} connected selfbot(s) to finish syncing...`);
                // Wait 10 seconds for selfbots to complete their sync (they start 2 seconds after ready)
                await new Promise(resolve => setTimeout(resolve, 10000));
                logger.log('✅ Connected selfbots should be synced now');
            }

            // Mark all servers as synced to prevent immediate re-sync if config is visited right after bot start
            // This only marks servers that have settings - new servers without settings will be synced every 5 minutes
            await markAllServersAsSynced();
        }
    }, 2000);

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

    // Check for servers needing sync (based on last_accessed with 30-minute cooldown)
    // This runs every 5 minutes to check for servers that need syncing
    syncCheckInterval = setInterval(async () => {
        if (!botId || !client) return;

        try {
            const serverIdsNeedingSync = await db.getServersNeedingSync(botId);

            if (serverIdsNeedingSync.length > 0) {
                logger.log(`🔄 Found ${serverIdsNeedingSync.length} server(s) needing sync`);

                // Get server data from database to find Discord guild IDs
                const servers = await db.getServersForBot(botId);
                const serversToSync = servers.filter(s => serverIdsNeedingSync.includes(s.id));

                for (const server of serversToSync) {
                    try {
                        const guild = client.guilds.cache.get(server.discord_server_id);
                        if (guild) {
                            await syncGuildData(guild);

                            // Clear last_accessed after syncing to prevent repeated syncs
                            // This allows the sync to trigger again when settings are next accessed/updated
                            await db.clearLastAccessed(server.id);
                        }
                    } catch (error) {
                        logger.log(`⚠️  Error syncing server ${server.name}: ${error.message}`);
                    }
                }
            }
        } catch (error) {
            logger.log(`⚠️  Error checking servers needing sync: ${error.message}`);
        }
    }, 5 * 60 * 1000); // Check every 5 minutes

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
    if (syncCheckInterval) {
        clearInterval(syncCheckInterval);
        syncCheckInterval = null;
    }
}

export default { init, stop, syncGuildData, syncAllGuilds };
