const pool = require("../../models/db.js");

async function up() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Create tender_vault_projects table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tender_vault_projects (
        id SERIAL PRIMARY KEY,
        created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        sub_category_id INTEGER REFERENCES sub_categories(id) ON DELETE SET NULL,
        sub_sub_category_id INTEGER REFERENCES sub_sub_categories(id) ON DELETE SET NULL,
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
    `);

    // Create index on status for faster filtering
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_status ON tender_vault_projects(status);
    `);

    // Create index on created_by_user_id for faster user queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tender_vault_projects_created_by_user_id ON tender_vault_projects(created_by_user_id);
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
      DROP TRIGGER IF EXISTS trigger_update_tender_vault_projects_updated_at ON tender_vault_projects;
      CREATE TRIGGER trigger_update_tender_vault_projects_updated_at
      BEFORE UPDATE ON tender_vault_projects
      FOR EACH ROW
      EXECUTE FUNCTION update_tender_vault_projects_updated_at();
    `);

    await client.query("COMMIT");
    console.log("✅ Successfully created tender_vault_projects table");
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

    await client.query(`
      DROP TABLE IF EXISTS tender_vault_projects CASCADE;
    `);

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
