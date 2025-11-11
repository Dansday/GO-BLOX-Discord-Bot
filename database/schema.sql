CREATE TABLE IF NOT EXISTS panel (
    id INT PRIMARY KEY AUTO_INCREMENT,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS panel_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    panel_id INT NULL,
    ip_address TEXT NOT NULL,
    user_agent TEXT,
    success BOOLEAN DEFAULT FALSE,
    attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (panel_id) REFERENCES panel(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS bots (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name TEXT NOT NULL,
    token TEXT NOT NULL,
    application_id TEXT,
    bot_type ENUM('official', 'selfbot') NOT NULL,
    bot_icon TEXT,
    port INT,
    secret_key TEXT,
    connect_to INT NULL,
    panel_id INT NULL,
    is_testing BOOLEAN DEFAULT FALSE,
    status ENUM('running', 'stopped', 'starting', 'stopping') DEFAULT 'stopped',
    process_id INT,
    uptime_started_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (connect_to) REFERENCES bots(id) ON DELETE SET NULL,
    FOREIGN KEY (panel_id) REFERENCES panel(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS servers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    bot_id INT NOT NULL,
    discord_server_id VARCHAR(150) NOT NULL,
    name TEXT,
    total_members INT DEFAULT 0,
    total_channels INT DEFAULT 0,
    total_boosters INT DEFAULT 0,
    boost_level INT DEFAULT 0,
    server_icon TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_bot_server (bot_id, discord_server_id),
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    server_id INT NOT NULL,
    discord_category_id VARCHAR(150) NOT NULL,
    name TEXT,
    position INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_server_category (server_id, discord_category_id),
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_channels (
    id INT PRIMARY KEY AUTO_INCREMENT,
    server_id INT NOT NULL,
    discord_channel_id VARCHAR(150) NOT NULL,
    name TEXT,
    type TEXT,
    category_id INT NULL,
    position INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_server_channel (server_id, discord_channel_id),
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES server_categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS server_roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    server_id INT NOT NULL,
    discord_role_id VARCHAR(150) NOT NULL,
    name TEXT,
    position INT,
    color TEXT,
    permissions TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_server_role (server_id, discord_role_id),
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_members (
    id INT PRIMARY KEY AUTO_INCREMENT,
    server_id INT NOT NULL,
    discord_member_id VARCHAR(150) NOT NULL,
    username TEXT,
    display_name TEXT,
    server_display_name TEXT,
    avatar TEXT,
    profile_created_at TIMESTAMP NULL,
    member_since TIMESTAMP NULL,
    is_booster BOOLEAN DEFAULT FALSE,
    booster_since TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_server_member (server_id, discord_member_id),
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_member_levels (
    id INT PRIMARY KEY AUTO_INCREMENT,
    member_id INT NOT NULL,
    chat_total INT DEFAULT 0,
    voice_minutes_total INT DEFAULT 0,
    voice_minutes_active INT DEFAULT 0,
    voice_minutes_afk INT DEFAULT 0,
    experience INT DEFAULT 0,
    level INT DEFAULT 1,
    rank INT DEFAULT NULL,
    chat_rewarded_at TIMESTAMP NULL,
    voice_rewarded_at TIMESTAMP NULL,
    voice_afk_rewarded_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_member_level (member_id),
    FOREIGN KEY (member_id) REFERENCES server_members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_member_roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    member_id INT NOT NULL,
    role_id INT NOT NULL,
    is_custom BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_member_role (member_id, role_id),
    FOREIGN KEY (member_id) REFERENCES server_members(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES server_roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_members_afk (
    id INT PRIMARY KEY AUTO_INCREMENT,
    member_id INT NOT NULL,
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_member_afk (member_id),
    FOREIGN KEY (member_id) REFERENCES server_members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    server_id INT NOT NULL,
    component_name VARCHAR(150) NOT NULL,
    settings JSON NOT NULL DEFAULT ('{}'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_server_component (server_id, component_name),
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE INDEX idx_bots_type ON bots(bot_type);
CREATE INDEX idx_bots_connect_to ON bots(connect_to);
CREATE INDEX idx_bots_panel_id ON bots(panel_id);
CREATE INDEX idx_servers_bot_id ON servers(bot_id);
CREATE INDEX idx_servers_discord_id ON servers(discord_server_id);
CREATE INDEX idx_server_categories_server_id ON server_categories(server_id);
CREATE INDEX idx_server_categories_discord_id ON server_categories(discord_category_id);
CREATE INDEX idx_server_channels_server_id ON server_channels(server_id);
CREATE INDEX idx_server_channels_discord_id ON server_channels(discord_channel_id);
CREATE INDEX idx_server_channels_category_id ON server_channels(category_id);
CREATE INDEX idx_server_roles_server_id ON server_roles(server_id);
CREATE INDEX idx_server_roles_discord_id ON server_roles(discord_role_id);
CREATE INDEX idx_server_members_server_id ON server_members(server_id);
CREATE INDEX idx_server_members_discord_id ON server_members(discord_member_id);
CREATE INDEX idx_server_member_levels_member_id ON server_member_levels(member_id);
CREATE INDEX idx_server_member_levels_rank ON server_member_levels(rank);
CREATE INDEX idx_server_member_roles_member_id ON server_member_roles(member_id);
CREATE INDEX idx_server_member_roles_role_id ON server_member_roles(role_id);
CREATE INDEX idx_server_members_afk_member_id ON server_members_afk(member_id);
CREATE INDEX idx_server_settings_server_id ON server_settings(server_id);
CREATE INDEX idx_server_settings_component ON server_settings(server_id, component_name);
CREATE INDEX idx_panel_logs_panel_id ON panel_logs(panel_id);
CREATE INDEX idx_panel_logs_attempted_at ON panel_logs(attempted_at);
