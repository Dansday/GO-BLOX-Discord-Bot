import express from 'express';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { CONTROL_PANEL } from './config.js';
import logger from '../backend/logger.js';
import db, { initializeDatabase } from '../database/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

let app = null;
let server = null;
// Store bot processes by bot_id
let botProcesses = new Map(); // Map<bot_id, { process, pid, startTime, status }>

// Start a specific bot by ID
async function startBotById(botId, bot) {
    // Update status to starting
    try {
        await db.updateBot(botId, { status: 'starting' });
    } catch (err) {
        logger.log(`⚠️  Failed to update bot status: ${err.message}`);
    }

    // Check if bot is already running
    const existing = botProcesses.get(botId);
    if (existing && existing.process && !existing.process.killed && existing.process.exitCode === null) {
        return { success: false, error: 'Bot is already running' };
    }

    // Check if process is actually running by PID
    if (existing && existing.pid) {
        try {
            process.kill(existing.pid, 0); // Signal 0 checks if process exists
            return { success: false, error: 'Bot process is already running' };
        } catch (e) {
            // Process doesn't exist, continue
        }
    }

    try {
        let botScript;
        let botPath;

        if (bot.bot_type === 'official') {
            botPath = join(projectRoot, 'backend', 'official-bot');
            botScript = 'officialbot.js';
        } else if (bot.bot_type === 'selfbot') {
            botPath = join(projectRoot, 'backend', 'self-bot');
            botScript = 'selfbot.js';
        } else {
            return { success: false, error: `Unknown bot type: ${bot.bot_type}` };
        }

        // Spawn bot process with token as environment variable
        // Use absolute path to avoid shell issues
        const scriptPath = join(botPath, botScript);
        const botProcess = spawn('node', [scriptPath], {
            cwd: botPath,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false, // Don't use shell to avoid spawning extra processes
            detached: false,
            env: {
                ...process.env,
                BOT_TOKEN: bot.token, // Pass token via environment
                BOT_ID: botId
            }
        });

        const processInfo = {
            process: botProcess,
            pid: botProcess.pid,
            startTime: Date.now(),
            status: 'running'
        };

        botProcesses.set(botId, processInfo);

        // Handle output
        botProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`[Bot ${botId}] ${output}`);
        });

        botProcess.stderr.on('data', (data) => {
            const output = data.toString();
            console.error(`[Bot ${botId} Error] ${output}`);
        });

        // Handle process exit
        botProcess.on('exit', async (code, signal) => {
            const info = botProcesses.get(botId);
            if (info) {
                info.status = 'stopped';
                info.pid = null;
                info.startTime = null;
                info.process = null;
            }

            // Update bot status in database
            try {
                await db.updateBot(botId, {
                    status: 'stopped',
                    process_id: null,
                    uptime_started_at: null
                });
            } catch (err) {
                logger.log(`⚠️  Failed to update bot status: ${err.message}`);
            }

            logger.log(`Bot ${botId} exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
        });

        botProcess.on('error', async (err) => {
            const info = botProcesses.get(botId);
            if (info) {
                info.status = 'stopped';
                info.pid = null;
                info.startTime = null;
                info.process = null;
            }

            // Update bot status in database
            try {
                await db.updateBot(botId, {
                    status: 'stopped',
                    process_id: null,
                    uptime_started_at: null
                });
            } catch (updateErr) { }

            logger.log(`Failed to start bot ${botId}: ${err.message}`);
        });

        // Wait a moment for process to fully start, then update status to running
        setTimeout(async () => {
            // Verify process is still running
            try {
                process.kill(botProcess.pid, 0); // Signal 0 checks if process exists

                // Update status to running in database
                try {
                    await db.updateBot(botId, {
                        status: 'running',
                        process_id: botProcess.pid,
                        uptime_started_at: new Date().toISOString()
                    });
                    logger.log(`✅ Updated bot ${botId} status to running (PID: ${botProcess.pid})`);
                } catch (err) {
                    logger.log(`⚠️  Failed to update bot status to running: ${err.message}`);
                }
            } catch (e) {
                // Process doesn't exist or failed to start
                logger.log(`⚠️  Bot process ${botProcess.pid} may have failed to start`);
                try {
                    await db.updateBot(botId, {
                        status: 'stopped',
                        process_id: null,
                        uptime_started_at: null
                    });
                } catch (updateErr) { }
            }
        }, 2000); // Wait 2 seconds for process to start

        logger.log(`✅ Started bot ${botId} (${bot.bot_type}) with PID ${botProcess.pid}`);
        return { success: true, pid: botProcess.pid };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Stop a specific bot by ID
async function stopBotById(botId) {
    // Update status to stopping
    try {
        await db.updateBot(botId, { status: 'stopping' });
    } catch (err) {
        logger.log(`⚠️  Failed to update bot status: ${err.message}`);
    }

    const botInfo = botProcesses.get(botId);

    if (!botInfo || !botInfo.process) {
        // Try to find and kill by PID if process info exists
        if (botInfo && botInfo.pid) {
            try {
                process.kill(botInfo.pid, 'SIGINT');
                // Wait a bit then force kill
                setTimeout(() => {
                    try {
                        process.kill(botInfo.pid, 'SIGKILL');
                    } catch (e) { }
                }, 2000);
                botProcesses.delete(botId);

                // Update bot status in database
                try {
                    await db.updateBot(botId, {
                        status: 'stopped',
                        process_id: null,
                        uptime_started_at: null
                    });
                } catch (err) { }

                return { success: true, message: 'Stopped bot process' };
            } catch (e) {
                // Update status
                try {
                    await db.updateBot(botId, {
                        status: 'stopped',
                        process_id: null,
                        uptime_started_at: null
                    });
                } catch (err) { }
                return { success: false, error: 'Bot is not running' };
            }
        }

        // Update status
        try {
            await db.updateBot(botId, {
                status: 'stopped',
                process_id: null,
                uptime_started_at: null
            });
        } catch (err) { }
        return { success: false, error: 'Bot is not running' };
    }

    botInfo.status = 'stopping';

    // Try graceful shutdown first
    if (botInfo.process && !botInfo.process.killed && botInfo.process.exitCode === null) {
        try {
            botInfo.process.kill('SIGINT');
        } catch (err) {
            // Process might already be dead
        }
    }

    // Force kill after timeout
    setTimeout(() => {
        if (botInfo.process && !botInfo.process.killed && botInfo.process.exitCode === null) {
            try {
                botInfo.process.kill('SIGKILL');
            } catch (e) { }
        }
    }, 2000);

    botInfo.status = 'stopped';
    botInfo.pid = null;
    botInfo.startTime = null;
    botInfo.process = null;

    // Update bot status in database
    try {
        await db.updateBot(botId, {
            status: 'stopped',
            process_id: null,
            uptime_started_at: null
        });
    } catch (err) {
        logger.log(`⚠️  Failed to update bot status: ${err.message}`);
    }

    logger.log(`⏹️  Stopped bot ${botId}`);
    return { success: true };
}

// Restart a specific bot by ID
async function restartBotById(botId, bot) {
    const stopResult = await stopBotById(botId);

    if (!stopResult.success && stopResult.error !== 'Bot is not running') {
        return { success: false, error: `Failed to stop: ${stopResult.error}` };
    }

    // Wait a moment for process to fully stop
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Now start
    const startResult = await startBotById(botId, bot);
    return startResult;
}

// Check and fix bot status by verifying if processes are actually running
async function verifyBotStatuses() {
    try {
        const bots = await db.getAllBots();
        logger.log(`🔍 Verifying status of ${bots.length} bot(s)...`);

        for (const bot of bots) {
            if (bot.status === 'running' || bot.status === 'starting' || bot.status === 'stopping') {
                if (bot.process_id) {
                    try {
                        // Check if process actually exists
                        process.kill(bot.process_id, 0); // Signal 0 doesn't kill, just checks
                        // Process exists - check if it's still a bot process
                        try {
                            const cmdline = readFileSync(`/proc/${bot.process_id}/cmdline`, 'utf8').replace(/\0/g, ' ');

                            // Check if it's actually a bot process
                            if (!cmdline.includes('officialbot.js') && !cmdline.includes('selfbot.js')) {
                                // Process exists but isn't a bot process - mark as stopped
                                logger.log(`⚠️  Bot ${bot.id} (${bot.name}) has PID ${bot.process_id} but it's not a bot process`);
                                await db.updateBot(bot.id, {
                                    status: 'stopped',
                                    process_id: null,
                                    uptime_started_at: null
                                });
                            }
                        } catch (cmdlineErr) {
                            // Can't read cmdline, process might be dead - mark as stopped
                            logger.log(`⚠️  Bot ${bot.id} (${bot.name}) process ${bot.process_id} appears to be dead`);
                            await db.updateBot(bot.id, {
                                status: 'stopped',
                                process_id: null,
                                uptime_started_at: null
                            });
                        }
                    } catch (e) {
                        // Process doesn't exist - mark as stopped
                        logger.log(`⚠️  Bot ${bot.id} (${bot.name}) process ${bot.process_id} no longer exists, marking as stopped`);
                        await db.updateBot(bot.id, {
                            status: 'stopped',
                            process_id: null,
                            uptime_started_at: null
                        });
                    }
                } else {
                    // No process ID but status says running - mark as stopped
                    logger.log(`⚠️  Bot ${bot.id} (${bot.name}) has status "${bot.status}" but no process_id, marking as stopped`);
                    await db.updateBot(bot.id, {
                        status: 'stopped',
                        process_id: null,
                        uptime_started_at: null
                    });
                }
            }
        }

        logger.log(`✅ Finished verifying bot statuses`);
    } catch (error) {
        logger.log(`⚠️  Error verifying bot statuses: ${error.message}`);
    }
}

// Initialize control panel
export async function init() {
    // Initialize database on startup
    try {
        await initializeDatabase();
    } catch (error) {
        logger.log(`⚠️  Database initialization warning: ${error.message}`);
        logger.log('📄 The database will be checked when first accessed');
    }

    // Verify and fix bot statuses on startup (in case processes were killed externally)
    await verifyBotStatuses();

    app = express();
    app.use(express.json());
    app.use(express.static(__dirname));

    // Check setup status endpoint
    app.get('/api/setup/status', async (req, res) => {
        try {
            const bots = await db.getAllBots();
            res.json({ setupRequired: bots.length === 0 });
        } catch (error) {
            res.json({ setupRequired: true });
        }
    });

    // Get all bots
    app.get('/api/bots', async (req, res) => {
        try {
            const bots = await db.getAllBots();
            // Don't send tokens in response
            const botsWithDetails = await Promise.all(bots.map(async (bot) => {
                // Verify bot status before returning (if it's marked as running)
                if ((bot.status === 'running' || bot.status === 'starting' || bot.status === 'stopping') && bot.process_id) {
                    try {
                        process.kill(bot.process_id, 0); // Signal 0 checks if process exists
                    } catch (e) {
                        // Process doesn't exist - update status
                        await db.updateBot(bot.id, {
                            status: 'stopped',
                            process_id: null,
                            uptime_started_at: null
                        });
                        bot.status = 'stopped';
                        bot.process_id = null;
                        bot.uptime_started_at = null;
                    }
                }

                const botData = {
                    id: bot.id,
                    name: bot.name,
                    bot_type: bot.bot_type,
                    bot_icon: bot.bot_icon,
                    port: bot.port,
                    application_id: bot.application_id,
                    connect_to: bot.connect_to,
                    status: bot.status || 'stopped',
                    process_id: bot.process_id || null,
                    uptime_started_at: bot.uptime_started_at || null,
                    created_at: bot.created_at,
                    updated_at: bot.updated_at
                };

                // If selfbot has connect_to, get the connected bot's name
                if (bot.connect_to) {
                    try {
                        const connectedBot = await db.getBot(bot.connect_to);
                        if (connectedBot) {
                            botData.connected_bot_name = connectedBot.name;
                        }
                    } catch (err) {
                        logger.log(`⚠️  Failed to get connected bot name: ${err.message}`);
                    }
                }

                // Calculate uptime if running
                if (botData.status === 'running' && botData.uptime_started_at) {
                    const startTime = new Date(botData.uptime_started_at);
                    const now = new Date();
                    const uptimeMs = now - startTime;
                    botData.uptime_ms = uptimeMs;
                } else {
                    botData.uptime_ms = 0;
                }

                return botData;
            }));

            res.json(botsWithDetails);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Get bot by ID
    app.get('/api/bots/:id', async (req, res) => {
        try {
            const bot = await db.getBot(req.params.id);
            if (!bot) {
                return res.status(404).json({ error: 'Bot not found' });
            }

            // Verify bot status before returning (if it's marked as running)
            if ((bot.status === 'running' || bot.status === 'starting' || bot.status === 'stopping') && bot.process_id) {
                try {
                    process.kill(bot.process_id, 0); // Signal 0 checks if process exists
                } catch (e) {
                    // Process doesn't exist - update status
                    await db.updateBot(bot.id, {
                        status: 'stopped',
                        process_id: null,
                        uptime_started_at: null
                    });
                    // Refresh bot data
                    const updatedBot = await db.getBot(req.params.id);
                    if (updatedBot) {
                        Object.assign(bot, updatedBot);
                    }
                }
            }

            // Don't send token
            const { token, ...botData } = bot;

            // If selfbot has connect_to, get the connected bot's name
            if (bot.connect_to) {
                try {
                    const connectedBot = await db.getBot(bot.connect_to);
                    if (connectedBot) {
                        botData.connected_bot_name = connectedBot.name;
                    }
                } catch (err) {
                    logger.log(`⚠️  Failed to get connected bot name: ${err.message}`);
                }
            }

            // Calculate uptime if running
            if (botData.status === 'running' && botData.uptime_started_at) {
                const startTime = new Date(botData.uptime_started_at);
                const now = new Date();
                const uptimeMs = now - startTime;
                botData.uptime_ms = uptimeMs;
            } else {
                botData.uptime_ms = 0;
            }

            res.json(botData);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Get servers for a bot
    app.get('/api/bots/:id/servers', async (req, res) => {
        try {
            const servers = await db.getServersForBot(req.params.id);
            res.json(servers);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Create bot
    app.post('/api/bots', async (req, res) => {
        try {
            await initializeDatabase();

            const {
                name,
                token,
                application_id,
                bot_type,
                bot_icon,
                port,
                secret_key,
                connect_to
            } = req.body;

            // Validate required fields
            if (!token || !bot_type) {
                return res.status(400).json({
                    success: false,
                    error: 'Token and Bot Type are required'
                });
            }

            if (!['official', 'selfbot'].includes(bot_type)) {
                return res.status(400).json({
                    success: false,
                    error: 'Bot type must be "official" or "selfbot"'
                });
            }

            // Application ID is required for official bots only
            if (bot_type === 'official' && !application_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Application ID is required for official bots'
                });
            }

            // Port is required for official bots
            if (bot_type === 'official' && !port) {
                return res.status(400).json({
                    success: false,
                    error: 'Port is required for official bots'
                });
            }

            // Secret Key is required for official bots
            if (bot_type === 'official' && !secret_key) {
                return res.status(400).json({
                    success: false,
                    error: 'Secret Key is required for official bots'
                });
            }

            // If selfbot, connect_to is required
            if (bot_type === 'selfbot' && !connect_to) {
                return res.status(400).json({
                    success: false,
                    error: 'Selfbot must connect to an official bot'
                });
            }

            // Check if port is already in use (only for official bots, since they use ports)
            if (bot_type === 'official') {
                const portToUse = port || 7777;
                const existingBots = await db.getAllBots();
                const portInUse = existingBots.some(bot =>
                    bot.port === portToUse && bot.bot_type === 'official'
                );

                if (portInUse) {
                    return res.status(400).json({
                        success: false,
                        error: `Port ${portToUse} is already in use by another official bot`
                    });
                }
            }

            const bot = await db.createBot({
                name: name || 'Bot',
                token,
                application_id,
                bot_type,
                bot_icon: bot_icon || null,
                port: bot_type === 'official' ? (port || 7777) : null, // Port only for official bots, null for selfbots
                secret_key: secret_key || null,
                connect_to: connect_to || null
            });

            res.json({ success: true, bot });
        } catch (error) {
            logger.log(`❌ Create bot error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });


    // Update bot mode (testing/production)
    app.put('/api/bots/:id/mode', async (req, res) => {
        try {
            const { is_testing } = req.body;
            
            if (typeof is_testing !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    error: 'is_testing must be a boolean value'
                });
            }

            await db.updateBot(req.params.id, { is_testing });
            res.json({ success: true });
        } catch (error) {
            logger.log(`❌ Update bot mode error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Delete bot
    app.delete('/api/bots/:id', async (req, res) => {
        try {
            await db.deleteBot(req.params.id);
            res.json({ success: true });
        } catch (error) {
            logger.log(`❌ Delete bot error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });


    // Control endpoints - bot-specific
    app.post('/api/start', async (req, res) => {
        const { bot_id } = req.body;
        if (!bot_id) {
            return res.json({ success: false, error: 'bot_id is required' });
        }

        try {
            const bot = await db.getBot(bot_id);
            if (!bot) {
                return res.json({ success: false, error: 'Bot not found' });
            }

            const result = await startBotById(bot_id, bot);
            res.json(result);
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

    app.post('/api/stop', async (req, res) => {
        const { bot_id } = req.body;
        if (!bot_id) {
            return res.json({ success: false, error: 'bot_id is required' });
        }

        try {
            const result = await stopBotById(bot_id);
            res.json(result);
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

    app.post('/api/restart', async (req, res) => {
        const { bot_id } = req.body;
        if (!bot_id) {
            return res.json({ success: false, error: 'bot_id is required' });
        }

        try {
            const bot = await db.getBot(bot_id);
            if (!bot) {
                return res.json({ success: false, error: 'Bot not found' });
            }

            const result = await restartBotById(bot_id, bot);
            res.json(result);
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

    // Serve the control panel HTML
    app.get('/', (req, res) => {
        res.sendFile(join(__dirname, 'index.html'));
    });

    // Start server
    const port = CONTROL_PANEL.PORT;
    server = app.listen(port, '0.0.0.0', () => {
        logger.log(`🎛️ Control panel started on http://0.0.0.0:${port}`);
        logger.log(`📱 Access the control panel at http://localhost:${port}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logger.log(`❌ Port ${port} is already in use. Control panel cannot start.`);
        } else {
            logger.log(`❌ Control panel error: ${err.message}`);
        }
    });
}

// Stop control panel
export function stop() {
    if (server) {
        server.close();
        server = null;
        logger.log('🛑 Control panel stopped');
    }
}

export default { init, stop };
