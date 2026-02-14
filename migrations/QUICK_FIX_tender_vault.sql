-- QUICK FIX: Rename created_by_user_id to created_by and add missing columns
-- Run this SQL directly in your PostgreSQL database

BEGIN;

-- Step 1: Rename column if it exists
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'created_by_user_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'created_by') THEN
    ALTER TABLE public.tender_vault_projects RENAME COLUMN created_by_user_id TO created_by;
    RAISE NOTICE 'Renamed created_by_user_id to created_by';
  END IF;
END $$;

-- Step 2: Add missing columns
DO $$ 
BEGIN
  -- category_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'category_id') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN category_id INTEGER REFERENCES public.categories(id) ON DELETE SET NULL;
    RAISE NOTICE 'Added category_id';
  END IF;

  -- budget_min
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'budget_min') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN budget_min NUMERIC(10,2);
    RAISE NOTICE 'Added budget_min';
  END IF;

  -- budget_max
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'budget_max') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN budget_max NUMERIC(10,2);
    RAISE NOTICE 'Added budget_max';
  END IF;

  -- currency
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'currency') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN currency VARCHAR(10) DEFAULT 'JD';
    RAISE NOTICE 'Added currency';
  END IF;

  -- duration_value
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'duration_value') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN duration_value INTEGER;
    RAISE NOTICE 'Added duration_value';
  END IF;

  -- duration_unit
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'duration_unit') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN duration_unit VARCHAR(20);
    RAISE NOTICE 'Added duration_unit';
  END IF;

  -- country
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'country') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN country VARCHAR(100);
    RAISE NOTICE 'Added country';
  END IF;

  -- attachments
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'attachments') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
    RAISE NOTICE 'Added attachments';
  END IF;

  -- metadata
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'metadata') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    RAISE NOTICE 'Added metadata';
  END IF;

  -- is_deleted
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'tender_vault_projects' AND column_name = 'is_deleted') THEN
    ALTER TABLE public.tender_vault_projects ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false;
    RAISE NOTICE 'Added is_deleted';
  END IF;
END $$;

-- Step 3: Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_status 
  ON public.tender_vault_projects(status);

CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_created_by 
  ON public.tender_vault_projects(created_by);

CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_category_id 
  ON public.tender_vault_projects(category_id);

COMMIT;

-- Verify the fix
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'tender_vault_projects'
ORDER BY ordinal_position;
