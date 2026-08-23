// migrate-multi-hwid.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://wantmatures_user:CWSWZCkVncc7RUu74TLwBFig5zeQWRRZ@dpg-d9f8ts1kh4rs7380h9sg-a.singapore-postgres.render.com/wantmatures',
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('🔄 Migrating database for multi-HWID support...');
    
    // Add new columns to codes table
    const columns = [
      'hwid_limit INTEGER DEFAULT 1',
      'hwid_count INTEGER DEFAULT 0',
      'hwid_whitelist TEXT[] DEFAULT ARRAY[]::TEXT[]'
    ];
    
    for (const col of columns) {
      try {
        await pool.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS ${col}`);
        console.log(`  ✅ Added column: ${col.split(' ')[0]}`);
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`  ℹ️ Column already exists: ${col.split(' ')[0]}`);
        } else {
          throw err;
        }
      }
    }
    
    // Set default values for existing codes
    await pool.query(`
      UPDATE codes 
      SET hwid_limit = COALESCE(hwid_limit, 1),
          hwid_count = COALESCE(hwid_count, 0),
          hwid_whitelist = COALESCE(hwid_whitelist, ARRAY[]::TEXT[])
    `);
    
    console.log('✅ Migration complete!');
    console.log('📊 New columns added: hwid_limit, hwid_count, hwid_whitelist');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

migrate();