// Common utility functions used across the application

/**
 * Format timestamp to Indonesian format
 * @param {number} [timestamp] - Optional timestamp to format. If not provided, uses current time
 * @param {boolean} [includeSeconds=false] - Whether to include seconds in the format
 * @returns {string} Formatted timestamp string
 */
export function formatTimestamp(timestamp = Date.now(), includeSeconds = false) {
    const formatter = new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
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

/**
 * Delay execution for specified milliseconds
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise} Promise that resolves after the delay
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
