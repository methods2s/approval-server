// migrate-multi-hwid.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://wantmatures_user:CWSWZCkVncc7RUu74TLwBFig5zeQWRRZ@dpg-d9f8ts1kh4rs7380h9sg-a.singapore-postgres.render.com/wantmatures',
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('🔄 Creating multi-HWID support...');

    // 1. Drop old hwid column from codes (optional, pero recommended)
    try {
      await pool.query(`ALTER TABLE codes DROP COLUMN IF EXISTS hwid`);
      console.log('✅ Dropped old hwid column from codes');
    } catch (e) {}

    // 2. Remove unique constraint sa hwid kung meron
    try {
      await pool.query(`DROP INDEX IF EXISTS idx_codes_hwid`);
    } catch (e) {}

    // 3. Create new table for multiple HWIDs per code
    await pool.query(`
      CREATE TABLE IF NOT EXISTS code_hwids (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL REFERENCES codes(code) ON DELETE CASCADE,
        hwid TEXT NOT NULL,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(code, hwid)
      )
    `);
    console.log('✅ Created code_hwids table');

    // 4. Add index
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_code_hwids_code ON code_hwids(code)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_code_hwids_hwid ON code_hwids(hwid)`);

    // 5. Add max_devices column to codes if not exists (editable limit)
    try {
      await pool.query(`ALTER TABLE codes ADD COLUMN max_devices INTEGER DEFAULT 10`);
      console.log('✅ Added max_devices column');
    } catch (e) {
      console.log('ℹ️ max_devices already exists');
    }

    console.log('✅ Migration complete!');
    await pool.end();
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    await pool.end();
  }
}

migrate();