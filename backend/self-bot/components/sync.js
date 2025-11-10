import db from '../../../database/database.js';
import logger from '../../logger.js';
import { getLoggerChannel } from '../../config.js';
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

        if (!loggerInitialized && client) {
            try {
                const loggerChannelId = await getLoggerChannel(guild.id);
                if (loggerChannelId) {
                    logger.init(client, loggerChannelId);
                    loggerInitialized = true;
                    logger.log(`✅ Logger initialized with channel from ${guild.name}`);
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

async function init(discordClient, botIdFromEnv) {
    client = discordClient;

    if (botIdFromEnv) {
        botId = botIdFromEnv;
        const bot = await findBotById(botId);
        if (bot) {
            logger.log(`✅ Found selfbot in database: ${bot.name} (${bot.bot_type})`);

            if (bot.bot_type === 'selfbot' && bot.connect_to) {
                connectedOfficialBotId = bot.connect_to;
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

            const existingServers = await db.getServersForBot(botId);
            const isFirstStartup = !existingServers || existingServers.length === 0;

            if (isFirstStartup) {
                logger.log('🔄 Starting initial guild data sync (first startup)...');
                await syncAllGuilds();
                logger.log('✅ Initial sync complete');
            } else {
                logger.log('⏭️  Skipping initial sync (not first startup). Sync will run on Discord events only.');
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
            await syncGuildData(channel.guild);
        }
    });

    client.on('channelUpdate', async (oldChannel, newChannel) => {
        if (newChannel.guild && botId) {
            await syncGuildData(newChannel.guild);
        }
    });

    client.on('channelDelete', async (channel) => {
        if (channel.guild && botId) {
            await syncGuildData(channel.guild);
        }
    });

    logger.log('🔄 Selfbot sync component initialized');
}

function stop() {

}

export default {
    init,
    stop,
    syncGuildData,
    syncAllGuilds,
    updateBotInfo
};
