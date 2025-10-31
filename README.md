# GO BLOX Bot System

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
- **Purpose**: Forwards messages to target channels, welcomes new users, provides interactive interface, and manages server features
- **Technology**: `discord.js` (official bot)
- **Functionality**:
  - Receives message data from self-bot
  - Forwards messages to target channels with role mentions
  - Welcomes new users with random messages
  - Provides interactive button-based interface
  - Tracks moderation actions (bans, unbans, kicks)
  - Finds inactive members
  - Manages custom supporter roles
  - Role-based permission system

## Project Structure

```
go-blox-bot/
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
        ├── interface.js  # Interface component
        ├── moderation.js # Moderation tracking component
        ├── permissions.js # Permission checking system
        ├── commands/     # Command definitions
        │   └── admin/
        │       └── setup.js  # Setup command
        └── interface/    # Interface button handlers
            ├── status.js # Status button handler
            ├── help.js   # Help button handler
            ├── pause.js  # Pause button handler
            ├── sendmessage.js # Send message button handler
            ├── inactive.js # Inactive members button handler
            └── customsupporterrole.js # Custom supporter role handler
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

The official bot provides a single slash command for bot management:

### Admin Commands (Require Administrator permissions)
- `/interface` - Send bot interface with buttons to target channel

### Interface Features

#### 📊 Status Button
- Shows bot status, uptime, and component information
- **Permission:** Member+

#### ❓ Help Button
- Displays comprehensive help information for all interface features
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
  - Custom description (required)
  - Optional image URL
  - Optional color customization (hex/decimal/name)
  - Optional footer text
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
  - Role automatically positioned between Supporter and Staff roles
- **Edit Features:**
  - Modify existing role name, color, or icon
  - Pre-filled with current values
  - Clear icon field to remove icon
- **Delete Features:**
  - Permanently delete your custom role
  - Role and all permissions removed
- **Auto-Cleanup:**
  - Unused roles (no members) are automatically removed
  - Cleanup runs on bot startup and every 6 hours
  - Roles removed when members lose permission or leave server
- **Permission:** Supporter, Staff, or Admin

### Command Features
- **Ephemeral responses** - All command responses are private to the user
- **Permission checking** - Admin commands verify Administrator permissions
- **Error handling** - Detailed error messages for command failures
- **Interface-based interaction** - Users interact through visual buttons instead of slash commands

## Button Interface

The `/interface` command creates a visual interface with buttons that users can click instead of using slash commands:

### Interface Features

See the full interface features list in the "Slash Commands" section above.

### How to Use
1. Admin uses `/interface #channel` to send the interface to any text channel
2. Users can click buttons for instant bot interaction
3. All button responses are ephemeral (private to the user)
4. Pause/Resume button requires Administrator permissions

### Feature Details

#### Send Message Feature
The Send Message button provides a step-by-step process:
1. **Select Channel** - Choose which channel to send the message to using channel selector
2. **Choose Role** - Optionally select one or more roles to mention (can skip)
3. **Fill Embed Details** - Enter title (required), description (required), image URL, color, and footer
4. **Send** - Message is sent with role mentions and embed formatting

#### Inactive Members Feature
- Searches through configured category channels for member activity
- Calculates last message timestamp for each member
- Lists members who haven't sent messages within the inactivity period
- Results displayed as an embed with member information and last activity time

#### Custom Supporter Role Feature
**First Time Use:**
1. Click "💎 Custom Supporter Role" button
2. Modal opens for role creation
3. Fill in role name (required), color (optional), and icon (optional)
4. Role is created and assigned to you

**Subsequent Uses (If You Have a Role):**
1. Click "💎 Custom Supporter Role" button
2. Options appear: "✏️ Edit Role" or "🗑️ Delete Role"
3. Choose to edit (modify existing role) or delete (permanently remove role)

**Icon Options:**
- **Emoji:** Enter a Unicode emoji (e.g., 🔥, ⚡, 💎)
- **Image URL:** Must be a valid JPG or PNG image URL (e.g., `https://example.com/icon.png`)
- **Remove Icon:** Clear the icon field when editing to remove the icon

**Auto-Cleanup System:**
- Automatically removes custom roles that have no members assigned
- Runs cleanup on bot startup (after 10 seconds) and every 6 hours
- Removes roles when members lose required permissions
- Removes roles when members leave the server

### Benefits
- **User-friendly** - No need to remember slash command syntax
- **Visual** - Clear buttons with icons and labels
- **Accessible** - Works for users who prefer clicking over typing
- **Simplified** - Only one slash command needed (admin only)
- **Clean** - No command clutter in Discord's slash command menu

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

### Core Configuration
- **Source Channels**: Configure which channels to monitor
- **Target Channels**: Configure where to forward messages
- **Role Mentions**: Configure role mentions for each group
- **Welcome Messages**: Configure welcome message templates
- **Excluded Users**: Configure users to exclude from forwarding
- **Main Channel**: Configure main channel for moderation logs (production/test)

### Permissions Configuration
Role-based permission system with the following roles:
- **ADMIN_ROLE**: Full access to all commands and interfaces
- **STAFF_ROLE**: All interfaces except pause
- **SUPPORTER_ROLE**: Can use custom supporter role feature
- **MEMBER_ROLE**: Can only use status and help

### Activity Tracker Configuration
- **ALLOWED_CATEGORIES**: Categories to search for member activity
- **INACTIVITY_DAYS**: Number of days of inactivity (default: 90)

### Custom Supporter Role Configuration
- **ROLE_ABOVE**: Custom roles must be above this role (typically Supporter role)
- **ROLE_BELOW**: Custom roles must be below this role (typically Staff role)

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
- **Welcomer Component**: Handles new user welcoming with beautiful embeds
- **Webhook Component**: Handles webhook server for self-bot communication
- **Commands Component**: Handles slash command system and execution
- **Interface Component**: Handles button interface creation and interactions
- **Moderation Component**: Tracks bans, unbans, and kicks in real-time, logs to main channel
- **Logger Component**: Centralized logging system
- **Permissions Component**: Role-based permission checking system

### Moderation Component

The moderation component automatically tracks moderation actions:
- **Bans**: Logs when members are banned, including moderator and reason
- **Unbans**: Logs when members are unbanned, including moderator and reason
- **Kicks**: Logs when members are kicked, including moderator and reason
- **Audit Log Integration**: Uses Discord audit logs to identify moderators
- **Main Channel Logging**: All moderation actions are logged to the configured main channel
- **Simplified Format**: Shows only user tags and moderator tags (no IDs)

### Interface Components

Located in `official-bot/components/interface/`:
- **status.js**: Status button handler - displays bot information
- **help.js**: Help button handler - displays comprehensive help
- **pause.js**: Pause/Resume button handler - bot control
- **sendmessage.js**: Send message button handler - embed message creation
- **inactive.js**: Inactive members button handler - activity tracking
- **customsupporterrole.js**: Custom role button handler - role management

## Troubleshooting

1. **Self-bot not receiving messages**: Check source channel IDs and permissions
2. **Official bot not forwarding**: Check target channel IDs and bot permissions
3. **Communication issues**: Verify webhook URL or shared storage path
4. **Token issues**: Ensure tokens are valid and have proper permissions
5. **Interface not appearing**: Use `/interface #channel` to create the interface
6. **Permission errors**: Interface creation requires Administrator permissions
7. **Bot appears paused**: Use the Pause/Resume button in the interface to resume the bot
