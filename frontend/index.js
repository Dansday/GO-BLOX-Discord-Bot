import express from 'express';
import session from 'express-session';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import bcrypt from 'bcrypt';
import { CONTROL_PANEL } from './config.js';
import logger from '../backend/logger.js';
import db, { initializeDatabase } from '../database/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

let app = null;
let server = null;

let botProcesses = new Map();

async function getConnectedSelfbots(officialBotId) {
    try {
        const allBots = await db.getAllBots();
        const officialBotIdNum = typeof officialBotId === 'string' ? parseInt(officialBotId) : officialBotId;
        return allBots.filter(b => {
            if (b.bot_type !== 'selfbot') return false;
            if (!b.connect_to) return false;
            const connectToNum = typeof b.connect_to === 'string' ? parseInt(b.connect_to) : b.connect_to;
            return connectToNum === officialBotIdNum;
        });
    } catch (error) {
        logger.log(`⚠️  Error getting connected selfbots: ${error.message}`);
        return [];
    }
}

async function startBotById(botId, bot) {

    try {
        await db.updateBot(botId, { status: 'starting' });
    } catch (err) {
        logger.log(`⚠️  Failed to update bot status: ${err.message}`);
    }

    const existing = botProcesses.get(botId);
    if (existing && existing.process && !existing.process.killed && existing.process.exitCode === null) {
        return { success: false, error: 'Bot is already running' };
    }

    if (existing && existing.pid) {
        try {
            process.kill(existing.pid, 0);
            return { success: false, error: 'Bot process is already running' };
        } catch (e) {

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


        const scriptPath = join(botPath, botScript);
        const botProcess = spawn('node', [scriptPath], {
            cwd: botPath,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            detached: false,
            env: {
                ...process.env,
                BOT_TOKEN: bot.token,
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

        botProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`[Bot ${botId}] ${output}`);
        });

        botProcess.stderr.on('data', (data) => {
            const output = data.toString();
            console.error(`[Bot ${botId} Error] ${output}`);
        });

        botProcess.on('exit', async (code, signal) => {
            const info = botProcesses.get(botId);
            if (info) {
                info.status = 'stopped';
                info.pid = null;
                info.startTime = null;
                info.process = null;
            }

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

            try {
                await db.updateBot(botId, {
                    status: 'stopped',
                    process_id: null,
                    uptime_started_at: null
                });
            } catch (updateErr) { }

            logger.log(`Failed to start bot ${botId}: ${err.message}`);
        });

        setTimeout(async () => {

            try {
                process.kill(botProcess.pid, 0);

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

                logger.log(`⚠️  Bot process ${botProcess.pid} may have failed to start`);
                try {
                    await db.updateBot(botId, {
                        status: 'stopped',
                        process_id: null,
                        uptime_started_at: null
                    });
                } catch (updateErr) { }
            }
        }, 2000);

        logger.log(`✅ Started bot ${botId} (${bot.bot_type}) with PID ${botProcess.pid}`);

        if (bot.bot_type === 'official') {
            const connectedSelfbots = await getConnectedSelfbots(botId);
            logger.log(`🔍 Found ${connectedSelfbots.length} selfbot(s) connected to official bot ${botId}`);
            if (connectedSelfbots.length > 0) {
                logger.log(`🔄 Starting ${connectedSelfbots.length} connected selfbot(s)...`);
                for (const selfbot of connectedSelfbots) {
                    logger.log(`  - Selfbot ${selfbot.id} (${selfbot.name}) - connect_to: ${selfbot.connect_to}`);
                }
                const startPromises = connectedSelfbots.map(selfbot =>
                    startBotById(selfbot.id, selfbot).catch(err => {
                        logger.log(`⚠️  Failed to start connected selfbot ${selfbot.id}: ${err.message}`);
                        return { success: false, error: err.message };
                    })
                );
                const results = await Promise.all(startPromises);
                const successful = results.filter(r => r && r.success).length;
                logger.log(`✅ Started ${successful}/${connectedSelfbots.length} connected selfbot(s)`);
            } else {
                logger.log(`ℹ️  No selfbots found connected to official bot ${botId}`);
            }
        }

        return { success: true, pid: botProcess.pid };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function stopBotById(botId) {

    try {
        await db.updateBot(botId, { status: 'stopping' });
    } catch (err) {
        logger.log(`⚠️  Failed to update bot status: ${err.message}`);
    }

    const botInfo = botProcesses.get(botId);

    if (!botInfo || !botInfo.process) {

        if (botInfo && botInfo.pid) {
            try {
                process.kill(botInfo.pid, 'SIGINT');

                setTimeout(() => {
                    try {
                        process.kill(botInfo.pid, 'SIGKILL');
                    } catch (e) { }
                }, 2000);
                botProcesses.delete(botId);

                try {
                    await db.updateBot(botId, {
                        status: 'stopped',
                        process_id: null,
                        uptime_started_at: null
                    });
                } catch (err) { }

                return { success: true, message: 'Stopped bot process' };
            } catch (e) {

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

    if (botInfo.process && !botInfo.process.killed && botInfo.process.exitCode === null) {
        try {
            botInfo.process.kill('SIGINT');
        } catch (err) {

        }
    }

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

    try {
        const bot = await db.getBot(botId);
        if (bot && bot.bot_type === 'official') {
            const connectedSelfbots = await getConnectedSelfbots(botId);
            if (connectedSelfbots.length > 0) {
                logger.log(`🔄 Stopping ${connectedSelfbots.length} connected selfbot(s)...`);
                const stopPromises = connectedSelfbots.map(selfbot =>
                    stopBotById(selfbot.id).catch(err => {
                        logger.log(`⚠️  Failed to stop connected selfbot ${selfbot.id}: ${err.message}`);
                        return { success: false, error: err.message };
                    })
                );
                const results = await Promise.all(stopPromises);
                const successful = results.filter(r => r.success).length;
                logger.log(`✅ Stopped ${successful}/${connectedSelfbots.length} connected selfbot(s)`);
            }
        }
    } catch (err) {
        logger.log(`⚠️  Error handling connected bots: ${err.message}`);
    }

    return { success: true };
}

async function restartBotById(botId, bot) {
    const stopResult = await stopBotById(botId);

    if (!stopResult.success && stopResult.error !== 'Bot is not running') {
        return { success: false, error: `Failed to stop: ${stopResult.error}` };
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    const startResult = await startBotById(botId, bot);
    return startResult;
}

async function verifyBotStatuses() {
    try {
        const bots = await db.getAllBots();
        logger.log(`🔍 Verifying status of ${bots.length} bot(s)...`);

        for (const bot of bots) {
            if (bot.status === 'running' || bot.status === 'starting' || bot.status === 'stopping') {
                if (bot.process_id) {
                    try {

                        process.kill(bot.process_id, 0);

                        try {
                            const cmdline = readFileSync(`/proc/${bot.process_id}/cmdline`, 'utf8').replace(/\0/g, ' ');

                            if (!cmdline.includes('officialbot.js') && !cmdline.includes('selfbot.js')) {

                                logger.log(`⚠️  Bot ${bot.id} (${bot.name}) has PID ${bot.process_id} but it's not a bot process`);
                                await db.updateBot(bot.id, {
                                    status: 'stopped',
                                    process_id: null,
                                    uptime_started_at: null
                                });
                            }
                        } catch (cmdlineErr) {

                            logger.log(`⚠️  Bot ${bot.id} (${bot.name}) process ${bot.process_id} appears to be dead`);
                            await db.updateBot(bot.id, {
                                status: 'stopped',
                                process_id: null,
                                uptime_started_at: null
                            });
                        }
                    } catch (e) {

                        logger.log(`⚠️  Bot ${bot.id} (${bot.name}) process ${bot.process_id} no longer exists, marking as stopped`);
                        await db.updateBot(bot.id, {
                            status: 'stopped',
                            process_id: null,
                            uptime_started_at: null
                        });
                    }
                } else {

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

export async function init() {

    try {
        await initializeDatabase();
    } catch (error) {
        logger.log(`⚠️  Database initialization warning: ${error.message}`);
        logger.log('📄 The database will be checked when first accessed');
    }

    await verifyBotStatuses();

    app = express();
    app.use(express.json({ limit: '10mb' }));

    if (!process.env.SESSION_SECRET) {
        throw new Error('Missing SESSION_SECRET environment variable');
    }

    app.use(session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false,
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000
        }
    }));

    app.use((req, res, next) => {
        const path = req.path.toLowerCase();

        if (path.startsWith('/uploads/')) {
            return next();
        }

        if (path.match(/\.(js|json|ts|mjs|map)$/)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        next();
    });

    app.use(express.static(__dirname));

    function getClientIp(req) {
        return req.headers['x-forwarded-for']?.split(',')[0] ||
            req.headers['x-real-ip'] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
            'unknown';
    }

    function getUserAgent(req) {
        return req.headers['user-agent'] || 'unknown';
    }

    async function requireAuth(req, res, next) {
        if (req.session && req.session.authenticated) {
            return next();
        }
        return res.status(401).json({ error: 'Authentication required' });
    }

    app.get('/api/panel/status', async (req, res) => {
        try {
            const panel = await db.getPanel();
            res.json({ panelExists: panel !== null });
        } catch (error) {
            res.json({ panelExists: false, error: error.message });
        }
    });

    app.post('/api/panel/register', async (req, res) => {
        try {
            const { password } = req.body;

            if (!password || password.length < 6) {
                return res.status(400).json({
                    success: false,
                    error: 'Password must be at least 6 characters long'
                });
            }

            const existing = await db.getPanel();
            if (existing) {
                return res.status(400).json({
                    success: false,
                    error: 'Panel already registered. Please login instead.'
                });
            }

            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);

            const panel = await db.createPanel(passwordHash);

            req.session.authenticated = true;
            req.session.panel_id = panel.id;

            await new Promise((resolve, reject) => {
                req.session.save((err) => {
                    if (err) {
                        logger.log(`⚠️  Session save error: ${err.message}`);
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });

            await db.createPanelLog({
                panel_id: panel.id,
                ip_address: getClientIp(req),
                user_agent: getUserAgent(req),
                success: true
            });

            res.json({ success: true, message: 'Panel registered successfully' });
        } catch (error) {
            logger.log(`❌ Panel registration error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/panel/login', async (req, res) => {
        try {
            const { password } = req.body;

            if (!password) {
                return res.status(400).json({
                    success: false,
                    error: 'Password is required'
                });
            }

            const panel = await db.getPanel();
            if (!panel) {

                await db.createPanelLog({
                    panel_id: null,
                    ip_address: getClientIp(req),
                    user_agent: getUserAgent(req),
                    success: false
                });
                return res.status(401).json({
                    success: false,
                    error: 'Panel not registered. Please register first.'
                });
            }

            const isValid = await bcrypt.compare(password, panel.password_hash);

            await db.createPanelLog({
                panel_id: panel.id,
                ip_address: getClientIp(req),
                user_agent: getUserAgent(req),
                success: isValid
            });

            if (!isValid) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid password'
                });
            }

            req.session.authenticated = true;
            req.session.panel_id = panel.id;

            await new Promise((resolve, reject) => {
                req.session.save((err) => {
                    if (err) {
                        logger.log(`⚠️  Session save error: ${err.message}`);
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });

            res.json({ success: true, message: 'Login successful' });
        } catch (error) {
            logger.log(`❌ Panel login error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/panel/logout', (req, res) => {
        req.session.destroy((err) => {
            if (err) {
                return res.status(500).json({ success: false, error: 'Failed to logout' });
            }
            res.json({ success: true, message: 'Logged out successfully' });
        });
    });

    app.get('/api/panel/auth', (req, res) => {
        res.json({
            authenticated: req.session && req.session.authenticated || false
        });
    });

    app.get('/api/bots', requireAuth, async (req, res) => {
        try {
            const bots = await db.getAllBots();

            const botsWithDetails = await Promise.all(bots.map(async (bot) => {

                if ((bot.status === 'running' || bot.status === 'starting' || bot.status === 'stopping') && bot.process_id) {
                    try {
                        process.kill(bot.process_id, 0);
                    } catch (e) {

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
                    updated_at: bot.updated_at,

                    is_testing: bot.is_testing || false
                };

                if (bot.connect_to) {
                    try {
                        const connectedBot = await db.getBot(bot.connect_to);
                        if (connectedBot) {
                            botData.connected_bot_name = connectedBot.name;

                            if (bot.bot_type === 'selfbot') {
                                botData.is_testing = connectedBot.is_testing || false;

                                if (bot.is_testing !== connectedBot.is_testing) {
                                    await db.updateBot(bot.id, { is_testing: connectedBot.is_testing || false });
                                }
                            }
                        }
                    } catch (err) {
                        logger.log(`⚠️  Failed to get connected bot info: ${err.message}`);
                    }
                }

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

    app.get('/api/bots/:id', requireAuth, async (req, res) => {
        try {
            const bot = await db.getBot(req.params.id);
            if (!bot) {
                return res.status(404).json({ error: 'Bot not found' });
            }

            if ((bot.status === 'running' || bot.status === 'starting' || bot.status === 'stopping') && bot.process_id) {
                try {
                    process.kill(bot.process_id, 0);
                } catch (e) {

                    await db.updateBot(bot.id, {
                        status: 'stopped',
                        process_id: null,
                        uptime_started_at: null
                    });

                    const updatedBot = await db.getBot(req.params.id);
                    if (updatedBot) {
                        Object.assign(bot, updatedBot);
                    }
                }
            }

            const { token, ...botData } = bot;

            botData.is_testing = bot.is_testing || false;

            if (bot.connect_to) {
                try {
                    const connectedBot = await db.getBot(bot.connect_to);
                    if (connectedBot) {
                        botData.connected_bot_name = connectedBot.name;

                        if (bot.bot_type === 'selfbot') {
                            botData.is_testing = connectedBot.is_testing || false;

                            if (bot.is_testing !== connectedBot.is_testing) {
                                await db.updateBot(bot.id, { is_testing: connectedBot.is_testing || false });
                            }
                        }
                    }
                } catch (err) {
                    logger.log(`⚠️  Failed to get connected bot info: ${err.message}`);
                }
            }

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

    app.get('/api/bots/:id/logs', requireAuth, async (req, res) => {
        const botId = parseInt(req.params.id, 10);
        if (Number.isNaN(botId)) {
            return res.status(400).json({ error: 'Invalid bot ID' });
        }

        const limitParam = parseInt(req.query.limit, 10);
        const offsetParam = parseInt(req.query.offset, 10);

        const limit = Number.isNaN(limitParam) ? 200 : Math.min(Math.max(limitParam, 1), 500);
        const offset = Number.isNaN(offsetParam) || offsetParam < 0 ? 0 : offsetParam;

        try {
            const bot = await db.getBot(botId);
            if (!bot) {
                return res.status(404).json({ error: 'Bot not found' });
            }

            const logs = await db.getBotLogs(botId, limit, offset);

            res.json({
                logs: logs.map(log => ({
                    id: log.id,
                    message: log.message,
                    created_at: log.created_at,
                    bot_name: log.bot_name
                })),
                pagination: {
                    limit,
                    offset,
                    count: logs.length
                }
            });
        } catch (error) {
            logger.log(`❌ Error fetching bot logs: ${error.message}`);
            res.status(500).json({ error: 'Failed to load bot logs' });
        }
    });

    app.get('/api/bots/:id/servers', requireAuth, async (req, res) => {
        try {
            const servers = await db.getServersForBot(req.params.id);
            res.json(servers);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/servers/:id/settings', requireAuth, async (req, res) => {
        try {
            const { component } = req.query;
            const settings = await db.getServerSettings(req.params.id, component);
            res.json(settings);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.put('/api/servers/:id/settings', requireAuth, async (req, res) => {
        try {
            const { component_name, settings } = req.body;
            if (!component_name) {
                return res.status(400).json({ error: 'component_name is required' });
            }
            const result = await db.upsertServerSettings(req.params.id, component_name, settings);
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/servers/:id/channels', requireAuth, async (req, res) => {
        try {
            const { search } = req.query;
            let channels = await db.getChannelsForServer(req.params.id);

            if (search) {
                const searchLower = search.toLowerCase();
                channels = channels.filter(ch =>
                    ch.name?.toLowerCase().includes(searchLower) ||
                    ch.discord_channel_id?.includes(searchLower)
                );
            }

            res.json(channels);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/servers/:id/categories', requireAuth, async (req, res) => {
        try {
            const categories = await db.getCategoriesForServer(req.params.id);
            res.json(categories);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/bots/:id/selfbots', requireAuth, async (req, res) => {
        try {
            const officialBot = await db.getBot(req.params.id);
            if (!officialBot || officialBot.bot_type !== 'official') {
                return res.status(400).json({ error: 'Bot not found or is not an official bot' });
            }

            const allBots = await db.getAllBots();
            const officialBotIdNum = typeof req.params.id === 'string' ? parseInt(req.params.id) : req.params.id;
            const selfbots = allBots.filter(bot => {
                if (bot.bot_type !== 'selfbot') return false;
                if (!bot.connect_to) return false;
                const connectToNum = typeof bot.connect_to === 'string' ? parseInt(bot.connect_to) : bot.connect_to;
                return connectToNum === officialBotIdNum;
            });

            res.json(selfbots);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/bots/:selfbotId/servers/:serverId/channels', requireAuth, async (req, res) => {
        try {
            const { selfbotId, serverId } = req.params;
            const { search, discordServerId } = req.query;

            const server = await db.getServerByDiscordId(selfbotId, discordServerId);
            if (!server) {
                return res.status(404).json({ error: 'Server not found' });
            }

            const serverIdNum = typeof serverId === 'string' ? parseInt(serverId) : serverId;
            const serverDbIdNum = typeof server.id === 'string' ? parseInt(server.id) : server.id;
            if (serverDbIdNum !== serverIdNum) {
                return res.status(404).json({ error: 'Server not found' });
            }

            let channels = await db.getChannelsForServer(serverIdNum);

            if (search) {
                const searchLower = search.toLowerCase();
                channels = channels.filter(ch =>
                    ch.name?.toLowerCase().includes(searchLower) ||
                    ch.discord_channel_id?.includes(searchLower)
                );
            }

            res.json(channels);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/servers/:id/overview', requireAuth, async (req, res) => {
        const { id } = req.params;
        const serverId = parseInt(id);

        if (isNaN(serverId)) {
            return res.status(400).json({ error: 'Invalid server ID' });
        }

        try {
            const overview = await db.getServerOverview(serverId);
            res.json(overview);
        } catch (error) {
            if (error.message && error.message.toLowerCase().includes('not found')) {
                return res.status(404).json({ error: 'Server not found' });
            }
            logger.log(`❌ Error fetching server overview: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/servers/:id/members', requireAuth, async (req, res) => {
        const { id } = req.params;
        const serverId = parseInt(id);

        if (isNaN(serverId)) {
            return res.status(400).json({ error: 'Invalid server ID' });
        }

        try {
            const members = await db.getServerMembersList(serverId);
            res.json(members);
        } catch (error) {
            logger.log(`❌ Error fetching server members: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/servers/:id/roles', requireAuth, async (req, res) => {
        try {
            const roles = await db.getRoles(req.params.id);
            res.json(roles);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/servers/:id/send-embed', requireAuth, async (req, res) => {
        try {
            const serverId = parseInt(req.params.id);
            if (isNaN(serverId)) {
                return res.status(400).json({ success: false, error: 'Invalid server ID' });
            }

            const { channel_ids, role_ids, title, description, image_url, uploaded_image_path, color, footer } = req.body;

            let imageBuffer = null;
            let imageFilename = null;
            if (uploaded_image_path) {
                try {
                    const filePath = join(projectRoot, 'frontend', 'uploads', 'embed-images', uploaded_image_path);
                    if (existsSync(filePath)) {
                        imageBuffer = readFileSync(filePath);
                        imageFilename = uploaded_image_path.split('/').pop() || 'image.png';
                    }
                } catch (readErr) {
                    logger.log(`⚠️  Failed to read uploaded image: ${readErr.message}`);
                }
            }

            if (!channel_ids || !Array.isArray(channel_ids) || channel_ids.length === 0 || !title) {
                return res.status(400).json({ success: false, error: 'channel_ids (array) and title are required' });
            }

            const server = await db.getServer(serverId);
            if (!server) {
                return res.status(404).json({ success: false, error: 'Server not found' });
            }

            const bot = await db.getBot(server.bot_id);
            if (!bot) {
                return res.status(404).json({ success: false, error: 'Bot not found' });
            }

            if (bot.status !== 'running') {
                return res.status(400).json({ success: false, error: 'Bot is not running' });
            }

            if (!bot.port || !bot.secret_key) {
                return res.status(400).json({ success: false, error: 'Bot webhook not configured' });
            }

            let finalImageUrl = image_url;
            if (finalImageUrl && finalImageUrl.startsWith('/uploads/')) {

                const protocol = req.protocol || 'http';
                const host = req.get('host') || `localhost:${CONTROL_PANEL.PORT}`;
                finalImageUrl = `${protocol}://${host}${finalImageUrl}`;
            }

            const validChannelIds = (channel_ids || []).filter(id => id != null && id !== '' && id !== undefined);

            if (validChannelIds.length === 0) {
                return res.status(400).json({ success: false, error: 'At least one valid channel ID is required' });
            }

            const http = await import('http');
            const payload = {
                type: 'send_embed',
                guild_id: server.discord_server_id,
                channel_ids: validChannelIds,
                role_ids: role_ids || [],
                title,
                description: description || null,
                image_url: (imageBuffer ? null : finalImageUrl) || null,
                color: color || null,
                footer: footer || null,
                image_attachment: imageBuffer ? {
                    filename: imageFilename,
                    data: imageBuffer.toString('base64')
                } : null
            };

            const payloadString = JSON.stringify(payload);
            const options = {
                hostname: 'localhost',
                port: bot.port,
                path: '/',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payloadString),
                    'X-Secret-Key': bot.secret_key
                }
            };

            const cleanupUploadedImage = (delay = 0) => {
                if (!uploaded_image_path) return;
                const cleanup = () => {
                    try {
                        const filePath = join(projectRoot, 'frontend', 'uploads', 'embed-images', uploaded_image_path);
                        if (existsSync(filePath)) {
                            unlinkSync(filePath);
                        }
                    } catch (cleanupErr) {
                        logger.log(`⚠️  Failed to cleanup uploaded image: ${cleanupErr.message}`);
                    }
                };
                if (delay > 0) {
                    setTimeout(cleanup, delay);
                } else {
                    cleanup();
                }
            };

            const webhookReq = http.request(options, (webhookRes) => {
                let data = '';
                webhookRes.on('data', (chunk) => {
                    data += chunk;
                });
                webhookRes.on('end', () => {
                    try {
                        const result = JSON.parse(data);
                        if (webhookRes.statusCode === 200 && result.success) {
                            if (uploaded_image_path && !imageBuffer) {
                                cleanupUploadedImage(30000);
                            } else {
                                cleanupUploadedImage();
                            }
                            res.json({ success: true, message: 'Embed sent successfully' });
                        } else {
                            cleanupUploadedImage();
                            res.status(webhookRes.statusCode || 500).json({
                                success: false,
                                error: result.error || 'Failed to send embed'
                            });
                        }
                    } catch (parseErr) {
                        cleanupUploadedImage();
                        res.status(500).json({ success: false, error: 'Failed to parse bot response' });
                    }
                });
            });

            webhookReq.on('error', (err) => {
                logger.log(`❌ Error calling bot webhook: ${err.message}`);
                cleanupUploadedImage();
                res.status(500).json({ success: false, error: 'Failed to communicate with bot' });
            });

            webhookReq.write(payloadString);
            webhookReq.end();

        } catch (error) {
            logger.log(`❌ Error sending embed: ${error.message}`);
            if (uploaded_image_path) {
                try {
                    const filePath = join(projectRoot, 'frontend', 'uploads', 'embed-images', uploaded_image_path);
                    if (existsSync(filePath)) {
                        unlinkSync(filePath);
                    }
                } catch (cleanupErr) {
                    logger.log(`⚠️  Failed to cleanup uploaded image: ${cleanupErr.message}`);
                }
            }
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/servers/:id/upload-embed-image', requireAuth, async (req, res) => {
        try {
            const serverId = parseInt(req.params.id);
            if (!serverId) {
                return res.status(400).json({ success: false, error: 'Invalid server ID' });
            }

            if (!req.body || !req.body.image) {
                return res.status(400).json({ success: false, error: 'No image file provided' });
            }

            let imageData;
            let fileExtension = 'png';

            if (req.body.image.startsWith('data:image/')) {
                const matches = req.body.image.match(/^data:image\/(\w+);base64,(.+)$/);
                if (!matches) {
                    return res.status(400).json({ success: false, error: 'Invalid image data format' });
                }
                fileExtension = matches[1].toLowerCase();
                if (fileExtension === 'jpeg') {
                    fileExtension = 'jpg';
                }
                const supportedFormats = ['jpg', 'png', 'gif', 'webp'];
                if (!supportedFormats.includes(fileExtension)) {
                    return res.status(400).json({ success: false, error: `Unsupported image format. Supported formats: ${supportedFormats.join(', ')}` });
                }
                imageData = Buffer.from(matches[2], 'base64');
            } else {
                return res.status(400).json({ success: false, error: 'Invalid image format' });
            }

            if (imageData.length > 10 * 1024 * 1024) {
                return res.status(400).json({ success: false, error: 'Image file is too large. Maximum size is 10MB' });
            }

            const uploadsDir = join(projectRoot, 'frontend', 'uploads', 'embed-images');
            if (!existsSync(uploadsDir)) {
                mkdirSync(uploadsDir, { recursive: true });
            }

            const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
            const filePath = join(uploadsDir, filename);

            writeFileSync(filePath, imageData);

            const imageUrl = `/uploads/embed-images/${filename}`;
            res.json({ success: true, url: imageUrl, path: filename });
        } catch (error) {
            logger.log(`❌ Error uploading embed image: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/servers/:id/delete-embed-image', requireAuth, async (req, res) => {
        try {
            const { path: filename } = req.body;
            if (!filename) {
                return res.status(400).json({ success: false, error: 'No filename provided' });
            }

            const filePath = join(projectRoot, 'frontend', 'uploads', 'embed-images', filename);

            if (existsSync(filePath)) {
                unlinkSync(filePath);
                res.json({ success: true });
            } else {
                res.json({ success: true, message: 'File already deleted' });
            }
        } catch (error) {
            logger.log(`❌ Error deleting embed image: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/uploads/embed-images/:filename', (req, res) => {
        try {
            const filename = req.params.filename;

            if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
                return res.status(400).json({ error: 'Invalid filename' });
            }

            const filenamePattern = /^\d+-[a-z0-9]+\.(jpg|jpeg|png|gif|webp|svg)$/i;
            if (!filenamePattern.test(filename)) {
                return res.status(400).json({ error: 'Invalid filename format' });
            }

            const filePath = join(projectRoot, 'frontend', 'uploads', 'embed-images', filename);

            if (!existsSync(filePath)) {
                return res.status(404).json({ error: 'File not found' });
            }

            const ext = filename.split('.').pop()?.toLowerCase();
            const contentTypes = {
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'gif': 'image/gif',
                'webp': 'image/webp',
                'svg': 'image/svg+xml'
            };
            const contentType = contentTypes[ext] || 'application/octet-stream';

            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.sendFile(filePath);
        } catch (error) {
            logger.log(`❌ Error serving uploaded image: ${error.message}`);
            res.status(500).json({ error: 'Failed to serve file' });
        }
    });

    app.post('/api/bots', requireAuth, async (req, res) => {
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

            const panel_id = req.session.panel_id;

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

            if (bot_type === 'official' && !application_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Application ID is required for official bots'
                });
            }

            if (bot_type === 'official' && !port) {
                return res.status(400).json({
                    success: false,
                    error: 'Port is required for official bots'
                });
            }

            if (bot_type === 'official' && !secret_key) {
                return res.status(400).json({
                    success: false,
                    error: 'Secret Key is required for official bots'
                });
            }

            if (bot_type === 'selfbot' && !connect_to) {
                return res.status(400).json({
                    success: false,
                    error: 'Selfbot must connect to an official bot'
                });
            }

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

            let is_testing = false;
            if (bot_type === 'selfbot' && connect_to) {
                try {
                    const connectedBot = await db.getBot(connect_to);
                    if (connectedBot) {
                        is_testing = connectedBot.is_testing || false;
                    }
                } catch (err) {
                    logger.log(`⚠️  Failed to get connected bot for is_testing: ${err.message}`);
                }
            } else if (bot_type === 'official') {

                is_testing = false;
            }

            const bot = await db.createBot({
                name: name || 'Bot',
                token,
                application_id,
                bot_type,
                bot_icon: bot_icon || null,
                port: bot_type === 'official' ? (port || 7777) : null,
                is_testing: is_testing,
                secret_key: secret_key || null,
                connect_to: connect_to || null,
                panel_id: panel_id || null
            });

            res.json({ success: true, bot });
        } catch (error) {
            logger.log(`❌ Create bot error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.put('/api/bots/:id/mode', requireAuth, async (req, res) => {
        try {
            const bot = await db.getBot(req.params.id);
            if (!bot) {
                return res.status(404).json({
                    success: false,
                    error: 'Bot not found'
                });
            }

            if (bot.bot_type !== 'official') {
                return res.status(400).json({
                    success: false,
                    error: 'Mode can only be changed for official bots. Selfbots inherit mode from their connected bot.'
                });
            }

            const { is_testing } = req.body;

            if (typeof is_testing !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    error: 'is_testing must be a boolean value'
                });
            }

            await db.updateBot(req.params.id, { is_testing });

            try {
                const allBots = await db.getAllBots();
                const officialBotIdNum = typeof req.params.id === 'string' ? parseInt(req.params.id) : req.params.id;
                const connectedSelfbots = allBots.filter(b => {
                    if (b.bot_type !== 'selfbot') return false;
                    if (!b.connect_to) return false;
                    const connectToNum = typeof b.connect_to === 'string' ? parseInt(b.connect_to) : b.connect_to;
                    return connectToNum === officialBotIdNum;
                });

                for (const selfbot of connectedSelfbots) {
                    await db.updateBot(selfbot.id, { is_testing });
                }

                if (connectedSelfbots.length > 0) {
                    logger.log(`✅ Updated ${connectedSelfbots.length} selfbot(s) to match official bot's mode`);
                }
            } catch (err) {
                logger.log(`⚠️  Failed to update connected selfbots: ${err.message}`);
            }

            res.json({ success: true });
        } catch (error) {
            logger.log(`❌ Update bot mode error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.delete('/api/bots/:id', requireAuth, async (req, res) => {
        try {
            await db.deleteBot(req.params.id);
            res.json({ success: true });
        } catch (error) {
            logger.log(`❌ Delete bot error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/start', requireAuth, async (req, res) => {
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

    app.post('/api/stop', requireAuth, async (req, res) => {
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

    app.post('/api/restart', requireAuth, async (req, res) => {
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

    app.get('/', (req, res) => {
        res.sendFile(join(__dirname, 'index.html'));
    });

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

export function stop() {
    if (server) {
        server.close();
        server = null;
        logger.log('🛑 Control panel stopped');
    }
}

export default { init, stop };
