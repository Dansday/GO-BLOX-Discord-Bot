/**
 * Optional Redis client. If REDIS_URL is set, returns a connected client; otherwise null.
 * Used for session store and rate limiting when available.
 */

let client = null;

function normalizeRedisUrl(url) {
    if (!url || url.trim() === '') return url;
    try {
        const u = new URL(url);
        if (u.password) return url;
        if (u.username && !u.username.includes(':')) {
            const pass = encodeURIComponent(u.username);
            const host = u.hostname || u.host;
            const port = u.port || '6379';
            const db = (u.pathname || '/0').replace(/^\//, '') || '0';
            return `redis://:${pass}@${host}:${port}/${db}`;
        }
        return url;
    } catch (_) {
        return url;
    }
}

function buildRedisUrl() {
    const url = process.env.REDIS_URL;
    if (url && url.trim() !== '') return normalizeRedisUrl(url);
    const host = process.env.REDIS_HOST;
    if (!host || host.trim() === '') return null;
    const port = process.env.REDIS_PORT || '6379';
    const db = process.env.REDIS_DB || '0';
    const username = process.env.REDIS_USERNAME;
    const password = process.env.REDIS_PASSWORD;
    if (username && username.trim() !== '' && password && password.trim() !== '') {
        return `redis://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
    }
    if (password && password.trim() !== '') {
        return `redis://:${encodeURIComponent(password)}@${host}:${port}/${db}`;
    }
    return `redis://${host}:${port}/${db}`;
}

export async function getRedisClient() {
    if (client) return client;
    const url = buildRedisUrl();
    if (!url) return null;
    try {
        const { createClient } = await import('redis');
        const c = createClient({ url });
        c.on('error', (err) => console.error('Redis client error:', err.message));
        await c.connect();
        client = c;
        return client;
    } catch (err) {
        console.error('Redis connection failed:', err.message);
        return null;
    }
}

export function hasRedis() {
    return client != null;
}
