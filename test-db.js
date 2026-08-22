// test-db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://wantmatures_user:CWSWZCkVncc7RUu74TLwBFig5zeQWRRZ@dpg-d9f8ts1kh4rs7380h9sg-a.singapore-postgres.render.com/wantmatures',
  ssl: { rejectUnauthorized: false }
});

async function test() {
  try {
    console.log('🔍 Testing database connection...');
    const result = await pool.query('SELECT NOW() as time');
    console.log('✅ Connected! Server time:', result.rows[0].time);
    await pool.end();
  } catch (error) {
    console.error('❌ Connection error:', error.message);
    console.error('📋 Details:', error);
  }
}

test();