// test-connection.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://wantmatures_user:CWSWZCkVncc7RUu74TLwBFig5zeQWRRZ@dpg-d9f8ts1kh4rs7380h9sg-a.singapore-postgres.render.com/wantmatures',
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000
});

async function test() {
  try {
    console.log('🔍 Testing connection...');
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as time');
    console.log('✅ Connected! Server time:', result.rows[0].time);
    client.release();
    await pool.end();
  } catch (error) {
    console.error('❌ Connection error:', error.message);
    console.error('📋 Full error:', error);
    process.exit(1);
  }
}

test();