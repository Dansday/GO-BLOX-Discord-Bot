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

const BOT_LOG_RETENTION_DAYS = 7;
const BOT_LOG_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastBotLogPurgeCheck = 0;

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
        logger.log('📊 Tables created: panel, panel_logs, bots, servers, server_categories, server_channels, server_roles, server_members, server_member_levels, server_member_roles, server_members_afk, server_settings, bot_logs');
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
        { name: 'server_categories', required: true },
        { name: 'server_channels', required: true },
        { name: 'server_roles', required: true },
        { name: 'server_members', required: true },
        { name: 'server_member_levels', required: true },
        { name: 'server_member_roles', required: true },
        { name: 'server_members_afk', required: true },
        { name: 'server_settings', required: true },
        { name: 'bot_logs', required: true }
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

    try {
        const columnsResult = await query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'server_members' AND COLUMN_NAME IN ('is_booster', 'booster_since')`,
            [connectionConfig.database]
        );

        const existingColumns = columnsResult.map(row => row.COLUMN_NAME);

        if (!existingColumns.includes('is_booster')) {
            logger.log('🔧 Adding is_booster column to server_members table...');
            await query('ALTER TABLE server_members ADD COLUMN is_booster BOOLEAN DEFAULT FALSE');
            logger.log('✅ Added is_booster column');
        }

        if (!existingColumns.includes('booster_since')) {
            logger.log('🔧 Adding booster_since column to server_members table...');
            await query('ALTER TABLE server_members ADD COLUMN booster_since TIMESTAMP NULL');
            logger.log('✅ Added booster_since column');
        }

        const serverDisplayNameCheck = await query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'server_members' AND COLUMN_NAME = 'server_display_name'`,
            [connectionConfig.database]
        );

        if (!serverDisplayNameCheck || serverDisplayNameCheck.length === 0) {
            logger.log('🔧 Adding server_display_name column to server_members table...');
            await query('ALTER TABLE server_members ADD COLUMN server_display_name TEXT');
            logger.log('✅ Added server_display_name column');
        }
    } catch (err) {
        logger.log(`⚠️  Error checking/adding columns: ${err.message}`);
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
                console.log(`⚠️  Connection error (attempt ${attempt}/${maxRetries}). Retrying in ${delayMs / 1000}s...`);
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
            `INSERT INTO server_categories (
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
            'SELECT * FROM server_categories WHERE server_id = ? AND discord_category_id = ?',
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
            'SELECT id, discord_category_id FROM server_categories WHERE server_id = ?',
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
                    `DELETE FROM server_categories WHERE server_id = ? AND id IN (${placeholders})`,
                    [serverId, ...idsToDelete]
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
            `INSERT INTO server_channels (
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
            'SELECT * FROM server_channels WHERE server_id = ? AND discord_channel_id = ?',
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
                'SELECT id, discord_channel_id FROM server_channels WHERE server_id = ? AND type = ?',
                [serverId, '4']
            );

            if (existingCategoryChannels && existingCategoryChannels.length > 0) {
                const categoryIds = existingCategoryChannels.map(ch => ch.id);
                const placeholders = categoryIds.map(() => '?').join(',');
                await query(
                    `DELETE FROM server_channels WHERE server_id = ? AND id IN (${placeholders})`,
                    [serverId, ...categoryIds]
                );
                console.log(`🧹 Removed ${categoryIds.length} category(ies) from server_channels table`);
            }
        } catch (cleanupError) {
            console.error('Error cleaning up categories from server_channels table:', cleanupError.message);
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
            'SELECT id, discord_channel_id FROM server_channels WHERE server_id = ?',
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
                    `DELETE FROM server_channels WHERE server_id = ? AND id IN (${placeholders})`,
                    [serverId, ...idsToDelete]
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
        'SELECT * FROM server_roles WHERE server_id = ? ORDER BY position DESC',
        [serverId]
    );
    return result;
}

export async function upsertRole(serverId, roleData) {
    try {
        await query(
            `INSERT INTO server_roles (
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
            'SELECT * FROM server_roles WHERE server_id = ? AND discord_role_id = ?',
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
            'SELECT id, discord_role_id FROM server_roles WHERE server_id = ?',
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
                    `DELETE FROM server_roles WHERE server_id = ? AND id IN (${placeholders})`,
                    [serverId, ...idsToDelete]
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

export async function upsertMember(serverId, memberData) {
    try {
        const user = memberData.user || memberData;
        const avatarUrl = user?.displayAvatarURL ? user.displayAvatarURL({ dynamic: true }) : null;
        const username = user?.username || null;
        const displayName = user?.globalName || user?.displayName || null;
        const serverDisplayName = memberData.nickname || null;
        const profileCreatedAt = user?.createdAt ? toMySQLDateTime(user.createdAt) : null;
        const memberSince = memberData.joinedAt ? toMySQLDateTime(memberData.joinedAt) : null;
        const isBooster = memberData.premiumSince !== null && memberData.premiumSince !== undefined;
        const boosterSince = memberData.premiumSince ? toMySQLDateTime(memberData.premiumSince) : null;

        await query(
            `INSERT INTO server_members (
                server_id, discord_member_id, username, display_name, server_display_name, avatar, profile_created_at, member_since, is_booster, booster_since, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                username = VALUES(username),
                display_name = VALUES(display_name),
                server_display_name = VALUES(server_display_name),
                avatar = VALUES(avatar),
                profile_created_at = VALUES(profile_created_at),
                member_since = VALUES(member_since),
                is_booster = VALUES(is_booster),
                booster_since = VALUES(booster_since),
                updated_at = VALUES(updated_at)`,
            [
                serverId, user?.id || memberData.id, username, displayName, serverDisplayName,
                avatarUrl, profileCreatedAt, memberSince, isBooster, boosterSince, toMySQLDateTime()
            ]
        );

        const members = await query(
            'SELECT * FROM server_members WHERE server_id = ? AND discord_member_id = ?',
            [serverId, user?.id || memberData.id]
        );
        return members[0];
    } catch (error) {
        console.error('Error upserting member:', error);
        throw error;
    }
}

export async function getMemberByDiscordId(serverId, discordMemberId) {
    await initializeDatabase();
    const result = await query(
        'SELECT * FROM server_members WHERE server_id = ? AND discord_member_id = ? LIMIT 1',
        [serverId, discordMemberId]
    );
    return result[0] || null;
}

export async function syncMemberRoles(memberId, discordRoleIds, serverId) {
    try {
        if (!discordRoleIds || discordRoleIds.length === 0) {
            await query(
                `DELETE smr FROM server_member_roles smr
                 INNER JOIN server_members sm ON smr.member_id = sm.id
                 WHERE smr.member_id = ? AND sm.server_id = ?`,
                [memberId, serverId]
            );
            return true;
        }

        const placeholders = discordRoleIds.map(() => '?').join(',');
        const roleMapResult = await query(
            `SELECT id, discord_role_id FROM server_roles WHERE server_id = ? AND discord_role_id IN (${placeholders})`,
            [serverId, ...discordRoleIds]
        );

        const roleMap = new Map();
        for (const role of roleMapResult) {
            roleMap.set(role.discord_role_id, role.id);
        }

        const roleIdsToAdd = [];
        for (const discordRoleId of discordRoleIds) {
            const roleId = roleMap.get(discordRoleId);
            if (roleId) {
                roleIdsToAdd.push(roleId);
            }
        }

        const existingRoles = await query(
            `SELECT smr.role_id 
             FROM server_member_roles smr
             INNER JOIN server_members sm ON smr.member_id = sm.id
             WHERE smr.member_id = ? AND sm.server_id = ?`,
            [memberId, serverId]
        );
        const existingRoleIds = new Set(existingRoles.map(r => r.role_id));

        const rolesToAdd = roleIdsToAdd.filter(roleId => !existingRoleIds.has(roleId));
        const rolesToRemove = Array.from(existingRoleIds).filter(roleId => !roleIdsToAdd.includes(roleId));

        if (rolesToAdd.length > 0) {
            const placeholders = rolesToAdd.map(() => '(?, ?, ?)').join(', ');
            const values = rolesToAdd.flatMap(roleId => [memberId, roleId, false]);
            await query(
                `INSERT INTO server_member_roles (member_id, role_id, is_custom) VALUES ${placeholders}`,
                values
            );
        }

        if (rolesToRemove.length > 0) {
            const placeholders = rolesToRemove.map(() => '?').join(', ');
            await query(
                `DELETE smr FROM server_member_roles smr
                 INNER JOIN server_members sm ON smr.member_id = sm.id
                 WHERE smr.member_id = ? AND sm.server_id = ? AND smr.role_id IN (${placeholders})`,
                [memberId, serverId, ...rolesToRemove]
            );
        }

        return true;
    } catch (error) {
        console.error('Error syncing member roles:', error);
        return false;
    }
}

export async function memberHasAnyRole(discordMemberId, discordRoleIds, serverId) {
    try {
        if (!discordRoleIds || discordRoleIds.length === 0) return false;
        if (!discordMemberId || !serverId) return false;

        const memberResult = await query(
            'SELECT id FROM server_members WHERE server_id = ? AND discord_member_id = ?',
            [serverId, discordMemberId]
        );

        if (!memberResult || memberResult.length === 0) {
            return false;
        }

        const memberId = memberResult[0].id;

        const placeholders = discordRoleIds.map(() => '?').join(',');
        const roleResult = await query(
            `SELECT sr.id 
             FROM server_roles sr
             INNER JOIN server_member_roles smr ON sr.id = smr.role_id
             INNER JOIN server_members sm ON smr.member_id = sm.id
             WHERE smr.member_id = ? AND sm.server_id = ? AND sr.discord_role_id IN (${placeholders})`,
            [memberId, serverId, ...discordRoleIds]
        );

        return roleResult && roleResult.length > 0;
    } catch (error) {
        console.error('Error checking member roles:', error);
        return false;
    }
}

export async function getMemberLevel(memberId) {
    await initializeDatabase();
    const result = await query(
        'SELECT * FROM server_member_levels WHERE member_id = ? LIMIT 1',
        [memberId]
    );
    return result[0] || null;
}

export async function ensureMemberLevel(memberId) {
    await initializeDatabase();
    await query(
        `INSERT INTO server_member_levels (member_id)
         VALUES (?)
         ON DUPLICATE KEY UPDATE member_id = VALUES(member_id)`,
        [memberId]
    );
    return await getMemberLevel(memberId);
}

export async function updateMemberLevelStats(memberId, updates = {}) {
    await initializeDatabase();
    if (!memberId) {
        throw new Error('memberId is required to update leveling stats');
    }

    const clauses = [];
    const values = [];

    if (typeof updates.chatIncrement === 'number' && updates.chatIncrement !== 0) {
        clauses.push('chat_total = chat_total + ?');
        values.push(updates.chatIncrement);
    }

    if (typeof updates.voiceMinutesTotalIncrement === 'number' && updates.voiceMinutesTotalIncrement !== 0) {
        clauses.push('voice_minutes_total = voice_minutes_total + ?');
        values.push(updates.voiceMinutesTotalIncrement);
    }

    if (typeof updates.voiceMinutesActiveIncrement === 'number' && updates.voiceMinutesActiveIncrement !== 0) {
        clauses.push('voice_minutes_active = voice_minutes_active + ?');
        values.push(updates.voiceMinutesActiveIncrement);
    }

    if (typeof updates.voiceMinutesAfkIncrement === 'number' && updates.voiceMinutesAfkIncrement !== 0) {
        clauses.push('voice_minutes_afk = voice_minutes_afk + ?');
        values.push(updates.voiceMinutesAfkIncrement);
    }

    if (typeof updates.experienceIncrement === 'number' && updates.experienceIncrement !== 0) {
        clauses.push('experience = experience + ?');
        values.push(updates.experienceIncrement);
    }

    if (updates.level !== undefined && updates.level !== null) {
        clauses.push('level = ?');
        values.push(updates.level);
    }

    if (updates.rank !== undefined) {
        clauses.push('rank = ?');
        values.push(updates.rank);
    }

    if (updates.chatRewardedAt) {
        clauses.push('chat_rewarded_at = ?');
        values.push(toMySQLDateTime(updates.chatRewardedAt));
    }

    if (updates.voiceRewardedAt !== undefined) {
        if (updates.voiceRewardedAt === null) {
            clauses.push('voice_rewarded_at = NULL');
        } else {
            clauses.push('voice_rewarded_at = ?');
            values.push(toMySQLDateTime(updates.voiceRewardedAt));
        }
    }

    if (clauses.length === 0) {
        return await getMemberLevel(memberId);
    }

    clauses.push('updated_at = ?');
    values.push(toMySQLDateTime());
    values.push(memberId);

    await query(
        `UPDATE server_member_levels
         SET ${clauses.join(', ')}
         WHERE member_id = ?`,
        values
    );

    return await getMemberLevel(memberId);
}

export async function recalculateServerMemberRanks(serverId) {
    await initializeDatabase();
    if (!serverId) {
        throw new Error('serverId is required to recalculate ranks');
    }

    const connection = await getPool().getConnection();
    try {
        await connection.query('SET @rank := 0');
        await connection.execute(
            `UPDATE server_member_levels sml
             INNER JOIN (
                 SELECT ranked.id, (@rank := @rank + 1) AS computed_rank
                 FROM (
                     SELECT sml_inner.id
                     FROM server_member_levels sml_inner
                     INNER JOIN server_members sm_inner ON sml_inner.member_id = sm_inner.id
                     WHERE sm_inner.server_id = ?
                     ORDER BY sml_inner.experience DESC,
                              sml_inner.level DESC,
                              sml_inner.created_at ASC
                 ) AS ranked
             ) AS ranks ON ranks.id = sml.id
             SET sml.rank = ranks.computed_rank`,
            [serverId]
        );
        return true;
    } catch (error) {
        console.error('Error recalculating server member ranks:', error);
        return false;
    } finally {
        connection.release();
    }
}

export async function getMemberLevelByDiscordId(serverId, discordMemberId) {
    await initializeDatabase();
    const result = await query(
        `SELECT sml.*, sm.username, sm.display_name, sm.server_display_name, sm.discord_member_id
         FROM server_member_levels sml
         INNER JOIN server_members sm ON sml.member_id = sm.id
         WHERE sm.server_id = ? AND sm.discord_member_id = ?
         LIMIT 1`,
        [serverId, discordMemberId]
    );
    return result[0] || null;
}

export async function getServerLeaderboard(serverId, limit = 3, sortType = 'xp') {
    await initializeDatabase();
    if (!serverId) {
        throw new Error('serverId is required to fetch leaderboard');
    }
    const safeLimit = Math.max(1, Math.min(50, limit));

    let orderBy;
    switch (sortType) {
        case 'xp':
            orderBy = 'sml.experience DESC, sml.level DESC, sml.created_at ASC';
            break;
        case 'voice':
            orderBy = 'sml.voice_minutes_total DESC, sml.experience DESC, sml.created_at ASC';
            break;
        case 'chat':
            orderBy = 'sml.chat_total DESC, sml.experience DESC, sml.created_at ASC';
            break;
        default:
            orderBy = 'sml.experience DESC, sml.level DESC, sml.created_at ASC';
            break;
    }

    const result = await query(
        `SELECT sm.discord_member_id, sm.username, sm.display_name, sm.server_display_name, sm.avatar,
                sml.experience, sml.level, sml.chat_total,
                sml.voice_minutes_total, sml.voice_minutes_active, sml.voice_minutes_afk, sml.rank
         FROM server_member_levels sml
         INNER JOIN server_members sm ON sml.member_id = sm.id
         WHERE sm.server_id = ?
         ORDER BY ${orderBy}
         LIMIT ?`,
        [serverId, safeLimit]
    );
    return result;
}

export async function getServerMembersList(serverId) {
    await initializeDatabase();
    if (!serverId) {
        throw new Error('serverId is required to fetch members list');
    }

    const result = await query(
        `SELECT 
            sm.id,
            sm.discord_member_id,
            sm.username,
            sm.display_name,
            sm.server_display_name,
            sm.avatar,
            sm.member_since,
            sm.is_booster,
            sm.booster_since,
            sml.level,
            sml.experience,
            sml.chat_total,
            sml.voice_minutes_active,
            sml.voice_minutes_afk,
            sml.rank,
            sma.message as afk_message,
            sma.created_at as afk_since,
            GROUP_CONCAT(
                DISTINCT CONCAT(sr.discord_role_id, ':', sr.name, ':', sr.color, ':', sr.position)
                ORDER BY sr.position DESC
                SEPARATOR ','
            ) as roles
         FROM server_members sm
         LEFT JOIN server_member_levels sml ON sm.id = sml.member_id
         LEFT JOIN server_members_afk sma ON sm.id = sma.member_id
         LEFT JOIN server_member_roles smr ON sm.id = smr.member_id
         LEFT JOIN server_roles sr ON smr.role_id = sr.id
         WHERE sm.server_id = ?
         GROUP BY sm.id, sm.discord_member_id, sm.username, sm.display_name, sm.server_display_name, 
                  sm.avatar, sm.member_since, sm.is_booster, sm.booster_since,
                  sml.level, sml.experience, sml.chat_total, sml.voice_minutes_active, 
                  sml.voice_minutes_afk, sml.rank, sma.message, sma.created_at
         ORDER BY sml.experience DESC, sml.level DESC, sm.created_at ASC`,
        [serverId]
    );

    return result.map(member => ({
        ...member,
        roles: member.roles ? member.roles.split(',').map(role => {
            const [roleId, roleName, roleColor, position] = role.split(':');
            return { 
                id: roleId, 
                name: roleName, 
                color: roleColor || null,
                position: position ? parseInt(position, 10) : 0
            };
        }).sort((a, b) => (b.position || 0) - (a.position || 0)) : [],
        is_afk: !!member.afk_message
    }));
}

export async function getServerOverview(serverId) {
    await initializeDatabase();
    if (!serverId) {
        throw new Error('serverId is required to fetch server overview');
    }

    const [serverRow] = await query(
        `SELECT 
            id,
            bot_id,
            discord_server_id,
            name,
            total_members,
            total_channels,
            total_boosters,
            boost_level,
            server_icon,
            created_at,
            updated_at
         FROM servers
         WHERE id = ?
         LIMIT 1`,
        [serverId]
    );

    if (!serverRow) {
        throw new Error(`Server not found for id ${serverId}`);
    }

    const [
        memberCounts,
        leveledCount,
        afkCount,
        channelCounts,
        categoriesCount,
        rolesCount,
        memberSyncTimes,
        channelSyncTimes,
        roleSyncTimes,
        categorySyncTimes,
        levelSyncTimes,
        settingsRows
    ] = await Promise.all([
        query(
            `SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN is_booster = 1 THEN 1 ELSE 0 END) AS boosters
             FROM server_members
             WHERE server_id = ?`,
            [serverId]
        ),
        query(
            `SELECT COUNT(*) AS leveled
             FROM server_member_levels sml
             INNER JOIN server_members sm ON sm.id = sml.member_id
             WHERE sm.server_id = ?`,
            [serverId]
        ),
        query(
            `SELECT COUNT(*) AS afk
             FROM server_members_afk sma
             INNER JOIN server_members sm ON sm.id = sma.member_id
             WHERE sm.server_id = ?`,
            [serverId]
        ),
        query(
            `SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN LOWER(COALESCE(type, '')) IN (
                    'guild_text', 'text', 'guild_news', 'news',
                    'guild_forum', 'forum', 'guild_public_thread', 'public_thread',
                    'guild_private_thread', 'private_thread', 'guild_announcement',
                    'announcement', 'guild_news_thread', 'news_thread', 'announcement_thread'
                ) THEN 1 ELSE 0 END) AS text_count,
                SUM(CASE WHEN LOWER(COALESCE(type, '')) IN ('guild_voice', 'voice') THEN 1 ELSE 0 END) AS voice_count,
                SUM(CASE WHEN LOWER(COALESCE(type, '')) IN ('guild_stage_voice', 'stage', 'stage_voice') THEN 1 ELSE 0 END) AS stage_count
             FROM server_channels
             WHERE server_id = ?`,
            [serverId]
        ),
        query(
            `SELECT COUNT(*) AS count
             FROM server_categories
             WHERE server_id = ?`,
            [serverId]
        ),
        query(
            `SELECT COUNT(*) AS count
             FROM server_roles
             WHERE server_id = ?`,
            [serverId]
        ),
        query(
            `SELECT MAX(updated_at) AS last_updated
             FROM server_members
             WHERE server_id = ?`,
            [serverId]
        ),
        query(
            `SELECT MAX(updated_at) AS last_updated
             FROM server_channels
             WHERE server_id = ?`,
            [serverId]
        ),
        query(
            `SELECT MAX(updated_at) AS last_updated
             FROM server_roles
             WHERE server_id = ?`,
            [serverId]
        ),
        query(
            `SELECT MAX(updated_at) AS last_updated
             FROM server_categories
             WHERE server_id = ?`,
            [serverId]
        ),
        query(
            `SELECT MAX(sml.updated_at) AS last_updated
             FROM server_member_levels sml
             INNER JOIN server_members sm ON sm.id = sml.member_id
             WHERE sm.server_id = ?`,
            [serverId]
        ),
        query(
            `SELECT component_name, updated_at
             FROM server_settings
             WHERE server_id = ?
             ORDER BY component_name ASC`,
            [serverId]
        )
    ]);

    const settingsLastUpdated = settingsRows.reduce((latest, row) => {
        if (!row.updated_at) {
            return latest;
        }
        if (!latest) {
            return row.updated_at;
        }
        return new Date(row.updated_at) > new Date(latest) ? row.updated_at : latest;
    }, null);

    return {
        ...serverRow,
        stats: {
            members_total: memberCounts[0]?.total || 0,
            members_boosters: memberCounts[0]?.boosters || 0,
            members_with_levels: leveledCount[0]?.leveled || 0,
            members_afk: afkCount[0]?.afk || 0,
            channels_total: channelCounts[0]?.total || 0,
            channels_text: channelCounts[0]?.text_count || 0,
            channels_voice: channelCounts[0]?.voice_count || 0,
            channels_stage: channelCounts[0]?.stage_count || 0,
            categories_total: categoriesCount[0]?.count || 0,
            roles_total: rolesCount[0]?.count || 0
        },
        sync: {
            members_last_updated: memberSyncTimes[0]?.last_updated || null,
            channels_last_updated: channelSyncTimes[0]?.last_updated || null,
            roles_last_updated: roleSyncTimes[0]?.last_updated || null,
            categories_last_updated: categorySyncTimes[0]?.last_updated || null,
            levels_last_updated: levelSyncTimes[0]?.last_updated || null,
            settings_last_updated: settingsLastUpdated
        },
        settings: settingsRows.map(row => ({
            component_name: row.component_name,
            updated_at: row.updated_at
        }))
    };
}

export async function updateCustomRoleFlags(serverId, roleStartId, roleEndId) {
    try {
        if (!roleStartId || !roleEndId) {
            await query(
                'UPDATE server_member_roles SET is_custom = FALSE WHERE role_id IN (SELECT id FROM server_roles WHERE server_id = ?)',
                [serverId]
            );
            return true;
        }

        const startRole = await query(
            'SELECT id, position FROM server_roles WHERE server_id = ? AND discord_role_id = ?',
            [serverId, roleStartId]
        );
        const endRole = await query(
            'SELECT id, position FROM server_roles WHERE server_id = ? AND discord_role_id = ?',
            [serverId, roleEndId]
        );

        if (!startRole || startRole.length === 0 || !endRole || endRole.length === 0) {
            await query(
                'UPDATE server_member_roles SET is_custom = FALSE WHERE role_id IN (SELECT id FROM server_roles WHERE server_id = ?)',
                [serverId]
            );
            return true;
        }

        const startPosition = startRole[0].position;
        const endPosition = endRole[0].position;

        await query(
            `UPDATE server_member_roles smr
             INNER JOIN server_roles sr ON smr.role_id = sr.id
             SET smr.is_custom = TRUE
             WHERE sr.server_id = ? AND sr.position < ? AND sr.position > ? AND sr.discord_role_id != ?`,
            [serverId, startPosition, endPosition, roleStartId]
        );

        await query(
            `UPDATE server_member_roles smr
             INNER JOIN server_roles sr ON smr.role_id = sr.id
             SET smr.is_custom = FALSE
             WHERE sr.server_id = ? AND (sr.position >= ? OR sr.position <= ? OR sr.discord_role_id = ?)`,
            [serverId, startPosition, endPosition, roleStartId]
        );

        return true;
    } catch (error) {
        console.error('Error updating custom role flags:', error);
        return false;
    }
}

export async function memberHasCustomSupporterRole(discordMemberId, serverId) {
    try {
        if (!discordMemberId || !serverId) return { has: false, role: null };

        const memberResult = await query(
            'SELECT id FROM server_members WHERE server_id = ? AND discord_member_id = ?',
            [serverId, discordMemberId]
        );

        if (!memberResult || memberResult.length === 0) {
            return { has: false, role: null };
        }

        const memberId = memberResult[0].id;

        const roleResult = await query(
            `SELECT sr.id, sr.discord_role_id, sr.name, sr.position, sr.color
             FROM server_roles sr
             INNER JOIN server_member_roles smr ON sr.id = smr.role_id
             INNER JOIN server_members sm ON smr.member_id = sm.id
             WHERE smr.member_id = ? AND sm.server_id = ? AND smr.is_custom = TRUE
             ORDER BY sr.position DESC
             LIMIT 1`,
            [memberId, serverId]
        );

        if (roleResult && roleResult.length > 0) {
            return { has: true, role: roleResult[0] };
        }

        return { has: false, role: null };
    } catch (error) {
        console.error('Error checking custom supporter role:', error);
        return { has: false, role: null };
    }
}

export async function syncMembers(serverId, members) {
    try {
        if (!members || members.length === 0) {
            const dbMembers = await query(
                'SELECT id, discord_member_id FROM server_members WHERE server_id = ?',
                [serverId]
            );
            if (dbMembers && dbMembers.length > 0) {
                const idsToDelete = dbMembers.map(m => m.id);
                const placeholders = idsToDelete.map(() => '?').join(',');
                await query(
                    `DELETE FROM server_members WHERE server_id = ? AND id IN (${placeholders})`,
                    [serverId, ...idsToDelete]
                );
                console.log(`🧹 Removed ${idsToDelete.length} deleted member(s) from database`);
            }
            return true;
        }

        const operations = members.map(async (member) => {
            try {
                const dbMember = await upsertMember(serverId, member);
                if (dbMember) {
                    const memberRoles = member.roles ? Array.from(member.roles.cache.keys()).filter(roleId => roleId !== member.guild?.id) : [];
                    await syncMemberRoles(dbMember.id, memberRoles, serverId);
                }
                return dbMember;
            } catch (err) {
                const memberId = member.user?.id || member.id;
                console.error(`Error upserting member ${memberId}:`, err.message);
                return null;
            }
        });

        await Promise.all(operations);

        const discordMemberIds = new Set(members.map(member => {
            const user = member.user || member;
            return user?.id || member.id;
        }));

        const dbMembers = await query(
            'SELECT id, discord_member_id FROM server_members WHERE server_id = ?',
            [serverId]
        );

        if (dbMembers && dbMembers.length > 0) {
            const membersToDelete = dbMembers.filter(dbMember =>
                !discordMemberIds.has(dbMember.discord_member_id)
            );

            if (membersToDelete.length > 0) {
                const idsToDelete = membersToDelete.map(member => member.id);
                const placeholders = idsToDelete.map(() => '?').join(',');
                await query(
                    `DELETE FROM server_members WHERE server_id = ? AND id IN (${placeholders})`,
                    [serverId, ...idsToDelete]
                );
                console.log(`🧹 Removed ${idsToDelete.length} deleted member(s) from database`);
            }
        }

        return true;
    } catch (error) {
        console.error('Error syncing members:', error);
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
        'SELECT * FROM server_channels WHERE server_id = ? ORDER BY position ASC, name ASC',
        [serverId]
    );
    return result;
}

async function getCategoriesForServer(serverId) {
    await initializeDatabase();
    const result = await query(
        'SELECT * FROM server_categories WHERE server_id = ? ORDER BY position ASC',
        [serverId]
    );
    return result;
}

export async function insertBotLog(botId, message) {
    await initializeDatabase();
    if (!botId || !message) {
        throw new Error('botId and message are required to insert bot log');
    }

    try {
        await query(
            'INSERT INTO bot_logs (bot_id, message) VALUES (?, ?)',
            [botId, message]
        );

        const now = Date.now();
        if (now - lastBotLogPurgeCheck >= BOT_LOG_PURGE_INTERVAL_MS) {
            lastBotLogPurgeCheck = now;
            try {
                await purgeOldBotLogs(BOT_LOG_RETENTION_DAYS);
            } catch (purgeError) {
                console.error('Error purging old bot logs:', purgeError);
            }
        }

        return true;
    } catch (error) {
        console.error('Error inserting bot log:', error);
        throw error;
    }
}

export async function getBotLogs(botId, limit = 100, offset = 0) {
    await initializeDatabase();
    if (!botId) {
        throw new Error('botId is required to fetch bot logs');
    }

    const result = await query(
        `SELECT bl.*, b.name as bot_name
         FROM bot_logs bl
         INNER JOIN bots b ON bl.bot_id = b.id
         WHERE bl.bot_id = ?
         ORDER BY bl.created_at DESC
         LIMIT ? OFFSET ?`,
        [botId, limit, offset]
    );
    return result;
}

export async function purgeOldBotLogs(retentionDays = BOT_LOG_RETENTION_DAYS) {
    await initializeDatabase();
    const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : BOT_LOG_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoff.toISOString().slice(0, 19).replace('T', ' ');

    const result = await query(
        'DELETE FROM bot_logs WHERE created_at < ?',
        [cutoffStr]
    );

    return result?.affectedRows || 0;
}

export async function getAFKStatus(serverId, discordMemberId) {
    await initializeDatabase();
    const result = await query(
        `SELECT sma.*, sm.server_display_name
         FROM server_members_afk sma
         INNER JOIN server_members sm ON sma.member_id = sm.id
         WHERE sm.server_id = ? AND sm.discord_member_id = ?`,
        [serverId, discordMemberId]
    );
    if (!result || result.length === 0) {
        return null;
    }
    const afkData = result[0];
    return {
        message: afkData.message || 'Away',
        timestamp: new Date(afkData.created_at).getTime(),
        serverDisplayName: afkData.server_display_name
    };
}

export async function setAFKStatus(serverId, discordMemberId, afkData) {
    await initializeDatabase();
    try {
        const memberResult = await query(
            'SELECT id FROM server_members WHERE server_id = ? AND discord_member_id = ?',
            [serverId, discordMemberId]
        );

        if (!memberResult || memberResult.length === 0) {
            return null;
        }

        const memberId = memberResult[0].id;

        await query(
            `INSERT INTO server_members_afk (
                member_id, message
            ) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE
                message = VALUES(message),
                updated_at = VALUES(updated_at)`,
            [
                memberId,
                afkData.message || 'Away'
            ]
        );

        return await getAFKStatus(serverId, discordMemberId);
    } catch (error) {
        console.error('Error setting AFK status:', error);
        throw error;
    }
}

export async function removeAFKStatus(serverId, discordMemberId) {
    await initializeDatabase();
    try {
        const result = await query(
            `DELETE sma FROM server_members_afk sma
             INNER JOIN server_members sm ON sma.member_id = sm.id
             WHERE sm.server_id = ? AND sm.discord_member_id = ?`,
            [serverId, discordMemberId]
        );
        return true;
    } catch (error) {
        console.error('Error removing AFK status:', error);
        return false;
    }
}

export async function serversNeedSync(botId) {
    await initializeDatabase();

    const servers = await getServersForBot(botId);
    if (!servers || servers.length === 0) {
        return true;
    }

    for (const server of servers) {
        const categoriesResult = await query(
            'SELECT COUNT(*) as count FROM server_categories WHERE server_id = ?',
            [server.id]
        );
        const channelsResult = await query(
            'SELECT COUNT(*) as count FROM server_channels WHERE server_id = ?',
            [server.id]
        );
        const rolesResult = await query(
            'SELECT COUNT(*) as count FROM server_roles WHERE server_id = ?',
            [server.id]
        );
        const membersResult = await query(
            'SELECT COUNT(*) as count FROM server_members WHERE server_id = ?',
            [server.id]
        );

        const categoriesCount = categoriesResult[0]?.count || 0;
        const channelsCount = channelsResult[0]?.count || 0;
        const rolesCount = rolesResult[0]?.count || 0;
        const membersCount = membersResult[0]?.count || 0;

        if (categoriesCount === 0 || channelsCount === 0 || rolesCount === 0 || membersCount === 0) {
            return true;
        }
    }

    return false;
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
    upsertMember,
    getMemberByDiscordId,
    syncMembers,
    syncMemberRoles,
    memberHasAnyRole,
    getMemberLevel,
    ensureMemberLevel,
    updateMemberLevelStats,
    recalculateServerMemberRanks,
    getMemberLevelByDiscordId,
    getServerLeaderboard,
    getServerMembersList,
    getServerOverview,
    updateCustomRoleFlags,
    memberHasCustomSupporterRole,
    getPanel,
    createPanel,
    updatePanelPassword,
    createPanelLog,
    getPanelLogs,
    getServerSettings,
    upsertServerSettings,
    getChannelsForServer,
    getCategoriesForServer,
    insertBotLog,
    getBotLogs,
    purgeOldBotLogs,
    serversNeedSync,
    getAFKStatus,
    setAFKStatus,
    removeAFKStatus
};
