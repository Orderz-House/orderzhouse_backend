-- Signup OTPs: store OTP for email before account exists (two-step signup)
CREATE TABLE IF NOT EXISTS signup_otps (
  email VARCHAR(255) PRIMARY KEY,
  otp VARCHAR(10) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signup_otps_expires_at ON signup_otps(expires_at);
