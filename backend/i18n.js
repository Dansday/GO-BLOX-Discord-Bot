import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from '../database/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const translations = new Map();
const defaultLang = 'en';

function loadTranslations() {
    const localesDir = join(__dirname, 'locales');

    const languages = ['en', 'id'];

    for (const lang of languages) {
        try {
            const filePath = join(localesDir, `${lang}.json`);
            if (existsSync(filePath)) {
                const content = readFileSync(filePath, 'utf-8');
                translations.set(lang, JSON.parse(content));
            }
        } catch (error) {
        }
    }

    if (!translations.has(defaultLang)) {
        const enPath = join(localesDir, `${defaultLang}.json`);
        if (existsSync(enPath)) {
            try {
                const content = readFileSync(enPath, 'utf-8');
                translations.set(defaultLang, JSON.parse(content));
            } catch (error) {
                console.error(`Failed to load default language (${defaultLang}):`, error);
            }
        }
    }
}

loadTranslations();

export async function getUserLanguage(guildId, userId) {
    try {
        if (!guildId || !userId) {
            return defaultLang;
        }

        const { getBotConfig } = await import('./config.js');
        const botConfig = getBotConfig();
        if (!botConfig || !botConfig.id) {
            return defaultLang;
        }

        const server = await db.getServerByDiscordId(botConfig.id, guildId);
        if (server) {
            const member = await db.getMemberByDiscordId(server.id, userId);
            if (member?.language) {
                return member.language;
            }
        }

        return defaultLang;
    } catch (error) {
        return defaultLang;
    }
}

export function t(key, lang = defaultLang, params = {}) {
    if (!key) return '';

    const langTranslations = translations.get(lang) || translations.get(defaultLang);

    if (!langTranslations) {
        return key;
    }

    const keys = key.split('.');
    let value = langTranslations;

    for (const k of keys) {
        value = value?.[k];
        if (!value) {
            const enTranslations = translations.get(defaultLang);
            if (enTranslations) {
                let enValue = enTranslations;
                for (const enKey of keys) {
                    enValue = enValue?.[enKey];
                    if (!enValue) break;
                }
                if (enValue) {
                    value = enValue;
                    break;
                }
            }
            if (!value) {
                return key;
            }
        }
    }

    if (typeof value === 'string') {
        value = value.replace(/\\n/g, '\n');

        if (Object.keys(params).length > 0) {
            value = value.replace(/\{(\w+)\}/g, (match, paramKey) => {
                return params[paramKey] !== undefined ? String(params[paramKey]) : match;
            });
        }
    }

    return value || key;
}

export async function translate(key, guildId, userId, params = {}) {
    const lang = await getUserLanguage(guildId, userId);
    return t(key, lang, params);
}

export function getAvailableLanguages() {
    return Array.from(translations.keys());
}
