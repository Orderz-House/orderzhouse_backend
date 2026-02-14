// Migration to fix and ensure tender_vault_projects table matches bidding project schema
const pool = require("../../models/db.js");

async function up() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Create table if it doesn't exist
    await client.query(`
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
    `);

    // Add missing columns if they don't exist (idempotent)
    const columnsToAdd = [
      { name: 'category_id', type: 'INTEGER REFERENCES public.categories(id) ON DELETE SET NULL' },
      { name: 'sub_category_id', type: 'INTEGER REFERENCES public.sub_categories(id) ON DELETE SET NULL' },
      { name: 'sub_sub_category_id', type: 'INTEGER REFERENCES public.sub_sub_categories(id) ON DELETE SET NULL' },
      { name: 'project_type', type: "VARCHAR(50) NOT NULL DEFAULT 'bidding'" },
      { name: 'budget_min', type: 'NUMERIC(10, 2)' },
      { name: 'budget_max', type: 'NUMERIC(10, 2)' },
      { name: 'currency', type: "VARCHAR(10) NOT NULL DEFAULT 'JOD'" },
      { name: 'duration_type', type: "VARCHAR(10) DEFAULT 'days'" },
      { name: 'duration_days', type: 'INTEGER' },
      { name: 'duration_hours', type: 'INTEGER' },
      { name: 'preferred_skills', type: "TEXT[] DEFAULT '{}'" },
      { name: 'attachments', type: "JSONB DEFAULT '[]'::jsonb" },
      { name: 'closing_date', type: 'TIMESTAMP' },
      { name: 'published_at', type: 'TIMESTAMP' },
      { name: 'archived_at', type: 'TIMESTAMP' },
    ];

    for (const col of columnsToAdd) {
      try {
        await client.query(`
          ALTER TABLE public.tender_vault_projects
          ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};
        `);
      } catch (err) {
        // Column might already exist with different type, skip
        console.warn(`⚠️  Could not add column ${col.name}:`, err.message);
      }
    }

    // Create indexes if they don't exist
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_status 
      ON public.tender_vault_projects(status);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_created_by_user_id 
      ON public.tender_vault_projects(created_by_user_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_category_id 
      ON public.tender_vault_projects(category_id);
    `);

    // Create function to update updated_at timestamp
    await client.query(`
      CREATE OR REPLACE FUNCTION update_tender_vault_projects_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create trigger to auto-update updated_at
    await client.query(`
      DROP TRIGGER IF EXISTS trigger_update_tender_vault_projects_updated_at ON public.tender_vault_projects;
      CREATE TRIGGER trigger_update_tender_vault_projects_updated_at
      BEFORE UPDATE ON public.tender_vault_projects
      FOR EACH ROW
      EXECUTE FUNCTION update_tender_vault_projects_updated_at();
    `);

    await client.query("COMMIT");
    console.log("✅ Successfully fixed tender_vault_projects table schema");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error fixing tender_vault_projects table schema:", err);
    throw err;
  } finally {
    client.release();
  }
}

async function down() {
  // This migration is additive, so down() doesn't need to do anything
  // The original migration 009 handles table deletion
  console.log("⚠️  Migration 010 is additive. Use migration 009 down() to drop the table.");
}

module.exports = { up, down };
