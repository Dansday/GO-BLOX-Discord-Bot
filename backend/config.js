// Backend Configuration for both Self-Bot and Official Bot
import db from '../database/database.js';

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

// Helper function to validate bot config is loaded
function requireBotConfig() {
    if (!botConfig) {
        throw new Error('Bot config not loaded. Call initializeConfig() first.');
    }
}

// Helper function to validate guild ID
function requireGuildId(guildId, action = 'operation') {
    if (!guildId) {
        throw new Error(`Guild ID is required for ${action}.`);
    }
}

// Helper function to get official bot ID (handles selfbot connection)
function getOfficialBotId() {
    requireBotConfig();
    if (botConfig.bot_type === 'selfbot' && botConfig.connect_to) {
        return botConfig.connect_to;
    }
    return botConfig.id;
}

// Helper function to get server for current bot (not official bot)
export async function getServerForCurrentBot(guildId) {
    requireBotConfig();
    requireGuildId(guildId, 'getting server');

    const server = await db.getServerByDiscordId(botConfig.id, guildId);
    if (!server) {
        throw new Error(`Server not found for guild ${guildId}`);
    }

    return server;
}

// Helper function to get official bot server for a guild
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

// Helper function to get server settings for a component
async function getServerSettingsForComponent(guildId, componentName) {
    const officialBotServer = await getOfficialBotServer(guildId);
    const settings = await db.getServerSettings(officialBotServer.id, componentName);

    if (!settings || !settings.settings) {
        throw new Error(`Server settings not found for guild ${guildId} (component: ${componentName})`);
    }

    return settings;
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

// Get main channel for a specific server (from server settings)
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

// Permissions Configuration - loads from database
export const PERMISSIONS = {
    // Get permissions for a specific guild (Discord guild ID)
    async getPermissions(guildId) {
        requireGuildId(guildId, 'permissions');

        // Get server by Discord ID (for permissions, use current bot's server, not official bot)
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
    requireBotConfig();
    requireGuildId(guildId, 'getting embed config');

    const officialBotServer = await getOfficialBotServer(guildId);
    const settings = await getServerSettingsForComponent(guildId, 'main_config');
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
    requireBotConfig();
    requireGuildId(guildId, 'getting logger channel');

    const settings = await getServerSettingsForComponent(guildId, 'main_config');

    if (!settings.settings.logger_channel) {
        throw new Error(`Logger channel not configured for guild ${guildId}`);
    }

    return settings.settings.logger_channel;
}

// Welcomer Configuration
export const WELCOMER = {
    // Get welcome channels for a guild (from database)
    async getChannels(guildId) {
        requireBotConfig();
        requireGuildId(guildId, 'getting welcomer channels');

        const settings = await db.getServerSettings((await getOfficialBotServer(guildId)).id, 'welcomer');

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
        requireBotConfig();
        requireGuildId(guildId, 'getting welcomer messages');

        const settings = await db.getServerSettings((await getOfficialBotServer(guildId)).id, 'welcomer');

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
        requireBotConfig();
        requireGuildId(guildId, 'getting booster channels');

        const settings = await db.getServerSettings((await getOfficialBotServer(guildId)).id, 'booster');

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
        requireBotConfig();
        requireGuildId(guildId, 'getting booster messages');

        const settings = await db.getServerSettings((await getOfficialBotServer(guildId)).id, 'booster');

        // If booster config exists and has messages, use them
        if (settings && settings.settings && settings.settings.messages && settings.settings.messages.length > 0) {
            return settings.settings.messages;
        }

        // Otherwise, return empty array (no messages configured)
        return [];
    }
};

// Custom Supporter Role Configuration - loads from database
export const CUSTOM_SUPPORTER_ROLE = {
    // Get role constraints for a guild (from database)
    async getRoleConstraints(guildId) {
        requireBotConfig();
        requireGuildId(guildId, 'getting custom role constraints');

        const settings = await db.getServerSettings((await getOfficialBotServer(guildId)).id, 'custom_supporter_role');

        // If custom role config exists, use it
        if (settings && settings.settings) {
            return {
                ROLE_START: settings.settings.role_start || null,
                ROLE_END: settings.settings.role_end || null
            };
        }

        // Otherwise, return null for both (no constraints configured)
        return {
            ROLE_START: null,
            ROLE_END: null
        };
    }
};

// Feedback Configuration - loads from database
export const FEEDBACK = {
    // Get feedback channel for a guild (from database)
    async getChannel(guildId) {
        requireBotConfig();
        requireGuildId(guildId, 'getting feedback channel');

        const settings = await db.getServerSettings((await getOfficialBotServer(guildId)).id, 'feedback');

        // If feedback config exists and has a channel, use it
        if (settings && settings.settings && settings.settings.feedback_channel) {
            return settings.settings.feedback_channel;
        }

        // Otherwise, return null (no channel configured)
        return null;
    }
};

// Forwarder Configuration - loads from database
export const FORWARDER = {
    // Get forwarder configuration for a specific server (from database)
    async getConfig(guildId) {
        requireBotConfig();
        requireGuildId(guildId, 'getting forwarder config');

        // For selfbots, forwarder config is stored on the official bot's server
        // For official bots, forwarder config is stored on their own server
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


    // Check if a channel should be forwarded (used by selfbot to filter messages before sending)
    async shouldForwardChannel(channelId, guildId) {
        requireBotConfig();
        if (!channelId || !guildId) {
            return false;
        }

        // Only selfbots should check this
        if (botConfig.bot_type !== 'selfbot' || !botConfig.connect_to) {
            return false;
        }

        try {
            // Get the selfbot's server database ID
            const selfbotServer = await db.getServerByDiscordId(botConfig.id, guildId);
            if (!selfbotServer) {
                return false;
            }

            // Get the connected official bot
            const officialBot = await db.getBot(botConfig.connect_to);
            if (!officialBot) {
                return false;
            }

            // Get all servers for the official bot
            const officialServers = await db.getServersForBot(officialBot.id);
            const environment = botConfig.is_testing ? 'testing' : 'production';

            // Check all official bot servers for forwarder configs
            for (const officialServer of officialServers) {
                try {
                    const forwarders = await this.getConfig(officialServer.discord_server_id);
                    const envForwarders = forwarders[environment] || [];

                    // Check each forwarder
                    for (const forwarder of envForwarders) {
                        // Check if this forwarder is for this selfbot and this server
                        if (String(forwarder.selfbot_id) !== String(botConfig.id)) {
                            continue;
                        }
                        if (String(forwarder.server_id) !== String(selfbotServer.id)) {
                            continue;
                        }

                        // Check if the channel is in source_channels
                        if (forwarder.source_channels && Array.isArray(forwarder.source_channels)) {
                            const foundChannel = forwarder.source_channels.find(
                                ch => String(ch?.channel_id || '') === String(channelId)
                            );
                            if (foundChannel) {
                                return true; // This channel should be forwarded
                            }
                        }
                    }
                } catch (err) {
                    // Continue searching other servers
                    continue;
                }
            }

            return false; // No forwarder found for this channel
        } catch (err) {
            // On error, don't forward (fail-safe)
            return false;
        }
    },

    // Get target channel ID and role mentions for a forwarder by source channel and server (used by official bot)
    // This matches forwarders based on:
    // - Source channel ID from selfbot
    // - Source guild ID from selfbot (which server the selfbot is in)
    async getForwarderConfigBySourceChannel(sourceChannelId, sourceGuildId) {
        requireBotConfig();
        if (!sourceChannelId || !sourceGuildId) {
            throw new Error('Source channel ID and guild ID are required.');
        }

        // For official bot: search through all servers to find forwarder config
        // We need to match:
        // 1. The forwarder's server_id (database ID) corresponds to the source guild (selfbot's server)
        // 2. The source channel is in forwarder.source_channels

        const allGuilds = await db.getServersForBot(botConfig.id);
        const environment = botConfig.is_testing ? 'testing' : 'production';

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
