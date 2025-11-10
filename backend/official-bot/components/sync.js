import db from '../../../database/database.js';
import logger from '../../logger.js';
import { getLoggerChannel } from '../../config.js';
import { separateChannelsAndCategories, mapCategoriesForSync, mapChannelsForSync } from '../../utils.js';

let client = null;
let botId = null;
let loggerInitialized = false;

async function findBotByToken(token) {
    try {

        if (process.env.BOT_ID) {
            const bot = await db.getBot(process.env.BOT_ID);
            if (bot && bot.token === token) {
                return bot;
            }
        }

        const bots = await db.getAllBots();
        const bot = bots.find(b => b.token === token);
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

        try {
            await guild.members.fetch();
        } catch (memberFetchError) {
            logger.log(`⚠️  Could not fetch all members for ${guild.name}: ${memberFetchError.message}. Continuing with member count: ${guild.memberCount}`);
        }

        await guild.channels.fetch();
        await guild.roles.fetch();

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

        const { categories, channels } = separateChannelsAndCategories(guild.channels.cache);

        const categoryMap = await db.syncCategories(serverId, mapCategoriesForSync(categories));

        await db.syncChannels(serverId, mapChannelsForSync(channels), categoryMap);

        const roles = Array.from(guild.roles.cache.values()).filter(role => role.id !== guild.id);

        await db.syncRoles(serverId, roles.map(role => ({
            id: role.id,
            name: role.name,
            position: role.position,
            hexColor: role.hexColor,
            permissions: role.permissions
        })));

        const members = Array.from(guild.members.cache.values()).filter(member => !member.user.bot);
        await db.syncMembers(serverId, members);

        try {
            const { CUSTOM_SUPPORTER_ROLE } = await import('../../config.js');
            const constraints = await CUSTOM_SUPPORTER_ROLE.getRoleConstraints(guild.id);
            if (constraints.ROLE_START && constraints.ROLE_END) {
                await db.updateCustomRoleFlags(serverId, constraints.ROLE_START, constraints.ROLE_END);
            } else {
                await db.updateCustomRoleFlags(serverId, null, null);
            }
        } catch (error) {
        }

        logger.log(`✅ Synced server: ${guild.name} (${guild.memberCount} members, ${categories.length} categories, ${channels.length} channels, ${roles.length} roles)`);
    } catch (error) {
        logger.log(`❌ Error syncing guild data for ${guild.name}: ${error.message}`);
    }
}

async function syncAllGuilds() {
    if (!client) return;

    try {
        const guilds = client.guilds.cache;
        logger.log(`🔄 Official bot sync started: ${guilds.size} server(s)`);

        let completed = 0;
        for (const [, guild] of guilds) {
            await syncGuildData(guild);
            completed++;
        }

        logger.log(`✅ Official bot sync completed: ${completed}/${guilds.size} server(s)`);
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

async function initLoggerChannel() {
    if (!client || loggerInitialized) return;

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
                const loggerChannelId = await getLoggerChannel(guild.id);
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

async function init(discordClient, botToken) {
    client = discordClient;

    const bot = await findBotByToken(botToken);
    if (!bot) {
        logger.log(`⚠️  Bot not found in database with token. Sync will be limited.`);
        logger.log(`💡 Create bot entry in database first`);
        return;
    }

    botId = bot.id;
    logger.log(`✅ Found bot in database: ${bot.name} (${bot.bot_type})`);

    if (client.user) {
        await updateBotInfo();
    }

    await initLoggerChannel();


    setTimeout(async () => {
        if (botId) {
            const needsSync = await db.serversNeedSync(botId);

            if (needsSync) {
                logger.log('🔄 Starting initial guild data sync (servers need data sync)...');
                await syncAllGuilds();
                logger.log('✅ Initial sync complete');

                const allBots = await db.getAllBots();
                const botIdNum = typeof botId === 'string' ? parseInt(botId) : botId;
                const connectedSelfbots = allBots.filter(b => {
                    if (b.bot_type !== 'selfbot') return false;
                    if (!b.connect_to) return false;
                    const connectToNum = typeof b.connect_to === 'string' ? parseInt(b.connect_to) : b.connect_to;
                    return connectToNum === botIdNum;
                });

                if (connectedSelfbots.length > 0) {
                    logger.log(`⏳ Waiting for ${connectedSelfbots.length} connected selfbot(s) to finish syncing...`);

                    await new Promise(resolve => setTimeout(resolve, 10000));
                    logger.log('✅ Connected selfbots should be synced now');
                }
            } else {
                logger.log('⏭️  Skipping initial sync (servers have data). Sync will run on Discord events only.');

                try {
                    const { CUSTOM_SUPPORTER_ROLE } = await import('../../config.js');
                    const guilds = client.guilds.cache;

                    for (const [, guild] of guilds) {
                        try {
                            const serverData = await db.getServerByDiscordId(botId, guild.id);
                            if (serverData) {
                                const constraints = await CUSTOM_SUPPORTER_ROLE.getRoleConstraints(guild.id);
                                if (constraints.ROLE_START && constraints.ROLE_END) {
                                    await db.updateCustomRoleFlags(serverData.id, constraints.ROLE_START, constraints.ROLE_END);
                                } else {
                                    await db.updateCustomRoleFlags(serverData.id, null, null);
                                }
                            }
                        } catch (error) {
                        }
                    }
                    logger.log('✅ Recalculated custom supporter role flags for all servers');
                } catch (error) {
                }

                logger.log('ℹ️  Note: Booster status (is_booster, booster_since) will be updated automatically when member events occur');
            }
        }
    }, 2000);

    client.on('guildCreate', async (guild) => {
        logger.log(`🆕 Bot joined new guild: ${guild.name}`);
        await syncGuildData(guild);
    });

    client.on('channelCreate', async (channel) => {
        if (channel.guild) {
            const channelType = channel.type === 4 ? 'Category' : channel.type === 0 ? 'Text Channel' : channel.type === 5 ? 'News Channel' : 'Channel';
            const channelName = channel.name || 'Unknown';
            await logger.log(`📁 ${channelType} created: **${channelName}** (${channel.id})`, channel.guild.id);
            await syncGuildData(channel.guild);
        }
    });

    client.on('channelUpdate', async (oldChannel, newChannel) => {
        if (newChannel.guild) {
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
        if (channel.guild) {
            const channelType = channel.type === 4 ? 'Category' : channel.type === 0 ? 'Text Channel' : channel.type === 5 ? 'News Channel' : 'Channel';
            const channelName = channel.name || 'Unknown';
            await logger.log(`🗑️ ${channelType} deleted: **${channelName}** (${channel.id})`, channel.guild.id);
            await syncGuildData(channel.guild);
        }
    });

    client.on('roleCreate', async (role) => {
        if (role.guild) {
            const roleName = role.name || 'Unknown';
            const roleColor = role.hexColor !== '#000000' ? role.hexColor : 'No color';
            await logger.log(`🎭 Role created: **${roleName}** (${roleColor}) (${role.id})`, role.guild.id);
            await syncGuildData(role.guild);
        }
    });

    client.on('roleUpdate', async (oldRole, newRole) => {
        if (newRole.guild) {
            const oldName = oldRole.name || 'Unknown';
            const newName = newRole.name || 'Unknown';
            const oldColor = oldRole.hexColor !== '#000000' ? oldRole.hexColor : 'No color';
            const newColor = newRole.hexColor !== '#000000' ? newRole.hexColor : 'No color';

            if (oldName !== newName) {
                await logger.log(`✏️ Role renamed: **${oldName}** → **${newName}** (${newRole.id})`, newRole.guild.id);
            } else if (oldColor !== newColor) {
                await logger.log(`✏️ Role color updated: **${newName}** (${oldColor} → ${newColor}) (${newRole.id})`, newRole.guild.id);
            } else {
                await logger.log(`✏️ Role updated: **${newName}** (${newRole.id})`, newRole.guild.id);
            }
            await syncGuildData(newRole.guild);
        }
    });

    client.on('roleDelete', async (role) => {
        if (role.guild) {
            const roleName = role.name || 'Unknown';
            await logger.log(`🗑️ Role deleted: **${roleName}** (${role.id})`, role.guild.id);
            await syncGuildData(role.guild);
        }
    });

    client.on('guildMemberAdd', async (member) => {
        if (member.guild && botId) {
            try {
                const serverData = await db.getServerByDiscordId(botId, member.guild.id);
                if (serverData) {
                    const dbMember = await db.upsertMember(serverData.id, member);
                    if (dbMember) {
                        const memberRoles = member.roles ? Array.from(member.roles.cache.keys()).filter(roleId => roleId !== member.guild.id) : [];
                        await db.syncMemberRoles(dbMember.id, memberRoles, serverData.id);
                    }
                }
            } catch (error) {
                await logger.log(`⚠️ Failed to upsert member ${member.id} on join: ${error.message}`, member.guild.id);
            }
            await syncGuildData(member.guild);
        }
    });

    client.on('guildMemberRemove', async (member) => {
        if (member.guild && botId) {
            await syncGuildData(member.guild);
        }
    });

    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        if (newMember.guild && botId && newMember.user && !newMember.user.bot) {
            try {
                const serverData = await db.getServerByDiscordId(botId, newMember.guild.id);
                if (serverData) {
                    const dbMember = await db.upsertMember(serverData.id, newMember);
                    if (dbMember) {
                        const memberRoles = newMember.roles ? Array.from(newMember.roles.cache.keys()).filter(roleId => roleId !== newMember.guild?.id) : [];
                        await db.syncMemberRoles(dbMember.id, memberRoles, serverData.id);
                    }
                }
            } catch (error) {
                logger.log(`❌ Error syncing member on update: ${error.message}`);
            }
        }
    });

    client.on('guildUpdate', async (oldGuild, newGuild) => {
        if (botId) {
            await syncGuildData(newGuild);
        }
    });

    logger.log('🔄 Sync component initialized');
}

export default { init, syncGuildData, syncAllGuilds };
