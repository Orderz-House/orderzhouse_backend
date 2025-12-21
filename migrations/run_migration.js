const { up } = require('./001_create_freelancer_sub_categories_table.js');

async function runMigration() {
  try {
    console.log('Running migration to create freelancer_sub_categories table...');
    await up();
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();