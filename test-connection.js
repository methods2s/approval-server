// test-connection.js
const { Pool } = require('pg');
require('dotenv').config();

async function testConnection() {
  console.log('🔍 Testing Supabase Connection...');
  console.log(`📡 URL: ${process.env.DATABASE_URL}`);
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
      sslmode: 'require'
    },
    connectionTimeoutMillis: 30000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000
  });

  try {
    console.log('⏳ Connecting...');
    const client = await pool.connect();
    console.log('✅ Connected!');
    
    const result = await client.query('SELECT NOW() as time, version() as version');
    console.log(`📅 Server time: ${result.rows[0].time}`);
    console.log(`📦 PostgreSQL version: ${result.rows[0].version}`);
    
    // Test table
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log(`📊 Tables found: ${tables.rows.length}`);
    tables.rows.forEach(t => console.log(`   - ${t.table_name}`));
    
    client.release();
    await pool.end();
    console.log('✅ Connection test completed successfully!');
    
  } catch (error) {
    console.error('❌ Connection test failed:', error.message);
    console.error('📋 Error details:', error);
    
    console.log('\n💡 Troubleshooting tips:');
    console.log('1. Check if your IP is allowed in Supabase dashboard');
    console.log('2. Verify your database password is correct');
    console.log('3. Try using transaction pooler (port 6543) instead of session pooler (port 5432)');
    console.log('4. Check if your network allows outbound connections to Supabase');
    
    process.exit(1);
  }
}

testConnection();