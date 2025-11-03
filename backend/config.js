// Backend Configuration for both Self-Bot and Official Bot
import db from '../database/supabase.js';

// Bot configuration loaded from database
let botConfig = null;

// Load bot configuration from database
async function loadBotConfig() {
    // Get BOT_ID from environment (set by control panel)
    const botId = process.env.BOT_ID;

    if (!botId) {
        throw new Error('BOT_ID not set in environment. Bot cannot start without database configuration.');
    }

    const bot = await db.getBot(botId);

    if (!bot) {
        throw new Error(`Bot not found in database with ID: ${botId}`);
    }

    // For selfbots, get port, secret_key, and is_testing from connected official bot
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

// Initialize config - load from database if available
export async function initializeConfig() {
    await loadBotConfig();
}

// Get current bot config
export function getBotConfig() {
    return botConfig;
}

// Environment Configuration - uses database is_testing field
export const ENV = {
    get PRODUCTION() {
        if (!botConfig) {
            throw new Error('Bot config not loaded. Call initializeConfig() first.');
        }
        return !botConfig.is_testing;
    }
};

// Get token from database
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

// Get application ID from database
export function getApplicationId() {
    if (!botConfig) {
        throw new Error('Bot config not loaded. Call initializeConfig() first.');
    }
    if (!botConfig.application_id) {
        throw new Error('Application ID not found in database configuration.');
    }
    return botConfig.application_id;
}

// Helper function to get server by Discord server ID
async function getServerByDiscordId(discordServerId) {
    if (!botConfig) {
        throw new Error('Bot config not loaded. Call initializeConfig() first.');
    }
    const server = await db.getServerByDiscordId(botConfig.id, discordServerId);
    if (!server) {
        throw new Error(`Server not found for Discord ID: ${discordServerId}`);
    }
    return server;
}

// Get main channel for a specific server (from server settings)
export async function getMainChannel(guildId) {
    if (!botConfig) {
        throw new Error('Bot config not loaded. Call initializeConfig() first.');
    }
    if (!guildId) {
        throw new Error('Guild ID is required to get main channel.');
    }

    // For selfbots, use the connected official bot's server config
    let officialBotId = botConfig.id;
    if (botConfig.bot_type === 'selfbot' && botConfig.connect_to) {
        officialBotId = botConfig.connect_to;
    }

    // Get the official bot's server for this Discord guild
    const officialBotServer = await db.getServerByDiscordId(officialBotId, guildId);
    if (!officialBotServer) {
        throw new Error(`Server not found for guild ${guildId} in official bot ${officialBotId}`);
    }

    const settings = await db.getServerSettings(officialBotServer.id, 'main_config');

    if (!settings || !settings.settings) {
        throw new Error(`Server settings not found for guild ${guildId}`);
    }

    const channelId = botConfig.is_testing
        ? settings.settings.test_channel
        : settings.settings.production_channel;

    if (!channelId) {
        throw new Error(`Channel not configured for ${botConfig.is_testing ? 'testing' : 'production'} mode in guild ${guildId}`);
    }

    return channelId;
}

// Permissions Configuration - loads from database
export const PERMISSIONS = {
    // Get permissions for a specific guild (Discord guild ID)
    async getPermissions(guildId) {
        if (!guildId) {
            throw new Error('Guild ID is required for permissions');
        }

        // Get server by Discord ID
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

    // Helper function to check if member has any of the specified roles
    async hasAnyRole(member, roleIds) {
        if (!roleIds || roleIds.length === 0) return false;
        return roleIds.some(roleId => member.roles.cache.has(roleId));
    }
};

// Communication Configuration - loads from database
export const COMMUNICATION = {
    // Webhook URL for self-bot to send data to official bot (local webhook server)
    get WEBHOOK_URL() {
        if (!botConfig) {
            throw new Error('Bot config not loaded. Call initializeConfig() first.');
        }
        if (!botConfig.port) {
            throw new Error('Port not found in database configuration.');
        }
        return `http://localhost:${botConfig.port}`;
    },
    // Secret key for webhook authentication - loads from database
    get SECRET_KEY() {
        if (!botConfig) {
            throw new Error('Bot config not loaded. Call initializeConfig() first.');
        }
        if (!botConfig.secret_key) {
            throw new Error('Secret key not found in database configuration.');
        }
        return botConfig.secret_key;
    },
    // Port for webhook server - loads from database
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

// Get embed configuration for a specific server (from server settings)
export async function getEmbedConfig(guildId) {
    if (!botConfig) {
        throw new Error('Bot config not loaded. Call initializeConfig() first.');
    }
    if (!guildId) {
        throw new Error('Guild ID is required to get embed config.');
    }

    // For selfbots, use the connected official bot's server config
    let officialBotId = botConfig.id;
    if (botConfig.bot_type === 'selfbot' && botConfig.connect_to) {
        officialBotId = botConfig.connect_to;
    }

    // Get the official bot's server for this Discord guild
    const officialBotServer = await db.getServerByDiscordId(officialBotId, guildId);
    if (!officialBotServer) {
        throw new Error(`Server not found for guild ${guildId} in official bot ${officialBotId}`);
    }

    const settings = await db.getServerSettings(officialBotServer.id, 'main_config');

    if (!settings || !settings.settings) {
        throw new Error(`Server settings not found for guild ${guildId}`);
    }

    const config = settings.settings;

    if (!config.embed_color) {
        throw new Error(`Embed color not configured for guild ${guildId}`);
    }

    // Convert hex color to integer
    const hex = config.embed_color.replace('#', '');
    const color = parseInt(hex, 16);

    if (!config.embed_footer) {
        throw new Error(`Embed footer not configured for guild ${guildId}`);
    }

    // Replace placeholders in footer text
    let footerText = config.embed_footer;
    if (footerText) {
        // Use the officialBotServer we already fetched above
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

// Get logger channel for a specific server (from server settings)
export async function getLoggerChannel(guildId) {
    if (!botConfig) {
        throw new Error('Bot config not loaded. Call initializeConfig() first.');
    }
    if (!guildId) {
        throw new Error('Guild ID is required to get logger channel.');
    }

    // For selfbots, use the connected official bot's server config
    let officialBotId = botConfig.id;
    if (botConfig.bot_type === 'selfbot' && botConfig.connect_to) {
        officialBotId = botConfig.connect_to;
    }

    // Get the official bot's server for this Discord guild
    const officialBotServer = await db.getServerByDiscordId(officialBotId, guildId);
    if (!officialBotServer) {
        throw new Error(`Server not found for guild ${guildId} in official bot ${officialBotId}`);
    }

    const settings = await db.getServerSettings(officialBotServer.id, 'main_config');

    if (!settings || !settings.settings) {
        throw new Error(`Server settings not found for guild ${guildId}`);
    }

    if (!settings.settings.logger_channel) {
        throw new Error(`Logger channel not configured for guild ${guildId}`);
    }

    return settings.settings.logger_channel;
}

// Welcomer Configuration
export const WELCOMER = {
    // Get welcome channels for a guild (from database)
    async getChannels(guildId) {
        if (!botConfig) {
            throw new Error('Bot config not loaded. Call initializeConfig() first.');
        }
        if (!guildId) {
            throw new Error('Guild ID is required to get welcomer channels.');
        }

        // For selfbots, use the connected official bot's server config
        let officialBotId = botConfig.id;
        if (botConfig.bot_type === 'selfbot' && botConfig.connect_to) {
            officialBotId = botConfig.connect_to;
        }

        // Get the official bot's server for this Discord guild
        const officialBotServer = await db.getServerByDiscordId(officialBotId, guildId);
        if (!officialBotServer) {
            throw new Error(`Server not found for guild ${guildId} in official bot ${officialBotId}`);
        }

        const settings = await db.getServerSettings(officialBotServer.id, 'welcomer');

        // If welcomer config exists and has channels, use them
        if (settings && settings.settings && settings.settings.channels && settings.settings.channels.length > 0) {
            return settings.settings.channels;
        }

        // Otherwise, fallback to main channel
        const mainChannel = await getMainChannel(guildId);
        return mainChannel ? [mainChannel] : [];
    },

    // Get welcome messages for a guild (from database)
    async getMessages(guildId) {
        if (!botConfig) {
            throw new Error('Bot config not loaded. Call initializeConfig() first.');
        }
        if (!guildId) {
            throw new Error('Guild ID is required to get welcomer messages.');
        }

        // For selfbots, use the connected official bot's server config
        let officialBotId = botConfig.id;
        if (botConfig.bot_type === 'selfbot' && botConfig.connect_to) {
            officialBotId = botConfig.connect_to;
        }

        // Get the official bot's server for this Discord guild
        const officialBotServer = await db.getServerByDiscordId(officialBotId, guildId);
        if (!officialBotServer) {
            throw new Error(`Server not found for guild ${guildId} in official bot ${officialBotId}`);
        }

        const settings = await db.getServerSettings(officialBotServer.id, 'welcomer');
        
        // If welcomer config exists and has messages, use them
        if (settings && settings.settings && settings.settings.messages && settings.settings.messages.length > 0) {
            return settings.settings.messages;
        }

        // Otherwise, return empty array (no messages configured)
        return [];
    }
};

// Booster Configuration
export const BOOSTER = {
    // Get booster channels for a guild (from database)
    async getChannels(guildId) {
        if (!botConfig) {
            throw new Error('Bot config not loaded. Call initializeConfig() first.');
        }
        if (!guildId) {
            throw new Error('Guild ID is required to get booster channels.');
        }

        // For selfbots, use the connected official bot's server config
        let officialBotId = botConfig.id;
        if (botConfig.bot_type === 'selfbot' && botConfig.connect_to) {
            officialBotId = botConfig.connect_to;
        }

        // Get the official bot's server for this Discord guild
        const officialBotServer = await db.getServerByDiscordId(officialBotId, guildId);
        if (!officialBotServer) {
            throw new Error(`Server not found for guild ${guildId} in official bot ${officialBotId}`);
        }

        const settings = await db.getServerSettings(officialBotServer.id, 'booster');

        // If booster config exists and has channels, use them
        if (settings && settings.settings && settings.settings.channels && settings.settings.channels.length > 0) {
            return settings.settings.channels;
        }

        // Otherwise, fallback to main channel
        const mainChannel = await getMainChannel(guildId);
        return mainChannel ? [mainChannel] : [];
    },

    async getChannel(guildId) {
        const channels = await this.getChannels(guildId);
        return channels.length > 0 ? channels[0] : await getMainChannel(guildId);
    },

    // Get booster messages for a guild (from database)
    async getMessages(guildId) {
        if (!botConfig) {
            throw new Error('Bot config not loaded. Call initializeConfig() first.');
        }
        if (!guildId) {
            throw new Error('Guild ID is required to get booster messages.');
        }

        // For selfbots, use the connected official bot's server config
        let officialBotId = botConfig.id;
        if (botConfig.bot_type === 'selfbot' && botConfig.connect_to) {
            officialBotId = botConfig.connect_to;
        }

        // Get the official bot's server for this Discord guild
        const officialBotServer = await db.getServerByDiscordId(officialBotId, guildId);
        if (!officialBotServer) {
            throw new Error(`Server not found for guild ${guildId} in official bot ${officialBotId}`);
        }

        const settings = await db.getServerSettings(officialBotServer.id, 'booster');
        
        // If booster config exists and has messages, use them
        if (settings && settings.settings && settings.settings.messages && settings.settings.messages.length > 0) {
            return settings.settings.messages;
        }

        // Otherwise, return empty array (no messages configured)
        return [];
    }
};

// Custom Supporter Role Configuration
export const CUSTOM_SUPPORTER_ROLE = {
    // Role position constraints
    ROLE_BELOW: "1433928533000061028",       // Custom role must be below this role
    ROLE_ABOVE: "1433928639010836520"      // Custom role must be above this role
};

// Feedback Configuration
export const FEEDBACK = {
    // Channel ID for feedback submissions
    CHANNEL_ID: "1409858556164964432"
};

// Forwarder Configuration - loads from database
export const FORWARDER = {
    // Get forwarder configuration for a specific server (from database)
    async getConfig(guildId) {
        if (!botConfig) {
            throw new Error('Bot config not loaded. Call initializeConfig() first.');
        }
        if (!guildId) {
            throw new Error('Guild ID is required to get forwarder config.');
        }

        const server = await getServerByDiscordId(guildId);
        const settings = await db.getServerSettings(server.id, 'forwarder');

        if (!settings || !settings.settings) {
            return { production: [], test: [] };
        }

        return settings.settings;
    },


    // Get target channel ID and role mentions for a forwarder by source channel and server (used by official bot)
    // This matches forwarders based on:
    // - Source channel ID from selfbot
    // - Source guild ID from selfbot (which server the selfbot is in)
    async getForwarderConfigBySourceChannel(sourceChannelId, sourceGuildId) {
        if (!botConfig) {
            throw new Error('Bot config not loaded. Call initializeConfig() first.');
        }
        if (!sourceChannelId || !sourceGuildId) {
            throw new Error('Source channel ID and guild ID are required.');
        }

        // For official bot: search through all servers to find forwarder config
        // We need to match:
        // 1. The forwarder's server_id (database ID) corresponds to the source guild (selfbot's server)
        // 2. The source channel is in forwarder.source_channels

        const allGuilds = await db.getServersForBot(botConfig.id);
        const environment = botConfig.is_testing ? 'test' : 'production';

        // First, find which selfbot sent this message by checking all selfbots connected to this official bot
        const allBots = await db.getAllBots();
        const connectedSelfbots = allBots.filter(bot =>
            bot.bot_type === 'selfbot' && bot.connect_to === botConfig.id
        );

        // Search through all official bot servers
        for (const officialServer of allGuilds) {
            try {
                const forwarders = await this.getConfig(officialServer.discord_server_id);
                const envForwarders = forwarders[environment] || [];

                // For each forwarder, check if it matches
                for (const forwarder of envForwarders) {
                    // Skip if forwarder doesn't have source_channels
                    if (!forwarder.source_channels || !Array.isArray(forwarder.source_channels)) {
                        continue;
                    }

                    // Check if this forwarder has the source channel
                    const foundChannel = forwarder.source_channels.find(
                        ch => {
                            // Compare channel IDs (handle both string and number types)
                            const chId = String(ch?.channel_id || '');
                            const targetId = String(sourceChannelId || '');
                            return chId === targetId;
                        }
                    );
                    if (!foundChannel) {
                        continue;
                    }

                    // Verify the forwarder's server_id matches the source guild
                    // Find the selfbot that owns this forwarder
                    const forwarderSelfbot = connectedSelfbots.find(bot => bot.id === forwarder.selfbot_id);
                    if (!forwarderSelfbot) {
                        continue;
                    }

                    // Get the selfbot's server by Discord ID (source guild is the selfbot's server)
                    const selfbotServer = await db.getServerByDiscordId(forwarderSelfbot.id, sourceGuildId);
                    if (!selfbotServer) {
                        continue;
                    }

                    // Verify server_id matches (forwarder.server_id is database ID of selfbot's server)
                    if (String(selfbotServer.id) !== String(forwarder.server_id)) {
                        continue;
                    }

                    // Found matching forwarder!
                    return {
                        target_channel_id: forwarder.target_channel_id,
                        roles: forwarder.roles,
                        target_guild_id: officialServer.discord_server_id
                    };
                }
            } catch (err) {
                // Continue searching other servers
                continue;
            }
        }

        // No forwarder found - return null (official bot will skip forwarding)
        return null;
    }
};
