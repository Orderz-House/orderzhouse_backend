// Migration to add Tender Vault Rotation System fields
const pool = require("../../models/db.js");

async function up() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("🔄 Adding Tender Vault Rotation System fields...");

    // 1. Update status CHECK constraint to include 'active' and 'expired'
    await client.query(`
      ALTER TABLE public.tender_vault_projects
      DROP CONSTRAINT IF EXISTS tender_vault_projects_status_check;
    `);

    await client.query(`
      ALTER TABLE public.tender_vault_projects
      ADD CONSTRAINT tender_vault_projects_status_check
      CHECK (status IN ('stored', 'published', 'archived', 'active', 'expired'));
    `);

    // 2. Add rotation system fields
    const columnsToAdd = [
      { name: 'usage_count', type: 'INTEGER NOT NULL DEFAULT 0' },
      { name: 'max_usage', type: 'INTEGER NOT NULL DEFAULT 4' },
      { name: 'display_start_time', type: 'TIMESTAMP' },
      { name: 'display_end_time', type: 'TIMESTAMP' },
      // cycle_number removed - now tracked in tender_vault_cycles table
      { name: 'temporary_archived_until', type: 'TIMESTAMP' },
      { name: 'last_displayed_at', type: 'TIMESTAMP' },
    ];

    for (const col of columnsToAdd) {
      try {
        const { rows } = await client.query(`
          SELECT column_name FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'tender_vault_projects' 
          AND column_name = $1
        `, [col.name]);
        
        if (rows.length === 0) {
          await client.query(`
            ALTER TABLE public.tender_vault_projects
            ADD COLUMN ${col.name} ${col.type};
          `);
          console.log(`✅ Added column ${col.name}`);
        }
      } catch (err) {
        console.warn(`⚠️  Could not add column ${col.name}:`, err.message);
      }
    }

    // 3. Create tender_client_ids table for temporary Client IDs
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.tender_client_ids (
        id SERIAL PRIMARY KEY,
        tender_id INTEGER NOT NULL REFERENCES public.tender_vault_projects(id) ON DELETE CASCADE,
        cycle_number INTEGER NOT NULL,
        client_id VARCHAR(50) NOT NULL UNIQUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_locked BOOLEAN NOT NULL DEFAULT false,
        locked_at TIMESTAMP,
        order_id INTEGER REFERENCES public.projects(id) ON DELETE SET NULL
      );
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_client_ids_tender_id 
      ON public.tender_client_ids(tender_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_client_ids_client_id 
      ON public.tender_client_ids(client_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_status_usage 
      ON public.tender_vault_projects(status, usage_count, temporary_archived_until);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_display_times 
      ON public.tender_vault_projects(display_start_time, display_end_time);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_last_displayed 
      ON public.tender_vault_projects(last_displayed_at);
    `);

    console.log("✅ Tender Vault Rotation System migration completed");

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Remove columns (cycle_number is now in tender_vault_cycles table)
    const columnsToRemove = [
      'usage_count',
      'max_usage',
      'display_start_time',
      'display_end_time',
      'temporary_archived_until',
      'last_displayed_at',
    ];

    for (const col of columnsToRemove) {
      try {
        await client.query(`
          ALTER TABLE public.tender_vault_projects
          DROP COLUMN IF EXISTS ${col};
        `);
      } catch (err) {
        console.warn(`Could not remove column ${col}:`, err.message);
      }
    }

    // Drop table
    await client.query(`
      DROP TABLE IF EXISTS public.tender_client_ids;
    `);

    // Restore original status constraint
    await client.query(`
      ALTER TABLE public.tender_vault_projects
      DROP CONSTRAINT IF EXISTS tender_vault_projects_status_check;
    `);

    await client.query(`
      ALTER TABLE public.tender_vault_projects
      ADD CONSTRAINT tender_vault_projects_status_check
      CHECK (status IN ('stored', 'published', 'archived'));
    `);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { up, down };
