-- ============================================================
-- GotoDm - PostgreSQL Database Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(255),
    role          VARCHAR(50)  NOT NULL DEFAULT 'owner',  -- owner | admin | member
    is_verified   BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- SUBSCRIPTIONS (Stripe)
-- ============================================================
CREATE TABLE subscriptions (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id   VARCHAR(255) UNIQUE NOT NULL,
    stripe_subscription_id VARCHAR(255) UNIQUE,
    plan                 VARCHAR(50) NOT NULL DEFAULT 'free',  -- free | starter | pro | agency
    status               VARCHAR(50) NOT NULL DEFAULT 'active', -- active | past_due | canceled | trialing
    current_period_start TIMESTAMPTZ,
    current_period_end   TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user_id  ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status   ON subscriptions(status);

-- ============================================================
-- USAGE LIMITS (per billing period)
-- ============================================================
CREATE TABLE usage_limits (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start     TIMESTAMPTZ NOT NULL,
    period_end       TIMESTAMPTZ NOT NULL,
    dm_sent          INTEGER NOT NULL DEFAULT 0,
    dm_limit         INTEGER NOT NULL DEFAULT 500,    -- overridden per plan
    comment_replies  INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, period_start)
);

CREATE INDEX idx_usage_limits_user_period ON usage_limits(user_id, period_start);

-- ============================================================
-- INSTAGRAM ACCOUNTS (connected via OAuth)
-- ============================================================
CREATE TABLE instagram_accounts (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instagram_user_id    VARCHAR(255) NOT NULL,          -- IG User ID from Graph API
    username             VARCHAR(255) NOT NULL,
    name                 VARCHAR(255),
    profile_picture_url  TEXT,
    access_token_enc     TEXT NOT NULL,                  -- AES-256 encrypted long-lived token
    token_expires_at     TIMESTAMPTZ,
    page_id              VARCHAR(255),                   -- Linked Facebook Page ID
    page_access_token_enc TEXT,                          -- Encrypted Page token
    webhook_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, instagram_user_id)
);

CREATE INDEX idx_ig_accounts_user_id         ON instagram_accounts(user_id);
CREATE INDEX idx_ig_accounts_instagram_user_id ON instagram_accounts(instagram_user_id);

-- ============================================================
-- AUTOMATIONS (top-level rule container)
-- ============================================================
CREATE TABLE automations (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instagram_account_id UUID NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
    name                 VARCHAR(255) NOT NULL,
    trigger_type         VARCHAR(50) NOT NULL,   -- comment_keyword | dm_keyword | first_dm | story_mention
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_automations_user_id              ON automations(user_id);
CREATE INDEX idx_automations_instagram_account_id ON automations(instagram_account_id);
CREATE INDEX idx_automations_trigger_type         ON automations(trigger_type);
CREATE INDEX idx_automations_is_active            ON automations(is_active);

-- ============================================================
-- AUTOMATION RULES (keyword → action mapping)
-- ============================================================
CREATE TABLE automation_rules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    automation_id   UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    keyword         VARCHAR(255),                   -- NULL means catch-all / fallback
    match_type      VARCHAR(50) NOT NULL DEFAULT 'contains', -- contains | exact | starts_with | regex
    action_type     VARCHAR(50) NOT NULL,           -- send_dm | reply_comment | send_template
    message_text    TEXT,                            -- DM/reply body; supports {name} merge tag
    template_id     VARCHAR(255),                   -- reserved for future template support
    delay_seconds   INTEGER NOT NULL DEFAULT 0,     -- human-like delay before sending
    priority        INTEGER NOT NULL DEFAULT 0,     -- higher = matched first
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_automation_rules_automation_id ON automation_rules(automation_id);
CREATE INDEX idx_automation_rules_keyword       ON automation_rules(keyword);

-- ============================================================
-- MESSAGE LOGS (audit trail)
-- ============================================================
CREATE TABLE message_logs (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instagram_account_id UUID NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
    automation_id        UUID REFERENCES automations(id) ON DELETE SET NULL,
    rule_id              UUID REFERENCES automation_rules(id) ON DELETE SET NULL,
    direction            VARCHAR(20) NOT NULL,   -- inbound | outbound
    message_type         VARCHAR(50) NOT NULL,   -- dm | comment_reply
    recipient_ig_id      VARCHAR(255),
    sender_ig_id         VARCHAR(255),
    message_text         TEXT,
    status               VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending | sent | failed | skipped
    error_message        TEXT,
    graph_message_id     VARCHAR(255),           -- message_id returned by Graph API
    sent_at              TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_logs_user_id              ON message_logs(user_id);
CREATE INDEX idx_message_logs_instagram_account_id ON message_logs(instagram_account_id);
CREATE INDEX idx_message_logs_automation_id        ON message_logs(automation_id);
CREATE INDEX idx_message_logs_status               ON message_logs(status);
CREATE INDEX idx_message_logs_created_at           ON message_logs(created_at);

-- ============================================================
-- REFRESH TOKEN STORE (rotating JWT refresh tokens)
-- ============================================================
CREATE TABLE refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
