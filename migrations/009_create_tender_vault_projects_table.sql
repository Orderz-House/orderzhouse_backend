-- Migration: Create tender_vault_projects table
-- Run this SQL directly in your PostgreSQL database if needed

BEGIN;

-- Create tender_vault_projects table
CREATE TABLE IF NOT EXISTS public.tender_vault_projects (
  id SERIAL PRIMARY KEY,
  created_by_user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category_id INTEGER REFERENCES public.categories(id) ON DELETE SET NULL,
  sub_category_id INTEGER REFERENCES public.sub_categories(id) ON DELETE SET NULL,
  sub_sub_category_id INTEGER REFERENCES public.sub_sub_categories(id) ON DELETE SET NULL,
  project_type VARCHAR(50) NOT NULL DEFAULT 'bidding',
  budget_min NUMERIC(10, 2),
  budget_max NUMERIC(10, 2),
  currency VARCHAR(10) NOT NULL DEFAULT 'JOD',
  duration_type VARCHAR(10) DEFAULT 'days',
  duration_days INTEGER,
  duration_hours INTEGER,
  preferred_skills TEXT[] DEFAULT '{}',
  status VARCHAR(50) NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'published', 'archived')),
  closing_date TIMESTAMP,
  published_at TIMESTAMP,
  archived_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_created_by_user_id 
  ON public.tender_vault_projects(created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_status 
  ON public.tender_vault_projects(status);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_tender_vault_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_tender_vault_projects_updated_at ON public.tender_vault_projects;
CREATE TRIGGER trigger_update_tender_vault_projects_updated_at
  BEFORE UPDATE ON public.tender_vault_projects
  FOR EACH ROW
  EXECUTE FUNCTION update_tender_vault_projects_updated_at();

COMMIT;
