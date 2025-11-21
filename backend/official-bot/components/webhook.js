import { COMMUNICATION } from "../../config.js";
import { EmbedBuilder } from 'discord.js';
import { getEmbedConfig } from "../../config.js";
import logger from "../../logger.js";

let webhookServer = null;
let client = null;

function parseColor(colorInput) {
    if (!colorInput || colorInput.trim() === '') {
        return null;
    }

    const trimmed = colorInput.trim();

    if (trimmed.startsWith('#')) {
        const hex = trimmed.substring(1);
        if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
            return parseInt(hex, 16);
        }
    } else if (/^[0-9A-Fa-f]{6}$/.test(trimmed)) {
        return parseInt(trimmed, 16);
    }

    const decimal = parseInt(trimmed, 10);
    if (!isNaN(decimal) && decimal >= 0 && decimal <= 0xFFFFFF) {
        return decimal;
    }

    const colorNames = {
        'red': 0xFF0000,
        'green': 0x00FF00,
        'blue': 0x0000FF,
        'yellow': 0xFFFF00,
        'orange': 0xFFA500,
        'purple': 0x800080,
        'pink': 0xFFC0CB,
        'cyan': 0x00FFFF,
        'black': 0x000000,
        'white': 0xFFFFFF,
        'gray': 0x808080,
        'grey': 0x808080
    };

    if (colorNames[trimmed.toLowerCase()]) {
        return colorNames[trimmed.toLowerCase()];
    }

    return null;
}

async function handleSendEmbed(payload) {
    try {
        const { guild_id, channel_ids, role_ids, title, description, image_url, color, footer } = payload;

        // Support both old format (single channel/role) and new format (multiple)
        const channelIds = channel_ids || (payload.channel_id ? [payload.channel_id] : []);
        const roleIds = role_ids || (payload.role_id ? [payload.role_id] : []);

        if (!guild_id || !channelIds || channelIds.length === 0 || !title) {
            throw new Error('Missing required fields: guild_id, channel_ids (array), and title are required');
        }

        const guild = client.guilds.cache.get(guild_id);
        if (!guild) {
            throw new Error('Guild not found');
        }

        const embedConfig = await getEmbedConfig(guild_id);
        let embedColor = embedConfig.COLOR;

        if (color && color.trim()) {
            const parsedColor = parseColor(color.trim());
            if (parsedColor !== null) {
                embedColor = parsedColor;
            } else {
                throw new Error('Invalid color format');
            }
        }

        const footerText = (footer && footer.trim()) ? footer.trim() : embedConfig.FOOTER;

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setFooter({ text: footerText })
            .setTimestamp();

        if (title) embed.setTitle(title);
        if (description) embed.setDescription(description);
        if (image_url) embed.setImage(image_url);

        // Build role mentions
        let content = '';
        if (roleIds && roleIds.length > 0) {
            const mentions = [];
            for (const roleId of roleIds) {
                const role = guild.roles.cache.get(roleId);
                if (role) {
                    mentions.push(`<@&${roleId}>`);
                }
            }
            if (mentions.length > 0) {
                content = mentions.join(' ');
            }
        }

        const messageOptions = {
            content: content || undefined,
            embeds: [embed]
        };

        // Send to all channels
        const results = [];
        for (const channelId of channelIds) {
            try {
                const channel = await guild.channels.fetch(channelId).catch(() => null);
                if (!channel) {
                    results.push({ channelId, success: false, error: 'Channel not found' });
                    continue;
                }

                if (!channel.isTextBased()) {
                    results.push({ channelId, success: false, error: 'Channel is not a text channel' });
                    continue;
                }

                await channel.send(messageOptions);
                results.push({ channelId, success: true, channelName: channel.name });
                await logger.log(`📤 Embed sent via webhook to ${channel.name} (${channel.id}) in ${guild.name} (${guild.id})`);
            } catch (channelError) {
                results.push({ channelId, success: false, error: channelError.message });
                await logger.log(`❌ Failed to send embed to channel ${channelId}: ${channelError.message}`);
            }
        }

        const successCount = results.filter(r => r.success).length;
        if (successCount === 0) {
            throw new Error(`Failed to send embed to any channel. Errors: ${results.map(r => r.error).join(', ')}`);
        }

        return { success: true, results, sentTo: successCount, total: channelIds.length };
    } catch (error) {
        await logger.log(`❌ Failed to send embed via webhook: ${error.message}`);
        throw error;
    }
}

function getClientIp(req) {
    const address = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
    return address.startsWith('::ffff:') ? address.slice(7) : address || 'unknown';
}

async function handleWebhookRequest(req, res) {
    try {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        const secretKey = req.headers['x-secret-key'];
        if (!secretKey || secretKey !== COMMUNICATION.SECRET_KEY) {
            await logger.log(`❌ Webhook unauthorized access attempt from ${getClientIp(req)}`);
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
                        await logger.log(`📥 Received message_forward webhook: channel ${payload.data.channel?.id} in guild ${payload.data.guild?.id}`);

                        const { processMessageFromSelfBot } = await import('./forwarder.js');
                        await processMessageFromSelfBot(payload.data, client);

                        await logger.log(`✅ Successfully processed message_forward webhook`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'Message processed' }));
                    } catch (forwardErr) {
                        await logger.log(`❌ Failed to process message: ${forwardErr.message}`);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Failed to process message', details: forwardErr.message }));
                    }
                } else if (payload.type === 'send_embed') {
                    try {
                        await logger.log(`📥 Received send_embed webhook: channel ${payload.channel_id} in guild ${payload.guild_id}`);
                        const result = await handleSendEmbed(payload);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'Embed sent successfully' }));
                    } catch (embedErr) {
                        await logger.log(`❌ Failed to send embed: ${embedErr.message}`);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Failed to send embed', details: embedErr.message }));
                    }
                } else {
                    await logger.log(`❌ Invalid payload format: ${JSON.stringify(payload)}`);
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

    if (COMMUNICATION.WEBHOOK_URL) {
        const port = COMMUNICATION.PORT;

        import('http').then(http => {
            webhookServer = http.createServer(handleWebhookRequest);

            webhookServer.listen(port, () => {
                logger.log(`🌐 Webhook server started on port ${port}`);
                logger.log(`📡 Listening for messages at ${COMMUNICATION.WEBHOOK_URL}`);
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
