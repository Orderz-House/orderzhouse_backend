-- Migration: Add OTP hash columns for secure OTP storage
-- Date: 2024

-- Add otp_hash column to signup_otps table (store hashed OTP instead of plain text)
ALTER TABLE signup_otps
ADD COLUMN IF NOT EXISTS otp_hash VARCHAR(64) NULL;

-- Add otp_code_hash column to users table (for login OTP)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS otp_code_hash VARCHAR(64) NULL;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_signup_otps_otp_hash ON signup_otps(otp_hash);
CREATE INDEX IF NOT EXISTS idx_users_otp_code_hash ON users(otp_code_hash);

-- Note: Existing plain OTP columns (otp, otp_code) are kept for backward compatibility
-- but should not be used for new OTPs. Migrate existing data if needed.
