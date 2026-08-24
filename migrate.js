// migrate.js - Run once: node migrate.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log('🔄 Running migration...');
        
        // Create table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS new_hwid_registry (
                id SERIAL PRIMARY KEY,
                hwid TEXT UNIQUE NOT NULL,
                cpu_name TEXT,
                gpu_name TEXT,
                ram_total_gb DECIMAL,
                storage_total_gb DECIMAL,
                device_name TEXT,
                browser_profile TEXT,
                detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                code_assigned TEXT,
                assigned_at TIMESTAMP,
                status TEXT DEFAULT 'new'
            )
        `);
        
        // Add indexes
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_new_hwid_registry_hwid ON new_hwid_registry(hwid)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_new_hwid_registry_status ON new_hwid_registry(status)`);
        
        // Add function and trigger
        await pool.query(`
            CREATE OR REPLACE FUNCTION auto_delete_old_hwid_logs() RETURNS trigger AS $$
            BEGIN
                DELETE FROM hwid_logs WHERE created_at < NOW() - INTERVAL '30 days';
                DELETE FROM hwid_logs WHERE id NOT IN (SELECT id FROM hwid_logs ORDER BY created_at DESC LIMIT 5000);
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `);
        
        await pool.query(`
            DROP TRIGGER IF EXISTS trigger_auto_delete_hwid_logs ON hwid_logs;
            CREATE TRIGGER trigger_auto_delete_hwid_logs
            AFTER INSERT ON hwid_logs
            EXECUTE FUNCTION auto_delete_old_hwid_logs();
        `);
        
        console.log('✅ Migration completed!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

migrate();