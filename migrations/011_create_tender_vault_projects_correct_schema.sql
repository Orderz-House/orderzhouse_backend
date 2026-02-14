-- Migration to create tender_vault_projects table with correct schema
-- Run this SQL directly in your PostgreSQL database if needed
-- This migration is idempotent (safe to run multiple times)

BEGIN;

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.tender_vault_projects (
  id SERIAL PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'stored' CHECK (status IN ('stored','published','archived')),
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category_id INTEGER REFERENCES public.categories(id) ON DELETE SET NULL,
  budget_min NUMERIC(10,2),
  budget_max NUMERIC(10,2),
  currency VARCHAR(10) DEFAULT 'JD',
  duration_value INTEGER,
  duration_unit VARCHAR(20),
  country VARCHAR(100),
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Rename created_by_user_id to created_by if it exists
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'created_by_user_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'created_by') THEN
    ALTER TABLE public.tender_vault_projects RENAME COLUMN created_by_user_id TO created_by;
  END IF;
END $$;

-- Add missing columns if they don't exist (idempotent)
DO $$ 
BEGIN
  -- created_by (only if it doesn't exist and wasn't just renamed)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'created_by') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN created_by INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;

  -- status
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'status') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'stored' CHECK (status IN ('stored','published','archived'));
  END IF;

  -- category_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'category_id') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN category_id INTEGER REFERENCES public.categories(id) ON DELETE SET NULL;
  END IF;

  -- budget_min
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'budget_min') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN budget_min NUMERIC(10,2);
  END IF;

  -- budget_max
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'budget_max') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN budget_max NUMERIC(10,2);
  END IF;

  -- currency
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'currency') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN currency VARCHAR(10) DEFAULT 'JD';
  END IF;

  -- duration_value
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'duration_value') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN duration_value INTEGER;
  END IF;

  -- duration_unit
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'duration_unit') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN duration_unit VARCHAR(20);
  END IF;

  -- country
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'country') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN country VARCHAR(100);
  END IF;

  -- attachments
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'attachments') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;

  -- metadata
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'metadata') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;

  -- is_deleted
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'is_deleted') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_status 
  ON public.tender_vault_projects(status);

CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_created_by 
  ON public.tender_vault_projects(created_by);

CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_category_id 
  ON public.tender_vault_projects(category_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_tender_vault_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
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
