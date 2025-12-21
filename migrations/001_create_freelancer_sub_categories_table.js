// Migration to create freelancer_sub_categories table
const pool = require('../models/db.js');

async function up() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Create the freelancer_sub_categories table
    await client.query(`
      CREATE TABLE IF NOT EXISTS freelancer_sub_categories (
        id SERIAL PRIMARY KEY,
        freelancer_id INTEGER NOT NULL,
        sub_category_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(freelancer_id, sub_category_id),
        FOREIGN KEY (freelancer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (sub_category_id) REFERENCES sub_categories(id) ON DELETE CASCADE
      )
    `);
    
    await client.query('COMMIT');
    console.log('Successfully created freelancer_sub_categories table');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating freelancer_sub_categories table:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Drop the freelancer_sub_categories table
    await client.query('DROP TABLE IF EXISTS freelancer_sub_categories');
    
    await client.query('COMMIT');
    console.log('Successfully dropped freelancer_sub_categories table');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error dropping freelancer_sub_categories table:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { up, down };