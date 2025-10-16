# Goblox Bot System

A Discord bot system that separates self-bot monitoring from official bot forwarding for better security and maintainability.

## Architecture

### Self-Bot (`self-bot/`)
- **Purpose**: Monitors source Discord servers for new messages
- **Technology**: `discord.js-selfbot-v13`
- **Functionality**: 
  - Listens to configured source channels
  - Processes messages and sends data to official bot
  - Handles historical message fetching

### Official Bot (`official-bot/`)
- **Purpose**: Forwards messages to target channels, welcomes new users, and provides slash commands
- **Technology**: `discord.js` (official bot)
- **Functionality**:
  - Receives message data from self-bot
  - Forwards messages to target channels with role mentions
  - Welcomes new users with random messages
  - Provides slash commands for bot management

## Project Structure

```
goblox-bot/
├── main.js                 # Launcher script
├── package.json           # Single package.json with all dependencies
├── config.js              # Configuration
├── logger.js              # Shared logger utility
├── utils.js               # Shared utilities
├── self-bot/
│   ├── main.js           # Self-bot entry point
│   └── components/
│       └── forwarder.js  # Message monitoring component
└── official-bot/
    ├── main.js           # Official bot entry point
    └── components/
        ├── forwarder.js  # Message forwarding component
        ├── welcomer.js   # User welcoming component
        ├── webhook.js    # Webhook server component
        ├── commands.js   # Slash command system
        └── commands/     # Command definitions
            ├── admin/
            │   └── pause.js    # Pause command
            └── user/
                ├── help.js     # Help command
                └── status.js   # Status command
```

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```
   
   > **Note**: This project uses a single `package.json` file for direct admin hosting compatibility.

2. **Configure environment**:
   - Edit `config.js`
   - Set `ENV.PRODUCTION` to `true` for production or `false` for testing

3. **Configure tokens**:
   - Set `SELF_BOT_TOKEN` (your self-bot token)
   - Set `OFFICIAL_BOT_TOKEN` (your official bot token)

4. **Configure communication**:
   - Set `COMMUNICATION.WEBHOOK_URL` to local webhook server (default: `http://localhost:7777`)
   - Set `COMMUNICATION.SECRET_KEY` for webhook authentication
   - Set `COMMUNICATION.PORT` for webhook server (default: 7777)

5. **Configure embed appearance**:
   - Set `EMBED.COLOR` for forwarded message embed color (default: red `0xff0000`)

## Usage

### Start both bots:
```bash
npm start
```

### Start individual bots:
```bash
npm run start:selfbot    # Self-bot only
npm run start:official   # Official bot only
```

### Development mode (with auto-restart):
```bash
npm run dev
```

## Slash Commands

The official bot provides several slash commands for bot management:

### User Commands (Available to all users)
- `/help` - Show available slash commands
- `/status` - Show bot status and uptime

### Admin Commands (Require Administrator permissions)
- `/pause` - Pause/Resume the bot (when paused, only `/pause` works)

### Command Features
- **Ephemeral responses** - All command responses are private to the user
- **Permission checking** - Admin commands verify Administrator permissions
- **Error handling** - Detailed error messages for command failures
- **Pause system** - Bot can be paused to disable all commands except `/pause`

## Communication Method

### Webhook Communication
- Self-bot sends message data via HTTP POST to local webhook server (`http://localhost:7777`)
- Official bot runs a webhook server on port 7777 to receive the data
- **Secret key authentication** - only authorized self-bot can access webhook
- **Local communication** - both bots run on same server, communicate via localhost
- Real-time communication for instant message forwarding
- Configured in `config.js` with `COMMUNICATION` settings

## Environment Configuration

### Production vs Testing
- **Production Mode** (`ENV.PRODUCTION: true`): Uses all source channels for full functionality
- **Testing Mode** (`ENV.PRODUCTION: false`): Uses only test channels for safe testing
- Easy switching between environments by changing one flag

### Security
- **Secret Key Authentication**: Webhook requires `X-Secret-Key` header
- **Unauthorized Access Logging**: Failed authentication attempts are logged
- **Secure Communication**: Only self-bot with correct secret key can send data

## Configuration

All configuration is centralized in `config.js`:

- **Source Channels**: Configure which channels to monitor
- **Target Channels**: Configure where to forward messages
- **Role Mentions**: Configure role mentions for each group
- **Welcome Messages**: Configure welcome message templates
- **Excluded Users**: Configure users to exclude from forwarding

## Data Management

### Real-time Operations
- **No Historical Fetching**: Messages are only forwarded when the bot is online
- **No Duplicate Tracking**: Each message is processed once when received
- **No Welcome Tracking**: New members are welcomed immediately when they join
- **Simplified Operation**: No complex state management or JSON tracking
- **Beautiful Embeds**: Welcome messages are sent as rich embeds with user info

## Security Benefits

1. **Separation of Concerns**: Self-bot only monitors, official bot only forwards
2. **Token Isolation**: Self-bot and official bot use different tokens
3. **Reduced Risk**: Official bot doesn't need access to source servers
4. **Better Logging**: Clear separation of monitoring vs forwarding logs

## Components

Each feature is organized as a component for easy maintenance:

- **Forwarder Component**: Handles message processing and forwarding
- **Welcomer Component**: Handles new user welcoming
- **Webhook Component**: Handles webhook server for self-bot communication
- **Commands Component**: Handles slash command system and execution
- **Logger Component**: Centralized logging system

## Troubleshooting

1. **Self-bot not receiving messages**: Check source channel IDs and permissions
2. **Official bot not forwarding**: Check target channel IDs and bot permissions
3. **Communication issues**: Verify webhook URL or shared storage path
4. **Token issues**: Ensure tokens are valid and have proper permissions
5. **Slash commands not appearing**: Commands are automatically deployed on bot startup
6. **Permission errors**: Admin commands require Administrator permissions
7. **Bot appears paused**: Use `/pause` command to resume the bot
