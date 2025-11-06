-- GO BLOX Bot System Database Schema

-- Panel table (stores panel administrator credentials)
CREATE TABLE IF NOT EXISTS panel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Panel logs table (stores login attempt logs)
CREATE TABLE IF NOT EXISTS panel_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    panel_id UUID REFERENCES panel(id) ON DELETE SET NULL,
    ip_address TEXT NOT NULL,
    user_agent TEXT,
    success BOOLEAN DEFAULT FALSE,
    attempted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bots table (stores bot configurations)
CREATE TABLE IF NOT EXISTS bots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    token TEXT NOT NULL,
    application_id TEXT,
    bot_type TEXT NOT NULL CHECK (bot_type IN ('official', 'selfbot')),
    bot_icon TEXT,
    port INTEGER,
    secret_key TEXT,
    connect_to UUID REFERENCES bots(id) ON DELETE SET NULL,
    panel_id UUID REFERENCES panel(id) ON DELETE SET NULL,
    is_testing BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'stopped' CHECK (status IN ('running', 'stopped', 'starting', 'stopping')),
    process_id INTEGER,
    uptime_started_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Servers table (stores Discord server information per bot)
CREATE TABLE IF NOT EXISTS servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    discord_server_id TEXT NOT NULL,
    name TEXT,
    total_members INTEGER DEFAULT 0,
    total_channels INTEGER DEFAULT 0,
    total_boosters INTEGER DEFAULT 0,
    boost_level INTEGER DEFAULT 0,
    server_icon TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(bot_id, discord_server_id)
);

-- Categories table (stores Discord category information, channel type 4)
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    discord_category_id TEXT NOT NULL,
    name TEXT,
    position INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(server_id, discord_category_id)
);

-- Channels table (stores Discord channel information)
CREATE TABLE IF NOT EXISTS channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    discord_channel_id TEXT NOT NULL,
    name TEXT,
    type TEXT,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    position INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(server_id, discord_channel_id)
);

-- Roles table (stores Discord role information)
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    discord_role_id TEXT NOT NULL,
    name TEXT,
    position INTEGER,
    color TEXT,
    permissions TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(server_id, discord_role_id)
);

-- Server settings table (stores per-server component configurations)
CREATE TABLE IF NOT EXISTS server_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    component_name TEXT NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}',
    last_accessed TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(server_id, component_name)
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_bots_type ON bots(bot_type);
CREATE INDEX IF NOT EXISTS idx_bots_connect_to ON bots(connect_to);
CREATE INDEX IF NOT EXISTS idx_bots_panel_id ON bots(panel_id);
CREATE INDEX IF NOT EXISTS idx_servers_bot_id ON servers(bot_id);
CREATE INDEX IF NOT EXISTS idx_servers_discord_id ON servers(discord_server_id);
CREATE INDEX IF NOT EXISTS idx_categories_server_id ON categories(server_id);
CREATE INDEX IF NOT EXISTS idx_categories_discord_id ON categories(discord_category_id);
CREATE INDEX IF NOT EXISTS idx_channels_server_id ON channels(server_id);
CREATE INDEX IF NOT EXISTS idx_channels_discord_id ON channels(discord_channel_id);
CREATE INDEX IF NOT EXISTS idx_channels_category_id ON channels(category_id);
CREATE INDEX IF NOT EXISTS idx_roles_server_id ON roles(server_id);
CREATE INDEX IF NOT EXISTS idx_roles_discord_id ON roles(discord_role_id);
CREATE INDEX IF NOT EXISTS idx_server_settings_server_id ON server_settings(server_id);
CREATE INDEX IF NOT EXISTS idx_server_settings_component ON server_settings(server_id, component_name);
CREATE INDEX IF NOT EXISTS idx_panel_logs_panel_id ON panel_logs(panel_id);
CREATE INDEX IF NOT EXISTS idx_panel_logs_attempted_at ON panel_logs(attempted_at);
