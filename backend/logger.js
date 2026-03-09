function buildPayload(level, message, meta) {
    const payload = {
        level,
        message,
        time: new Date().toISOString()
    };

    if (meta && typeof meta === 'object') {
        payload.meta = meta;
    }

    return JSON.stringify(payload);
}

function info(message, meta) {
    const line = buildPayload('info', message, meta);
    console.log(line);
}

function debug(message, meta) {
    const line = buildPayload('debug', message, meta);
    console.log(line);
}

function warn(message, meta) {
    const line = buildPayload('warn', message, meta);
    console.warn(line);
}

function error(message, meta) {
    const line = buildPayload('error', message, meta);
    console.error(line);
}

// Backwards-compatible generic log method
function log(message, meta) {
    info(message, meta);
}

function init(client) {
    void client;
}

export default {
    init,
    log,
    info,
    debug,
    warn,
    error
};
