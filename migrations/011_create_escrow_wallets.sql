-- Migration: Create escrow and wallet tables
-- Run this migration to add escrow and wallet functionality

-- 1. Create escrow table
CREATE TABLE IF NOT EXISTS escrow (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  freelancer_id INTEGER NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  status VARCHAR NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released', 'refunded')),
  created_at TIMESTAMP DEFAULT NOW(),
  released_at TIMESTAMP,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  CONSTRAINT fk_escrow_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_escrow_client FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_escrow_freelancer FOREIGN KEY (freelancer_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. Create wallets table
CREATE TABLE IF NOT EXISTS wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance NUMERIC NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. Create wallet_transactions table
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  type VARCHAR NOT NULL CHECK (type IN ('credit', 'debit')),
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_escrow_project_id ON escrow(project_id);
CREATE INDEX IF NOT EXISTS idx_escrow_payment_id ON escrow(payment_id);
CREATE INDEX IF NOT EXISTS idx_escrow_status ON escrow(status);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON wallet_transactions(created_at DESC);

-- 5. Create unique constraint: one escrow per (project_id, payment_id) combination
-- This ensures idempotency when creating escrow
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_project_payment_unique 
ON escrow(project_id, payment_id) 
WHERE payment_id IS NOT NULL;

-- 6. Create unique constraint: one escrow per project_id when payment_id is NULL (for bidding projects)
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_project_unique_null_payment 
ON escrow(project_id) 
WHERE payment_id IS NULL;
