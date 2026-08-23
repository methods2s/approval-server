// migrate-multi-hwid.js
require('dotenv').config(); // Add this line at the top
const { Pool } = require('pg');

// Use environment variable
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { 
    rejectUnauthorized: false 
  },
  // Add these for better connection handling
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    console.log(`📡 Using DATABASE_URL: ${process.env.DATABASE_URL ? '✓ Set' : '✗ Not set'}`);
    
    // Test connection first
    await pool.query('SELECT NOW()');
    console.log('✅ Connected to database successfully!');
    
    console.log('🔄 Migrating database for multi-HWID support...');
    
    // Add new columns to codes table one by one
    const columns = [
      'hwid_limit INTEGER DEFAULT 1',
      'hwid_count INTEGER DEFAULT 0',
      'hwid_whitelist TEXT[] DEFAULT ARRAY[]::TEXT[]'
    ];
    
    for (const col of columns) {
      try {
        const colName = col.split(' ')[0];
        console.log(`  Adding column: ${colName}...`);
        
        const checkQuery = `
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'codes' AND column_name = $1
        `;
        const checkResult = await pool.query(checkQuery, [colName]);
        
        if (checkResult.rows.length === 0) {
          await pool.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS ${col}`);
          console.log(`  ✅ Added column: ${colName}`);
        } else {
          console.log(`  ℹ️ Column ${colName} already exists`);
        }
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
    console.log('📊 Columns added: hwid_limit, hwid_count, hwid_whitelist');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    console.error('📋 Full error:', error);
    await pool.end();
    process.exit(1);
  }
}

migrate();