const TIMEZONE = process.env.TIMEZONE || "Asia/Jakarta";

export function separateChannelsAndCategories(guildChannels) {

    const channelsArray = Array.from(guildChannels.values());

    const isThreadType = (type) => {
        if (typeof type === 'number') {
            return type === 10 || type === 11 || type === 12;
        }

        if (typeof type === 'string') {
            return type === 'GUILD_NEWS_THREAD' ||
                type === 'GUILD_PUBLIC_THREAD' ||
                type === 'GUILD_PRIVATE_THREAD';
        }
        return false;
    };

    const isCategoryType = (type) => {
        if (typeof type === 'number') {
            return type === 4;
        }
        if (typeof type === 'string') {
            return type === 'GUILD_CATEGORY';
        }
        return false;
    };

    const isTextOrNewsType = (type) => {
        if (typeof type === 'number') {
            return type === 0 || type === 5;
        }
        if (typeof type === 'string') {
            return type === 'GUILD_TEXT' || type === 'GUILD_NEWS';
        }
        return false;
    };

    const isVoiceType = (type) => {
        if (typeof type === 'number') {
            return type === 2;
        }
        if (typeof type === 'string') {
            return type === 'GUILD_VOICE';
        }
        return false;
    };

    const isStageType = (type) => {
        if (typeof type === 'number') {
            return type === 13;
        }
        if (typeof type === 'string') {
            return type === 'GUILD_STAGE_VOICE';
        }
        return false;
    };

    const allChannels = channelsArray.filter(ch => {

        const isThreadMethod = ch.isThread ? ch.isThread() : false;

        const isThreadByType = isThreadType(ch.type);

        return !isThreadMethod && !isThreadByType;
    });

    const categories = allChannels.filter(ch => {
        return isCategoryType(ch.type);
    });

    const channels = allChannels.filter(ch => {
        return isTextOrNewsType(ch.type) || isVoiceType(ch.type) || isStageType(ch.type);
    });

    return { categories, channels };
}

export function mapCategoriesForSync(categories) {
    return categories.map(cat => ({
        id: cat.id,
        name: cat.name,
        position: cat.position !== undefined ? cat.position : null
    }));
}

export function mapChannelsForSync(channels) {
    return channels.map(ch => {

        let typeValue = ch.type;
        if (typeof ch.type === 'number') {

            const typeMap = {
                0: 'GUILD_TEXT',
                2: 'GUILD_VOICE',
                5: 'GUILD_NEWS',
                13: 'GUILD_STAGE_VOICE'
            };
            typeValue = typeMap[ch.type] || String(ch.type);
        } else if (typeof ch.type === 'string') {

            typeValue = ch.type;
        } else {

            typeValue = String(ch.type);
        }

        return {
            id: ch.id,
            name: ch.name,
            type: typeValue,
            parent_id: ch.parentId || null,
            position: ch.position !== undefined ? ch.position : null
        };
    });
}

function getTimeComponents(date = new Date(), timezone = TIMEZONE) {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });

    const parts = formatter.formatToParts(date);
    return {
        year: parseInt(parts.find(p => p.type === 'year').value),
        month: parseInt(parts.find(p => p.type === 'month').value) - 1,
        day: parseInt(parts.find(p => p.type === 'day').value),
        hour: parseInt(parts.find(p => p.type === 'hour').value),
        minute: parseInt(parts.find(p => p.type === 'minute').value),
        second: parseInt(parts.find(p => p.type === 'second').value)
    };
}

function getTimezoneOffset(timezone = TIMEZONE) {
    const now = new Date();
    const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const tz = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
    return (tz - utc) / (1000 * 60 * 60);
}

export function formatTimestamp(timestamp = Date.now(), includeSeconds = false) {
    const formatter = new Intl.DateTimeFormat("id-ID", {
        timeZone: TIMEZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: includeSeconds ? "2-digit" : undefined,
        hour12: false,
    });

    return formatter.format(new Date(timestamp)).replace(",", "");
}

export function getNowInTimezone() {
    const now = new Date();
    const components = getTimeComponents(now);
    const offset = getTimezoneOffset();
    const offsetHours = Math.floor(offset);
    const offsetMinutes = Math.floor((offset - offsetHours) * 60);
    const offsetSign = offset >= 0 ? '+' : '-';
    const offsetStr = `${offsetSign}${String(Math.abs(offsetHours)).padStart(2, '0')}:${String(Math.abs(offsetMinutes)).padStart(2, '0')}`;

    const isoString = `${components.year}-${String(components.month + 1).padStart(2, '0')}-${String(components.day).padStart(2, '0')}T${String(components.hour).padStart(2, '0')}:${String(components.minute).padStart(2, '0')}:${String(components.second).padStart(2, '0')}${offsetStr}`;

    return new Date(isoString);
}

export function parseMySQLDateTime(mysqlDateTimeString, timezone = TIMEZONE) {
    if (!mysqlDateTimeString) return null;

    let dateString = mysqlDateTimeString;
    if (typeof mysqlDateTimeString !== 'string') {
        if (mysqlDateTimeString instanceof Date) {
            const year = mysqlDateTimeString.getFullYear();
            const month = String(mysqlDateTimeString.getMonth() + 1).padStart(2, '0');
            const day = String(mysqlDateTimeString.getDate()).padStart(2, '0');
            const hours = String(mysqlDateTimeString.getHours()).padStart(2, '0');
            const minutes = String(mysqlDateTimeString.getMinutes()).padStart(2, '0');
            const seconds = String(mysqlDateTimeString.getSeconds()).padStart(2, '0');
            dateString = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        } else {
            dateString = String(mysqlDateTimeString);
        }
    }

    const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!match) {
        return new Date(mysqlDateTimeString);
    }

    const [, year, month, day, hour, minute, second] = match;

    const components = {
        year: parseInt(year, 10),
        month: parseInt(month, 10) - 1,
        day: parseInt(day, 10),
        hour: parseInt(hour, 10),
        minute: parseInt(minute, 10),
        second: parseInt(second, 10)
    };

    const offset = getTimezoneOffset(timezone);
    const offsetHours = Math.floor(offset);
    const offsetMinutes = Math.floor((offset - offsetHours) * 60);
    const offsetSign = offset >= 0 ? '+' : '-';
    const offsetStr = `${offsetSign}${String(Math.abs(offsetHours)).padStart(2, '0')}:${String(Math.abs(offsetMinutes)).padStart(2, '0')}`;

    const isoString = `${components.year}-${String(components.month + 1).padStart(2, '0')}-${String(components.day).padStart(2, '0')}T${String(components.hour).padStart(2, '0')}:${String(components.minute).padStart(2, '0')}:${String(components.second).padStart(2, '0')}${offsetStr}`;

    return new Date(isoString);
}

export function toMySQLDateTime(date, timezone = TIMEZONE) {
    if (!date) date = new Date();
    if (typeof date === 'string') date = new Date(date);

    const components = getTimeComponents(date, timezone);

    const year = components.year;
    const month = String(components.month + 1).padStart(2, '0');
    const day = String(components.day).padStart(2, '0');
    const hours = String(components.hour).padStart(2, '0');
    const minutes = String(components.minute).padStart(2, '0');
    const seconds = String(components.second).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export const getNowIndonesia = getNowInTimezone;
export const toMySQLDateTimeIndonesia = toMySQLDateTime;
