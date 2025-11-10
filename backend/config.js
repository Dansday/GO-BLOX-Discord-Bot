import db from '../database/database.js';

let botConfig = null;

async function loadBotConfig() {
    const botId = process.env.BOT_ID;

    if (!botId) {
        throw new Error('BOT_ID not set in environment. Bot cannot start without database configuration.');
    }

    const bot = await db.getBot(botId);

    if (!bot) {
        throw new Error(`Bot not found in database with ID: ${botId}`);
    }

    let port = bot.port;
    let secret_key = bot.secret_key;
    let is_testing = bot.is_testing || false;

    if (bot.bot_type === 'selfbot' && bot.connect_to) {
        const connectedBot = await db.getBot(bot.connect_to);
        if (connectedBot) {
            port = connectedBot.port;
            secret_key = connectedBot.secret_key;
            is_testing = connectedBot.is_testing || false;
        } else {
            throw new Error(`Connected bot not found for selfbot ${botId}. Connected bot ID: ${bot.connect_to}`);
        }
    }

    botConfig = {
        id: bot.id,
        token: bot.token,
        application_id: bot.application_id,
        bot_type: bot.bot_type,
        port: port,
        secret_key: secret_key,
        is_testing: is_testing,
        connect_to: bot.connect_to
    };

    return botConfig;
}

export async function initializeConfig() {
    await loadBotConfig();
}

export function getBotConfig() {
    return botConfig;
}

function requireBotConfig() {
    if (!botConfig) {
        throw new Error('Bot config not loaded. Call initializeConfig() first.');
    }
}

function requireGuildId(guildId, action = 'operation') {
    if (!guildId) {
        throw new Error(`Guild ID is required for ${action}.`);
    }
}

function getOfficialBotId() {
    requireBotConfig();
    if (botConfig.bot_type === 'selfbot' && botConfig.connect_to) {
        return botConfig.connect_to;
    }
    return botConfig.id;
}

export async function getServerForCurrentBot(guildId) {
    requireBotConfig();
    requireGuildId(guildId, 'getting server');

    const server = await db.getServerByDiscordId(botConfig.id, guildId);
    if (!server) {
        throw new Error(`Server not found for guild ${guildId}`);
    }

    return server;
}

async function getOfficialBotServer(guildId) {
    requireBotConfig();
    requireGuildId(guildId, 'getting server');

    const officialBotId = getOfficialBotId();
    const officialBotServer = await db.getServerByDiscordId(officialBotId, guildId);

    if (!officialBotServer) {
        throw new Error(`Server not found for guild ${guildId} in official bot ${officialBotId}`);
    }

    return officialBotServer;
}

async function getServerSettingsForComponent(guildId, componentName) {
    const officialBotServer = await getOfficialBotServer(guildId);
    const settings = await db.getServerSettings(officialBotServer.id, componentName);

    if (!settings || !settings.settings) {
        throw new Error(`Server settings not found for guild ${guildId} (component: ${componentName})`);
    }

    return settings;
}

export const ENV = {
    get PRODUCTION() {
        if (!botConfig) {
            throw new Error('Bot config not loaded. Call initializeConfig() first.');
        }
        return !botConfig.is_testing;
    }
};

export function getBotToken(botType) {
    if (!botConfig) {
        throw new Error('Bot config not loaded. Call initializeConfig() first.');
    }
    if (botConfig.bot_type !== botType) {
        throw new Error(`Bot type mismatch. Expected ${botType}, got ${botConfig.bot_type}`);
    }
    if (!botConfig.token) {
        throw new Error('Bot token not found in database configuration.');
    }
    return botConfig.token;
}

export function getApplicationId() {
    if (!botConfig) {
        throw new Error('Bot config not loaded. Call initializeConfig() first.');
    }
    if (!botConfig.application_id) {
        throw new Error('Application ID not found in database configuration.');
    }
    return botConfig.application_id;
}

export async function getMainChannel(guildId) {
    requireBotConfig();
    requireGuildId(guildId, 'getting main channel');

    const settings = await getServerSettingsForComponent(guildId, 'main_config');
    const channelId = botConfig.is_testing
        ? settings.settings.testing_channel
        : settings.settings.production_channel;

    if (!channelId) {
        throw new Error(`Channel not configured for ${botConfig.is_testing ? 'testing' : 'production'} mode in guild ${guildId}`);
    }

    return channelId;
}

export const PERMISSIONS = {

    async getPermissions(guildId) {
        requireGuildId(guildId, 'permissions');

        requireBotConfig();
        const server = await db.getServerByDiscordId(botConfig.id, guildId);
        if (!server) {
            throw new Error(`Server not found for guild ${guildId}`);
        }

        const settings = await db.getServerSettings(server.id, 'permissions');
        if (!settings || !settings.settings) {
            throw new Error(`Permissions not configured for guild ${guildId}`);
        }

        return {
            ADMIN_ROLES: settings.settings.admin_roles || [],
            STAFF_ROLES: settings.settings.staff_roles || [],
            SUPPORTER_ROLES: settings.settings.supporter_roles || [],
            MEMBER_ROLES: settings.settings.member_roles || []
        };
    },

    async hasAnyRole(member, roleIds) {
        if (!roleIds || roleIds.length === 0) return false;
        return roleIds.some(roleId => member.roles.cache.has(roleId));
    }
};

export const COMMUNICATION = {

    get WEBHOOK_URL() {
        if (!botConfig) {
            throw new Error('Bot config not loaded. Call initializeConfig() first.');
        }
        if (!botConfig.port) {
            throw new Error('Port not found in database configuration.');
        }
        return `http://localhost:${botConfig.port}`;
    },

    get SECRET_KEY() {
        if (!botConfig) {
            throw new Error('Bot config not loaded. Call initializeConfig() first.');
        }
        if (!botConfig.secret_key) {
            throw new Error('Secret key not found in database configuration.');
        }
        return botConfig.secret_key;
    },

    get PORT() {
        if (!botConfig) {
            throw new Error('Bot config not loaded. Call initializeConfig() first.');
        }
        if (!botConfig.port) {
            throw new Error('Port not found in database configuration.');
        }
        return botConfig.port;
    }
};

export async function getEmbedConfig(guildId) {
    requireBotConfig();
    requireGuildId(guildId, 'getting embed config');

    const officialBotServer = await getOfficialBotServer(guildId);
    const settings = await getServerSettingsForComponent(guildId, 'main_config');
    const config = settings.settings;

    if (!config.embed_color) {
        throw new Error(`Embed color not configured for guild ${guildId}`);
    }

    const hex = config.embed_color.replace('#', '');
    const color = parseInt(hex, 16);

    if (!config.embed_footer) {
        throw new Error(`Embed footer not configured for guild ${guildId}`);
    }

    let footerText = config.embed_footer;
    if (footerText) {
        const now = new Date();
        footerText = footerText
            .replace(/{server}/g, officialBotServer?.name || 'Server')
            .replace(/{year}/g, now.getFullYear().toString())
            .replace(/{date}/g, now.toLocaleDateString())
            .replace(/{time}/g, now.toLocaleTimeString());
    }

    return {
        COLOR: color,
        FOOTER: footerText
    };
}

export async function getLoggerChannel(guildId) {
    requireBotConfig();
    requireGuildId(guildId, 'getting logger channel');

    const settings = await getServerSettingsForComponent(guildId, 'main_config');

    if (!settings.settings.logger_channel) {
        throw new Error(`Logger channel not configured for guild ${guildId}`);
    }

    return settings.settings.logger_channel;
}

export const WELCOMER = {

    async getChannels(guildId) {
        requireBotConfig();
        requireGuildId(guildId, 'getting welcomer channels');

        const settings = await db.getServerSettings((await getOfficialBotServer(guildId)).id, 'welcomer');

        if (settings && settings.settings && settings.settings.channels && settings.settings.channels.length > 0) {
            return settings.settings.channels;
        }

        const mainChannel = await getMainChannel(guildId);
        return mainChannel ? [mainChannel] : [];
    },

    async getMessages(guildId) {
        requireBotConfig();
        requireGuildId(guildId, 'getting welcomer messages');

        const settings = await db.getServerSettings((await getOfficialBotServer(guildId)).id, 'welcomer');

        if (settings && settings.settings && settings.settings.messages && settings.settings.messages.length > 0) {
            return settings.settings.messages;
        }

        return [];
    }
};

export const BOOSTER = {

    async getChannels(guildId) {
        requireBotConfig();
        requireGuildId(guildId, 'getting booster channels');

        const settings = await db.getServerSettings((await getOfficialBotServer(guildId)).id, 'booster');

        if (settings && settings.settings && settings.settings.channels && settings.settings.channels.length > 0) {
            return settings.settings.channels;
        }

        const mainChannel = await getMainChannel(guildId);
        return mainChannel ? [mainChannel] : [];
    },

    async getChannel(guildId) {
        const channels = await this.getChannels(guildId);
        return channels.length > 0 ? channels[0] : await getMainChannel(guildId);
    },

    async getMessages(guildId) {
        requireBotConfig();
        requireGuildId(guildId, 'getting booster messages');

        const settings = await db.getServerSettings((await getOfficialBotServer(guildId)).id, 'booster');

        if (settings && settings.settings && settings.settings.messages && settings.settings.messages.length > 0) {
            return settings.settings.messages;
        }

        return [];
    }
};

export const CUSTOM_SUPPORTER_ROLE = {

    async getRoleConstraints(guildId) {
        requireBotConfig();
        requireGuildId(guildId, 'getting custom role constraints');

        const settings = await db.getServerSettings((await getOfficialBotServer(guildId)).id, 'custom_supporter_role');

        if (settings && settings.settings) {
            return {
                ROLE_START: settings.settings.role_start || null,
                ROLE_END: settings.settings.role_end || null
            };
        }

        return {
            ROLE_START: null,
            ROLE_END: null
        };
    }
};

export const FEEDBACK = {

    async getChannel(guildId) {
        requireBotConfig();
        requireGuildId(guildId, 'getting feedback channel');

        const settings = await db.getServerSettings((await getOfficialBotServer(guildId)).id, 'feedback');

        if (settings && settings.settings && settings.settings.feedback_channel) {
            return settings.settings.feedback_channel;
        }

        return null;
    }
};

export const FORWARDER = {

    async getConfig(guildId) {
        requireBotConfig();
        requireGuildId(guildId, 'getting forwarder config');


        const botIdToUse = getOfficialBotId();
        const server = await db.getServerByDiscordId(botIdToUse, guildId);

        if (!server) {
            return { production: [], testing: [] };
        }

        const settings = await db.getServerSettings(server.id, 'forwarder');
        if (!settings || !settings.settings) {
            return { production: [], testing: [] };
        }

        return settings.settings;
    },

    async shouldForwardChannel(channelId, guildId) {
        requireBotConfig();
        if (!channelId || !guildId) {
            return false;
        }

        if (botConfig.bot_type !== 'selfbot' || !botConfig.connect_to) {
            return false;
        }

        try {

            const selfbotServer = await db.getServerByDiscordId(botConfig.id, guildId);
            if (!selfbotServer) {
                return false;
            }

            const officialBot = await db.getBot(botConfig.connect_to);
            if (!officialBot) {
                return false;
            }

            const officialServers = await db.getServersForBot(officialBot.id);
            const environment = botConfig.is_testing ? 'testing' : 'production';

            for (const officialServer of officialServers) {
                try {
                    const forwarders = await this.getConfig(officialServer.discord_server_id);
                    const envForwarders = forwarders[environment] || [];

                    for (const forwarder of envForwarders) {

                        if (String(forwarder.selfbot_id) !== String(botConfig.id)) {
                            continue;
                        }
                        if (String(forwarder.server_id) !== String(selfbotServer.id)) {
                            continue;
                        }

                        if (forwarder.source_channels && Array.isArray(forwarder.source_channels)) {
                            const foundChannel = forwarder.source_channels.find(
                                ch => String(ch?.channel_id || '') === String(channelId)
                            );
                            if (foundChannel) {
                                return true;
                            }
                        }
                    }
                } catch (err) {

                    continue;
                }
            }

            return false;
        } catch (err) {

            return false;
        }
    },




    async getForwarderConfigBySourceChannel(sourceChannelId, sourceGuildId) {
        requireBotConfig();
        if (!sourceChannelId || !sourceGuildId) {
            throw new Error('Source channel ID and guild ID are required.');
        }





        const allGuilds = await db.getServersForBot(botConfig.id);
        const environment = botConfig.is_testing ? 'testing' : 'production';

        const allBots = await db.getAllBots();
        const botConfigIdNum = typeof botConfig.id === 'string' ? parseInt(botConfig.id) : botConfig.id;
        const connectedSelfbots = allBots.filter(bot => {
            if (bot.bot_type !== 'selfbot') return false;
            if (!bot.connect_to) return false;
            const connectToNum = typeof bot.connect_to === 'string' ? parseInt(bot.connect_to) : bot.connect_to;
            return connectToNum === botConfigIdNum;
        });

        for (const officialServer of allGuilds) {
            try {
                const forwarders = await this.getConfig(officialServer.discord_server_id);
                const envForwarders = forwarders[environment] || [];

                for (const forwarder of envForwarders) {

                    if (!forwarder.source_channels || !Array.isArray(forwarder.source_channels)) {
                        continue;
                    }

                    const foundChannel = forwarder.source_channels.find(
                        ch => {

                            const chId = String(ch?.channel_id || '');
                            const targetId = String(sourceChannelId || '');
                            return chId === targetId;
                        }
                    );
                    if (!foundChannel) {
                        continue;
                    }


                    const forwarderSelfbotIdNum = typeof forwarder.selfbot_id === 'string' ? parseInt(forwarder.selfbot_id) : forwarder.selfbot_id;
                    const forwarderSelfbot = connectedSelfbots.find(bot => {
                        const botIdNum = typeof bot.id === 'string' ? parseInt(bot.id) : bot.id;
                        return botIdNum === forwarderSelfbotIdNum;
                    });
                    if (!forwarderSelfbot) {
                        continue;
                    }

                    const selfbotServer = await db.getServerByDiscordId(forwarderSelfbot.id, sourceGuildId);
                    if (!selfbotServer) {
                        continue;
                    }

                    if (String(selfbotServer.id) !== String(forwarder.server_id)) {
                        continue;
                    }

                    return {
                        target_channel_id: forwarder.target_channel_id,
                        roles: forwarder.roles,
                        target_guild_id: officialServer.discord_server_id
                    };
                }
            } catch (err) {

                continue;
            }
        }

        return null;
    }
};
