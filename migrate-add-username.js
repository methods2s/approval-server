const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://wantmatures_user:CWSWZCkVncc7RUu74TLwBFig5zeQWRRZ@dpg-d9f8ts1kh4rs7380h9sg-a.singapore-postgres.render.com/wantmatures',
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('🔄 Adding username column to codes table...');
    
    const checkResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'codes' AND column_name = 'username'
    `);
    
    if (checkResult.rows.length === 0) {
      await pool.query(`
        ALTER TABLE codes ADD COLUMN username TEXT
      `);
      console.log('✅ Username column added successfully!');
      
      await pool.query(`
        UPDATE codes 
        SET username = SUBSTRING(notes FROM 'For user: (.*)$')
        WHERE notes LIKE '%For user:%' AND username IS NULL
      `);
      console.log('✅ Updated existing records with username from notes');
    } else {
      console.log('ℹ️ Username column already exists');
    }
    
    await pool.end();
    console.log('✅ Migration complete!');
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    await pool.end();
  }
}

migrate();