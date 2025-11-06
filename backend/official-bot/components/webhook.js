import { COMMUNICATION } from "../../config.js";
import logger from "../../logger.js";

let webhookServer = null;
let client = null;
let startTime = null;

// Handle status/health check endpoint
async function handleStatusRequest(req, res) {
    try {
        const headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        };

        // Require secret key authentication
        const secretKey = req.headers['x-secret-key'];
        if (!secretKey || secretKey !== COMMUNICATION.SECRET_KEY) {
            await logger.log(`❌ Status endpoint unauthorized access attempt from ${req.connection?.remoteAddress || 'unknown'}`);
            res.writeHead(401, headers);
            res.end(JSON.stringify({
                error: 'Unauthorized',
                message: 'Secret key required. Include x-secret-key header.'
            }));
            return;
        }

        if (!client || !client.isReady()) {
            res.writeHead(503, headers);
            res.end(JSON.stringify({
                status: 'offline',
                bot: null,
                uptime: null,
                guilds: 0,
                timestamp: new Date().toISOString()
            }));
            return;
        }

        const uptime = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
        const guildCount = client.guilds.cache.size;
        const userCount = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);

        res.writeHead(200, headers);
        res.end(JSON.stringify({
            status: 'online',
            bot: {
                id: client.user.id,
                username: client.user.username,
                tag: client.user.tag,
                discriminator: client.user.discriminator
            },
            uptime: uptime,
            uptime_formatted: formatUptime(uptime),
            guilds: guildCount,
            users: userCount,
            timestamp: new Date().toISOString()
        }));
    } catch (err) {
        await logger.log(`❌ Status endpoint error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
    }
}

// Format uptime in human-readable format
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
}

async function handleWebhookRequest(req, res) {
    try {
        // Handle status endpoint (GET /status or /health)
        if (req.method === 'GET' && (req.url === '/status' || req.url === '/health' || req.url === '/')) {
            await handleStatusRequest(req, res);
            return;
        }

        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        // Verify secret key
        const secretKey = req.headers['x-secret-key'];
        if (!secretKey || secretKey !== COMMUNICATION.SECRET_KEY) {
            await logger.log(`❌ Webhook unauthorized access attempt from ${req.connection.remoteAddress}`);
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);

                if (payload.type === 'message_forward' && payload.data) {
                    try {
                        await logger.log(`📥 Received message_forward webhook: channel ${payload.data.channel?.id} in guild ${payload.data.guild?.id}`, payload.data.guild?.id);

                        // Import forwarder dynamically to avoid circular dependency
                        const { processMessageFromSelfBot } = await import('./forwarder.js');
                        await processMessageFromSelfBot(payload.data, client);

                        await logger.log(`✅ Successfully processed message_forward webhook`, payload.data.guild?.id);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'Message processed' }));
                    } catch (forwardErr) {
                        await logger.log(`❌ Failed to process message: ${forwardErr.message}`, payload.data.guild?.id);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Failed to process message', details: forwardErr.message }));
                    }
                } else {
                    await logger.log(`❌ Invalid payload format: ${JSON.stringify(payload)}`, null);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid payload format' }));
                }
            } catch (parseErr) {
                await logger.log(`❌ Webhook parse error: ${parseErr.message}`);
                await logger.log(`❌ Raw body: ${body}`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
    } catch (err) {
        await logger.log(`❌ Webhook error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
    }
}

function startWebhookServer(discordClient) {
    client = discordClient;
    startTime = Date.now();

    if (COMMUNICATION.WEBHOOK_URL) {
        const port = COMMUNICATION.PORT;

        // Import http module dynamically
        import('http').then(http => {
            webhookServer = http.createServer(handleWebhookRequest);

            webhookServer.listen(port, () => {
                logger.log(`🌐 Webhook server started on port ${port}`);
                logger.log(`📡 Listening for messages at ${COMMUNICATION.WEBHOOK_URL}`);
                logger.log(`❤️ Health check available at http://localhost:${port}/status or /health`);
                logger.log(`🔐 Secret key required: Include 'x-secret-key' header (same as webhook secret key)`);
            });

            webhookServer.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    logger.log(`❌ Port ${port} is already in use. Trying port ${port + 1}...`);
                    webhookServer.listen(port + 1, () => {
                        logger.log(`🌐 Webhook server started on port ${port + 1}`);
                        logger.log(`📡 Listening for messages at ${COMMUNICATION.WEBHOOK_URL}`);
                    });
                } else {
                    logger.log(`❌ Webhook server error: ${err.message}`);
                }
            });
        });
    }
}

function stopWebhookServer() {
    if (webhookServer) {
        webhookServer.close();
        webhookServer = null;
        logger.log(`🛑 Webhook server stopped`);
    }
}

export default {
    startWebhookServer,
    stopWebhookServer
};
