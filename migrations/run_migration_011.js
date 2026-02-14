// Quick script to run migration 011
const { up } = require('./011_create_tender_vault_projects_correct_schema.js');

async function runMigration() {
  try {
    console.log('Running migration 011: Fix tender_vault_projects schema...');
    await up();
    console.log('✅ Migration 011 completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration 011 failed:', error);
    process.exit(1);
  }
}

runMigration();
