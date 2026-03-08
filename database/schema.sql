CREATE TABLE IF NOT EXISTS panel (
    id INT PRIMARY KEY AUTO_INCREMENT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_accounts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    account_type ENUM('admin', 'moderator') NOT NULL DEFAULT 'admin',
    email_verified BOOLEAN DEFAULT FALSE,
    otp_code VARCHAR(6) NULL,
    otp_expires_at DATETIME NULL,
    panel_id INT NULL,
    ip_address TEXT NULL,
    is_frozen BOOLEAN DEFAULT FALSE,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (panel_id) REFERENCES panel(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS panel_invite_links (
    id INT PRIMARY KEY AUTO_INCREMENT,
    token VARCHAR(255) NOT NULL UNIQUE,
    account_type ENUM('admin', 'moderator') NOT NULL,
    created_by INT NOT NULL,
    used_by INT NULL,
    expires_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    FOREIGN KEY (created_by) REFERENCES panel_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (used_by) REFERENCES panel_accounts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS panel_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    panel_account_id INT NULL,
    message TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    FOREIGN KEY (panel_account_id) REFERENCES panel_accounts(id) ON DELETE SET NULL
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
    uptime_started_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
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
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY unique_bot_server (bot_id, discord_server_id),
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    server_id INT NOT NULL,
    discord_category_id VARCHAR(150) NOT NULL,
    name TEXT,
    position INT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY unique_server_category (server_id, discord_category_id),
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    server_id INT NOT NULL,
    discord_role_id VARCHAR(150) NOT NULL,
    name TEXT,
    position INT,
    color TEXT,
    permissions TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY unique_server_role (server_id, discord_role_id),
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
    notification_role_id INT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY unique_server_channel (server_id, discord_channel_id),
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES server_categories(id) ON DELETE SET NULL,
    FOREIGN KEY (notification_role_id) REFERENCES server_roles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS server_members (
    id INT PRIMARY KEY AUTO_INCREMENT,
    server_id INT NOT NULL,
    discord_member_id VARCHAR(150) NOT NULL,
    username TEXT,
    display_name TEXT,
    server_display_name TEXT,
    avatar TEXT,
    profile_created_at DATETIME NULL,
    member_since DATETIME NULL,
    is_booster BOOLEAN DEFAULT FALSE,
    booster_since DATETIME NULL,
    language VARCHAR(10) DEFAULT 'en',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
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
    dm_notifications_enabled BOOLEAN DEFAULT TRUE,
    is_in_voice BOOLEAN DEFAULT FALSE,
    `rank` INT DEFAULT NULL,
    chat_rewarded_at DATETIME NULL,
    voice_rewarded_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY unique_member_level (member_id),
    FOREIGN KEY (member_id) REFERENCES server_members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_member_roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    member_id INT NOT NULL,
    role_id INT NOT NULL,
    is_custom BOOLEAN DEFAULT FALSE,
    is_rating BOOLEAN DEFAULT FALSE,
    is_notification BOOLEAN DEFAULT FALSE,
    created_at DATETIME NOT NULL,
    UNIQUE KEY unique_member_role (member_id, role_id),
    FOREIGN KEY (member_id) REFERENCES server_members(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES server_roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_members_afk (
    id INT PRIMARY KEY AUTO_INCREMENT,
    member_id INT NOT NULL,
    message TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY unique_member_afk (member_id),
    FOREIGN KEY (member_id) REFERENCES server_members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    server_id INT NOT NULL,
    component_name VARCHAR(150) NOT NULL,
    settings JSON NOT NULL DEFAULT ('{}'),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY unique_server_component (server_id, component_name),
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bot_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    bot_id INT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_giveaways (
    id INT PRIMARY KEY AUTO_INCREMENT,
    discord_message_id VARCHAR(150) NULL,
    member_id INT NOT NULL,
    title TEXT NOT NULL,
    prize TEXT NOT NULL,
    duration_minutes INT NOT NULL,
    allowed_roles JSON NULL,
    multiple_entries_allowed BOOLEAN DEFAULT FALSE,
    winner_count INT NOT NULL DEFAULT 1,
    status ENUM('active', 'ended', 'ended_force') DEFAULT 'active',
    ends_at DATETIME NOT NULL,
    winners_announced BOOLEAN DEFAULT FALSE,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (member_id) REFERENCES server_members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_giveaway_entries (
    id INT PRIMARY KEY AUTO_INCREMENT,
    giveaway_id INT NOT NULL,
    member_id INT NOT NULL,
    entry_count INT DEFAULT 1,
    is_winner BOOLEAN DEFAULT FALSE,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY unique_giveaway_member (giveaway_id, member_id),
    FOREIGN KEY (giveaway_id) REFERENCES server_giveaways(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES server_members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_staff_ratings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    staff_member_id INT NOT NULL,
    current_rating DECIMAL(3,2) DEFAULT 0,
    total_reports INT DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY unique_staff_rating (staff_member_id),
    FOREIGN KEY (staff_member_id) REFERENCES server_members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_staff_reports (
    id INT PRIMARY KEY AUTO_INCREMENT,
    reporter_member_id INT NOT NULL,
    reported_staff_id INT NOT NULL,
    rating TINYINT NOT NULL CHECK(rating >= 1 AND rating <= 5),
    category VARCHAR(50) NOT NULL,
    description TEXT,
    is_anonymous BOOLEAN DEFAULT 0,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    reported_at DATETIME NOT NULL,
    FOREIGN KEY (reporter_member_id) REFERENCES server_members(id) ON DELETE CASCADE,
    FOREIGN KEY (reported_staff_id) REFERENCES server_members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_feedback (
    id INT PRIMARY KEY AUTO_INCREMENT,
    member_id INT NOT NULL,
    description TEXT NOT NULL,
    is_anonymous BOOLEAN DEFAULT 0,
    submitted_at DATETIME NOT NULL,
    FOREIGN KEY (member_id) REFERENCES server_members(id) ON DELETE CASCADE
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
CREATE INDEX idx_server_members_language ON server_members(language);
CREATE INDEX idx_server_member_levels_member_id ON server_member_levels(member_id);
CREATE INDEX idx_server_member_levels_rank ON server_member_levels(`rank`);
CREATE INDEX idx_server_member_roles_member_id ON server_member_roles(member_id);
CREATE INDEX idx_server_member_roles_role_id ON server_member_roles(role_id);
CREATE INDEX idx_server_members_afk_member_id ON server_members_afk(member_id);
CREATE INDEX idx_server_settings_server_id ON server_settings(server_id);
CREATE INDEX idx_server_settings_component ON server_settings(server_id, component_name);
CREATE INDEX idx_bot_logs_bot_id ON bot_logs(bot_id);
CREATE INDEX idx_bot_logs_created_at ON bot_logs(created_at);
CREATE INDEX idx_panel_accounts_email ON panel_accounts(email);
CREATE INDEX idx_panel_accounts_username ON panel_accounts(username);
CREATE INDEX idx_panel_accounts_panel_id ON panel_accounts(panel_id);
CREATE INDEX idx_panel_invite_links_token ON panel_invite_links(token);
CREATE INDEX idx_panel_invite_links_created_by ON panel_invite_links(created_by);
CREATE INDEX idx_panel_invite_links_used_by ON panel_invite_links(used_by);
CREATE INDEX idx_panel_logs_panel_account_id ON panel_logs(panel_account_id);
CREATE INDEX idx_panel_logs_created_at ON panel_logs(created_at);
CREATE INDEX idx_server_giveaways_member_id ON server_giveaways(member_id);
CREATE INDEX idx_server_giveaways_status ON server_giveaways(status);
CREATE INDEX idx_server_giveaways_ends_at ON server_giveaways(ends_at);
CREATE INDEX idx_server_giveaway_entries_giveaway_id ON server_giveaway_entries(giveaway_id);
CREATE INDEX idx_server_giveaway_entries_member_id ON server_giveaway_entries(member_id);
CREATE INDEX idx_server_staff_ratings_member ON server_staff_ratings(staff_member_id);
CREATE INDEX idx_server_staff_reports_staff ON server_staff_reports(reported_staff_id);
CREATE INDEX idx_server_staff_reports_pair ON server_staff_reports(reporter_member_id, reported_staff_id);
CREATE INDEX idx_server_staff_reports_status ON server_staff_reports(status);
CREATE INDEX idx_server_feedback_member ON server_feedback(member_id);
