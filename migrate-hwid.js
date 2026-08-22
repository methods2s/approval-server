// migrate-hwid.js
// Run this once to add HWID columns to existing database

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://wantmatures_user:CWSWZCkVncc7RUu74TLwBFig5zeQWRRZ@dpg-d9f8ts1kh4rs7380h9sg-a.singapore-postgres.render.com/wantmatures',
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('🔄 Migrating database for HWID support...');
    
    // Add columns to codes table
    console.log('📊 Adding columns to codes table...');
    
    const columns = [
      'hwid TEXT UNIQUE',
      'fingerprint TEXT',
      'machine_info JSONB'
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
    
    // Add hwid to devices table
    try {
      await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS hwid TEXT`);
      console.log('  ✅ Added column: hwid to devices');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('  ℹ️ Column hwid already exists in devices');
      } else {
        throw err;
      }
    }
    
    // Create indexes
    console.log('📊 Creating indexes...');
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_codes_hwid ON codes(hwid)`);
      console.log('  ✅ Created index: idx_codes_hwid');
    } catch (err) {
      console.log('  ⚠️ Could not create index:', err.message);
    }
    
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_devices_hwid ON devices(hwid)`);
      console.log('  ✅ Created index: idx_devices_hwid');
    } catch (err) {
      console.log('  ⚠️ Could not create index:', err.message);
    }
    
    console.log('✅ Migration complete!');
    console.log('📊 New columns added: hwid, fingerprint, machine_info');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

migrate();