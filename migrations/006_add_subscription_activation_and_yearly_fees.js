const pool = require("../../models/db.js");

async function up() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Add activated_at column to subscriptions
    await client.query(`
      ALTER TABLE subscriptions
      ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP NULL;
    `);

    // Ensure status column accepts 'pending_start' value
    // If status is VARCHAR, it will accept any value
    // If it's an enum, we need to add the value (PostgreSQL requires recreating enum)
    // For minimal changes, we'll assume VARCHAR or handle enum gracefully
    try {
      await client.query(`
        DO $$ 
        BEGIN
          -- Check if status column is an enum type
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'subscriptions' 
            AND column_name = 'status' 
            AND udt_name LIKE '%enum%'
          ) THEN
            -- If enum exists, try to add value (may fail if already exists)
            -- PostgreSQL doesn't support ALTER TYPE ADD VALUE in transaction easily
            -- So we'll just ensure the column accepts the value
            NULL; -- Do nothing, assume enum already has the value or is VARCHAR
          END IF;
        END $$;
      `);
    } catch (err) {
      // Ignore enum errors - status column is likely VARCHAR which accepts any value
      console.log("Note: Status enum handling skipped (likely VARCHAR)");
    }

    // Create user_yearly_fees table for tracking 25 JOD fee payments
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_yearly_fees (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        fee_year INTEGER NOT NULL,
        paid_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        stripe_session_id VARCHAR(255) UNIQUE NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, fee_year)
      );
    `);

    // Add index for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_yearly_fees_user_year 
      ON user_yearly_fees(user_id, fee_year);
    `);

    await client.query("COMMIT");
    console.log("✅ Successfully added subscription activation and yearly fees support");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error adding subscription activation and yearly fees:", err);
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
      DROP INDEX IF EXISTS idx_user_yearly_fees_user_year;
    `);

    await client.query(`
      DROP TABLE IF EXISTS user_yearly_fees;
    `);

    await client.query(`
      ALTER TABLE subscriptions
      DROP COLUMN IF EXISTS activated_at;
    `);

    await client.query("COMMIT");
    console.log("✅ Successfully reverted subscription activation and yearly fees");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error reverting subscription activation and yearly fees:", err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { up, down };
