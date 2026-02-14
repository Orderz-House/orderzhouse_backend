-- Migration: Set JOD as default currency for payments table
-- Standardizes all payments to use JOD currency

-- Update existing payments without currency to JOD
UPDATE payments 
SET currency = 'JOD' 
WHERE currency IS NULL OR currency = '';

-- Set default value for currency column
ALTER TABLE payments 
ALTER COLUMN currency SET DEFAULT 'JOD';

-- Add constraint to ensure currency is always JOD (if desired, uncomment)
-- ALTER TABLE payments 
-- ADD CONSTRAINT payments_currency_jod CHECK (currency = 'JOD');
