// Migration to create tender_vault_cycles table for tracking activation cycles
const pool = require("../../models/db.js");

async function up() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("🔄 Creating tender_vault_cycles table...");

    // Create tender_vault_cycles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.tender_vault_cycles (
        id SERIAL PRIMARY KEY,
        tender_id INTEGER NOT NULL REFERENCES public.tender_vault_projects(id) ON DELETE CASCADE,
        cycle_number INTEGER NOT NULL,
        client_public_id VARCHAR(50) NOT NULL UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'awarded')),
        display_start_time TIMESTAMP NOT NULL,
        display_end_time TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        order_id INTEGER REFERENCES public.projects(id) ON DELETE SET NULL,
        UNIQUE(tender_id, cycle_number)
      );
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_cycles_tender_id 
      ON public.tender_vault_cycles(tender_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_cycles_client_public_id 
      ON public.tender_vault_cycles(client_public_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_cycles_status 
      ON public.tender_vault_cycles(status);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_cycles_display_times 
      ON public.tender_vault_cycles(display_start_time, display_end_time);
    `);

    // Remove cycle_number column from tender_vault_projects if it exists
    try {
      const { rows: cycleColCheck } = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'tender_vault_projects' 
        AND column_name = 'cycle_number'
      `);
      
      if (cycleColCheck.length > 0) {
        await client.query(`
          ALTER TABLE public.tender_vault_projects
          DROP COLUMN cycle_number;
        `);
        console.log("✅ Removed cycle_number column from tender_vault_projects");
      }
    } catch (err) {
      console.warn("⚠️  Could not remove cycle_number column:", err.message);
    }

    // Create trigger for updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION update_tender_vault_cycles_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS trigger_update_tender_vault_cycles_updated_at ON public.tender_vault_cycles;
      CREATE TRIGGER trigger_update_tender_vault_cycles_updated_at
      BEFORE UPDATE ON public.tender_vault_cycles
      FOR EACH ROW
      EXECUTE FUNCTION update_tender_vault_cycles_updated_at();
    `);

    console.log("✅ tender_vault_cycles table created successfully");

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

    await client.query(`
      DROP TRIGGER IF EXISTS trigger_update_tender_vault_cycles_updated_at ON public.tender_vault_cycles;
    `);

    await client.query(`
      DROP FUNCTION IF EXISTS update_tender_vault_cycles_updated_at();
    `);

    await client.query(`
      DROP TABLE IF EXISTS public.tender_vault_cycles;
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
