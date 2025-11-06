# GO BLOX Bot System

A comprehensive Discord bot management system with a web-based control panel. Features dual bot architecture (self-bot monitoring + official bot forwarding) with database-driven configuration, multiple server support, and extensive moderation/management features.

## Architecture

### Self-Bot (`backend/self-bot/`)
- **Purpose**: Monitors source Discord servers for new messages
- **Technology**: `discord.js-selfbot-v13`
- **Functionality**: 
  - Listens to configured source channels from database
  - Processes messages and sends data to official bot via webhook
  - Syncs server/channel/role data to database
  - Multiple self-bots can connect to one official bot

### Official Bot (`backend/official-bot/`)
- **Purpose**: Forwards messages, manages server features, and provides interactive interface
- **Technology**: `discord.js` (official bot API)
- **Functionality**:
  - Receives message data from self-bot(s) via webhook server
  - Forwards messages to target channels with role mentions
  - Welcomes new users with random messages
  - Thanks server boosters with custom messages
  - Provides interactive button-based interface
  - Tracks moderation actions (bans, unbans, kicks)
  - Finds inactive members
  - Manages custom supporter roles
  - AFK system with voice mute/deafen
  - Feedback submission system
  - Role-based permission system
  - Syncs server/channel/role data to database

### Control Panel (`frontend/`)
- **Purpose**: Web-based management interface for all bots
- **Technology**: Express.js with session-based authentication
- **Functionality**:
  - Create and manage multiple bots (official + self-bots)
  - Start/stop/restart bots remotely
  - Configure all bot settings via web interface
  - View bot status, uptime, and process information
  - Manage server configurations per bot
  - Configure forwarder, welcomer, booster, permissions, and more

## Project Structure

```
GOBLOX/
├── main.js                    # Control panel server entry point
├── package.json               # Dependencies and scripts
├── example.env               # Environment variables template
├── .env                      # Your environment variables (create this)
├── frontend/
│   ├── index.js              # Control panel Express server
│   ├── index.html            # Web interface (4624 lines)
│   └── config.js             # Frontend configuration
├── backend/
│   ├── config.js             # Backend configuration (database-driven)
│   ├── logger.js             # Centralized logging utility
│   ├── utils.js              # Utility functions
│   ├── official-bot/
│   │   ├── officialbot.js   # Official bot entry point
│   │   └── components/
│   │       ├── forwarder.js      # Message forwarding component
│   │       ├── welcomer.js       # User welcoming component
│   │       ├── booster.js         # Server booster thank you messages
│   │       ├── webhook.js        # Webhook server for self-bot communication
│   │       ├── commands.js       # Slash command system
│   │       ├── interface.js      # Button interface component
│   │       ├── moderation.js     # Moderation tracking component
│   │       ├── permissions.js    # Permission checking system
│   │       ├── sync.js           # Server/channel/role sync to database
│   │       ├── commands/         # Command definitions
│   │       │   └── admin/
│   │       │       └── setup.js  # Setup command
│   │       └── interface/        # Interface button handlers
│   │           ├── afk.js            # AFK button handler
│   │           ├── feedback.js      # Feedback button handler
│   │           ├── sendmessage.js    # Send message button handler
│   │           ├── help.js           # Help button handler
│   │           ├── customsupporterrole.js # Custom role handler
│   │           └── ... (other handlers)
│   └── self-bot/
│       ├── selfbot.js         # Self-bot entry point
│       └── components/
│           ├── forwarder.js    # Message monitoring component
│           └── sync.js         # Server/channel/role sync to database
└── database/
    ├── database.js            # Neon database client and operations
    └── schema.sql             # Database schema (tables, indexes)
```

## Features

### Core Features
- **Message Forwarding**: Forward messages from source channels to target channels with role mentions
- **Welcome System**: Custom welcome messages for new members with beautiful embeds
- **Booster System**: Thank server boosters with custom messages and embeds
- **Moderation Tracking**: Automatically log bans, unbans, and kicks with moderator information
- **Inactive Member Detection**: Find members who haven't been active in configured period
- **Custom Supporter Roles**: Allow supporters to create custom roles with icons and colors
- **AFK System**: Set AFK status with automatic nickname prefix and voice mute/deafen
- **Feedback System**: Submit feedback to staff with automatic channel posting
- **Permission System**: Role-based permissions (Admin, Staff, Supporter, Member)
- **Testing/Production Modes**: Switch between test and production channels

### Management Features
- **Web Control Panel**: Full web interface for bot management
- **Multiple Bot Support**: Manage multiple official bots and self-bots
- **Database-Driven Config**: All settings stored in Neon PostgreSQL (no file editing needed)
- **Real-time Status**: Live bot status, uptime, and process information
- **Remote Control**: Start/stop/restart bots from anywhere
- **Session Authentication**: Secure password-protected control panel

## Setup

### Prerequisites
- Node.js (v18+ recommended)
- Neon PostgreSQL account (free tier works)
- Discord bot token(s)
- Discord application ID (for official bots)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root directory (copy from `example.env`):

```env
# Neon PostgreSQL Configuration (Required)
DATABASE_URL=postgresql://user:password@host/database?sslmode=require

# Control Panel Configuration
CONTROL_PANEL_PORT=8080

# Session Secret (optional, for production)
SESSION_SECRET=your-random-secret-key
```

**Getting Neon Credentials:**
- **DATABASE_URL**: Go to Neon Dashboard → Connection Details → Copy connection string

### 3. Initialize Database
The database will be automatically initialized when you start the control panel. If `DATABASE_URL` is set, tables will be created automatically. Otherwise, you can manually run the SQL schema:

1. Open Neon Dashboard → SQL Editor
2. Copy and paste the contents of `database/schema.sql`
3. Execute the SQL

### 4. Start Control Panel
```bash
npm start
```

This starts the control panel web server. Access it at `http://localhost:8080` (or your configured port).

### 5. First-Time Setup

1. **Register Panel Password**: 
   - On first access, you'll be prompted to create a panel password
   - This password protects your control panel (minimum 6 characters)

2. **Create Official Bot**:
   - Click "Add Bot" → Select "Official Bot"
   - Enter:
     - Bot name (e.g., "My Bot")
     - Official bot token (from Discord Developer Portal)
     - Application ID (from Discord Developer Portal)
     - Port (unique port for webhook server, e.g., 7777)
     - Secret key (random string for webhook authentication)

3. **Create Self-Bot** (Optional):
   - Click "Add Bot" → Select "Self-Bot"
   - Enter:
     - Bot name (e.g., "Monitor Bot")
     - Self-bot token (your user token)
     - Connect to: Select the official bot created above

4. **Configure Bot Settings**:
   - All settings are configured through the web interface
   - No file editing required!
   - Settings include:
     - Forwarder configuration (source/target channels, role mentions)
     - Welcome messages and channels
     - Booster messages and channels
     - Permission roles (Admin, Staff, Supporter, Member)
     - Embed colors and footers
     - Main channel (for moderation logs)
     - Logger channel
     - Feedback channel
     - Custom role constraints

5. **Start Bots**:
   - Click "Start" on any bot to start it
   - Bot status updates in real-time
   - View uptime and process ID

## Usage

### Control Panel
Access the control panel at `http://localhost:8080` (or your configured port).

**Features:**
- **Dashboard**: View all bots and their status
- **Bot Management**: Create, edit, delete bots
- **Server Configuration**: Configure settings per Discord server
- **Start/Stop/Restart**: Control bots remotely
- **Real-time Status**: Live updates every 2 seconds

### Discord Commands

#### Admin Commands
- `/interface #channel` - Send bot interface with buttons to target channel (requires Administrator permissions)

### Interface Buttons

The `/interface` command creates a visual interface with buttons. All button responses are ephemeral (private to the user).

#### 📊 Status Button
- Shows bot status, uptime, and component information
- **Permission:** Member+

#### ⏸️ AFK Button
- Set yourself as AFK (Away From Keyboard) with optional message
- Features:
  - Optional custom AFK message
  - Nickname automatically prefixed with `[AFK]`
  - Original display name is restored when AFK is removed
  - If in voice channel: automatically muted and deafened
  - Auto-removal when you send any message, unmute/undeafen, or manually remove
  - Mention notifications: Users notified when mentioning you while AFK
  - DM notifications: You receive a DM when mentioned while AFK
- **Permission:** Member+

#### ❓ Help Button
- Displays comprehensive help information for all interface features
- **Permission:** Member+

#### 💬 Feedback Button
- Submit feedback, suggestions, or concerns to server staff
- Features:
  - Simple modal with text input (up to 2000 characters)
  - All submissions posted to configured feedback channel with user information
  - Staff role automatically mentioned in feedback channel
- **Permission:** Member+

#### ⏸️ Pause/Resume Button
- Pauses or resumes the bot's operations
- When paused, all bot features are disabled except this button
- **Permission:** Admin only

#### 📤 Send Message Button
- Send custom embed messages to any channel
- Features:
  - Select target channel from dropdown
  - Optionally mention one or more roles
  - Custom title (required)
  - Custom description (optional)
  - Optional image URL
  - Optional color customization (hex/decimal/color name)
  - Optional footer text (defaults to configured footer if empty)
- Step-by-step process: Select channel → Choose role (optional) → Fill embed details → Send
- **Permission:** Staff+

#### 📊 Inactive Members Button
- Find members who haven't chatted in the configured inactivity period
- Default: 90 days of inactivity
- Searches through all text and voice text channels in specified categories
- Results show member tags and last activity time
- **Permission:** Staff+

#### 💎 Custom Supporter Role Button
- Create, edit, or delete a custom role
- **Create Features:**
  - Set custom role name (1-100 characters)
  - Set role color (hex format like #FF5733, decimal number, or color name)
  - Set role icon (Unicode emoji or JPG/PNG image URL)
  - Role automatically positioned between configured role constraints (role start and role end)
  - Each user can have exactly one custom role
- **Edit Features:**
  - Modify existing role name, color, or icon
  - Pre-filled with current values
  - Clear icon field to remove icon
- **Delete Features:**
  - Permanently delete your custom role
  - Role and all permissions removed
- **Auto-Cleanup:**
  - Roles with no members or more than one member are automatically removed
  - Cleanup runs on bot startup (after 5 seconds) and every 6 hours
  - Roles removed when members lose permission or leave server
  - Valid roles (exactly 1 member) are preserved across bot restarts
- **Permission:** Supporter, Staff, or Admin

## Communication Method

### Webhook Communication
- Self-bot sends message data via HTTP POST to local webhook server
- Official bot runs a webhook server on configured port (default: 7777)
- **Secret key authentication**: All endpoints require `X-Secret-Key` header
- **Health Check Endpoint**: `GET /status` or `GET /health` - Returns bot status, uptime, guild count (requires secret key)
- **Local communication**: Both bots run on same server, communicate via localhost
- Real-time communication for instant message forwarding
- Each official bot can have its own port (multiple bots supported)

## Configuration

### Database-Driven Configuration
**All configuration is stored in Neon PostgreSQL database** - no file editing required!

Configuration is managed through:
1. **Web Control Panel**: Primary method for all settings
2. **Database**: Settings stored in `server_settings` table with JSONB

### Configuration Components

#### Forwarder Configuration
- Source channels (from self-bot servers)
- Target channels (in official bot servers)
- Role mentions per forwarder
- Production/test mode support

#### Welcomer Configuration
- Welcome channels
- Welcome message templates (with `{user}` placeholder)
- Random message selection

#### Booster Configuration
- Booster channels
- Booster message templates (with `{user}` placeholder)
- Random message selection

#### Permissions Configuration
- Admin roles (full access)
- Staff roles (all interfaces: Send Message, Custom Supporter Role, AFK, Help, Feedback)
- Supporter roles (Custom Supporter Role, Help)
- Member roles (AFK, Help, Feedback)

#### Main Configuration
- Production channel (for moderation logs)
- Test channel (for testing mode)
- Logger channel (for bot logs)
- Embed color (hex format)
- Embed footer (with placeholders: `{server}`, `{year}`, `{date}`, `{time}`)

#### Feedback Configuration
- Feedback channel ID (where submissions are posted)
- Staff roles automatically mentioned in feedback channel

#### Custom Supporter Role Configuration
- Role Start (top/highest position - typically Supporter role)
- Role End (bottom/lowest position - typically Staff role)
- Custom roles are created between these constraints

#### Activity Tracker Configuration
- Allowed categories for activity search
- Inactivity days (default: 90)

## Testing vs Production Mode

- **Testing Mode** (`is_testing: true`): Uses test channels for safe testing
- **Production Mode** (`is_testing: false`): Uses production channels for full functionality
- Mode is set per official bot in the control panel
- Self-bots automatically inherit mode from their connected official bot
- Easy switching between modes via web interface

## Security Features

1. **Panel Authentication**: Password-protected control panel with session management
2. **Secret Key Authentication**: Webhook requires `X-Secret-Key` header
3. **Unauthorized Access Logging**: Failed authentication attempts are logged
4. **Secure Communication**: Only self-bot with correct secret key can send data
5. **Token Isolation**: Self-bot and official bot use different tokens
6. **Separation of Concerns**: Self-bot only monitors, official bot only forwards
7. **Process Verification**: Bot status verified against actual running processes

## Components

Each feature is organized as a component for easy maintenance:

### Official Bot Components
- **Forwarder Component**: Handles message processing and forwarding
- **Welcomer Component**: Handles new user welcoming with beautiful embeds
- **Booster Component**: Handles server booster thank you messages
- **Webhook Component**: Handles webhook server for self-bot communication and health check endpoint
- **Commands Component**: Handles slash command system and execution
- **Interface Component**: Handles button interface creation and interactions
- **Moderation Component**: Tracks bans, unbans, and kicks in real-time, logs to main channel
- **Permissions Component**: Role-based permission checking system
- **Sync Component**: Event-driven sync system - syncs on bot startup and when configs are accessed/updated (30-minute cooldown)

### Self-Bot Components
- **Forwarder Component**: Handles message monitoring and filtering
- **Sync Component**: Syncs server data to database

### Utility Components
- **Logger Component**: Centralized logging system with Discord channel integration

## Database Schema

The system uses Neon PostgreSQL with the following main tables:

- **panel**: Panel administrator credentials
- **panel_logs**: Login attempt logs
- **bots**: Bot configurations (tokens, ports, status, etc.)
- **servers**: Discord server information per bot
- **categories**: Discord category information (type 4 channels)
- **channels**: Discord channel information
- **roles**: Discord role information
- **server_settings**: Component-specific settings per server (JSONB)

## Troubleshooting

### Database Issues
1. **Tables not found**: 
   - Ensure `DATABASE_URL` is set in `.env`
   - Database will auto-create tables on first startup
   - Or manually run `database/schema.sql` in Neon SQL Editor

2. **Connection errors**: 
   - Verify `DATABASE_URL` in `.env`
   - Check `DATABASE_URL` format and credentials
   - Ensure Neon project is active

### Bot Issues
1. **Bot won't start**: 
   - Check bot token is valid
   - Verify bot has required permissions in Discord
   - Check application ID is correct for official bots
   - Review control panel logs for errors

2. **Self-bot not receiving messages**: 
   - Verify forwarder configuration in control panel
   - Check source channel IDs are correct
   - Ensure self-bot is in the source server
   - Check self-bot token is valid

3. **Official bot not forwarding**: 
   - Verify forwarder configuration (target channels, roles)
   - Check webhook server is running (check port)
   - Verify secret key matches between self-bot and official bot
   - Check official bot has permissions in target channels

4. **Communication issues**: 
   - Verify webhook URL and port configuration
   - Check secret key matches
   - Ensure both bots are running
   - Check firewall/network settings for localhost
   - Test health endpoint: `curl -H "x-secret-key: YOUR_KEY" http://localhost:PORT/status`

5. **Sync issues**: 
   - Sync runs on bot startup automatically
   - Sync also triggers when configs are accessed or updated
   - 30-minute cooldown between syncs per server
   - Check `last_accessed` timestamp in `server_settings` table if sync seems delayed

### Control Panel Issues
1. **Can't login**: 
   - If first time, register a password
   - Check password is correct
   - View login logs in database (`panel_logs` table)

2. **Interface not loading**: 
   - Check browser console for errors
   - Verify control panel server is running
   - Check port is not blocked by firewall

3. **Bot status not updating**: 
   - Refresh the page
   - Check bot process is actually running
   - Verify database connection

### Feature Issues
1. **Interface not appearing**: 
   - Use `/interface #channel` to create the interface
   - Requires Administrator permissions

2. **Permission errors**: 
   - Verify permission roles are configured in control panel
   - Check user has required role in Discord
   - Ensure roles are synced to database

3. **Bot appears paused**: 
   - Use the Pause/Resume button in the interface to resume
   - Requires Administrator permissions

## Development

### Project Structure
- Modular component-based architecture
- Database-driven configuration (no hardcoded settings)
- Type: ES Modules (`"type": "module"` in package.json)

### Adding New Features
1. Create component in appropriate directory (`backend/official-bot/components/` or `backend/self-bot/components/`)
2. Export init function and any handlers
3. Import and initialize in bot entry point
4. Add configuration to database schema if needed
5. Add UI controls in control panel if needed

## License

MIT License - See LICENSE file for details

## Author

Akbar Yudhanto

## Version

5.0.0

---

**Note**: This is a comprehensive bot management system. For detailed component documentation, refer to individual component files in the codebase.
