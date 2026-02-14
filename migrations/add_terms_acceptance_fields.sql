-- Migration: Add Terms & Conditions acceptance fields to users table
-- Date: 2024

ALTER TABLE users
ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS terms_version VARCHAR(20) NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_terms_accepted_at ON users(terms_accepted_at);
CREATE INDEX IF NOT EXISTS idx_users_terms_version ON users(terms_version);
