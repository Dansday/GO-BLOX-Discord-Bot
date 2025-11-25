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
  - Manages custom supporter roles
  - AFK system with voice mute/deafen
  - Leveling system with XP tracking and leaderboards
  - Giveaway system with role restrictions and multiple entries
  - Feedback submission system
  - Role-based permission system
  - Syncs server/channel/role data to database
  - Timezone-aware operations (configurable via TIMEZONE environment variable)

### Control Panel (`frontend/`)
- **Purpose**: Web-based management interface for all bots
- **Technology**: Express.js with session-based authentication
- **Functionality**:
  - Create and manage multiple bots (official + self-bots)
  - Start/stop/restart bots remotely
  - Configure all bot settings via web interface
  - View bot status, uptime, and process information
  - Manage server configurations per bot
  - Configure forwarder, welcomer, booster, permissions, giveaway, leveling, and more
  - View bot logs in real-time terminal interface with auto-scroll
  - Server list pagination (10 servers per page)
  - Server overview dashboard with comprehensive statistics
  - Enhanced member list with advanced filtering, sorting, and search
  - Visual embed builder with live preview and image upload
  - Mobile-responsive design throughout

### Localization & User Preferences (`backend/i18n.js`, `backend/locales/`)
- **Multi-language support**: Built-in translation files for English and Bahasa Indonesia with easy JSON overrides
- **Per-member language**: Each member's preferred language is stored in `server_members.language` and respected across embeds, errors, and buttons
- **User preferences**: The in-discord ⚙️ Settings button lets members toggle level-up DM notifications (`server_member_levels.dm_notifications_enabled`) and change languages at any time
- **Extensible**: Add additional locale files under `backend/locales/` and they automatically appear in the Settings selector

## Project Structure

```
GOBLOX/
├── main.js                    # Control panel server entry point
├── package.json               # Dependencies and scripts
├── .env.dev                  # Development environment variables
├── .env.production           # Production environment variables
├── Dockerfile                # Docker container configuration
├── docker-compose.yml        # Docker Compose configuration
├── frontend/
│   ├── index.js              # Control panel Express server
│   ├── index.html            # Web interface
│   └── config.js             # Frontend configuration
├── backend/
│   ├── config.js             # Backend configuration (database-driven)
│   ├── i18n.js               # Localization runtime + helpers
│   ├── locales/              # Translation resources (per language JSON)
│   │   ├── en.json
│   │   └── id.json
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
│   │       ├── leveling.js       # Leveling system component
│   │       ├── staffreportrating.js # Staff rating role manager
│   │       ├── sync.js           # Server/channel/role sync to database
│   │       ├── commands/         # Command definitions
│   │       │   └── admin/
│   │       │       └── setup.js  # Setup command
│   │       └── interface/        # Interface button handlers
│   │           ├── afk.js                 # AFK button handler
│   │           ├── customsupporterrole.js # Custom role handler
│   │           ├── feedback.js           # Feedback button handler
│   │           ├── giveaway.js           # Giveaway button handler
│   │           ├── leveling.js           # Leveling button handler
│   │           ├── settings.js           # Per-member settings + localization
│   │           └── staffreportrating.js  # Staff report/rating workflow
│   └── self-bot/
│       ├── selfbot.js         # Self-bot entry point
│       └── components/
│           ├── forwarder.js    # Message monitoring component
│           └── sync.js         # Server/channel/role sync to database
└── database/
    ├── database.js            # MySQL database client and operations
    └── schema.sql             # Database schema (tables, indexes)
```

## Features

### Core Features
- **Message Forwarding**: Forward messages from source channels to target channels with role mentions
- **Welcome System**: Custom welcome messages for new members with beautiful embeds
- **Booster System**: Thank server boosters with custom messages and embeds
- **Moderation Tracking**: Automatically log bans, unbans, and kicks with moderator information
- **Custom Supporter Roles**: Allow supporters to create custom roles with icons and colors
- **AFK System**: Set AFK status with automatic nickname prefix and voice mute/deafen
- **Leveling System**: Track member activity with XP, levels, ranks, and leaderboards
  - XP from messages (+10 XP per message, 15s cooldown)
  - XP from voice chat (+30 XP per minute, minimum 1 minute)
  - XP from voice when AFK (+5 XP per minute, still counts time)
  - Exponential level curve (Level 2: 100 XP, Level 3: 200 XP, Level 4: 400 XP, etc.)
  - Automatic level recalculation from XP
  - Level up DM notifications
  - Live rank calculation
  - Top 5 leaderboard with medal emotes (🥇🥈🥉)
  - Tie-breaking by who reached level first
- **Feedback System**: Submit feedback to staff with automatic channel posting
- **Staff Report & Rating System**: Collect granular ratings for staff members with audit trail
  - Select staff from configured staff roles, choose rating (⭐1-5) and category (helpful, rude, abuse, etc.)
  - Require written feedback, optionally allow anonymous submissions, and enforce cooldowns per staff/member pair
  - Moderators approve/reject reports via buttons; approvals update running averages, DM the reporter, and notify the rated staff member
  - Automatically create/update per-staff rating roles with color-coded scores and send summary embeds to a dedicated rating channel
- **Giveaway System**: Create and manage giveaways with advanced features
  - Create giveaways with custom title, prize, duration, and winner count
  - Optional role restrictions (limit entries to specific roles)
  - Multiple entries support (allow users to enter multiple times)
  - Automatic winner selection with weighted random distribution
  - Real-time entry tracking and countdown
  - Finish, cancel, or force-end active giveaways
  - Automatic winner announcement when giveaway ends
  - Creator participation control (allow/disallow creator from entering)
  - Timezone-aware scheduling (uses configured TIMEZONE)
- **Permission System**: Role-based permissions (Admin, Staff, Supporter, Member)
- **Testing/Production Modes**: Switch between test and production channels
- **Localization & Personal Settings**: English + Bahasa Indonesia translations with per-member language preferences and level-up DM notification toggles exposed through the in-discord ⚙️ Settings interface

### Management Features
- **Web Control Panel**: Full web interface for bot management
- **Multiple Bot Support**: Manage multiple official bots and self-bots
- **Database-Driven Config**: All settings stored in MySQL/MariaDB (no file editing needed)
- **Real-time Status**: Live bot status, uptime, and process information
- **Remote Control**: Start/stop/restart bots from anywhere
- **Session Authentication**: Secure password-protected control panel
- **Bot Logs Terminal**: Real-time terminal view for each bot's logs with auto-refresh
- **Log Retention**: Automatic 7-day log retention policy
- **Server List Pagination**: View servers in paginated lists (10 per page)
- **Enhanced Member List**: Beautiful member cards with Font Awesome icons, mobile-responsive design, and advanced sorting options

## Setup

### Prerequisites
- Node.js (v18+ recommended) OR Docker & Docker Compose
- MySQL/MariaDB database (local or remote)
- Discord bot token(s)
- Discord application ID (for official bots)

## Quick Start with Docker (Recommended)

### 1. Clone and Configure
```bash
# Use .env.dev for development or .env.production for production
# Edit the appropriate .env file and set your values:
# - DB_ROOT_PASSWORD (for MariaDB)
# - DB_NAME, DB_USER, DB_PASSWORD
# - SESSION_SECRET (generate with: openssl rand -base64 32)
# - CONTROL_PANEL_PORT (default: 8080)
# - TIMEZONE (optional, defaults to Asia/Jakarta)
```

### 2. Start with Docker Compose
```bash
docker-compose up -d
```

This will:
- Build the application image
- Start MariaDB database container
- Start the application container
- Automatically create database tables

### 3. Access Control Panel
Open your browser: `http://localhost:8080` (or your configured port)

### 4. View Logs
```bash
docker-compose logs -f
```

### Common Docker Commands
```bash
# Stop containers
docker-compose down

# Restart containers
docker-compose restart

# Rebuild after code changes
docker-compose up -d --build

# View logs
docker-compose logs -f app
docker-compose logs -f database
```

## Manual Setup (Without Docker)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Use `.env.dev` for development or `.env.production` for production. Configure the appropriate file:

```env
# MySQL/MariaDB Configuration (Required)
# Option 1: Use DATABASE_URL
DATABASE_URL=mysql://user:password@host:port/database

# Option 2: Use individual variables
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_user
DB_PASSWORD=your_password
DB_NAME=goblox_bot

# Control Panel Configuration (Required)
CONTROL_PANEL_PORT=8080
SESSION_SECRET=your-random-secret-key

# Timezone Configuration (Optional)
# Defaults to Asia/Jakarta if not set
# Used for all date/time operations (giveaways, timestamps, etc.)
# Examples: "Asia/Jakarta", "Asia/Singapore", "America/New_York", "Europe/London"
TIMEZONE=Asia/Jakarta
```

**For Remote Database (SSH Tunnel):**
1. Create SSH tunnel: `ssh -p PORT -L 3306:localhost:3306 user@host`
2. Use `localhost:3306` in your DATABASE_URL

### 3. Initialize Database
The database will be automatically initialized when you start the control panel. Tables will be created automatically from `database/schema.sql` on first startup.

Alternatively, you can manually run the SQL schema:
1. Connect to your MySQL/MariaDB database
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
     - Giveaway channel
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
- **Bot Logs Terminal**: View real-time logs for each bot with auto-scroll and manual refresh
  - Auto-refresh every 5 seconds
  - Toggle auto-scroll on/off
  - Manual refresh button
  - Scroll position detection
  - Terminal-style display with timestamps
- **Server List**: Paginated server list (10 servers per page) with search and filter
- **Server Overview**: Comprehensive server statistics dashboard
  - Member statistics (total, with levels, boosters, AFK, custom roles)
  - Channel breakdown (text, voice, stage, announcement channels)
  - Leveling statistics (total XP, average level, max level, chat activity)
  - Voice activity metrics (total minutes, active minutes, AFK minutes, averages)
  - Roles and structure (total roles, boost level, categories)
  - Data sync timestamps (last updated for members, channels, roles, levels, etc.)
  - Configured components list with last update times
- **Server Members View**: Enhanced member list with advanced filtering and sorting
  - Filter by role type: All, Members, Supporter, Staff, Admin
  - Search by name or Discord ID
  - Multiple sort options:
    - Rank (High to Low / Low to High)
    - Level (High to Low / Low to High)
    - XP (High to Low / Low to High)
    - Name (A-Z / Z-A)
    - Voice Activity (Active / AFK minutes)
    - Chat count
    - Account created date
    - Member since date
    - AFK status (AFK first / last)
  - Beautiful member cards with:
    - Avatar display
    - Display name, username, and server nickname
    - Level, XP, and rank information
    - Role badges with colors
    - AFK status indicator
    - Voice activity stats
    - Chat count
    - Account and member join dates
    - Booster status
  - Mobile-responsive design
- **Embed Builder**: Visual embed creation tool with live preview
  - Title (required, max 256 characters)
  - Description (optional, max 4096 characters)
  - Image support (URL or file upload)
  - Color picker with hex/decimal/color name support
  - Custom footer (optional, max 2048 characters)
  - Multi-channel selection
  - Optional role mentions
  - Real-time character counter
  - Live preview of embed
  - Total embed size validation (6000 character limit)
  - Image preview for uploaded files

### Discord Commands

#### Admin Commands
- `/interface #channel` - Send bot interface with buttons to target channel (requires Administrator permissions)

### Interface Buttons

The `/interface` command creates a visual interface with buttons. All button responses are ephemeral (private to the user).

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

#### 📈 Leveling Button
- View your leveling stats and server leaderboard
- Features:
  - Personal stats: Level, XP, chat count, voice minutes, rank
  - Visual progress bar showing XP towards next level
  - Top 5 leaderboard with medal emotes (🥇🥈🥉) for top 3
  - Automatic level recalculation from XP
  - Live rank calculation with tie-breaking (who reached level first)
- **XP Sources:**
  - Messages: +10 XP per eligible message (15 seconds cooldown)
  - Voice chat: +30 XP per minute (minimum 1 minute per tick)
  - Voice when AFK: +5 XP per minute (still counts time)
- **Level System:**
  - Exponential XP curve: Level 2 = 100 XP, Level 3 = 200 XP, Level 4 = 400 XP, etc.
  - Level up DM notifications sent automatically
- **Permission:** Member+

#### ⭐ Staff Report & Rating Button
- Rate staff members after an interaction with structured prompts
- Flow:
  - Pick a staff member (list populated from configured staff roles)
  - Select a category (Excellent, Helpful, Slow Response, Unhelpful, Rude, Abuse of Power) and a rating (⭐1-5)
  - Provide mandatory written feedback and optionally type “yes” to submit anonymously
- Safeguards & moderation:
  - Prevents self-reporting and enforces a configurable cooldown between reports for the same staff/member pair
  - Pending reports are posted to an audit channel with Approve/Reject buttons that require setup-level permissions
- Outcomes:
  - Approved reports update the staff member’s average score, refresh their dynamic rating role/name/color, send a rich embed to the rating channel, and DM both reporter and staff
  - Rejected reports notify the reporter privately and remove buttons from the audit entry
- **Permission:** Member+ to submit, Staff/Admin (setup) to approve

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

#### 💬 Feedback Button
- Submit feedback, suggestions, or concerns to server staff
- Features:
  - Simple modal with text input (up to 2000 characters)
  - All submissions posted to configured feedback channel with user information
  - Staff role automatically mentioned in feedback channel
- **Permission:** Member+

#### 🎉 Giveaway Button
- Create and manage server giveaways
- **Create Features:**
  - Custom title and prize description
  - Duration in minutes (configurable)
  - Winner count (1 or more winners)
  - Optional role restrictions (limit to specific roles)
  - Multiple entries toggle (allow users to enter multiple times)
  - Automatic end time calculation based on configured timezone
- **Management Features:**
  - View active giveaway details
  - Finish giveaway early (selects winners immediately)
  - Cancel giveaway (no winners selected)
  - Force-end giveaway (if automatic end fails)
- **Entry Features:**
  - Click "Enter Giveaway" button on giveaway message
  - Automatic role verification (if restrictions set)
  - Entry count tracking (for multiple entries)
  - Real-time participant count display
- **Winner Selection:**
  - Weighted random selection (multiple entries = higher chance)
  - Automatic announcement when giveaway ends
  - Winner marking in database
  - Configurable creator participation (can creator enter their own giveaway?)
- **Permission:** Staff+ (configurable via permissions)
- **Note:** Giveaway channel must be configured in control panel

#### ⚙️ Settings Button
- Lets members manage personal preferences without leaving Discord
- Features:
  - Toggle level-up DM notifications (updates `server_member_levels.dm_notifications_enabled`)
  - Change language between English and Bahasa Indonesia (stored in `server_members.language`)
  - See immediate confirmation via localized embeds/buttons
- **Permission:** Member+

## Communication Method

### Webhook Communication
- Self-bot sends message data via HTTP POST to local webhook server
- Official bot runs a webhook server on configured port (default: 7777)
- **Secret key authentication**: All requests require `X-Secret-Key` header
- **POST endpoint**: Accepts `message_forward` payloads with message data
- **Local communication**: Both bots run on same server, communicate via localhost
- Real-time communication for instant message forwarding
- Each official bot can have its own port (multiple bots supported)

## Configuration

### Database-Driven Configuration
**All configuration is stored in MySQL/MariaDB database** - no file editing required!

Configuration is managed through:
1. **Web Control Panel**: Primary method for all settings
2. **Database**: Settings stored in `server_settings` table with JSON

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
- Staff roles (interface access: Custom Supporter Role, Leveling, AFK, Feedback, Giveaway, Staff Report, Settings)
- Supporter roles (Custom Supporter Role, Settings)
- Member roles (Leveling, AFK, Feedback, Staff Report, Settings)

#### Main Configuration
- Production channel (for moderation logs)
- Test channel (for testing mode)
- Embed color (hex format)
- Embed footer (with placeholders: `{server}`, `{year}`, `{date}`, `{time}`)
- Note: Bot logs are now stored in database (`bot_logs` table) and viewable in control panel terminal

#### Feedback Configuration
- Feedback channel ID (where submissions are posted)
- Staff roles automatically mentioned in feedback channel

#### Custom Supporter Role Configuration
- Role Start (top/highest position - typically Supporter role)
- Role End (bottom/lowest position - typically Staff role)
- Custom roles are created between these constraints

#### Staff Report & Rating Configuration
- Report channel ID (where pending reports + moderation buttons are posted)
- Rating channel ID (optional) for announcing approved reports and updated averages
- Role Start / Role End (re-uses supporter constraint logic to clamp dynamic rating roles into the correct bracket)
- Cooldown days (minimum wait time before the same member can rate the same staff again)
- Category labels are localized via `backend/locales/*.json`, so you can rename categories or add translations without redeploying

#### Giveaway Configuration
- Giveaway channel ID (where giveaways are posted)
- Creator can participate toggle (allow/disallow giveaway creator from entering)
- Timezone-aware scheduling (uses TIMEZONE environment variable)

#### Leveling Configuration
- Message XP: +10 XP per eligible message (default)
- Message cooldown: 15 seconds (default)
- Voice XP per minute: +30 XP per minute (default)
- Voice XP when AFK: +5 XP per minute (default, still counts time)
- Minimum voice session minutes: 1 minute per tick (default)
- Exponential level curve: Level 2 = 100 XP, Level 3 = 200 XP, Level 4 = 400 XP, etc.
- Leaderboard: Top 5 with medal emotes for positions 1-3
- Tie-breaking: Users with same level/XP ranked by who reached it first

#### Localization & Preference Configuration
- Translate any string by editing `backend/locales/en.json`, `backend/locales/id.json`, or by adding new locale files (they auto-register in the Settings dropdown)
- Per-member language selections are stored automatically in `server_members.language`
- Level-up DM notification preferences live in `server_member_levels.dm_notifications_enabled` and are toggled via the Settings button

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
- **Leveling Component**: Tracks member XP, levels, and ranks from messages and voice activity
  - Message XP tracking with cooldown
  - Live voice minute tracking with per-minute intervals
  - Automatic level calculation from XP
  - Level up DM notifications
  - Voice session resume after bot restarts
  - AFK status checking (AFK users earn reduced XP: 5 XP/min vs 30 XP/min)
- **Staff Rating Component**: Automates staff reputation once a report is approved
  - Calculates rolling averages and total report counts per staff member
  - Creates/updates dedicated rating roles with clamped positions and color gradients
  - Posts celebratory embeds to the rating channel and DMs staff with their latest score
  - Supports role cleanup when a staff member loses all approved reports
- **Giveaway Component**: Manages server giveaways with full lifecycle support
  - Create giveaways with role restrictions and multiple entry support
  - Automatic winner selection with weighted random distribution
  - Real-time entry tracking and countdown display
  - Automatic end detection and winner announcement
  - Manual finish, cancel, and force-end operations
  - Timezone-aware scheduling and end time calculation
- **Sync Component**: Event-driven sync system - syncs on bot startup and when configs are accessed/updated (30-minute cooldown)
  - Syncs text, voice, stage, and announcement channels
  - Tracks role positions for accurate member ranking
  - Excludes unsupported channel types (forums, media channels)

### Self-Bot Components
- **Forwarder Component**: Handles message monitoring and filtering
- **Sync Component**: Syncs server data to database

### Utility Components
- **Logger Component**: Centralized database-based logging system
  - All logs stored in `bot_logs` table per bot
  - Database-first approach with console fallback on failure
  - Automatic 7-day retention policy with periodic cleanup
  - Real-time log viewing in control panel terminal

## Database Schema

The system uses MySQL/MariaDB with the following main tables:

- **panel**: Panel administrator credentials
- **panel_logs**: Login attempt logs
- **bots**: Bot configurations (tokens, ports, status, etc.)
- **bot_logs**: Bot activity logs with 7-day retention policy
- **servers**: Discord server information per bot
- **server_categories**: Discord category information (type 4 channels)
- **server_channels**: Discord channel information (text, voice, stage, announcement)
- **server_roles**: Discord role information with position tracking
- **server_members**: Discord member information per server (includes boosters, language preference, join timestamps)
- **server_member_levels**: Leveling stats (XP, level, rank, chat count, voice minutes, DM notification flag)
- **server_member_roles**: Member role assignments (flags for custom supporter roles and rating roles)
- **server_members_afk**: AFK status and messages
- **server_giveaways**: Giveaway information (title, prize, duration, status, etc.)
- **server_giveaway_entries**: Giveaway entry tracking (member entries, entry counts, winner status)
- **server_staff_ratings**: Aggregated rating + total report count per staff member and their associated rating role
- **server_staff_reports**: Individual staff reports with rating, category, description, anonymity flag, and approval status
- **server_feedback**: Stored feedback submissions (anonymous or attributed)
- **server_settings**: Component-specific settings per server (JSON)

## Troubleshooting

### Database Issues
1. **Tables not found**: 
   - Ensure database connection is configured in `.env`
   - Database will auto-create tables on first startup
   - Or manually run `database/schema.sql` in your MySQL client

2. **Connection errors**: 
   - Verify database credentials in `.env`
   - Check database server is running
   - For remote databases, ensure SSH tunnel is active (if using)
   - Verify network connectivity to database server

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
   - Verify webhook server is listening on the configured port

5. **Sync issues**: 
   - Sync runs on first bot startup only (when no servers exist in database)
   - After first startup, sync only runs on Discord events (guild joins, channel changes, role changes, etc.)
   - No periodic syncs - database is only accessed when Discord events occur

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

3. **Leveling not working**: 
   - Verify member roles are configured in permissions
   - Check user has member role
   - Ensure leveling component is initialized

4. **Giveaway not working**: 
   - Verify giveaway channel is configured in control panel
   - Check user has required permission role (Staff+ by default)
   - Ensure giveaway component is initialized
   - Verify timezone is configured correctly (TIMEZONE environment variable)
   - Check giveaway message exists and hasn't been deleted

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

7.7.0

---

**Note**: This is a comprehensive bot management system. For detailed component documentation, refer to individual component files in the codebase.
