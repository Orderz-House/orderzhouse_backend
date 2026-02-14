-- Migration to fix and ensure tender_vault_projects table matches bidding project schema
-- Run this SQL directly in your PostgreSQL database if needed
-- This migration is idempotent (safe to run multiple times)

BEGIN;

-- Create table if it doesn't exist
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
  attachments JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'published', 'archived')),
  closing_date TIMESTAMP,
  published_at TIMESTAMP,
  archived_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add missing columns if they don't exist (idempotent)
DO $$ 
BEGIN
  -- category_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'category_id') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN category_id INTEGER REFERENCES public.categories(id) ON DELETE SET NULL;
  END IF;

  -- sub_category_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'sub_category_id') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN sub_category_id INTEGER REFERENCES public.sub_categories(id) ON DELETE SET NULL;
  END IF;

  -- sub_sub_category_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'sub_sub_category_id') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN sub_sub_category_id INTEGER REFERENCES public.sub_sub_categories(id) ON DELETE SET NULL;
  END IF;

  -- project_type
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'project_type') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN project_type VARCHAR(50) NOT NULL DEFAULT 'bidding';
  END IF;

  -- budget_min
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'budget_min') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN budget_min NUMERIC(10, 2);
  END IF;

  -- budget_max
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'budget_max') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN budget_max NUMERIC(10, 2);
  END IF;

  -- currency
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'currency') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'JOD';
  END IF;

  -- duration_type
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'duration_type') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN duration_type VARCHAR(10) DEFAULT 'days';
  END IF;

  -- duration_days
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'duration_days') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN duration_days INTEGER;
  END IF;

  -- duration_hours
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'duration_hours') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN duration_hours INTEGER;
  END IF;

  -- preferred_skills
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'preferred_skills') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN preferred_skills TEXT[] DEFAULT '{}';
  END IF;

  -- attachments
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'attachments') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN attachments JSONB DEFAULT '[]'::jsonb;
  END IF;

  -- closing_date
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'closing_date') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN closing_date TIMESTAMP;
  END IF;

  -- published_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'published_at') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN published_at TIMESTAMP;
  END IF;

  -- archived_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'archived_at') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN archived_at TIMESTAMP;
  END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_status 
  ON public.tender_vault_projects(status);

CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_created_by_user_id 
  ON public.tender_vault_projects(created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_category_id 
  ON public.tender_vault_projects(category_id);

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
