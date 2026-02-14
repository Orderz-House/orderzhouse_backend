const pool = require("../../models/db.js");

async function up() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Add activated_at and update status enum for subscriptions
    await client.query(`
      ALTER TABLE subscriptions
      ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP NULL;
    `);

    // Update status to include 'pending_start' and 'expired'
    // Note: PostgreSQL doesn't support ALTER TYPE easily, so we'll use a workaround
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'subscription_status_enum'
        ) THEN
          CREATE TYPE subscription_status_enum AS ENUM ('pending_start', 'active', 'cancelled', 'expired');
        END IF;
      END $$;
    `);

    // If status column is VARCHAR, we'll keep it as VARCHAR and just allow new values
    // (safer than trying to convert enum)
    await client.query(`
      ALTER TABLE subscriptions
      ALTER COLUMN status SET DEFAULT 'pending_start';
    `);

    // Add plan_fee_last_paid_at to users table
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS plan_fee_last_paid_at DATE NULL;
    `);

    // Add index for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_subscriptions_activated_at 
      ON subscriptions(activated_at) 
      WHERE activated_at IS NULL;
    `);

    await client.query("COMMIT");
    console.log("✅ Successfully added subscription activation fields");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error adding subscription activation fields:", err);
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
      ALTER TABLE subscriptions
      DROP COLUMN IF EXISTS activated_at;
    `);

    await client.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS plan_fee_last_paid_at;
    `);

    await client.query(`
      DROP INDEX IF EXISTS idx_subscriptions_activated_at;
    `);

    await client.query("COMMIT");
    console.log("✅ Successfully reverted subscription activation fields");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error reverting subscription activation fields:", err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { up, down };
