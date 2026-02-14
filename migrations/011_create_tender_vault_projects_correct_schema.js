// Migration to create tender_vault_projects table with correct schema matching bidding projects
const pool = require("../../models/db.js");

async function up() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Create table if it doesn't exist with exact schema
    await client.query(`
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
    `);

    // Check if table exists and has old column name (created_by_user_id)
    const { rows: existingCols } = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'tender_vault_projects'
    `);

    const hasCreatedByUserId = existingCols.some(r => r.column_name === 'created_by_user_id');
    const hasCreatedBy = existingCols.some(r => r.column_name === 'created_by');

    // Rename created_by_user_id to created_by if it exists
    if (hasCreatedByUserId && !hasCreatedBy) {
      await client.query(`
        ALTER TABLE public.tender_vault_projects
        RENAME COLUMN created_by_user_id TO created_by;
      `);
      console.log("✅ Renamed created_by_user_id to created_by");
    }

    // Add missing columns if they don't exist (idempotent)
    const columnsToAdd = [
      { name: 'created_by', type: 'INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE', skipIf: hasCreatedBy || hasCreatedByUserId },
      { name: 'status', type: "VARCHAR(20) NOT NULL DEFAULT 'stored' CHECK (status IN ('stored','published','archived'))" },
      { name: 'title', type: 'VARCHAR(255) NOT NULL' },
      { name: 'description', type: 'TEXT NOT NULL' },
      { name: 'category_id', type: 'INTEGER REFERENCES public.categories(id) ON DELETE SET NULL' },
      { name: 'budget_min', type: 'NUMERIC(10,2)' },
      { name: 'budget_max', type: 'NUMERIC(10,2)' },
      { name: 'currency', type: "VARCHAR(10) DEFAULT 'JD'" },
      { name: 'duration_value', type: 'INTEGER' },
      { name: 'duration_unit', type: 'VARCHAR(20)' },
      { name: 'country', type: 'VARCHAR(100)' },
      { name: 'attachments', type: "JSONB NOT NULL DEFAULT '[]'::jsonb" },
      { name: 'metadata', type: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
      { name: 'is_deleted', type: 'BOOLEAN NOT NULL DEFAULT false' },
      { name: 'created_at', type: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP' },
    ];

    // Refresh column list after rename
    const { rows: colsAfterRename } = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'tender_vault_projects'
    `);
    const existingColNames = colsAfterRename.map(r => r.column_name);

    for (const col of columnsToAdd) {
      try {
        // Skip if column already exists (or was just renamed)
        if (col.skipIf && existingColNames.includes(col.name)) {
          continue;
        }

        // Check if column exists
        if (!existingColNames.includes(col.name)) {
          await client.query(`
            ALTER TABLE public.tender_vault_projects
            ADD COLUMN ${col.name} ${col.type};
          `);
          console.log(`✅ Added column ${col.name}`);
        }
      } catch (err) {
        // Column might already exist or constraint issue, skip
        console.warn(`⚠️  Could not add column ${col.name}:`, err.message);
      }
    }

    // Create indexes if they don't exist
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_status 
      ON public.tender_vault_projects(status);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_created_by 
      ON public.tender_vault_projects(created_by);
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
        NEW.updated_at = CURRENT_TIMESTAMP;
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
    console.log("✅ Successfully created/fixed tender_vault_projects table with correct schema");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating tender_vault_projects table:", err);
    throw err;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DROP TABLE IF EXISTS public.tender_vault_projects CASCADE;`);
    await client.query("COMMIT");
    console.log("✅ Successfully dropped tender_vault_projects table");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error dropping tender_vault_projects table:", err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { up, down };
