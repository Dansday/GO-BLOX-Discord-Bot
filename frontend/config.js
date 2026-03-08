import dotenv from 'dotenv';

dotenv.config();

// PORT: used by Coolify, Heroku, Railway, etc. for preview/production (dynamic port).
// CONTROL_PANEL_PORT: used by Docker/self-host when you want a fixed port (e.g. 80).
const portRaw = process.env.PORT || process.env.CONTROL_PANEL_PORT || '80';
const port = parseInt(portRaw, 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: set PORT or CONTROL_PANEL_PORT to a number 1-65535 (got "${portRaw}")`);
}

export const CONTROL_PANEL = {
    PORT: port
};