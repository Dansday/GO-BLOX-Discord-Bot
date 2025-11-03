// Frontend Configuration
import dotenv from 'dotenv';

dotenv.config();

// Control Panel Configuration
export const CONTROL_PANEL = {
    // Port for control panel web interface
    PORT: parseInt(process.env.CONTROL_PANEL_PORT)
};
