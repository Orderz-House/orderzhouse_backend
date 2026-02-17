-- Migration: Add offline payment and admin approval columns to projects table
-- Date: 2024-XX-XX
-- Purpose: Support offline payment methods (CliQ/Cash) with admin approval workflow

-- Add payment_method column (nullable, tracks how payment was made)
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) NULL;

-- Add admin_approval_status column (NOT NULL with default 'none')
-- Values: 'none' (normal/old flows), 'pending', 'approved', 'rejected'
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS admin_approval_status VARCHAR(20) NOT NULL DEFAULT 'none';

-- Add admin approval timestamps
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS admin_approved_at TIMESTAMP NULL;

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS admin_rejected_at TIMESTAMP NULL;

-- Add admin decision reason (for rejections)
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS admin_decision_reason TEXT NULL;

-- Add index for filtering pending approvals
CREATE INDEX IF NOT EXISTS idx_projects_admin_approval_status 
ON projects(admin_approval_status) 
WHERE admin_approval_status IN ('pending', 'rejected');

-- Add index for payment method queries
CREATE INDEX IF NOT EXISTS idx_projects_payment_method 
ON projects(payment_method) 
WHERE payment_method IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN projects.payment_method IS 'Payment method: stripe, cliq, cash, or skipped';
COMMENT ON COLUMN projects.admin_approval_status IS 'Admin approval status: none, pending, approved, rejected';
COMMENT ON COLUMN projects.admin_approved_at IS 'Timestamp when admin approved the offline payment';
COMMENT ON COLUMN projects.admin_rejected_at IS 'Timestamp when admin rejected the offline payment';
COMMENT ON COLUMN projects.admin_decision_reason IS 'Reason provided by admin for rejection';
