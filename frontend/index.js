import express from 'express';
import { spawn, exec } from 'child_process';
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

// Store process info (for backward compatibility)
let processInfo = {
    pid: null,
    startTime: null,
    status: 'stopped', // 'running', 'stopped', 'starting', 'stopping'
    mode: null // 'both', 'selfbot', 'official'
};

// Check if any bots exist
async function checkSetup() {
    const bots = await db.getAllBots();
    return bots.length > 0;
}

// Setup middleware - check if setup is required
async function checkSetupRequired(req, res, next) {
    const isSetup = await checkSetup();
    if (!isSetup && !req.path.startsWith('/api/setup')) {
        return res.json({ setupRequired: true });
    }
    next();
}

// Get bot status
async function getBotStatus() {
    const isRunning = botProcess && !botProcess.killed && botProcess.exitCode === null;
    
    // Also check if bot process is actually running (in case it was started externally)
    let actualRunning = isRunning;
    if (processInfo.pid && !isRunning) {
        try {
            // Try to check if process still exists (Unix/Linux only)
            process.kill(processInfo.pid, 0); // Signal 0 doesn't kill, just checks if process exists
            actualRunning = true;
        } catch (err) {
            // Process doesn't exist
            actualRunning = false;
            processInfo.pid = null;
            processInfo.startTime = null;
            processInfo.status = 'stopped';
        }
    }
    
    let uptime = null;
    if (processInfo.startTime && actualRunning) {
        uptime = Math.floor((Date.now() - processInfo.startTime) / 1000);
    }

    return {
        status: actualRunning ? 'running' : 'stopped',
        pid: processInfo.pid,
        startTime: processInfo.startTime,
        uptime: uptime,
        mode: processInfo.mode
    };
}

// Kill all bot processes (including child processes)
async function killAllBotProcesses() {
    return new Promise((resolve) => {
        // Find processes by matching backend.js, officialbot.js, or selfbot.js
        exec(`pgrep -f "node.*(backend|officialbot|selfbot)\\.js" || true`, (error, stdout, stderr) => {
            let allPids = stdout.trim().split('\n').filter(pid => pid && !isNaN(pid));
            
            // Filter to only actual bot processes (not control panel)
            const botPids = [];
            const checkPromises = allPids.map(pid => {
                return new Promise((resolveCheck) => {
                    const pidNum = parseInt(pid);
                    
                    // Skip control panel process
                    if (pidNum === process.pid) {
                        resolveCheck(false);
                        return;
                    }
                    
                    // Check the process command line
                    try {
                        const cmdline = readFileSync(`/proc/${pidNum}/cmdline`, 'utf8').replace(/\0/g, ' ');
                        // Must include backend.js or officialbot.js or selfbot.js but NOT frontend.js
                        if ((cmdline.includes('backend.js') || cmdline.includes('officialbot.js') || cmdline.includes('selfbot.js')) && !cmdline.includes('frontend.js')) {
                            botPids.push(pidNum);
                            resolveCheck(true);
                        } else {
                            resolveCheck(false);
                        }
                    } catch (e) {
                        // Process might not exist or no permission - skip it
                        resolveCheck(false);
                    }
                });
            });
            
            Promise.all(checkPromises).then(() => {
                if (botPids.length === 0) {
                    resolve([]);
                    return;
                }

                console.log(`Found ${botPids.length} bot process(es) to kill: ${botPids.join(', ')}`);

                // Kill all found processes - use kill command for better reliability
                const killPromises = botPids.map(pid => {
                    return new Promise((resolveKill) => {
                        // Use kill command directly for more reliability
                        exec(`kill -INT ${pid} 2>/dev/null || kill -KILL ${pid} 2>/dev/null || true`, (killErr) => {
                            // Also try via process.kill as backup
                            try {
                                process.kill(pid, 'SIGINT');
                            } catch (e) {
                                // Ignore errors
                            }
                            
                            // Wait a moment, then force kill if still alive
                            setTimeout(() => {
                                try {
                                    // Check if still running
                                    process.kill(pid, 0); // Signal 0 checks if process exists
                                    // Still running, force kill
                                    exec(`kill -KILL ${pid} 2>/dev/null || true`);
                                    try {
                                        process.kill(pid, 'SIGKILL');
                                    } catch (e) {
                                        // Process might be dead now
                                    }
                                } catch (e) {
                                    // Process is dead
                                }
                                resolveKill();
                            }, 1500);
                        });
                    });
                });

                Promise.all(killPromises).then(() => {
                    // Verify all are dead
                    setTimeout(() => {
                        const stillAlive = [];
                        botPids.forEach(pid => {
                            try {
                                process.kill(pid, 0); // Check if still exists
                                stillAlive.push(pid);
                            } catch (e) {
                                // Process is dead, good
                            }
                        });
                        
                        if (stillAlive.length > 0) {
                            console.log(`Warning: Some processes still alive, force killing: ${stillAlive.join(', ')}`);
                            stillAlive.forEach(pid => {
                                exec(`kill -KILL ${pid} 2>/dev/null || true`);
                            });
                        }
                        
                        resolve(botPids);
                    }, 500);
                });
            });
        });
    });
}

// Start the bot
async function startBot(mode = 'both') {
    // Check if already running by checking process
    if (botProcess && !botProcess.killed && botProcess.exitCode === null) {
        return { success: false, error: 'Bot is already running' };
    }

    // Also check if any bot processes are running
    return new Promise((resolve) => {
        const mainScriptPath = join(projectRoot, 'main.js');
        // Find all node processes
        exec(`pgrep -f "node" || true`, (error, stdout) => {
            const allPids = stdout.trim().split('\n').filter(pid => pid && !isNaN(pid));
            
            // Filter to only bot processes (main.js, not controlpanel-server)
            const botPids = [];
            const checkPromises = allPids.map(pid => {
                return new Promise((resolveCheck) => {
                    const pidNum = parseInt(pid);
                    
                    // Skip control panel process
                    if (pidNum === process.pid) {
                        resolveCheck(false);
                        return;
                    }
                    
                    // Check the process command line
                    try {
                        const cmdline = readFileSync(`/proc/${pidNum}/cmdline`, 'utf8').replace(/\0/g, ' ');
                        // Must include main.js but NOT controlpanel-server
                        if (cmdline.includes(mainScriptPath) && !cmdline.includes('controlpanel-server')) {
                            botPids.push(pidNum);
                            resolveCheck(true);
                        } else {
                            resolveCheck(false);
                        }
                    } catch (e) {
                        // Process doesn't exist or no permission - assume it's not a bot
                        resolveCheck(false);
                    }
                });
            });
            
            Promise.all(checkPromises).then(() => {
                if (botPids.length > 0) {
                    resolve({ success: false, error: `Bot processes are already running (PIDs: ${botPids.join(', ')}). Stop them first.` });
                    return;
                }
                
                // No bot processes running, continue with start
                processInfo.status = 'starting';
                processInfo.mode = mode;

                try {
                    const backendScript = join(projectRoot, 'backend.js');
                    botProcess = spawn('node', [backendScript, mode], {
                        cwd: projectRoot,
                        stdio: ['ignore', 'pipe', 'pipe'],
                        shell: true,
                        detached: false // Keep in same process group
                    });

                    processInfo.pid = botProcess.pid;
                    processInfo.startTime = Date.now();
                    processInfo.status = 'running';

                    // Handle output
                    botProcess.stdout.on('data', (data) => {
                        const output = data.toString();
                        console.log(`[Bot] ${output}`);
                    });

                    botProcess.stderr.on('data', (data) => {
                        const output = data.toString();
                        console.error(`[Bot Error] ${output}`);
                    });

                    // Handle process exit
                    botProcess.on('exit', (code, signal) => {
                        processInfo.status = 'stopped';
                        processInfo.pid = null;
                        processInfo.startTime = null;
                        botProcess = null;
                        logger.log(`Bot process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
                    });

                    botProcess.on('error', (err) => {
                        processInfo.status = 'stopped';
                        processInfo.pid = null;
                        processInfo.startTime = null;
                        botProcess = null;
                        logger.log(`Failed to start bot: ${err.message}`);
                    });

                    resolve({ success: true, pid: botProcess.pid });
                } catch (error) {
                    processInfo.status = 'stopped';
                    resolve({ success: false, error: error.message });
                }
            });
        });
    });
}

// Stop the bot
async function stopBot() {
    // Check if there's anything to stop
    const hadProcess = botProcess || processInfo.pid;
    
    if (!hadProcess) {
        // Also check if any bot processes are actually running
        const testKill = await killAllBotProcesses();
        if (testKill.length === 0) {
            return { success: false, error: 'Bot is not running' };
        }
        return { success: true, killed: testKill.length };
    }

    processInfo.status = 'stopping';

    // First, try to kill the tracked process
    if (botProcess && !botProcess.killed && botProcess.exitCode === null) {
        try {
            botProcess.kill('SIGINT');
        } catch (err) {
            // Process might already be dead
        }
    }

    // Kill all bot processes (including child processes)
    const killedPids = await killAllBotProcesses();
    
    // Clean up
    botProcess = null;
    processInfo.status = 'stopped';
    processInfo.pid = null;
    processInfo.startTime = null;

    if (killedPids.length > 0) {
        logger.log(`Stopped ${killedPids.length} bot process(es): ${killedPids.join(', ')}`);
        return { success: true, killed: killedPids.length };
    } else {
        return { success: true, message: 'No running processes found' };
    }
}

// Restart the bot
async function restartBot(mode = 'both') {
    const currentMode = processInfo.mode || mode;
    
    // Stop first and wait for it to complete
    const stopResult = await stopBot();
    
    if (!stopResult.success && stopResult.error !== 'Bot is not running') {
        return { success: false, error: `Failed to stop: ${stopResult.error}` };
    }
    
    // Wait a moment for all processes to fully stop
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Now start
    const startResult = await startBot(currentMode);
    return startResult;
}

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
            } catch (updateErr) {}
            
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
                } catch (updateErr) {}
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
                    } catch (e) {}
                }, 2000);
                botProcesses.delete(botId);
                
                // Update bot status in database
                try {
                    await db.updateBot(botId, {
                        status: 'stopped',
                        process_id: null,
                        uptime_started_at: null
                    });
                } catch (err) {}
                
                return { success: true, message: 'Stopped bot process' };
            } catch (e) {
                // Update status
                try {
                    await db.updateBot(botId, {
                        status: 'stopped',
                        process_id: null,
                        uptime_started_at: null
                    });
                } catch (err) {}
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
        } catch (err) {}
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
            } catch (e) {}
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
                port: port || 7777,
                connect_to: connect_to || null
            });

            res.json({ success: true, bot });
        } catch (error) {
            logger.log(`❌ Create bot error: ${error.message}`);
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

    // API Routes
    // Status endpoint
    app.get('/api/status', async (req, res) => {
        const status = await getBotStatus();
        res.json(status);
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
