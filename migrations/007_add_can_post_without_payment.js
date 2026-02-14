const pool = require("../../models/db.js");

async function up() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Add can_post_without_payment column to users table
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS can_post_without_payment BOOLEAN NOT NULL DEFAULT false;
    `);

    await client.query("COMMIT");
    console.log("✅ Successfully added can_post_without_payment column");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error adding can_post_without_payment column:", err);
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
      ALTER TABLE users
      DROP COLUMN IF EXISTS can_post_without_payment;
    `);

    await client.query("COMMIT");
    console.log("✅ Successfully reverted can_post_without_payment column");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error reverting can_post_without_payment column:", err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { up, down };
