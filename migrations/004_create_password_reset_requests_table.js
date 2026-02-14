// Migration: Create password_reset_requests table for secure password reset flow
import pool from "../models/db.js";
import dotenv from "dotenv";

dotenv.config();

async function up() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Create password_reset_requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        otp_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        used BOOLEAN DEFAULT false NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      )
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_requests_user_id 
      ON password_reset_requests(user_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_requests_expires_at 
      ON password_reset_requests(expires_at)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_requests_used 
      ON password_reset_requests(used)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_requests_active 
      ON password_reset_requests(user_id, used, expires_at) 
      WHERE used = false
    `);

    await client.query("COMMIT");
    console.log("✅ Created password_reset_requests table");
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
    await client.query("DROP TABLE IF EXISTS password_reset_requests CASCADE");
    await client.query("COMMIT");
    console.log("✅ Dropped password_reset_requests table");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Rollback failed:", error);
    throw error;
  } finally {
    client.release();
  }
}

export { up, down };
