const pool = require("../../models/db.js");

async function up() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Add can_manage_tender_vault column to users table
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS can_manage_tender_vault BOOLEAN NOT NULL DEFAULT false;
    `);

    await client.query("COMMIT");
    console.log("✅ Successfully added can_manage_tender_vault column");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error adding can_manage_tender_vault column:", err);
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
      DROP COLUMN IF EXISTS can_manage_tender_vault;
    `);

    await client.query("COMMIT");
    console.log("✅ Successfully reverted can_manage_tender_vault column");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error reverting can_manage_tender_vault column:", err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { up, down };
