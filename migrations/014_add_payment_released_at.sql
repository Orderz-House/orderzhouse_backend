-- Migration: Add payment_released_at to projects (set when escrow is released to freelancer)
-- Run once to support "payment released" timestamp after client approval.

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS payment_released_at TIMESTAMP NULL;

COMMENT ON COLUMN projects.payment_released_at IS 'Set when escrow is released to freelancer after project completion approval';
