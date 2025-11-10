import db from '../../../database/database.js';
import logger from '../../logger.js';
import { separateChannelsAndCategories, mapCategoriesForSync, mapChannelsForSync } from '../../utils.js';

let client = null;
let botId = null;
let connectedOfficialBotId = null;
let loggerInitialized = false;

async function findBotById(botId) {
    try {
        const bot = await db.getBot(botId);
        return bot;
    } catch (error) {
        logger.log(`❌ Error finding bot: ${error.message}`);
        return null;
    }
}

async function syncGuildData(guild) {
    try {
        if (!botId) {
            logger.log(`⚠️  Bot ID not set, skipping sync for guild: ${guild.name}`);
            return;
        }

        await guild.fetch();

        const serverData = await db.upsertServer(botId, guild);

        if (!serverData) {
            logger.log(`⚠️  Failed to sync server info for ${guild.name}`);
            return;
        }

        const serverId = serverData.id;

        if (!loggerInitialized && client && connectedOfficialBotId) {
            try {
                const loggerChannelId = await getLoggerChannelFromOfficialBot(guild.id);
                if (loggerChannelId) {
                    logger.init(client, loggerChannelId);
                    loggerInitialized = true;
                    logger.log(`✅ Logger initialized with channel from ${guild.name}`, guild.id);
                }
            } catch (error) {
            }
        }

        try {

            try {
                await guild.channels.fetch();
            } catch (fetchError) {
                logger.log(`⚠️  Could not fetch channels for ${guild.name}: ${fetchError.message}`);
            }

            if (guild.channels.cache.size > 0) {

                const { categories, channels } = separateChannelsAndCategories(guild.channels.cache);

                const categoryMap = await db.syncCategories(serverId, mapCategoriesForSync(categories));

                await db.syncChannels(serverId, mapChannelsForSync(channels), categoryMap);

                logger.log(`✅ Synced server: ${guild.name} (${guild.memberCount} members, ${categories.length} categories, ${channels.length} channels)`);
            } else {
                logger.log(`✅ Synced server info: ${guild.name} (${guild.memberCount} members)`);
            }
        } catch (error) {
            logger.log(`❌ Error syncing channels/categories for ${guild.name}: ${error.message}`);
            logger.log(`✅ Synced server info: ${guild.name} (${guild.memberCount} members)`);
        }
    } catch (error) {
        logger.log(`❌ Error syncing guild data for ${guild.name}: ${error.message}`);
    }
}

async function syncAllGuilds() {
    try {
        if (!client || !botId) {
            logger.log(`⚠️  Client or bot ID not set, skipping sync`);
            return;
        }

        const guilds = client.guilds.cache;
        logger.log(`🔄 Selfbot sync started: ${guilds.size} server(s)`);

        let completed = 0;
        for (const [, guild] of guilds) {
            await syncGuildData(guild);
            completed++;
        }

        logger.log(`✅ Selfbot sync completed: ${completed}/${guilds.size} server(s)`);
    } catch (error) {
        logger.log(`❌ Error syncing all guilds: ${error.message}`);
    }
}

async function updateBotInfo() {
    if (!botId || !client || !client.user) {
        return;
    }

    try {
        const avatarUrl = client.user.displayAvatarURL({ dynamic: true, size: 256 });

        const displayName = client.user.globalName || client.user.displayName || client.user.username;
        await db.updateBot(botId, {
            name: displayName,
            bot_icon: avatarUrl || null
        });
        logger.log(`✅ Updated selfbot name and icon from Discord: ${displayName}`);
    } catch (error) {
        logger.log(`⚠️  Failed to update bot info: ${error.message}`);
    }
}

async function getLoggerChannelFromOfficialBot(discordGuildId) {
    if (!connectedOfficialBotId) return null;

    try {
        const officialServer = await db.getServerByDiscordId(connectedOfficialBotId, discordGuildId);
        if (!officialServer) return null;

        const settings = await db.getServerSettings(officialServer.id, 'main_config');
        if (!settings || !settings.settings || !settings.settings.logger_channel) {
            return null;
        }

        return settings.settings.logger_channel;
    } catch (error) {
        return null;
    }
}

async function initLoggerChannel() {
    if (!client || loggerInitialized || !connectedOfficialBotId) return;

    try {
        let guilds = client.guilds.cache;
        if (guilds.size === 0) {
            try {
                await client.guilds.fetch();
                guilds = client.guilds.cache;
            } catch (fetchError) {
            }
        }

        for (const [, guild] of guilds) {
            try {
                const loggerChannelId = await getLoggerChannelFromOfficialBot(guild.id);
                if (loggerChannelId) {
                    logger.init(client, loggerChannelId);
                    loggerInitialized = true;
                    logger.log(`✅ Logger initialized with channel from ${guild.name}`, guild.id);
                    return;
                }
            } catch (error) {
            }
        }
    } catch (error) {
    }
}

async function init(discordClient, botIdFromEnv) {
    client = discordClient;

    if (botIdFromEnv) {
        botId = botIdFromEnv;
        const bot = await findBotById(botId);
        if (bot) {
            if (bot.bot_type === 'selfbot' && bot.connect_to) {
                connectedOfficialBotId = bot.connect_to;
            }

            await initLoggerChannel();

            logger.log(`✅ Found selfbot in database: ${bot.name} (${bot.bot_type})`);

            if (bot.bot_type === 'selfbot' && bot.connect_to) {
                const officialBot = await findBotById(connectedOfficialBotId);
                if (officialBot) {
                    logger.log(`🔗 Selfbot connected to official bot: ${officialBot.name}`);
                } else {
                    logger.log(`⚠️  Connected official bot not found: ${connectedOfficialBotId}`);
                }
            }

            if (client.user) {
                await updateBotInfo();
            }
        } else {
            logger.log(`❌ Selfbot not found in database with ID: ${botId}`);
        }
    } else {
        logger.log(`⚠️  BOT_ID not set. Sync will be limited.`);
    }


    setTimeout(async () => {
        if (botId) {
            const needsSync = await db.serversNeedSync(botId);

            if (needsSync) {
                logger.log('🔄 Starting initial guild data sync (servers need data sync)...');
                await syncAllGuilds();
                logger.log('✅ Initial sync complete');
            } else {
                logger.log('⏭️  Skipping initial sync (servers have data). Sync will run on Discord events only.');
            }
        }
    }, 2000);

    client.on('guildCreate', async (guild) => {
        logger.log(`🆕 Selfbot joined new guild: ${guild.name}`);
        await syncGuildData(guild);
    });



    client.on('guildUpdate', async (oldGuild, newGuild) => {
        if (botId) {
            await syncGuildData(newGuild);
        }
    });

    client.on('channelCreate', async (channel) => {
        if (channel.guild && botId) {
            const channelType = channel.type === 4 ? 'Category' : channel.type === 0 ? 'Text Channel' : channel.type === 5 ? 'News Channel' : 'Channel';
            const channelName = channel.name || 'Unknown';
            await logger.log(`📁 ${channelType} created: **${channelName}** (${channel.id})`, channel.guild.id);
            await syncGuildData(channel.guild);
        }
    });

    client.on('channelUpdate', async (oldChannel, newChannel) => {
        if (newChannel.guild && botId) {
            const channelType = newChannel.type === 4 ? 'Category' : newChannel.type === 0 ? 'Text Channel' : newChannel.type === 5 ? 'News Channel' : 'Channel';
            const oldName = oldChannel.name || 'Unknown';
            const newName = newChannel.name || 'Unknown';

            if (oldName !== newName) {
                await logger.log(`✏️ ${channelType} renamed: **${oldName}** → **${newName}** (${newChannel.id})`, newChannel.guild.id);
            } else {
                await logger.log(`✏️ ${channelType} updated: **${newName}** (${newChannel.id})`, newChannel.guild.id);
            }
            await syncGuildData(newChannel.guild);
        }
    });

    client.on('channelDelete', async (channel) => {
        if (channel.guild && botId) {
            const channelType = channel.type === 4 ? 'Category' : channel.type === 0 ? 'Text Channel' : channel.type === 5 ? 'News Channel' : 'Channel';
            const channelName = channel.name || 'Unknown';
            await logger.log(`🗑️ ${channelType} deleted: **${channelName}** (${channel.id})`, channel.guild.id);
            await syncGuildData(channel.guild);
        }
    });

    logger.log('🔄 Selfbot sync component initialized');
}

export default {
    init,
    syncGuildData,
    syncAllGuilds,
    updateBotInfo
};
