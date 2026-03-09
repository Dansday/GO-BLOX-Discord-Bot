import { formatTimestamp } from "./utils.js";
import db from "../database/database.js";
import { getBotConfig } from "./config.js";

let _otelLogger = undefined;
let _otelApi = undefined;

function inferSeverity(text) {
    if (text.includes('❌')) return 'ERROR';
    if (text.includes('⚠️')) return 'WARN';
    return 'INFO';
}

async function getOtelLogger() {
    if (_otelLogger !== undefined) return _otelLogger;

    const hasExporter =
        Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT) ||
        Boolean(process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT);

    const logsExporter = (process.env.OTEL_LOGS_EXPORTER || '').toLowerCase();
    const logsEnabled = logsExporter !== 'none' && hasExporter;
    if (!logsEnabled) {
        _otelLogger = null;
        return _otelLogger;
    }

    try {
        const mod = await import('@opentelemetry/api-logs');
        const api = mod?.logs ? mod : mod?.default;
        if (!api?.logs?.getLogger) {
            _otelLogger = null;
            return _otelLogger;
        }
        _otelApi = api;
        _otelLogger = api.logs.getLogger('dansday.logger');
        return _otelLogger;
    } catch (e) {
        _otelLogger = null;
        return _otelLogger;
    }
}

async function log(text) {
    const timestamp = formatTimestamp(Date.now(), true);
    const formattedText = `[${timestamp}] ${text}`;

    try {
        const botConfig = getBotConfig();
        const botId = botConfig?.id || null;

        try {
            const otelLogger = await getOtelLogger();
            if (otelLogger) {
                const sevText = inferSeverity(text);
                const sevNum =
                    _otelApi?.SeverityNumber?.[sevText] ??
                    _otelApi?.SeverityNumber?.INFO ??
                    undefined;

                otelLogger.emit({
                    body: formattedText,
                    severityText: sevText,
                    ...(sevNum != null ? { severityNumber: sevNum } : {}),
                    attributes: botId ? { bot_id: botId } : undefined,
                });
            }
        } catch (e) {
        }

        try {
            const dbEnabled = (process.env.BOT_LOG_DB_ENABLED || 'true').toLowerCase() !== 'false';
            if (dbEnabled && botId) {
                await db.insertBotLog(botId, text);
            } else {
                console.log(formattedText);
            }
        } catch (error) {
            console.log(formattedText);
            console.error('Failed to store log in database:', error.message);
        }
    } catch (error) {
        console.log(formattedText);
        console.error('Logger error:', error.message);
    }
}

function init(client) {
    void client;
}

export default {
    init,
    log
};
