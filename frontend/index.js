import express from 'express';
import session from 'express-session';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import bcrypt from 'bcrypt';
import { CONTROL_PANEL } from './config.js';
import logger from '../backend/logger.js';
import db, { initializeDatabase, connectionConfig } from '../database/database.js';
import MySQLStoreFactory from 'express-mysql-session';
import { getRedisClient } from '../backend/redis.js';
import { parseMySQLDateTime, getNowInTimezone, getDateTimeFromSQL, getDateTimeFromJSDate, addMinutesToNow, addDaysToNow, getCurrentDateTime } from '../backend/utils.js';

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
        const otelEnabled =
            process.env.OTEL_ENABLED === 'true' ||
            Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT) ||
            Boolean(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) ||
            Boolean(process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT) ||
            Boolean(process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT);

        const otelArgs = otelEnabled ? ['--import', join(projectRoot, 'backend', 'otel.js')] : [];

        const botProcess = spawn(process.execPath, [...otelArgs, scriptPath], {
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

        let stdoutBuffer = '';
        let stderrBuffer = '';

        botProcess.stdout.on('data', (data) => {
            const output = data.toString();
            stdoutBuffer += output;
            console.log(`[Bot ${botId}] ${output}`);
        });

        botProcess.stderr.on('data', (data) => {
            const output = data.toString();
            stderrBuffer += output;
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

            if (code !== 0 && code !== null) {
                logger.log(`❌ Bot ${botId} exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
                if (stderrBuffer.trim()) {
                    logger.log(`❌ Bot ${botId} stderr output:\n${stderrBuffer.trim()}`);
                }
                if (stdoutBuffer.trim() && code === 1) {
                    logger.log(`❌ Bot ${botId} stdout output:\n${stdoutBuffer.trim()}`);
                }
            } else {
                logger.log(`Bot ${botId} exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
            }
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
            } catch (updateErr) {
                logger.log(`⚠️  Failed to update bot status after error: ${updateErr.message}`);
            }

            logger.log(`❌ Failed to start bot ${botId}: ${err.message}`);
            logger.log(`❌ Error details: ${err.stack || err.toString()}`);
        });

        setTimeout(async () => {
            if (botProcess.exitCode !== null) {
                logger.log(`❌ Bot ${botId} process ${botProcess.pid} exited immediately (exit code: ${botProcess.exitCode})`);
                if (stderrBuffer.trim()) {
                    logger.log(`❌ Bot ${botId} immediate stderr:\n${stderrBuffer.trim()}`);
                }
                if (stdoutBuffer.trim()) {
                    logger.log(`❌ Bot ${botId} immediate stdout:\n${stdoutBuffer.trim()}`);
                }
                try {
                    await db.updateBot(botId, {
                        status: 'stopped',
                        process_id: null,
                        uptime_started_at: null
                    });
                } catch (updateErr) {
                    logger.log(`⚠️  Failed to update bot status after immediate exit: ${updateErr.message}`);
                }
                return;
            }
        }, 500);

        setTimeout(async () => {
            try {
                if (botProcess.exitCode !== null) {
                    logger.log(`⚠️  Bot ${botId} process ${botProcess.pid} exited before status check (exit code: ${botProcess.exitCode})`);
                    if (stderrBuffer.trim()) {
                        logger.log(`❌ Bot ${botId} stderr output:\n${stderrBuffer.trim()}`);
                    }
                    return;
                }

                process.kill(botProcess.pid, 0);

                try {
                    await db.updateBot(botId, {
                        status: 'running',
                        process_id: botProcess.pid,
                        uptime_started_at: getCurrentDateTime()
                    });
                    logger.log(`✅ Updated bot ${botId} status to running (PID: ${botProcess.pid})`);
                } catch (err) {
                    logger.log(`⚠️  Failed to update bot status to running: ${err.message}`);
                }
            } catch (e) {
                if (e.code === 'ESRCH' || e.message.includes('ESRCH')) {
                    logger.log(`❌ Bot ${botId} process ${botProcess.pid} failed to start (process not found)`);
                    if (stderrBuffer.trim()) {
                        logger.log(`❌ Bot ${botId} stderr output:\n${stderrBuffer.trim()}`);
                    }
                    if (stdoutBuffer.trim()) {
                        logger.log(`❌ Bot ${botId} stdout output:\n${stdoutBuffer.trim()}`);
                    }
                } else {
                    logger.log(`❌ Bot ${botId} process ${botProcess.pid} may have failed to start`);
                    logger.log(`❌ Process check error: ${e.message}`);
                }
                try {
                    await db.updateBot(botId, {
                        status: 'stopped',
                        process_id: null,
                        uptime_started_at: null
                    });
                } catch (updateErr) {
                    logger.log(`⚠️  Failed to update bot status after failure check: ${updateErr.message}`);
                }
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

    const redisClient = await getRedisClient();
    if (redisClient) logger.log('✅ Redis connected (sessions + rate limit)');

    app = express();
    app.use(express.json({ limit: '10mb' }));

    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        next();
    });

    if (!process.env.SESSION_SECRET) {
        throw new Error('Missing SESSION_SECRET environment variable');
    }

    const MySQLStore = MySQLStoreFactory(session);
    const connectRedisMod = await import('connect-redis');
    const connectRedis = connectRedisMod.default || connectRedisMod;
    const RedisStore = connectRedis(session);
    const sessionStore = redisClient
        ? new RedisStore({ client: redisClient, prefix: 'dansday:sess:' })
        : new MySQLStore({
            ...connectionConfig,
            schema: { tableName: 'panel_sessions' }
        });

    app.use(session({
        store: sessionStore,
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false,
            httpOnly: true,
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000
        }
    }));

    app.locals.sessionStore = sessionStore;

    const rateLimitStore = new Map();
    const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
    const MAX_LOGIN_ATTEMPTS = 5;
    const MAX_REGISTER_ATTEMPTS = 3;

    async function checkRateLimit(ip, endpoint, maxAttempts) {
        if (redisClient) {
            const key = `dansday:ratelimit:${ip}:${endpoint}`;
            const count = await redisClient.incr(key);
            if (count === 1) await redisClient.pExpire(key, RATE_LIMIT_WINDOW);
            const ttl = await redisClient.pTTL(key);
            const resetTime = Date.now() + (ttl > 0 ? ttl : RATE_LIMIT_WINDOW);
            if (count > maxAttempts) return { allowed: false, remaining: 0, resetTime };
            return { allowed: true, remaining: maxAttempts - count, resetTime };
        }
        const key = `${ip}:${endpoint}`;
        const now = Date.now();
        const attempts = rateLimitStore.get(key) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
        if (now > attempts.resetTime) {
            attempts.count = 0;
            attempts.resetTime = now + RATE_LIMIT_WINDOW;
        }
        if (attempts.count >= maxAttempts) {
            return { allowed: false, remaining: 0, resetTime: attempts.resetTime };
        }
        attempts.count++;
        rateLimitStore.set(key, attempts);
        if (Math.random() < 0.01) {
            for (const [k, v] of rateLimitStore.entries()) {
                if (now > v.resetTime) rateLimitStore.delete(k);
            }
        }
        return { allowed: true, remaining: maxAttempts - attempts.count, resetTime: attempts.resetTime };
    }

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

    async function getAccountForLogging(req) {
        if (req.session && req.session.authenticated && req.session.panel_account_id) {
            try {
                const account = await db.getPanelAccountById(req.session.panel_account_id);
                return account;
            } catch (err) {
                return null;
            }
        }
        return null;
    }

    async function logPanelActivity(req, message) {
        try {
            const account = await getAccountForLogging(req);
            const accountId = account ? account.id : null;
            await db.insertPanelLog(accountId, message);
        } catch (err) {
            console.error('Failed to log panel activity:', err);
        }
    }

    let securityUtils = null;
    async function getSecurityUtils() {
        if (!securityUtils) {
            securityUtils = await import('../backend/utils.js');
        }
        return securityUtils;
    }

    async function sanitizeAccountId(id) {
        const utils = await getSecurityUtils();
        return utils.sanitizeInteger(id, 1, null);
    }

    async function validateRegistrationInputs(username, email, password) {
        const utils = await getSecurityUtils();
        const errors = [];

        const sanitizedUsername = utils.sanitizeUsername(username);
        if (!sanitizedUsername || sanitizedUsername.length < 3) {
            errors.push('Username must be at least 3 characters long');
        } else if (!/^[a-zA-Z]+$/.test(sanitizedUsername)) {
            errors.push('Username can only contain uppercase and lowercase letters');
        } else {
            const usernameValidation = utils.validateInputLength(sanitizedUsername, 'Username', 3, 50);
            if (!usernameValidation.valid) {
                errors.push(usernameValidation.error);
            }
        }

        const sanitizedEmail = utils.sanitizeEmail(email);
        if (!sanitizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizedEmail)) {
            errors.push('Valid email is required');
        } else {
            const emailValidation = utils.validateInputLength(sanitizedEmail, 'Email', 5, 255);
            if (!emailValidation.valid) {
                errors.push(emailValidation.error);
            }
        }

        if (!password || typeof password !== 'string') {
            errors.push('Password is required');
        } else {
            const passwordValidation = utils.validateInputLength(password, 'Password', 6, 128);
            if (!passwordValidation.valid) {
                errors.push(passwordValidation.error);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            sanitizedUsername: sanitizedUsername || '',
            sanitizedEmail: sanitizedEmail || ''
        };
    }

    async function requireAuth(req, res, next) {
        if (req.session && req.session.authenticated && req.session.panel_account_id) {
            try {
                const account = await db.getPanelAccountById(req.session.panel_account_id);
                if (account && account.is_frozen) {
                    return res.status(403).json({ error: 'Your account has been frozen. Access denied.' });
                }
            } catch (err) {
                logger.log(`❌ Error checking account in requireAuth: ${err.message}`);
            }
            return next();
        }
        return res.status(401).json({ error: 'Authentication required' });
    }

    async function requireAdmin(req, res, next) {
        if (req.session && req.session.authenticated && req.session.panel_account_id) {
            try {
                const account = await db.getPanelAccountById(req.session.panel_account_id);
                if (account) {
                    if (account.is_frozen) {
                        return res.status(403).json({ error: 'Your account has been frozen. Access denied.' });
                    }
                    if (account.account_type === 'admin') {
                        return next();
                    }
                }
            } catch (error) {
                logger.log(`❌ Error checking admin status: ${error.message}`);
            }
        }
        return res.status(403).json({ error: 'Admin access required' });
    }

    app.post('/api/panel/register', async (req, res) => {
        try {
            const clientIp = getClientIp(req);
            const rateLimit = await checkRateLimit(clientIp, 'register', MAX_REGISTER_ATTEMPTS);

            if (!rateLimit.allowed) {
                const resetTime = new Date(rateLimit.resetTime).toISOString();
                return res.status(429).json({
                    success: false,
                    error: 'Too many registration attempts. Please try again later.',
                    resetTime: resetTime
                });
            }

            const { username, email, password } = req.body;
            const validation = await validateRegistrationInputs(username, email, password);

            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    error: validation.errors[0]
                });
            }

            const existingUsername = await db.getPanelAccountByUsername(validation.sanitizedUsername);
            if (existingUsername) {
                return res.status(400).json({
                    success: false,
                    error: 'Username already taken. Please choose another.'
                });
            }

            const existingAccount = await db.getPanelAccountByEmail(validation.sanitizedEmail);
            if (existingAccount) {
                return res.status(400).json({
                    success: false,
                    error: 'Email already registered. Please login instead.'
                });
            }

            const panel = await db.getPanel();
            if (!panel) {
                await db.createPanel();
            }

            const saltRounds = 12;
            const passwordHash = await bcrypt.hash(password, saltRounds);

            const crypto = await import('crypto');
            const otpCode = crypto.randomInt(100000, 999999).toString();
            const otpExpiresAt = addMinutesToNow(10);

            const account = await db.createPanelAccount({
                username: validation.sanitizedUsername,
                email: validation.sanitizedEmail,
                password_hash: passwordHash,
                account_type: 'admin',
                email_verified: false,
                otp_code: otpCode,
                otp_expires_at: otpExpiresAt,
                panel_id: (await db.getPanel()).id,
                ip_address: clientIp
            });

            const { sendOTPEmail } = await import('../backend/email.js');
            try {
                await sendOTPEmail(validation.sanitizedEmail, otpCode);
            } catch (emailError) {
                logger.log(`❌ Failed to send OTP email: ${emailError.message}`);
                logger.log(`❌ Email error details: ${emailError.stack || emailError.toString()}`);
                return res.status(500).json({
                    success: false,
                    error: `Failed to send verification email: ${emailError.message}. Please check your email configuration.`
                });
            }

            res.json({ success: true, message: 'Registration successful. Please check your email for verification code.', account_id: account.id });
        } catch (error) {
            logger.log(`❌ Panel registration error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/panel/verify-otp', async (req, res) => {
        try {
            const { account_id, otp_code } = req.body;

            const utils = await getSecurityUtils();
            const sanitizedAccountId = await sanitizeAccountId(account_id);
            const sanitizedOtpCode = utils.sanitizeString(otp_code, 6);

            if (!sanitizedAccountId || !sanitizedOtpCode || sanitizedOtpCode.length !== 6) {
                return res.status(400).json({
                    success: false,
                    error: 'Account ID and valid OTP code are required'
                });
            }

            if (!/^\d{6}$/.test(sanitizedOtpCode)) {
                return res.status(400).json({
                    success: false,
                    error: 'OTP code must be 6 digits'
                });
            }

            const account = await db.getPanelAccountById(sanitizedAccountId);
            if (!account) {
                return res.status(404).json({
                    success: false,
                    error: 'Account not found'
                });
            }

            if (account.email_verified) {
                return res.status(400).json({
                    success: false,
                    error: 'Email already verified'
                });
            }

            if (!account.otp_code || account.otp_code !== sanitizedOtpCode) {
                await db.insertPanelLog(account.id, `Failed OTP verification for ${account.username} (IP: ${getClientIp(req)})`);
                return res.status(401).json({
                    success: false,
                    error: 'Invalid OTP code'
                });
            }

            if (account.otp_expires_at) {
                const expiresAt = getDateTimeFromSQL(account.otp_expires_at);
                const now = getNowInTimezone();
                if (expiresAt.isValid && expiresAt < now) {
                    return res.status(401).json({
                        success: false,
                        error: 'OTP code has expired. Please request a new one.'
                    });
                }
            }

            const clientIp = getClientIp(req);
            await db.updatePanelAccount(account.id, {
                email_verified: true,
                otp_code: null,
                otp_expires_at: null,
                ip_address: clientIp
            });

            req.session.authenticated = true;
            req.session.panel_account_id = account.id;
            req.session.account_type = account.account_type;

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

            await db.insertPanelLog(account.id, `Email verified and logged in: ${account.username} (IP: ${clientIp})`);

            const { sendVerificationSuccessEmail } = await import('../backend/email.js');
            try {
                await sendVerificationSuccessEmail(account.email, account.username);
            } catch (emailError) {
                logger.log(`⚠️  Failed to send verification success email: ${emailError.message}`);
            }

            res.json({ success: true, message: 'Email verified successfully', account_type: account.account_type });
        } catch (error) {
            logger.log(`❌ OTP verification error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/panel/resend-otp', async (req, res) => {
        try {
            const { account_id } = req.body;
            const sanitizedAccountId = await sanitizeAccountId(account_id);

            if (!sanitizedAccountId) {
                return res.status(400).json({
                    success: false,
                    error: 'Valid account ID is required'
                });
            }

            const account = await db.getPanelAccountById(sanitizedAccountId);
            if (!account) {
                return res.status(404).json({
                    success: false,
                    error: 'Account not found'
                });
            }

            if (account.email_verified) {
                return res.status(400).json({
                    success: false,
                    error: 'Email already verified'
                });
            }

            const crypto = await import('crypto');
            const otpCode = crypto.randomInt(100000, 999999).toString();
            const otpExpiresAt = addMinutesToNow(10);

            await db.updatePanelAccount(account.id, {
                otp_code: otpCode,
                otp_expires_at: otpExpiresAt
            });

            const { sendOTPEmail } = await import('../backend/email.js');
            try {
                await sendOTPEmail(account.email, otpCode);
            } catch (emailError) {
                logger.log(`❌ Failed to send OTP email: ${emailError.message}`);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to send verification email. Please try again.'
                });
            }

            res.json({ success: true, message: 'OTP code resent successfully' });
        } catch (error) {
            logger.log(`❌ Resend OTP error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/panel/login', async (req, res) => {
        try {
            const clientIp = getClientIp(req);
            const rateLimit = await checkRateLimit(clientIp, 'login', MAX_LOGIN_ATTEMPTS);

            if (!rateLimit.allowed) {
                const resetTime = new Date(rateLimit.resetTime).toISOString();
                return res.status(429).json({
                    success: false,
                    error: 'Too many login attempts. Please try again later.',
                    resetTime: resetTime
                });
            }

            const { username_or_email, password } = req.body;

            if (!username_or_email || !password) {
                return res.status(400).json({
                    success: false,
                    error: 'Username/Email and password are required'
                });
            }

            const utils = await getSecurityUtils();
            let sanitizedInput = utils.sanitizeString(username_or_email, 255);

            let account = null;
            if (sanitizedInput.includes('@')) {
                const sanitizedEmail = utils.sanitizeEmail(sanitizedInput);
                if (sanitizedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizedEmail)) {
                    account = await db.getPanelAccountByEmail(sanitizedEmail);
                }
            }

            if (!account) {
                const sanitizedUsername = utils.sanitizeUsername(sanitizedInput);
                if (sanitizedUsername && sanitizedUsername.length >= 3) {
                    account = await db.getPanelAccountByUsername(sanitizedUsername);
                }
            }

            if (typeof password !== 'string') {
                await db.insertPanelLog(null, `Failed login attempt: Invalid password format (IP: ${clientIp})`);
                return res.status(400).json({
                    success: false,
                    error: 'Invalid password format'
                });
            }

            const passwordValidation = utils.validateInputLength(password, 'Password', 1, 128);
            if (!passwordValidation.valid) {
                await db.insertPanelLog(null, `Failed login attempt: Invalid password length (IP: ${clientIp})`);
                return res.status(400).json({
                    success: false,
                    error: passwordValidation.error
                });
            }

            if (!account) {
                await db.insertPanelLog(null, `Failed login attempt: Account not found (IP: ${clientIp})`);
                return res.status(401).json({
                    success: false,
                    error: 'Invalid credentials'
                });
            }

            if (!account.email_verified) {
                return res.status(401).json({
                    success: false,
                    error: 'Email not verified. Please verify your email first.',
                    requires_verification: true,
                    account_id: account.id
                });
            }

            if (account.is_frozen) {
                await db.insertPanelLog(account.id, `Blocked login attempt: Account frozen for ${account.username} (IP: ${clientIp})`);
                return res.status(403).json({
                    success: false,
                    error: 'This account has been frozen. Please contact an administrator.'
                });
            }

            const isValid = await bcrypt.compare(password, account.password_hash);

            if (!isValid) {
                await db.insertPanelLog(account.id, `Failed login attempt for ${account.username} (IP: ${clientIp})`);
                return res.status(401).json({
                    success: false,
                    error: 'Invalid credentials'
                });
            }

            await db.updatePanelAccount(account.id, { ip_address: clientIp });

            req.session.authenticated = true;
            req.session.panel_account_id = account.id;
            req.session.account_type = account.account_type;

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

            await db.insertPanelLog(account.id, `Successful login: ${account.username} (IP: ${clientIp})`);

            res.json({ success: true, message: 'Login successful', account_type: account.account_type });
        } catch (error) {
            logger.log(`❌ Panel login error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/panel/logout', async (req, res) => {
        const accountId = req.session?.panel_account_id;
        req.session.destroy(async (err) => {
            if (err) {
                return res.status(500).json({ success: false, error: 'Failed to logout' });
            }
            if (accountId) {
                try {
                    const account = await db.getPanelAccountById(accountId);
                    if (account) {
                        await db.insertPanelLog(accountId, `Logged out: ${account.username} (IP: ${getClientIp(req)})`);
                    }
                } catch (logError) {
                }
            }
            res.json({ success: true, message: 'Logged out successfully' });
        });
    });

    app.get('/api/panel/auth', async (req, res) => {
        try {
            if (req.session && req.session.authenticated && req.session.panel_account_id) {
                const account = await db.getPanelAccountById(req.session.panel_account_id);
                if (account) {
                    return res.json({
                        authenticated: true,
                        account_type: account.account_type,
                        account_id: account.id,
                        username: account.username,
                        email: account.email
                    });
                }
            }

            const accounts = await db.getAllPanelAccounts();
            const hasAccounts = accounts && accounts.length > 0;

            res.json({
                authenticated: false,
                can_register: !hasAccounts
            });
        } catch (error) {
            logger.log(`❌ Auth check error: ${error.message}`);
            res.json({ authenticated: false, can_register: false });
        }
    });

    app.get('/api/panel/accounts', requireAdmin, async (req, res) => {
        try {
            const accounts = await db.getAllPanelAccounts();
            res.json({ success: true, accounts });
        } catch (error) {
            logger.log(`❌ Get accounts error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.put('/api/panel/accounts/:id/freeze', requireAdmin, async (req, res) => {
        try {
            const accountId = await sanitizeAccountId(req.params.id);
            if (!accountId) {
                return res.status(400).json({ success: false, error: 'Invalid account ID' });
            }

            const account = await db.getPanelAccountById(accountId);
            if (!account) {
                return res.status(404).json({ success: false, error: 'Account not found' });
            }

            if (accountId === req.session.panel_account_id) {
                return res.status(400).json({ success: false, error: 'You cannot freeze your own account' });
            }

            await db.updatePanelAccount(accountId, { is_frozen: true });

            const store = req.app.locals.sessionStore;
            if (store && typeof store.all === 'function') {
                try {
                    const sessions = await store.all();
                    for (const [sid, data] of Object.entries(sessions || {})) {
                        if (data && data.panel_account_id === accountId) {
                            await new Promise((resolve, reject) => {
                                store.destroy(sid, (err) => (err ? reject(err) : resolve()));
                            });
                            logger.log(`🛑 Destroyed session for frozen account ${account.username} (ID: ${accountId})`);
                        }
                    }
                } catch (sessionErr) {
                    logger.log(`⚠️  Failed to destroy sessions for frozen account: ${sessionErr.message}`);
                }
            }

            const adminAccount = await getAccountForLogging(req);
            if (adminAccount) {
                await logPanelActivity(req, `${adminAccount.username} froze account: ${account.username} (ID: ${accountId})`);
            }

            const { sendAccountFrozenEmail } = await import('../backend/email.js');
            try {
                await sendAccountFrozenEmail(account.email, account.username);
            } catch (emailError) {
                logger.log(`⚠️  Failed to send account frozen email: ${emailError.message}`);
            }

            res.json({ success: true, message: 'Account frozen successfully' });
        } catch (error) {
            logger.log(`❌ Freeze account error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.put('/api/panel/accounts/:id/unfreeze', requireAdmin, async (req, res) => {
        try {
            const accountId = await sanitizeAccountId(req.params.id);
            if (!accountId) {
                return res.status(400).json({ success: false, error: 'Invalid account ID' });
            }

            const account = await db.getPanelAccountById(accountId);
            if (!account) {
                return res.status(404).json({ success: false, error: 'Account not found' });
            }

            await db.updatePanelAccount(accountId, { is_frozen: false });

            const adminAccount = await getAccountForLogging(req);
            if (adminAccount) {
                await logPanelActivity(req, `${adminAccount.username} unfroze account: ${account.username} (ID: ${accountId})`);
            }

            const { sendAccountUnfrozenEmail } = await import('../backend/email.js');
            try {
                await sendAccountUnfrozenEmail(account.email, account.username);
            } catch (emailError) {
                logger.log(`⚠️  Failed to send account unfrozen email: ${emailError.message}`);
            }

            res.json({ success: true, message: 'Account unfrozen successfully' });
        } catch (error) {
            logger.log(`❌ Unfreeze account error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.put('/api/panel/accounts/:id/verify', requireAdmin, async (req, res) => {
        try {
            const accountId = await sanitizeAccountId(req.params.id);
            if (!accountId) {
                return res.status(400).json({ success: false, error: 'Invalid account ID' });
            }

            const account = await db.getPanelAccountById(accountId);
            if (!account) {
                return res.status(404).json({ success: false, error: 'Account not found' });
            }

            if (account.email_verified) {
                return res.status(400).json({ success: false, error: 'Account is already verified' });
            }

            await db.updatePanelAccount(accountId, {
                email_verified: true,
                otp_code: null,
                otp_expires_at: null
            });

            const adminAccount = await getAccountForLogging(req);
            if (adminAccount) {
                await logPanelActivity(req, `${adminAccount.username} manually verified account: ${account.username} (ID: ${accountId})`);
            }

            const { sendVerificationSuccessEmail } = await import('../backend/email.js');
            try {
                await sendVerificationSuccessEmail(account.email, account.username);
            } catch (emailError) {
                logger.log(`⚠️  Failed to send verification success email: ${emailError.message}`);
            }

            res.json({ success: true, message: 'Account verified successfully' });
        } catch (error) {
            logger.log(`❌ Verify account error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.delete('/api/panel/accounts/:id', requireAdmin, async (req, res) => {
        try {
            const accountId = await sanitizeAccountId(req.params.id);
            if (!accountId) {
                return res.status(400).json({ success: false, error: 'Invalid account ID' });
            }

            const account = await db.getPanelAccountById(accountId);
            if (!account) {
                return res.status(404).json({ success: false, error: 'Account not found' });
            }

            if (accountId === req.session.panel_account_id) {
                return res.status(400).json({ success: false, error: 'You cannot delete your own account' });
            }

            const { sendAccountDeletedEmail } = await import('../backend/email.js');
            try {
                await sendAccountDeletedEmail(account.email, account.username);
            } catch (emailError) {
                logger.log(`⚠️  Failed to send account deleted email: ${emailError.message}`);
            }

            await db.deletePanelAccount(accountId);

            const adminAccount = await getAccountForLogging(req);
            if (adminAccount) {
                await logPanelActivity(req, `${adminAccount.username} deleted account: ${account.username} (ID: ${accountId})`);
            }

            res.json({ success: true, message: 'Account deleted successfully' });
        } catch (error) {
            logger.log(`❌ Delete account error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/panel/invite-links', requireAdmin, async (req, res) => {
        try {
            const { account_type } = req.body;

            if (!account_type || !['admin', 'moderator'].includes(account_type)) {
                return res.status(400).json({
                    success: false,
                    error: 'Valid account type (admin or moderator) is required'
                });
            }

            const crypto = await import('crypto');
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = addDaysToNow(1);

            const inviteLink = await db.createPanelInviteLink({
                token,
                account_type,
                created_by: req.session.panel_account_id,
                expires_at: expiresAt
            });

            const account = await getAccountForLogging(req);
            if (account) {
                await logPanelActivity(req, `${account.username} generated invite link for ${account_type} account`);
            }

            const protocol = req.protocol || 'http';
            const host = req.get('host') || `localhost:${CONTROL_PANEL.PORT}`;
            const fullUrl = `${protocol}://${host}/register?token=${token}`;

            res.json({ success: true, invite_link: fullUrl, token, expires_at: expiresAt });
        } catch (error) {
            logger.log(`❌ Create invite link error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/panel/invite-links', requireAdmin, async (req, res) => {
        try {
            const links = await db.getAllPanelInviteLinks();
            res.json({ success: true, links });
        } catch (error) {
            logger.log(`❌ Get invite links error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/panel/invite-link/:token', async (req, res) => {
        try {
            const { token } = req.params;
            const utils = await getSecurityUtils();
            const sanitizedToken = utils.sanitizeString(token, 255);

            if (!sanitizedToken || sanitizedToken.length < 32) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid token format'
                });
            }

            const inviteLink = await db.getPanelInviteLinkByToken(sanitizedToken);

            if (!inviteLink) {
                return res.status(404).json({
                    success: false,
                    error: 'Invite link not found'
                });
            }

            if (inviteLink.used_by || inviteLink.used_at) {
                return res.status(400).json({
                    success: false,
                    error: 'Invite link has already been used'
                });
            }

            if (inviteLink.expires_at) {
                const expiresAt = getDateTimeFromSQL(inviteLink.expires_at);
                const now = getNowInTimezone();
                if (expiresAt.isValid && expiresAt < now) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invite link has expired'
                    });
                }
            }

            res.json({ success: true, account_type: inviteLink.account_type });
        } catch (error) {
            logger.log(`❌ Get invite link error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/panel/register-with-token', async (req, res) => {
        try {
            const { token, username, email, password } = req.body;
            const utils = await getSecurityUtils();

            if (!token || typeof token !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Token is required'
                });
            }

            const sanitizedToken = utils.sanitizeString(token, 255);
            if (!sanitizedToken || sanitizedToken.length < 32) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid token format'
                });
            }

            const validation = await validateRegistrationInputs(username, email, password);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    error: validation.errors[0]
                });
            }

            const inviteLink = await db.getPanelInviteLinkByToken(sanitizedToken);
            if (!inviteLink) {
                return res.status(404).json({
                    success: false,
                    error: 'Invalid invite link'
                });
            }

            if (inviteLink.used_by || inviteLink.used_at) {
                return res.status(400).json({
                    success: false,
                    error: 'Invite link has already been used'
                });
            }

            if (inviteLink.expires_at) {
                const expiresAt = getDateTimeFromSQL(inviteLink.expires_at);
                const now = getNowInTimezone();
                if (expiresAt.isValid && expiresAt < now) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invite link has expired'
                    });
                }
            }

            const existingUsername = await db.getPanelAccountByUsername(validation.sanitizedUsername);
            if (existingUsername) {
                return res.status(400).json({
                    success: false,
                    error: 'Username already taken'
                });
            }

            const existingAccount = await db.getPanelAccountByEmail(validation.sanitizedEmail);
            if (existingAccount) {
                return res.status(400).json({
                    success: false,
                    error: 'Email already registered'
                });
            }

            const panel = await db.getPanel();
            if (!panel) {
                await db.createPanel();
            }

            const clientIp = getClientIp(req);
            const saltRounds = 12;
            const passwordHash = await bcrypt.hash(password, saltRounds);

            const crypto = await import('crypto');
            const otpCode = crypto.randomInt(100000, 999999).toString();
            const otpExpiresAt = addMinutesToNow(10);

            const account = await db.createPanelAccount({
                username: validation.sanitizedUsername,
                email: validation.sanitizedEmail,
                password_hash: passwordHash,
                account_type: inviteLink.account_type,
                email_verified: false,
                otp_code: otpCode,
                otp_expires_at: otpExpiresAt,
                panel_id: (await db.getPanel()).id,
                ip_address: clientIp
            });

            await db.updatePanelInviteLink(inviteLink.id, {
                used_by: account.id,
                used_at: getCurrentDateTime()
            });

            const { sendOTPEmail } = await import('../backend/email.js');
            try {
                await sendOTPEmail(validation.sanitizedEmail, otpCode);
            } catch (emailError) {
                logger.log(`❌ Failed to send OTP email: ${emailError.message}`);
                logger.log(`❌ Email error details: ${emailError.stack || emailError.toString()}`);
                return res.status(500).json({
                    success: false,
                    error: `Failed to send verification email: ${emailError.message}. Please check your email configuration.`
                });
            }

            res.json({ success: true, message: 'Registration successful. Please check your email for verification code.', account_id: account.id });
        } catch (error) {
            logger.log(`❌ Register with token error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/config/timezone', (req, res) => {
        const timezone = process.env.TIMEZONE;
        if (!timezone) {
            return res.status(500).json({ error: 'TIMEZONE environment variable not set' });
        }
        res.json({ timezone });
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
                    const connectToId = Number(bot.connect_to);
                    if (connectToId && !Number.isNaN(connectToId)) {
                        try {
                            const connectedBot = await db.getBot(connectToId);
                            if (connectedBot) {
                                const rawName = connectedBot.name;
                                botData.connected_bot_name = (rawName != null && String(rawName).trim() !== '')
                                    ? rawName
                                    : null;

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
                }

                if (botData.status === 'running' && botData.uptime_started_at) {
                    let startTime;
                    if (botData.uptime_started_at instanceof Date) {
                        startTime = getDateTimeFromJSDate(botData.uptime_started_at);
                    } else {
                        const parsed = parseMySQLDateTime(botData.uptime_started_at);
                        startTime = parsed ? getDateTimeFromJSDate(parsed) : null;
                    }
                    if (startTime && startTime.isValid) {
                        const now = getNowInTimezone();
                        botData.uptime_ms = now.diff(startTime, 'milliseconds').milliseconds;
                    } else {
                        botData.uptime_ms = 0;
                    }
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
                const connectToId = Number(bot.connect_to);
                if (connectToId && !Number.isNaN(connectToId)) {
                    try {
                        const connectedBot = await db.getBot(connectToId);
                        if (connectedBot) {
                            const rawName = connectedBot.name;
                            botData.connected_bot_name = (rawName != null && String(rawName).trim() !== '')
                                ? rawName
                                : null;

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
            }

            if (botData.status === 'running' && botData.uptime_started_at) {
                let startTime;
                if (botData.uptime_started_at instanceof Date) {
                    startTime = getDateTimeFromJSDate(botData.uptime_started_at);
                } else {
                    const parsed = parseMySQLDateTime(botData.uptime_started_at);
                    startTime = parsed ? getDateTimeFromJSDate(parsed) : null;
                }
                if (startTime && startTime.isValid) {
                    const now = getNowInTimezone();
                    botData.uptime_ms = now.diff(startTime, 'milliseconds').milliseconds;
                } else {
                    botData.uptime_ms = 0;
                }
            } else {
                botData.uptime_ms = 0;
            }

            res.json(botData);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/bots/:id/logs', requireAdmin, async (req, res) => {
        const utils = await getSecurityUtils();
        const botId = utils.sanitizeInteger(req.params.id, 1, null);
        if (!botId) {
            return res.status(400).json({ error: 'Invalid bot ID' });
        }

        const limitParam = utils.sanitizeInteger(req.query.limit, 1, 500);
        const offsetParam = utils.sanitizeInteger(req.query.offset, 0, null);

        const limit = limitParam || 200;
        const offset = offsetParam || 0;

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

    app.get('/api/panel/logs', requireAdmin, async (req, res) => {
        const utils = await getSecurityUtils();
        const limitParam = utils.sanitizeInteger(req.query.limit, 1, 500);
        const offsetParam = utils.sanitizeInteger(req.query.offset, 0, null);

        const limit = limitParam || 200;
        const offset = offsetParam || 0;

        try {
            const logs = await db.getPanelLogs(limit, offset);

            res.json({
                logs: logs.map(log => ({
                    id: log.id,
                    message: log.message,
                    created_at: log.created_at,
                    account_username: log.account_username || 'System',
                    account_email: log.account_email || null
                })),
                pagination: {
                    limit,
                    offset,
                    count: logs.length
                }
            });
        } catch (error) {
            logger.log(`❌ Error fetching panel logs: ${error.message}`);
            res.status(500).json({ error: 'Failed to load panel logs' });
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
            let serverId = req.params.id;
            if (component === 'notifications') {
                const officialServerId = await db.getOfficialBotServerIdForServer(req.params.id);
                if (officialServerId) serverId = officialServerId;
            }
            const settings = await db.getServerSettings(serverId, component);
            res.json(settings);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.put('/api/servers/:id/settings', requireAdmin, async (req, res) => {
        try {
            const { component_name, settings } = req.body;
            if (!component_name) {
                return res.status(400).json({ error: 'component_name is required' });
            }
            let targetServerId = req.params.id;
            if (component_name === 'notifications') {
                const officialServerId = await db.getOfficialBotServerIdForServer(req.params.id);
                if (officialServerId) targetServerId = officialServerId;
            }
            const result = await db.upsertServerSettings(targetServerId, component_name, settings);

            if (component_name === 'notifications') {
                try {
                    const server = await db.getServer(targetServerId);
                    const bot = server ? await db.getBot(server.bot_id) : null;
                    if (server && bot && server.discord_server_id) {
                        const http = await import('http');
                        const payload = JSON.stringify({ type: 'sync_notification_roles', guild_id: server.discord_server_id });
                        const options = {
                            hostname: 'localhost',
                            port: bot.port,
                            path: '/',
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength(payload),
                                'X-Secret-Key': bot.secret_key
                            }
                        };
                        await new Promise((resolve) => {
                            const webhookReq = http.request(options, (webhookRes) => {
                                let data = '';
                                webhookRes.on('data', (chunk) => { data += chunk; });
                                webhookRes.on('end', () => resolve());
                            });
                            webhookReq.on('error', (err) => {
                                logger.log(`⚠️  Notification sync webhook failed: ${err.message}`);
                                resolve();
                            });
                            webhookReq.write(payload);
                            webhookReq.end();
                        });
                    }
                } catch (err) {
                    logger.log(`⚠️  Notification sync trigger failed: ${err.message}`);
                }
            }

            const account = await getAccountForLogging(req);
            if (account) {
                const server = await db.getServer(req.params.id);
                const serverName = server ? server.name : `Server ID: ${req.params.id}`;
                await logPanelActivity(req, `${account.username} changed ${component_name} configuration on server "${serverName}" (Server ID: ${req.params.id})`);
            }
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

            let finalImageUrl = image_url ? image_url.trim() : null;
            if (finalImageUrl) {
                if (finalImageUrl.startsWith('/uploads/')) {
                    const protocol = req.protocol || 'http';
                    const host = req.get('host') || `localhost:${CONTROL_PANEL.PORT}`;
                    finalImageUrl = `${protocol}://${host}${finalImageUrl}`;
                } else if (!finalImageUrl.startsWith('http://') && !finalImageUrl.startsWith('https://') && !finalImageUrl.startsWith('data:')) {
                    finalImageUrl = null;
                }
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
                webhookRes.on('end', async () => {
                    try {
                        const result = JSON.parse(data);
                        if (webhookRes.statusCode === 200 && result.success) {
                            if (uploaded_image_path && !imageBuffer) {
                                cleanupUploadedImage(30000);
                            } else {
                                cleanupUploadedImage();
                            }
                            const account = await getAccountForLogging(req);
                            if (account) {
                                await logPanelActivity(req, `${account.username} used embed builder on server "${server.name || serverId}" (Server ID: ${serverId})`);
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

    app.post('/api/bots', requireAdmin, async (req, res) => {
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

            const account = await db.getPanelAccountById(req.session.panel_account_id);
            if (!account) {
                return res.status(401).json({
                    success: false,
                    error: 'Account not found'
                });
            }
            const panel_id = account.panel_id;

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

            if (account) {
                await logPanelActivity(req, `${account.username} added ${bot_type} bot: "${name || 'Bot'}" (ID: ${bot.id})`);
            }

            res.json({ success: true, bot });
        } catch (error) {
            logger.log(`❌ Create bot error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.put('/api/bots/:id/mode', requireAdmin, async (req, res) => {
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

            const account = await getAccountForLogging(req);
            if (account) {
                const mode = is_testing ? 'testing' : 'production';
                await logPanelActivity(req, `${account.username} changed bot "${bot.name}" (ID: ${bot.id}) to ${mode} mode`);
            }

            res.json({ success: true });
        } catch (error) {
            logger.log(`❌ Update bot mode error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.delete('/api/bots/:id', requireAdmin, async (req, res) => {
        try {
            const bot = await db.getBot(req.params.id);
            if (bot) {
                const account = await getAccountForLogging(req);
                if (account) {
                    await logPanelActivity(req, `${account.username} removed bot "${bot.name}" (ID: ${bot.id}, Type: ${bot.bot_type})`);
                }
            }
            await db.deleteBot(req.params.id);
            res.json({ success: true });
        } catch (error) {
            logger.log(`❌ Delete bot error: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/start', requireAdmin, async (req, res) => {
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
            if (result.success) {
                const account = await getAccountForLogging(req);
                if (account) {
                    await logPanelActivity(req, `${account.username} started bot "${bot.name}" (ID: ${bot_id})`);
                }
            }
            res.json(result);
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

    app.post('/api/stop', requireAdmin, async (req, res) => {
        const { bot_id } = req.body;
        if (!bot_id) {
            return res.json({ success: false, error: 'bot_id is required' });
        }

        try {
            const bot = await db.getBot(bot_id);
            const result = await stopBotById(bot_id);
            if (result.success && bot) {
                const account = await getAccountForLogging(req);
                if (account) {
                    await logPanelActivity(req, `${account.username} stopped bot "${bot.name}" (ID: ${bot_id})`);
                }
            }
            res.json(result);
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

    app.post('/api/restart', requireAdmin, async (req, res) => {
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
            if (result.success) {
                const account = await getAccountForLogging(req);
                if (account) {
                    await logPanelActivity(req, `${account.username} restarted bot "${bot.name}" (ID: ${bot_id})`);
                }
            }
            res.json(result);
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

    app.get('/', (req, res) => {
        res.sendFile(join(__dirname, 'index.html'));
    });

    app.get('/register', (req, res) => {
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

const BOT_KILL_TIMEOUT_MS = 2000;

export function stop(callback) {
    for (const [botId, info] of botProcesses.entries()) {
        try {
            if (info.process && !info.process.killed && info.process.exitCode === null) {
                info.process.kill('SIGINT');
                logger.log(`🛑 Stopping bot ${botId} (PID ${info.pid}) for app shutdown`);
                const proc = info.process;
                setTimeout(() => {
                    if (proc && !proc.killed && proc.exitCode === null) {
                        try { proc.kill('SIGKILL'); } catch (_) { }
                    }
                }, BOT_KILL_TIMEOUT_MS);
            }
        } catch (e) {
            try { process.kill(info.pid, 'SIGKILL'); } catch (_) { }
        }
        botProcesses.delete(botId);
    }
    if (server) {
        const s = server;
        server = null;
        logger.log('🛑 Control panel stopping (closing server)...');
        let done = false;
        const onDone = () => {
            if (done) return;
            done = true;
            logger.log('🛑 Control panel stopped');
            if (typeof callback === 'function') callback();
        };
        s.close(onDone);
        setTimeout(onDone, 5000).unref?.();
    } else if (typeof callback === 'function') {
        callback();
    }
}

export default { init, stop };
