// migrate-ssl.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://wantmatures_user:CWSWZCkVncc7RUu74TLwBFig5zeQWRRZ@dpg-d9f8ts1kh4rs7380h9sg-a.singapore-postgres.render.com/wantmatures',
  ssl: {
    rejectUnauthorized: false,
    require: true
  },
  connectionTimeoutMillis: 30000
});

async function migrate() {
  try {
    console.log('🔍 Connecting to database...');
    const client = await pool.connect();
    console.log('✅ Connected!');
    
    const queries = [
      "ALTER TABLE codes ADD COLUMN IF NOT EXISTS cpu_name TEXT",
      "ALTER TABLE codes ADD COLUMN IF NOT EXISTS gpu_name TEXT",
      "ALTER TABLE codes ADD COLUMN IF NOT EXISTS ram_total_gb DECIMAL",
      "ALTER TABLE codes ADD COLUMN IF NOT EXISTS storage_total_gb DECIMAL",
      "ALTER TABLE codes ADD COLUMN IF NOT EXISTS device_name TEXT",
      "ALTER TABLE codes ADD COLUMN IF NOT EXISTS profile_name TEXT"
    ];
    
    for (const query of queries) {
      try {
        await client.query(query);
        console.log(`✅ ${query}`);
      } catch (err) {
        console.log(`⚠️ Error: ${err.message}`);
      }
    }
    
    const result = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'codes'
      ORDER BY ordinal_position
    `);
    
    console.log('\n📊 Columns in codes table:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}`);
    });
    
    client.release();
    await pool.end();
    console.log('\n✅ Migration complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

migrate();