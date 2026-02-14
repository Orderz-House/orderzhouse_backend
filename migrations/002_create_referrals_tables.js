// Migration to add referral_code to users and create referrals/referral_rewards tables
const pool = require('../models/db.js');

async function up() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Add referral_code column to users table (handle constraint separately)
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20)
    `);
    
    // Add unique constraint if it doesn't exist
    const constraintCheck = await client.query(`
      SELECT 1 FROM pg_constraint 
      WHERE conname = 'users_referral_code_key' 
      LIMIT 1
    `);
    
    if (constraintCheck.rows.length === 0) {
      try {
        await client.query(`
          ALTER TABLE users 
          ADD CONSTRAINT users_referral_code_key UNIQUE (referral_code)
        `);
      } catch (constraintErr) {
        // Constraint might already exist, ignore
        if (!constraintErr.message.includes('already exists')) {
          throw constraintErr;
        }
      }
    }
    
    // Create referrals table
    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_user_id INTEGER NOT NULL,
        referred_user_id INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(referred_user_id)
      )
    `);
    
    // Create index on referrals for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status)
    `);
    
    // Create referral_rewards table
    await client.query(`
      CREATE TABLE IF NOT EXISTS referral_rewards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        referral_id INTEGER NOT NULL,
        amount NUMERIC(10, 2) NOT NULL,
        type VARCHAR(20) DEFAULT 'referral',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (referral_id) REFERENCES referrals(id) ON DELETE CASCADE
      )
    `);
    
    // Create index on referral_rewards
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_referral_rewards_user ON referral_rewards(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_referral_rewards_referral ON referral_rewards(referral_id)
    `);
    
    // Generate referral codes for existing users
    await client.query(`
      UPDATE users 
      SET referral_code = UPPER(
        SUBSTRING(MD5(RANDOM()::TEXT || id::TEXT || NOW()::TEXT), 1, 7)
      )
      WHERE referral_code IS NULL
    `);
    
    await client.query('COMMIT');
    console.log('Successfully created referrals tables and added referral_code to users');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating referrals tables:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Drop referral_rewards table
    await client.query('DROP TABLE IF EXISTS referral_rewards');
    
    // Drop referrals table
    await client.query('DROP TABLE IF EXISTS referrals');
    
    // Remove referral_code column from users (optional - comment out if you want to keep data)
    // await client.query('ALTER TABLE users DROP COLUMN IF EXISTS referral_code');
    
    await client.query('COMMIT');
    console.log('Successfully dropped referrals tables');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error dropping referrals tables:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { up, down };
