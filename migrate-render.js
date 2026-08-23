// migrate-render.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://wantmatures_user:CWSWZCkVncc7RUu74TLwBFig5zeQWRRZ@dpg-d9f8ts1kh4rs7380h9sg-a.singapore-postgres.render.com/wantmatures',
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('🔄 Running migration...');
    
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ Connected to database');
    
    // Add columns
    const columns = [
      { name: 'hwid_limit', sql: 'ALTER TABLE codes ADD COLUMN IF NOT EXISTS hwid_limit INTEGER DEFAULT 1' },
      { name: 'hwid_count', sql: 'ALTER TABLE codes ADD COLUMN IF NOT EXISTS hwid_count INTEGER DEFAULT 0' },
      { name: 'hwid_whitelist', sql: 'ALTER TABLE codes ADD COLUMN IF NOT EXISTS hwid_whitelist TEXT[] DEFAULT ARRAY[]::TEXT[]' }
    ];
    
    for (const col of columns) {
      try {
        await pool.query(col.sql);
        console.log(`  ✅ ${col.name} added`);
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`  ℹ️ ${col.name} already exists`);
        } else {
          console.log(`  ❌ ${col.name}: ${err.message}`);
        }
      }
    }
    
    // Update existing records
    await pool.query(`
      UPDATE codes 
      SET hwid_limit = COALESCE(hwid_limit, 1),
          hwid_count = COALESCE(hwid_count, 0),
          hwid_whitelist = COALESCE(hwid_whitelist, ARRAY[]::TEXT[])
    `);
    console.log('  ✅ Updated existing records');
    
    // Show results
    const result = await pool.query(`
      SELECT code, username, hwid_limit, hwid_count, 
             array_length(hwid_whitelist, 1) as hwid_whitelist_count
      FROM codes
    `);
    console.log('\n📊 Current codes:');
    console.table(result.rows);
    
    console.log('\n✅ Migration complete!');
    await pool.end();
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

migrate();