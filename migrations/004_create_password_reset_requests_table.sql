-- Migration: Create password_reset_requests table for secure password reset flow
-- This table stores reset requests separately from users table

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_user_id ON password_reset_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_expires_at ON password_reset_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_used ON password_reset_requests(used);
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_active ON password_reset_requests(user_id, used, expires_at) WHERE used = false;

-- Add comment
COMMENT ON TABLE password_reset_requests IS 'Stores password reset requests with hashed OTP codes';
