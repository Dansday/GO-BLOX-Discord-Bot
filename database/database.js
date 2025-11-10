import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import logger from '../backend/logger.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getConnectionConfig() {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (databaseUrl) {
        try {
            const url = new URL(databaseUrl);
            if (!url.hostname) throw new Error('Missing hostname in DATABASE_URL');
            if (!url.username) throw new Error('Missing username in DATABASE_URL');
            if (!url.password) throw new Error('Missing password in DATABASE_URL');
            if (!url.pathname || url.pathname.length <= 1) throw new Error('Missing database name in DATABASE_URL');
            
            if (!url.port) throw new Error('Missing port in DATABASE_URL');
            
            return {
                host: url.hostname,
                port: parseInt(url.port),
                user: url.username,
                password: url.password,
                database: url.pathname.slice(1)
            };
        } catch (error) {
            throw new Error(`Invalid DATABASE_URL: ${error.message}`);
        }
    }

    if (!process.env.DB_HOST) throw new Error('Missing DB_HOST environment variable');
    if (!process.env.DB_PORT) throw new Error('Missing DB_PORT environment variable');
    if (!process.env.DB_USER) throw new Error('Missing DB_USER environment variable');
    if (!process.env.DB_PASSWORD) throw new Error('Missing DB_PASSWORD environment variable');
    if (!process.env.DB_NAME) throw new Error('Missing DB_NAME environment variable');
    
    return {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    };
}

const connectionConfig = getConnectionConfig();

console.log(`🔌 Database connection: mysql://${connectionConfig.user}@${connectionConfig.host}:${connectionConfig.port}/${connectionConfig.database}`);

let pool = null;

function getPool() {
    if (!pool) {
        pool = mysql.createPool({
            ...connectionConfig,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
    }
    return pool;
}

function toMySQLDateTime(date) {
    if (!date) date = new Date();
    if (typeof date === 'string') date = new Date(date);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function query(sql, params = []) {
    const connection = await getPool().getConnection();
    try {
        const [rows] = await connection.execute(sql, params);
        return rows;
    } finally {
        connection.release();
    }
}

async function runMigration() {
    const connection = await mysql.createConnection(connectionConfig);
    
    try {
        logger.log('🔌 Connecting to database...');
        await connection.connect();
        logger.log('✅ Connected to database');

        const schemaPath = join(__dirname, 'schema.sql');
        const schemaSQL = readFileSync(schemaPath, 'utf-8');

        logger.log('📦 Executing schema...');

        const statements = schemaSQL
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const statement of statements) {
            if (statement.length > 0) {
                await connection.query(statement);
            }
        }

        logger.log('✅ Database schema created successfully!');
        logger.log('📊 Tables created: panel, panel_logs, bots, servers, categories, channels, roles, server_settings');
        logger.log('📈 Indexes created: all indexes');

    } catch (error) {
        logger.log(`❌ Migration failed: ${error.message}`);
        if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            logger.log('💡 Authentication failed. Check your database credentials.');
        } else if (error.code === 'ECONNREFUSED') {
            logger.log('💡 Connection refused. Check your connection settings and network.');
        }
        throw error;
    } finally {
        await connection.end();
        logger.log('🔌 Database connection closed');
    }
}

async function setupDatabase() {
    logger.log('🔍 Checking database tables...');

    const tables = [
        { name: 'panel', required: true },
        { name: 'panel_logs', required: true },
        { name: 'bots', required: true },
        { name: 'servers', required: true },
        { name: 'categories', required: true },
        { name: 'channels', required: true },
        { name: 'roles', required: true },
        { name: 'server_settings', required: true }
    ];

    const missingTables = [];

    for (const table of tables) {
        try {
            const result = await query(
                `SELECT COUNT(*) as count FROM information_schema.tables 
                 WHERE table_schema = ? AND table_name = ?`,
                [connectionConfig.database, table.name]
            );

            const exists = result[0]?.count > 0;

            if (!exists) {
                missingTables.push(table.name);
                logger.log(`❌ Table '${table.name}' does not exist`);
            } else {
                logger.log(`✅ Table '${table.name}' exists`);
            }
        } catch (err) {
            logger.log(`⚠️  Error checking table '${table.name}': ${err.message}`);
            if (table.required) {
                missingTables.push(table.name);
            }
        }
    }

    if (missingTables.length > 0) {
        logger.log(`❌ Missing tables: ${missingTables.join(', ')}`);

        try {
            logger.log('🔧 Attempting automatic table creation...');
            await runMigration();
            logger.log('✅ Tables created automatically');
            return true;
        } catch (migrateError) {
            logger.log(`⚠️  Automatic migration failed: ${migrateError.message}`);
            logger.log('📄 Please run the SQL schema manually in your MySQL client');
            throw new Error(`Missing tables: ${missingTables.join(', ')}`);
        }
    }

    logger.log('✅ All database tables verified');
    return true;
}

let dbInitialized = false;

export async function initializeDatabase() {
    if (dbInitialized) return;

    try {
        await setupDatabase();
        dbInitialized = true;
    } catch (error) {
        logger.log(`⚠️  Database initialization: ${error.message}`);
        logger.log(`💡 Set DATABASE_URL or DB_* environment variables to enable automatic table creation`);
        logger.log(`📄 Or run the SQL schema from database/schema.sql in your MySQL client`);
    }
}

async function retryOnConnectionError(fn, maxRetries = 3, delayMs = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const isConnectionError = error.code === 'ECONNREFUSED' || 
                                     error.code === 'ETIMEDOUT' ||
                                     error.code === 'PROTOCOL_CONNECTION_LOST';
            
            if (isConnectionError && attempt < maxRetries) {
                console.log(`⚠️  Connection error (attempt ${attempt}/${maxRetries}). Retrying in ${delayMs/1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }
            throw error;
        }
    }
}

export async function getAllBots() {
    await initializeDatabase();
    return await retryOnConnectionError(async () => {
        const result = await query('SELECT * FROM bots ORDER BY created_at ASC');
        return result;
    });
}

export async function getBot(botId) {
    await initializeDatabase();
    return await retryOnConnectionError(async () => {
        const result = await query('SELECT * FROM bots WHERE id = ? LIMIT 1', [botId]);
        return result[0] || null;
    });
}

export async function createBot(botData) {
    try {
        await initializeDatabase();

        const bots = await getAllBots();
        const botNumber = bots.length + 1;

        const connection = await getPool().getConnection();
        try {
            const [result] = await connection.execute(
                `INSERT INTO bots (
                    name, token, application_id, bot_type, bot_icon, port, secret_key, connect_to, panel_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    botData.name || `Bot#${botNumber}`,
                    botData.token,
                    botData.application_id || null,
                    botData.bot_type,
                    botData.bot_icon || null,
                    botData.port !== undefined ? botData.port : (botData.bot_type === 'official' ? 7777 : null),
                    botData.secret_key || null,
                    botData.connect_to || null,
                    botData.panel_id || null
                ]
            );

            const insertedBots = await query('SELECT * FROM bots WHERE id = ?', [result.insertId]);
            return insertedBots[0];
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error creating bot:', error);
        throw error;
    }
}

export async function updateBot(botId, botData) {
    try {
        const updateData = {
            ...botData,
            updated_at: toMySQLDateTime()
        };

        if (botData.status === 'running' && !botData.uptime_started_at) {
            updateData.uptime_started_at = toMySQLDateTime();
        } else if (botData.uptime_started_at) {
            updateData.uptime_started_at = toMySQLDateTime(botData.uptime_started_at);
        }

        if (botData.status === 'stopped') {
            updateData.uptime_started_at = null;
            updateData.process_id = null;
        }

        const fields = Object.keys(updateData).filter(key => updateData[key] !== undefined);
        if (fields.length === 0) {
            return await getBot(botId);
        }

        const setClause = fields.map(field => `${field} = ?`).join(', ');
        const values = fields.map(field => updateData[field]);
        values.push(botId);

        await query(
            `UPDATE bots SET ${setClause} WHERE id = ?`,
            values
        );

        return await getBot(botId);
    } catch (error) {
        console.error('Error updating bot:', error);
        throw error;
    }
}

export async function deleteBot(botId) {
    try {
        await query('DELETE FROM bots WHERE id = ?', [botId]);
        return true;
    } catch (error) {
        console.error('Error deleting bot:', error);
        throw error;
    }
}

export async function getServersForBot(botId) {
    const result = await query('SELECT * FROM servers WHERE bot_id = ? ORDER BY name ASC', [botId]);
    return result;
}

export async function getServerByDiscordId(botId, discordServerId) {
    await initializeDatabase();
    const result = await query(
        'SELECT * FROM servers WHERE bot_id = ? AND discord_server_id = ? LIMIT 1',
        [botId, discordServerId]
    );
    return result[0] || null;
}

export async function upsertServer(botId, guild) {
    try {
        const iconUrl = guild.iconURL ? guild.iconURL({ dynamic: true }) : null;

        let boostLevel = 0;
        if (guild.premiumTier) {
            const tierString = String(guild.premiumTier);
            if (tierString.includes('TIER_')) {
                const tierMatch = tierString.match(/TIER_(\d+)/);
                if (tierMatch) {
                    boostLevel = parseInt(tierMatch[1], 10);
                } else {
                    boostLevel = parseInt(tierString, 10) || 0;
                }
            } else {
                boostLevel = parseInt(tierString, 10) || 0;
            }
        }

        await query(
            `INSERT INTO servers (
                bot_id, discord_server_id, name, total_members, total_channels,
                total_boosters, boost_level, server_icon, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                total_members = VALUES(total_members),
                total_channels = VALUES(total_channels),
                total_boosters = VALUES(total_boosters),
                boost_level = VALUES(boost_level),
                server_icon = VALUES(server_icon),
                updated_at = VALUES(updated_at)`,
            [
                botId, guild.id, guild.name, guild.memberCount || 0,
                guild.channels?.cache?.size || 0, guild.premiumSubscriptionCount || 0,
                boostLevel, iconUrl, toMySQLDateTime()
            ]
        );

        const servers = await query(
            'SELECT * FROM servers WHERE bot_id = ? AND discord_server_id = ?',
            [botId, guild.id]
        );
        return servers[0];
    } catch (error) {
        console.error('Error upserting server:', error);
        throw error;
    }
}

export async function upsertCategory(serverId, categoryData) {
    try {
        await query(
            `INSERT INTO categories (
                server_id, discord_category_id, name, position, updated_at
            ) VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                position = VALUES(position),
                updated_at = VALUES(updated_at)`,
            [
                serverId, categoryData.id, categoryData.name,
                categoryData.position !== undefined ? categoryData.position : null,
                toMySQLDateTime()
            ]
        );

        const categories = await query(
            'SELECT * FROM categories WHERE server_id = ? AND discord_category_id = ?',
            [serverId, categoryData.id]
        );
        return categories[0];
    } catch (error) {
        console.error('Error upserting category:', error);
        throw error;
    }
}

export async function syncCategories(serverId, categories) {
    try {
        if (!categories || categories.length === 0) {
            return new Map();
        }

        const operations = categories.map(category =>
            upsertCategory(serverId, {
                id: category.id,
                name: category.name,
                position: category.position
            }).catch(err => {
                console.error(`Error upserting category ${category.id}:`, err.message);
                return null;
            })
        );

        const allResults = await Promise.all(operations);

        const categoryMap = new Map();
        allResults.forEach(cat => {
            if (cat) {
                categoryMap.set(cat.discord_category_id, cat.id);
            }
        });

        const discordCategoryIds = new Set(categories.map(cat => cat.id));
        
        const dbCategories = await query(
            'SELECT id, discord_category_id FROM categories WHERE server_id = ?',
            [serverId]
        );

        if (dbCategories && dbCategories.length > 0) {
            const categoriesToDelete = dbCategories.filter(dbCat => 
                !discordCategoryIds.has(dbCat.discord_category_id)
            );

            if (categoriesToDelete.length > 0) {
                const idsToDelete = categoriesToDelete.map(cat => cat.id);
                const placeholders = idsToDelete.map(() => '?').join(',');
                await query(
                    `DELETE FROM categories WHERE id IN (${placeholders})`,
                    idsToDelete
                );
                console.log(`🧹 Removed ${idsToDelete.length} deleted category(ies) from database`);
            }
        }

        return categoryMap;
    } catch (error) {
        console.error('Error syncing categories:', error);
        return new Map();
    }
}

export async function upsertChannel(serverId, channelData, categoryMap = null) {
    try {
        let categoryId = null;
        if (channelData.parent_id && categoryMap) {
            categoryId = categoryMap.get(channelData.parent_id) || null;
        }

        await query(
            `INSERT INTO channels (
                server_id, discord_channel_id, name, type, category_id, position, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                type = VALUES(type),
                category_id = VALUES(category_id),
                position = VALUES(position),
                updated_at = VALUES(updated_at)`,
            [
                serverId, channelData.id, channelData.name, channelData.type,
                categoryId, channelData.position !== undefined ? channelData.position : null,
                toMySQLDateTime()
            ]
        );

        const channels = await query(
            'SELECT * FROM channels WHERE server_id = ? AND discord_channel_id = ?',
            [serverId, channelData.id]
        );
        return channels[0];
    } catch (error) {
        console.error('Error upserting channel:', error);
        throw error;
    }
}

export async function syncChannels(serverId, channels, categoryMap = null) {
    try {
        const validChannels = channels.filter(ch => ch.type !== 4);

        try {
            const existingCategoryChannels = await query(
                'SELECT id, discord_channel_id FROM channels WHERE server_id = ? AND type = ?',
                [serverId, '4']
            );

            if (existingCategoryChannels && existingCategoryChannels.length > 0) {
                const categoryIds = existingCategoryChannels.map(ch => ch.id);
                const placeholders = categoryIds.map(() => '?').join(',');
                await query(
                    `DELETE FROM channels WHERE id IN (${placeholders})`,
                    categoryIds
                );
                console.log(`🧹 Removed ${categoryIds.length} category(ies) from channels table`);
            }
        } catch (cleanupError) {
            console.error('Error cleaning up categories from channels table:', cleanupError.message);
        }

        const operations = validChannels.map(channel =>
            upsertChannel(serverId, {
                id: channel.id,
                name: channel.name,
                type: channel.type,
                parent_id: channel.parent_id || null,
                position: channel.position
            }, categoryMap).catch(err => {
                console.error(`Error upserting channel ${channel.id}:`, err.message);
                return null;
            })
        );

        await Promise.all(operations);

        const discordChannelIds = new Set(validChannels.map(ch => ch.id));
        
        const dbChannels = await query(
            'SELECT id, discord_channel_id FROM channels WHERE server_id = ?',
            [serverId]
        );

        if (dbChannels && dbChannels.length > 0) {
            const channelsToDelete = dbChannels.filter(dbCh => 
                !discordChannelIds.has(dbCh.discord_channel_id)
            );

            if (channelsToDelete.length > 0) {
                const idsToDelete = channelsToDelete.map(ch => ch.id);
                const placeholders = idsToDelete.map(() => '?').join(',');
                await query(
                    `DELETE FROM channels WHERE id IN (${placeholders})`,
                    idsToDelete
                );
                console.log(`🧹 Removed ${idsToDelete.length} deleted channel(s) from database`);
            }
        }

        return true;
    } catch (error) {
        console.error('Error syncing channels:', error);
        return false;
    }
}

export async function getRoles(serverId) {
    const result = await query(
        'SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC',
        [serverId]
    );
    return result;
}

export async function upsertRole(serverId, roleData) {
    try {
        await query(
            `INSERT INTO roles (
                server_id, discord_role_id, name, position, color, permissions, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                position = VALUES(position),
                color = VALUES(color),
                permissions = VALUES(permissions),
                updated_at = VALUES(updated_at)`,
            [
                serverId, roleData.id, roleData.name, roleData.position,
                roleData.hexColor, roleData.permissions?.bitfield?.toString() || null,
                toMySQLDateTime()
            ]
        );

        const roles = await query(
            'SELECT * FROM roles WHERE server_id = ? AND discord_role_id = ?',
            [serverId, roleData.id]
        );
        return roles[0];
    } catch (error) {
        console.error('Error upserting role:', error);
        throw error;
    }
}

export async function syncRoles(serverId, roles) {
    try {
        if (!roles || roles.length === 0) {
            return true;
        }

        const operations = roles.map(role =>
            upsertRole(serverId, {
                id: role.id,
                name: role.name,
                position: role.position,
                hexColor: role.hexColor,
                permissions: role.permissions
            }).catch(err => {
                console.error(`Error upserting role ${role.id}:`, err.message);
                return null;
            })
        );

        await Promise.all(operations);

        const discordRoleIds = new Set(roles.map(role => role.id));
        
        const dbRoles = await query(
            'SELECT id, discord_role_id FROM roles WHERE server_id = ?',
            [serverId]
        );

        if (dbRoles && dbRoles.length > 0) {
            const rolesToDelete = dbRoles.filter(dbRole => 
                !discordRoleIds.has(dbRole.discord_role_id)
            );

            if (rolesToDelete.length > 0) {
                const idsToDelete = rolesToDelete.map(role => role.id);
                const placeholders = idsToDelete.map(() => '?').join(',');
                await query(
                    `DELETE FROM roles WHERE id IN (${placeholders})`,
                    idsToDelete
                );
                console.log(`🧹 Removed ${idsToDelete.length} deleted role(s) from database`);
            }
        }

        return true;
    } catch (error) {
        console.error('Error syncing roles:', error);
        return false;
    }
}

async function getPanel() {
    const result = await query('SELECT * FROM panel LIMIT 1');
    return result[0] || null;
}

async function createPanel(passwordHash) {
    const existing = await getPanel();
    if (existing) {
        throw new Error('Panel already exists');
    }

    const connection = await getPool().getConnection();
    try {
        const [result] = await connection.execute('INSERT INTO panel (password_hash) VALUES (?)', [passwordHash]);
        const panels = await query('SELECT * FROM panel WHERE id = ?', [result.insertId]);
        return panels[0];
    } finally {
        connection.release();
    }
}

async function updatePanelPassword(panelId, passwordHash) {
    await query(
        'UPDATE panel SET password_hash = ?, updated_at = ? WHERE id = ?',
        [passwordHash, toMySQLDateTime(), panelId]
    );
    const panels = await query('SELECT * FROM panel WHERE id = ?', [panelId]);
    return panels[0];
}

async function createPanelLog(logData) {
    const connection = await getPool().getConnection();
    try {
        const [result] = await connection.execute(
            `INSERT INTO panel_logs (
                panel_id, ip_address, user_agent, success, attempted_at
            ) VALUES (?, ?, ?, ?, ?)`,
            [
                logData.panel_id || null,
                logData.ip_address,
                logData.user_agent || null,
                logData.success || false,
                logData.attempted_at ? toMySQLDateTime(logData.attempted_at) : toMySQLDateTime()
            ]
        );
        const logs = await query('SELECT * FROM panel_logs WHERE id = ?', [result.insertId]);
        return logs[0];
    } finally {
        connection.release();
    }
}

async function getPanelLogs(limit) {
    const result = await query(
        'SELECT * FROM panel_logs ORDER BY attempted_at DESC LIMIT ?',
        [limit]
    );
    return result;
}

async function getServerSettings(serverId, componentName = null) {
    await initializeDatabase();
    
    let result;
    if (componentName) {
        result = await query(
            'SELECT * FROM server_settings WHERE server_id = ? AND component_name = ? LIMIT 1',
            [serverId, componentName]
        );
        if (result[0] && result[0].settings) {
            try {
                result[0].settings = typeof result[0].settings === 'string' 
                    ? JSON.parse(result[0].settings) 
                    : result[0].settings;
            } catch (e) {
                console.error('Error parsing settings JSON:', e);
                result[0].settings = {};
            }
        }
    } else {
        result = await query(
            'SELECT * FROM server_settings WHERE server_id = ?',
            [serverId]
        );
        result = result.map(row => {
            if (row.settings) {
                try {
                    row.settings = typeof row.settings === 'string' 
                        ? JSON.parse(row.settings) 
                        : row.settings;
                } catch (e) {
                    console.error('Error parsing settings JSON:', e);
                    row.settings = {};
                }
            }
            return row;
        });
    }

    return componentName ? (result[0] || null) : result;
}

async function upsertServerSettings(serverId, componentName, settings) {
    try {
        await initializeDatabase();
        const now = toMySQLDateTime();
        
        await query(
            `INSERT INTO server_settings (server_id, component_name, settings, updated_at)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 settings = VALUES(settings),
                 updated_at = VALUES(updated_at)`,
            [serverId, componentName, JSON.stringify(settings), now]
        );

        const resultSettings = await query(
            'SELECT * FROM server_settings WHERE server_id = ? AND component_name = ?',
            [serverId, componentName]
        );
        return resultSettings[0];
    } catch (error) {
        console.error('Error upserting server settings:', error);
        throw error;
    }
}

async function getChannelsForServer(serverId) {
    await initializeDatabase();
    const result = await query(
        'SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, name ASC',
        [serverId]
    );
    return result;
}

async function getCategoriesForServer(serverId) {
    await initializeDatabase();
    const result = await query(
        'SELECT * FROM categories WHERE server_id = ? ORDER BY position ASC',
        [serverId]
    );
    return result;
}

export default {
    getAllBots,
    getBot,
    createBot,
    updateBot,
    deleteBot,
    getServersForBot,
    getServerByDiscordId,
    upsertServer,
    upsertCategory,
    syncCategories,
    upsertChannel,
    syncChannels,
    getRoles,
    upsertRole,
    syncRoles,
    getPanel,
    createPanel,
    updatePanelPassword,
    createPanelLog,
    getPanelLogs,
    getServerSettings,
    upsertServerSettings,
    getChannelsForServer,
    getCategoriesForServer
};
