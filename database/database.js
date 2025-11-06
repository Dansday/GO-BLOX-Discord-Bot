import { neon } from '@neondatabase/serverless';
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import logger from '../backend/logger.js';

dotenv.config();

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL in .env file. Please set your Neon database connection string.');
}

// Clean up connection string for Neon serverless
// Remove channel_binding parameter as it can cause issues with serverless driver
function cleanDatabaseUrl(url) {
    if (!url) return url;
    
    try {
        const urlObj = new URL(url);
        // Remove channel_binding parameter if present
        urlObj.searchParams.delete('channel_binding');
        
        // Ensure sslmode is set correctly
        if (!urlObj.searchParams.has('sslmode')) {
            urlObj.searchParams.set('sslmode', 'require');
        }
        
        return urlObj.toString();
    } catch (error) {
        // If URL parsing fails, try simple string replacement
        return url.replace(/[?&]channel_binding=[^&]*/g, '').replace(/[?&]$/, '');
    }
}

databaseUrl = cleanDatabaseUrl(databaseUrl);

// Log connection details (without password) - use console.log for early initialization
const logUrl = databaseUrl.replace(/:([^:@]+)@/, ':****@');
console.log(`🔌 Database connection: ${logUrl.split('?')[0]}...`);

// Check if using pooler endpoint (may need direct connection for serverless driver)
if (databaseUrl.includes('-pooler')) {
    console.log('⚠️  Using pooler endpoint. If you experience connection issues, try the direct connection endpoint from Neon Dashboard.');
    console.log('💡 Tip: Direct connection endpoints work better with Neon serverless driver.');
}

// Validate DATABASE_URL format
function validateDatabaseUrl(url) {
    if (!url) return false;
    // Neon accepts both postgresql:// and postgres:// formats
    // The serverless driver converts them to HTTP internally
    return url.startsWith('postgresql://') || url.startsWith('postgres://');
}

if (!validateDatabaseUrl(databaseUrl)) {
    console.log('⚠️  Warning: DATABASE_URL format may be incorrect. Expected format: postgresql://user:password@host/database');
}

// Create Neon serverless client
// Note: Neon serverless uses HTTP connections internally, but accepts standard postgresql:// URLs
// The driver automatically converts the connection to HTTP
// For best results with serverless driver, use direct connection endpoint (not pooler)
const sql = neon(databaseUrl);

// Read and execute schema SQL (only if tables don't exist)
async function runMigration() {
    if (!databaseUrl) {
        throw new Error(
            'Please set DATABASE_URL in .env file.\n' +
            'Get it from: Neon Dashboard > Connection Details'
        );
    }

    const client = new Client({ connectionString: databaseUrl });

    try {
        logger.log('🔌 Connecting to database...');
        await client.connect();
        logger.log('✅ Connected to database');

        // Read schema file
        const schemaPath = join(__dirname, 'schema.sql');
        const schemaSQL = readFileSync(schemaPath, 'utf-8');

        logger.log('📦 Executing schema...');

        await client.query(schemaSQL);

        logger.log('✅ Database schema created successfully!');
        logger.log('📊 Tables created: servers, channels, roles, server_settings');
        logger.log('📈 Indexes created: all indexes');

    } catch (error) {
        logger.log(`❌ Migration failed: ${error.message}`);
        if (error.code === '28P01') {
            logger.log('💡 Authentication failed. Check your DATABASE_URL or connection credentials.');
        } else if (error.code === 'ECONNREFUSED') {
            logger.log('💡 Connection refused. Check your connection string and network.');
        }
        throw error;
    } finally {
        await client.end();
        logger.log('🔌 Database connection closed');
    }
}

// Check tables first, only migrate if they don't exist
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
            const result = await sql`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = ${table.name}
                );
            `;

            const exists = result[0]?.exists;

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

    // If tables are missing, try to migrate
    if (missingTables.length > 0) {
        logger.log(`❌ Missing tables: ${missingTables.join(', ')}`);

        // Only migrate if DATABASE_URL is set
        if (databaseUrl) {
            try {
                logger.log('🔧 Attempting automatic table creation...');
                await runMigration();
                logger.log('✅ Tables created automatically');
                return true;
            } catch (migrateError) {
                logger.log(`⚠️  Automatic migration failed: ${migrateError.message}`);
                logger.log('📄 Please run the SQL schema manually in Neon SQL Editor');
                throw new Error(`Missing tables: ${missingTables.join(', ')}`);
            }
        } else {
            logger.log('💡 Set DATABASE_URL in .env to enable automatic table creation');
            logger.log('📄 Or run the SQL schema in Neon SQL Editor:');
            logger.log('   1. Open Neon Dashboard → SQL Editor');
            logger.log('   2. Copy and paste the contents of database/schema.sql');
            logger.log('   3. Execute the SQL');
            throw new Error(`Missing tables: ${missingTables.join(', ')}`);
        }
    }

    logger.log('✅ All database tables verified');
    return true;
}

// Initialize database on import
let dbInitialized = false;

export async function initializeDatabase() {
    if (dbInitialized) return;

    try {
        await setupDatabase();
        dbInitialized = true;
    } catch (error) {
        logger.log(`⚠️  Database initialization: ${error.message}`);
        if (error.message && (error.message.includes('fetch failed') || error.message.includes('ETIMEDOUT'))) {
            logger.log(`⚠️  Connection timeout detected. Possible issues:`);
            logger.log(`   1. Neon project may be paused (free tier pauses after inactivity)`);
            logger.log(`   2. Check DATABASE_URL format in .env file`);
            logger.log(`   3. Get fresh connection string from Neon Dashboard`);
            logger.log(`   4. Verify network connectivity`);
        }
        logger.log(`💡 Set DATABASE_URL in .env to enable automatic table creation`);
        logger.log(`📄 Or run the SQL schema from database/schema.sql in Neon SQL Editor`);
    }
}

// Bot operations
export async function getAllBots() {
    try {
        await initializeDatabase();
        return await retryOnConnectionError(async () => {
            const result = await sql`
                SELECT * FROM bots
                ORDER BY created_at ASC
            `;
            return result || [];
        });
    } catch (error) {
        console.error('Error getting bots:', error);
        if (error.message && (error.message.includes('fetch failed') || error.message.includes('ETIMEDOUT') || error.message.includes('EHOSTUNREACH'))) {
            console.error('⚠️  Connection error detected.');
            console.error('💡 Troubleshooting steps:');
            console.error('   1. Check if your Neon project is active (free tier projects pause after inactivity)');
            console.error('   2. Go to Neon Dashboard and resume your project if it\'s paused');
            console.error('   3. Wait a few seconds for the project to wake up');
            console.error('   4. Verify DATABASE_URL in .env file is correct');
            console.error('   5. Check network/firewall settings (Neon uses HTTPS connections)');
        }
        if (error.cause && error.cause.code === 'EHOSTUNREACH') {
            console.error('⚠️  Host unreachable - Neon project is likely paused. Resume it in Neon Dashboard.');
        }
        return [];
    }
}

// Retry helper for connection errors (especially EHOSTUNREACH on first setup)
async function retryOnConnectionError(fn, maxRetries = 3, delayMs = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const isConnectionError = error.message && (
                error.message.includes('fetch failed') || 
                error.message.includes('ETIMEDOUT') ||
                error.message.includes('EHOSTUNREACH')
            );
            
            if (isConnectionError && attempt < maxRetries) {
                console.log(`⚠️  Connection error (attempt ${attempt}/${maxRetries}). Retrying in ${delayMs/1000}s...`);
                if (error.cause && error.cause.code === 'EHOSTUNREACH') {
                    console.log('💡 EHOSTUNREACH detected - Neon project may be paused. Please resume it in Neon Dashboard.');
                }
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }
            throw error;
        }
    }
}

export async function getBot(botId) {
    try {
        await initializeDatabase();
        return await retryOnConnectionError(async () => {
            const result = await sql`
                SELECT * FROM bots
                WHERE id = ${botId}
                LIMIT 1
            `;
            return result[0] || null;
        });
    } catch (error) {
        console.error('Error getting bot:', error);
        if (error.cause && error.cause.code === 'EHOSTUNREACH') {
            console.error('⚠️  Host unreachable error. This usually means:');
            console.error('   1. Neon project is paused (free tier pauses after inactivity)');
            console.error('   2. Go to Neon Dashboard and resume your project');
            console.error('   3. Wait a few seconds for the project to wake up');
            console.error('   4. Try again');
        }
        return null;
    }
}

export async function createBot(botData) {
    try {
        await initializeDatabase();

        // Get bot count to generate default name
        const bots = await getAllBots();
        const botNumber = bots.length + 1;

        const result = await sql`
            INSERT INTO bots (
                name, token, application_id, bot_type, bot_icon, port, secret_key, connect_to, panel_id
            )
            VALUES (
                ${botData.name || `Bot#${botNumber}`},
                ${botData.token},
                ${botData.application_id || null},
                ${botData.bot_type},
                ${botData.bot_icon || null},
                ${botData.port !== undefined ? botData.port : (botData.bot_type === 'official' ? 7777 : null)},
                ${botData.secret_key || null},
                ${botData.connect_to || null},
                ${botData.panel_id || null}
            )
            RETURNING *
        `;

        return result[0];
    } catch (error) {
        console.error('Error creating bot:', error);
        throw error;
    }
}

export async function updateBot(botId, botData) {
    try {
        // Build update object with only defined fields
        const updateData = {
            ...botData,
            updated_at: new Date().toISOString()
        };

        // Handle status-specific logic
        if (botData.status === 'running' && !botData.uptime_started_at) {
            updateData.uptime_started_at = new Date().toISOString();
        }

        if (botData.status === 'stopped') {
            updateData.uptime_started_at = null;
            updateData.process_id = null;
        }

        // Build dynamic SQL with only provided fields
        const fields = Object.keys(updateData).filter(key => updateData[key] !== undefined);
        if (fields.length === 0) {
            // No fields to update, just return current bot
            return await getBot(botId);
        }

        // Use pg Client for complex dynamic updates
        const client = new Client({ connectionString: databaseUrl });
        try {
            await client.connect();
            
            const setClause = fields.map((field, idx) => `${field} = $${idx + 1}`).join(', ');
            const values = fields.map(field => updateData[field]);
            values.push(botId);

            const query = `
                UPDATE bots 
                SET ${setClause}
                WHERE id = $${fields.length + 1}
                RETURNING *
            `;

            const result = await client.query(query, values);
            return result.rows[0];
        } finally {
            await client.end();
        }
    } catch (error) {
        console.error('Error updating bot:', error);
        throw error;
    }
}

export async function deleteBot(botId) {
    try {
        await sql`
            DELETE FROM bots
            WHERE id = ${botId}
        `;
        return true;
    } catch (error) {
        console.error('Error deleting bot:', error);
        throw error;
    }
}

// Discord Server (Guild) operations
export async function getServersForBot(botId) {
    try {
        const result = await sql`
            SELECT * FROM servers
            WHERE bot_id = ${botId}
            ORDER BY name ASC
        `;
        return result || [];
    } catch (error) {
        console.error('Error getting servers:', error);
        return [];
    }
}

export async function getServerByDiscordId(botId, discordServerId) {
    try {
        await initializeDatabase();
        const result = await sql`
            SELECT * FROM servers
            WHERE bot_id = ${botId}
            AND discord_server_id = ${discordServerId}
            LIMIT 1
        `;
        return result[0] || null;
    } catch (error) {
        console.error('Error getting server:', error);
        // Log connection details for debugging
        if (error.message && (error.message.includes('fetch failed') || error.message.includes('ETIMEDOUT'))) {
            console.error('⚠️  Connection timeout error detected.');
            console.error('💡 Troubleshooting steps:');
            console.error('   1. Check if your Neon project is active (free tier projects pause after inactivity)');
            console.error('   2. Verify DATABASE_URL in .env file is correct');
            console.error('   3. Get a fresh connection string from Neon Dashboard → Connection Details');
            console.error('   4. Ensure DATABASE_URL format: postgresql://user:password@host/database?sslmode=require');
            console.error('   5. Check network/firewall settings');
        }
        return null;
    }
}

export async function upsertServer(botId, guild) {
    try {
        const iconUrl = guild.iconURL ? guild.iconURL({ dynamic: true }) : null;

        // Convert premiumTier enum to integer (TIER_0 = 0, TIER_1 = 1, etc.)
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

        const result = await sql`
            INSERT INTO servers (
                bot_id, discord_server_id, name, total_members, total_channels,
                total_boosters, boost_level, server_icon, updated_at
            )
            VALUES (
                ${botId}, ${guild.id}, ${guild.name}, ${guild.memberCount || 0},
                ${guild.channels?.cache?.size || 0}, ${guild.premiumSubscriptionCount || 0},
                ${boostLevel}, ${iconUrl}, ${new Date().toISOString()}
            )
            ON CONFLICT (bot_id, discord_server_id)
            DO UPDATE SET
                name = EXCLUDED.name,
                total_members = EXCLUDED.total_members,
                total_channels = EXCLUDED.total_channels,
                total_boosters = EXCLUDED.total_boosters,
                boost_level = EXCLUDED.boost_level,
                server_icon = EXCLUDED.server_icon,
                updated_at = EXCLUDED.updated_at
            RETURNING *
        `;

        return result[0];
    } catch (error) {
        console.error('Error upserting server:', error);
        throw error;
    }
}

// Category operations
export async function upsertCategory(serverId, categoryData) {
    try {
        const result = await sql`
            INSERT INTO categories (
                server_id, discord_category_id, name, position, updated_at
            )
            VALUES (
                ${serverId}, ${categoryData.id}, ${categoryData.name},
                ${categoryData.position !== undefined ? categoryData.position : null},
                ${new Date().toISOString()}
            )
            ON CONFLICT (server_id, discord_category_id)
            DO UPDATE SET
                name = EXCLUDED.name,
                position = EXCLUDED.position,
                updated_at = EXCLUDED.updated_at
            RETURNING *
        `;

        return result[0];
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

        // Process all categories at once
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

        // Create a map of discord_category_id to category UUID for channel reference
        const categoryMap = new Map();
        allResults.forEach(cat => {
            if (cat) {
                categoryMap.set(cat.discord_category_id, cat.id);
            }
        });

        // Remove deleted categories from database
        const discordCategoryIds = new Set(categories.map(cat => cat.id));
        
        const dbCategories = await sql`
            SELECT id, discord_category_id
            FROM categories
            WHERE server_id = ${serverId}
        `;

        if (dbCategories && dbCategories.length > 0) {
            const categoriesToDelete = dbCategories.filter(dbCat => 
                !discordCategoryIds.has(dbCat.discord_category_id)
            );

            if (categoriesToDelete.length > 0) {
                const idsToDelete = categoriesToDelete.map(cat => cat.id);
                // Use pg Client for array operations
                const client = new Client({ connectionString: databaseUrl });
                try {
                    await client.connect();
                    await client.query('DELETE FROM categories WHERE id = ANY($1::uuid[])', [idsToDelete]);
                    console.log(`🧹 Removed ${idsToDelete.length} deleted category(ies) from database`);
                } finally {
                    await client.end();
                }
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
        // Find category UUID if parent_id is provided
        let categoryId = null;
        if (channelData.parent_id && categoryMap) {
            categoryId = categoryMap.get(channelData.parent_id) || null;
        }

        const result = await sql`
            INSERT INTO channels (
                server_id, discord_channel_id, name, type, category_id, position, updated_at
            )
            VALUES (
                ${serverId}, ${channelData.id}, ${channelData.name}, ${channelData.type},
                ${categoryId}, ${channelData.position !== undefined ? channelData.position : null},
                ${new Date().toISOString()}
            )
            ON CONFLICT (server_id, discord_channel_id)
            DO UPDATE SET
                name = EXCLUDED.name,
                type = EXCLUDED.type,
                category_id = EXCLUDED.category_id,
                position = EXCLUDED.position,
                updated_at = EXCLUDED.updated_at
            RETURNING *
        `;

        return result[0];
    } catch (error) {
        console.error('Error upserting channel:', error);
        throw error;
    }
}

export async function syncChannels(serverId, channels, categoryMap = null) {
    try {
        // Ensure no categories (type 4) are included in channels
        const validChannels = channels.filter(ch => ch.type !== 4);

        // Delete any existing category channels that might be in the channels table
        try {
            const existingCategoryChannels = await sql`
                SELECT id, discord_channel_id
                FROM channels
                WHERE server_id = ${serverId}
                AND type = '4'
            `;

            if (existingCategoryChannels && existingCategoryChannels.length > 0) {
                const categoryIds = existingCategoryChannels.map(ch => ch.id);
                // Use pg Client for array operations
                const client = new Client({ connectionString: databaseUrl });
                try {
                    await client.connect();
                    await client.query('DELETE FROM channels WHERE id = ANY($1::uuid[])', [categoryIds]);
                    console.log(`🧹 Removed ${categoryIds.length} category(ies) from channels table`);
                } finally {
                    await client.end();
                }
            }
        } catch (cleanupError) {
            console.error('Error cleaning up categories from channels table:', cleanupError.message);
        }

        // Process all channels at once
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

        // Remove deleted channels from database
        const discordChannelIds = new Set(validChannels.map(ch => ch.id));
        
        const dbChannels = await sql`
            SELECT id, discord_channel_id
            FROM channels
            WHERE server_id = ${serverId}
        `;

        if (dbChannels && dbChannels.length > 0) {
            const channelsToDelete = dbChannels.filter(dbCh => 
                !discordChannelIds.has(dbCh.discord_channel_id)
            );

            if (channelsToDelete.length > 0) {
                const idsToDelete = channelsToDelete.map(ch => ch.id);
                // Use pg Client for array operations
                const client = new Client({ connectionString: databaseUrl });
                try {
                    await client.connect();
                    await client.query('DELETE FROM channels WHERE id = ANY($1::uuid[])', [idsToDelete]);
                    console.log(`🧹 Removed ${idsToDelete.length} deleted channel(s) from database`);
                } finally {
                    await client.end();
                }
            }
        }

        return true;
    } catch (error) {
        console.error('Error syncing channels:', error);
        return false;
    }
}

// Role operations
export async function getRoles(serverId) {
    try {
        const result = await sql`
            SELECT * FROM roles
            WHERE server_id = ${serverId}
            ORDER BY position DESC
        `;
        return result || [];
    } catch (error) {
        console.error('Error getting roles:', error);
        return [];
    }
}

export async function upsertRole(serverId, roleData) {
    try {
        const result = await sql`
            INSERT INTO roles (
                server_id, discord_role_id, name, position, color, permissions, updated_at
            )
            VALUES (
                ${serverId}, ${roleData.id}, ${roleData.name}, ${roleData.position},
                ${roleData.hexColor}, ${roleData.permissions?.bitfield?.toString() || null},
                ${new Date().toISOString()}
            )
            ON CONFLICT (server_id, discord_role_id)
            DO UPDATE SET
                name = EXCLUDED.name,
                position = EXCLUDED.position,
                color = EXCLUDED.color,
                permissions = EXCLUDED.permissions,
                updated_at = EXCLUDED.updated_at
            RETURNING *
        `;

        return result[0];
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

        // Process all roles at once
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

        // Remove deleted roles from database
        const discordRoleIds = new Set(roles.map(role => role.id));
        
        const dbRoles = await sql`
            SELECT id, discord_role_id
            FROM roles
            WHERE server_id = ${serverId}
        `;

        if (dbRoles && dbRoles.length > 0) {
            const rolesToDelete = dbRoles.filter(dbRole => 
                !discordRoleIds.has(dbRole.discord_role_id)
            );

            if (rolesToDelete.length > 0) {
                const idsToDelete = rolesToDelete.map(role => role.id);
                // Use pg Client for array operations
                const client = new Client({ connectionString: databaseUrl });
                try {
                    await client.connect();
                    await client.query('DELETE FROM roles WHERE id = ANY($1::uuid[])', [idsToDelete]);
                    console.log(`🧹 Removed ${idsToDelete.length} deleted role(s) from database`);
                } finally {
                    await client.end();
                }
            }
        }

        return true;
    } catch (error) {
        console.error('Error syncing roles:', error);
        return false;
    }
}

// Panel functions
async function getPanel() {
    try {
        const result = await sql`
            SELECT * FROM panel
            LIMIT 1
        `;
        return result[0] || null;
    } catch (error) {
        console.error('Error getting panel:', error);
        return null;
    }
}

async function createPanel(passwordHash) {
    // Check if panel already exists
    const existing = await getPanel();
    if (existing) {
        throw new Error('Panel already exists');
    }

    const result = await sql`
        INSERT INTO panel (password_hash)
        VALUES (${passwordHash})
        RETURNING *
    `;

    return result[0];
}

async function updatePanelPassword(panelId, passwordHash) {
    const result = await sql`
        UPDATE panel
        SET password_hash = ${passwordHash}, updated_at = ${new Date().toISOString()}
        WHERE id = ${panelId}
        RETURNING *
    `;

    return result[0];
}

async function createPanelLog(logData) {
    const result = await sql`
        INSERT INTO panel_logs (
            panel_id, ip_address, user_agent, success, attempted_at
        )
        VALUES (
            ${logData.panel_id || null}, ${logData.ip_address},
            ${logData.user_agent || null}, ${logData.success || false},
            ${logData.attempted_at || new Date().toISOString()}
        )
        RETURNING *
    `;

    return result[0];
}

async function getPanelLogs(limit = 100) {
    const result = await sql`
        SELECT * FROM panel_logs
        ORDER BY attempted_at DESC
        LIMIT ${limit}
    `;
    return result || [];
}

// Server settings functions
async function getServerSettings(serverId, componentName = null) {
    try {
        await initializeDatabase();
        
        let result;
        if (componentName) {
            result = await sql`
                SELECT * FROM server_settings
                WHERE server_id = ${serverId}
                AND component_name = ${componentName}
                LIMIT 1
            `;
        } else {
            result = await sql`
                SELECT * FROM server_settings
                WHERE server_id = ${serverId}
            `;
        }

        const data = result || [];

        // Update last_accessed timestamp when settings are VIEWED/accessed
        if (data && data.length > 0) {
            const now = new Date();
            const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

            const hasRecentAccess = data.some(item => {
                if (!item.last_accessed) return false;
                const lastAccessTime = new Date(item.last_accessed);
                return lastAccessTime > thirtyMinutesAgo;
            });

            if (!hasRecentAccess) {
                const nowISO = now.toISOString();
                await sql`
                    UPDATE server_settings
                    SET last_accessed = ${nowISO}
                    WHERE server_id = ${serverId}
                `;
            }
        }

        return componentName ? (data[0] || null) : (data || []);
    } catch (error) {
        console.error('Error getting server settings:', error);
        return componentName ? null : [];
    }
}

async function upsertServerSettings(serverId, componentName, settings) {
    try {
        await initializeDatabase();
        const now = new Date().toISOString();
        
        // Use pg Client for JSONB handling
        const client = new Client({ connectionString: databaseUrl });
        try {
            await client.connect();
            const result = await client.query(
                `INSERT INTO server_settings (server_id, component_name, settings, updated_at)
                 VALUES ($1::uuid, $2, $3::jsonb, $4)
                 ON CONFLICT (server_id, component_name)
                 DO UPDATE SET settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at
                 RETURNING *`,
                [serverId, componentName, JSON.stringify(settings), now]
            );
            return result.rows[0];
        } finally {
            await client.end();
        }
    } catch (error) {
        console.error('Error upserting server settings:', error);
        throw error;
    }
}

async function getChannelsForServer(serverId) {
    try {
        await initializeDatabase();
        const result = await sql`
            SELECT * FROM channels
            WHERE server_id = ${serverId}
            ORDER BY position ASC NULLS LAST, name ASC
        `;
        return result || [];
    } catch (error) {
        console.error('Error getting channels for server:', error);
        return [];
    }
}

async function getCategoriesForServer(serverId) {
    try {
        await initializeDatabase();
        const result = await sql`
            SELECT * FROM categories
            WHERE server_id = ${serverId}
            ORDER BY position ASC NULLS LAST
        `;
        return result || [];
    } catch (error) {
        console.error('Error getting categories for server:', error);
        return [];
    }
}

// Get servers that need syncing based on last_accessed (30 minute cooldown)
// Returns servers that either:
// 1. Have no server_settings entries (no last_accessed) - first setup
// 2. Have last_accessed older than 30 minutes
async function getServersNeedingSync(botId) {
    try {
        await initializeDatabase();

        const servers = await getServersForBot(botId);
        if (!servers || servers.length === 0) {
            return [];
        }

        const serverIds = servers.map(s => s.id);
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

        // Use pg Client for array operations
        const client = new Client({ connectionString: databaseUrl });
        try {
            await client.connect();
            
            // Get servers that have settings with old last_accessed
            const result1 = await client.query(
                'SELECT DISTINCT server_id FROM server_settings WHERE server_id = ANY($1::uuid[]) AND last_accessed IS NOT NULL AND last_accessed < $2',
                [serverIds, thirtyMinutesAgo]
            );
            const serversWithOldAccess = new Set((result1.rows || []).map(s => s.server_id));
            
            // Get servers that have settings (to find servers without any settings)
            const result2 = await client.query(
                'SELECT DISTINCT server_id FROM server_settings WHERE server_id = ANY($1::uuid[])',
                [serverIds]
            );
            const serversWithSettings = new Set((result2.rows || []).map(s => s.server_id));
            
            // Servers without any settings need sync (first setup)
            const serversWithoutSettings = serverIds.filter(id => !serversWithSettings.has(id));
            
            // Combine: servers without settings + servers with old last_accessed
            const uniqueServerIds = [...new Set([...serversWithoutSettings, ...Array.from(serversWithOldAccess)])];
            
            return uniqueServerIds;
        } finally {
            await client.end();
        }
    } catch (error) {
        console.error('Error getting servers needing sync:', error);
        return [];
    }
}

// Mark servers as synced by updating last_accessed timestamp
async function markServersAsSynced(serverIds) {
    try {
        await initializeDatabase();

        if (!serverIds || serverIds.length === 0) {
            return;
        }

        const now = new Date().toISOString();

        // Use pg Client for array operations
        const client = new Client({ connectionString: databaseUrl });
        try {
            await client.connect();
            await client.query(
                'UPDATE server_settings SET last_accessed = $1 WHERE server_id = ANY($2::uuid[])',
                [now, serverIds]
            );
        } finally {
            await client.end();
        }
    } catch (error) {
        console.error('Error marking servers as synced:', error);
        throw error;
    }
}

// Clear last_accessed for a server after syncing
async function clearLastAccessed(serverId) {
    try {
        await initializeDatabase();

        await sql`
            UPDATE server_settings
            SET last_accessed = NULL
            WHERE server_id = ${serverId}
        `;
    } catch (error) {
        console.error('Error clearing last_accessed:', error);
        throw error;
    }
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
    getCategoriesForServer,
    getServersNeedingSync,
    markServersAsSynced,
    clearLastAccessed
};
