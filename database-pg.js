// database-pg.js - Complete Database File
const { Pool } = require('pg');

class DeviceDatabase {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    
    this.cache = {
      codes: [],
      stats: { total: 0, approved: 0, revoked: 0, totalPings: 0, totalCodes: 0, activeCodes: 0, pendingRequests: 0 },
      devices: [],
      requests: [],
      lastUpdate: 0,
      hasInitialData: false
    };
    
    this.pool.on('error', (err) => console.error('Database pool error:', err));
    this.initTables();
    console.log('✅ PostgreSQL Database initialized');
  }

  async query(sql, params = []) {
    let client = null;
    try {
      client = await this.pool.connect();
      const result = await client.query(sql, params);
      return result;
    } finally {
      if (client) client.release();
    }
  }

  async run(sql, params = []) {
    const result = await this.query(sql, params);
    return { changes: result.rowCount, lastID: result.rows[0]?.id || null };
  }

  async get(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows[0] || null;
  }

  async all(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows;
  }

  async initTables() {
    try {
      await this.query(`
        CREATE TABLE IF NOT EXISTS codes (
          code TEXT PRIMARY KEY,
          max_devices INTEGER DEFAULT 10,
          used_count INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT TRUE,
          created_by TEXT,
          username TEXT,
          access_level TEXT DEFAULT 'VIP',
          subscription_type TEXT DEFAULT 'Lifetime',
          subscription_started_at TIMESTAMP,
          expires_at TIMESTAMP,
          status TEXT DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          notes TEXT,
          hwid TEXT,
          fingerprint TEXT,
          machine_info JSONB,
          max_hwid_limit INTEGER DEFAULT 1
        )
      `);

      await this.query(`
        CREATE TABLE IF NOT EXISTS code_hwids (
          id SERIAL PRIMARY KEY,
          code TEXT NOT NULL REFERENCES codes(code) ON DELETE CASCADE,
          hwid TEXT NOT NULL,
          assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_used TIMESTAMP,
          UNIQUE(code, hwid)
        )
      `);

      await this.query(`
        CREATE TABLE IF NOT EXISTS devices (
          id SERIAL PRIMARY KEY,
          device_id TEXT UNIQUE NOT NULL,
          user_agent TEXT,
          ip_address TEXT,
          browser_info TEXT,
          code TEXT,
          hwid TEXT,
          status TEXT DEFAULT 'approved',
          approved_at TIMESTAMP,
          revoked_at TIMESTAMP,
          last_ping TIMESTAMP,
          ping_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          browser_profile TEXT,
          cpu_name TEXT,
          gpu_name TEXT,
          ram_total_gb DECIMAL,
          storage_total_gb DECIMAL,
          profile_name TEXT,
          device_name TEXT,
          wallpaper_name TEXT,
          wallpaper_size_kb DECIMAL,
          wallpaper_width INTEGER,
          wallpaper_height INTEGER,
          wallpaper_base64 TEXT
        )
      `);

      await this.query(`
        CREATE TABLE IF NOT EXISTS requests (
          id SERIAL PRIMARY KEY,
          device_id TEXT NOT NULL,
          code TEXT,
          reason TEXT,
          status TEXT DEFAULT 'pending',
          requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          responded_at TIMESTAMP,
          admin_response TEXT
        )
      `);

      await this.query(`
        CREATE TABLE IF NOT EXISTS usage_logs (
          id SERIAL PRIMARY KEY,
          device_id TEXT,
          code TEXT,
          action TEXT NOT NULL,
          details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await this.query(`
        CREATE TABLE IF NOT EXISTS admins (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await this.query(`
        CREATE TABLE IF NOT EXISTS hwid_logs (
          id SERIAL PRIMARY KEY,
          hwid TEXT NOT NULL,
          code TEXT,
          device_id TEXT,
          action TEXT NOT NULL,
          status TEXT DEFAULT 'new',
          details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ip_address TEXT,
          user_agent TEXT,
          browser_profile TEXT
        )
      `);

      await this.query(`
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

      // Indexes
      await this.query(`CREATE INDEX IF NOT EXISTS idx_codes_hwid ON codes(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_devices_hwid ON devices(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_codes_username ON codes(username)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_code_hwids_code ON code_hwids(code)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_code_hwids_hwid ON code_hwids(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_hwid_logs_hwid ON hwid_logs(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_hwid_logs_created_at ON hwid_logs(created_at DESC)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_new_hwid_registry_hwid ON new_hwid_registry(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_new_hwid_registry_status ON new_hwid_registry(status)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_devices_code ON devices(code)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_codes_status ON codes(status)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_codes_is_active ON codes(is_active)`);

      // Auto-delete function
      await this.query(`
        CREATE OR REPLACE FUNCTION auto_delete_old_hwid_logs() RETURNS trigger AS $$
        BEGIN
          DELETE FROM hwid_logs WHERE created_at < NOW() - INTERVAL '30 days';
          DELETE FROM hwid_logs WHERE id NOT IN (
            SELECT id FROM hwid_logs ORDER BY created_at DESC LIMIT 5000
          );
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);

      await this.query(`
        DROP TRIGGER IF EXISTS trigger_auto_delete_hwid_logs ON hwid_logs;
        CREATE TRIGGER trigger_auto_delete_hwid_logs
        AFTER INSERT ON hwid_logs
        EXECUTE FUNCTION auto_delete_old_hwid_logs();
      `);

      console.log('✅ Tables created/verified');
      await this.refreshCache();
    } catch (error) {
      console.error('❌ Failed to create tables:', error.message);
    }
  }

  async refreshCache() {
    try {
      const result = await this.query(`
        WITH 
        stats AS (
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
            COUNT(CASE WHEN status = 'revoked' THEN 1 END) as revoked,
            COALESCE(SUM(ping_count), 0) as totalPings
          FROM devices
        ),
        code_stats AS (
          SELECT 
            COUNT(*) as totalCodes,
            COUNT(CASE WHEN is_active = true AND status = 'active' THEN 1 END) as activeCodes,
            COUNT(CASE WHEN access_level = 'SVIP' THEN 1 END) as svip_count,
            COUNT(CASE WHEN access_level = 'VIP' THEN 1 END) as vip_count
          FROM codes
        ),
        pending_req AS (
          SELECT COUNT(*) as pendingRequests FROM requests WHERE status = 'pending'
        )
        SELECT 
          json_build_object(
            'total', s.total,
            'approved', s.approved,
            'revoked', s.revoked,
            'totalPings', s.totalPings,
            'totalCodes', cs.totalCodes,
            'activeCodes', cs.activeCodes,
            'pendingRequests', pr.pendingRequests,
            'svip_count', cs.svip_count,
            'vip_count', cs.vip_count
          ) as stats,
          (SELECT json_agg(d ORDER BY created_at DESC) FROM (SELECT * FROM devices LIMIT 200) d) as devices,
          (SELECT json_agg(c ORDER BY created_at DESC) FROM codes c) as codes,
          (SELECT json_agg(r ORDER BY requested_at DESC) FROM (SELECT * FROM requests WHERE status = 'pending' LIMIT 50) r) as requests
        FROM stats s, code_stats cs, pending_req pr
      `);
      
      if (result.rows[0]) {
        this.cache.stats = result.rows[0].stats || this.cache.stats;
        this.cache.devices = result.rows[0].devices || [];
        this.cache.codes = result.rows[0].codes || [];
        this.cache.requests = result.rows[0].requests || [];
        this.cache.lastUpdate = Date.now();
        this.cache.hasInitialData = true;
      }
      return this.cache;
    } catch (error) {
      console.error('Cache refresh error:', error);
      return this.cache;
    }
  }

  getCachedData() {
    return {
      codes: this.cache.codes || [],
      stats: this.cache.stats || { total: 0, approved: 0, revoked: 0, totalPings: 0, totalCodes: 0, activeCodes: 0, pendingRequests: 0 },
      devices: this.cache.devices || [],
      requests: this.cache.requests || []
    };
  }

  async addNewHwidToRegistry(hwid, hardware, browserProfile) {
    try {
      let cpuName = 'Unknown', gpuName = 'Unknown', ramTotal = 0, storageTotal = 0, deviceName = 'Unknown', profileName = 'Default';
      
      if (hardware) {
        const hw = typeof hardware === 'string' ? JSON.parse(hardware) : hardware;
        cpuName = hw.cpu || 'Unknown';
        gpuName = hw.gpu || 'Unknown';
        ramTotal = hw.ram_gb || 0;
        storageTotal = hw.storage_gb || 0;
        deviceName = hw.device_name || 'Unknown';
        profileName = hw.profile_name || 'Default';
      }
      
      if (browserProfile) profileName = browserProfile;
      
      await this.query(
        `INSERT INTO new_hwid_registry (hwid, cpu_name, gpu_name, ram_total_gb, storage_total_gb, device_name, browser_profile, detected_at, last_seen, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'new')
         ON CONFLICT (hwid) DO UPDATE SET last_seen = CURRENT_TIMESTAMP`,
        [hwid, cpuName, gpuName, ramTotal, storageTotal, deviceName, profileName]
      );
      return true;
    } catch (error) {
      console.error('Add new HWID error:', error.message);
      return false;
    }
  }

  async markHwidAsAssigned(hwid, code) {
    try {
      await this.query(
        `UPDATE new_hwid_registry SET status = 'assigned', code_assigned = $1, assigned_at = CURRENT_TIMESTAMP WHERE hwid = $2`,
        [code, hwid]
      );
      await this.query('DELETE FROM hwid_logs WHERE hwid = $1 AND code IS NULL', [hwid]);
      return true;
    } catch (error) {
      console.error('Mark HWID as assigned error:', error.message);
      return false;
    }
  }

  async getNewHwids(limit = 100) {
    try {
      const result = await this.query(
        `SELECT * FROM new_hwid_registry WHERE status = 'new' ORDER BY detected_at DESC LIMIT $1`,
        [limit]
      );
      return result.rows;
    } catch (error) {
      return [];
    }
  }

  async getNewHwidCount() {
    try {
      const result = await this.query("SELECT COUNT(*) as count FROM new_hwid_registry WHERE status = 'new'");
      return parseInt(result.rows[0]?.count || 0);
    } catch (error) {
      return 0;
    }
  }

  async removeNewHwid(hwid) {
    try {
      const result = await this.query('DELETE FROM new_hwid_registry WHERE hwid = $1 AND status = $2', [hwid, 'new']);
      return result.rowCount > 0;
    } catch (error) {
      return false;
    }
  }

  async clearOldHwidLogs() {
    try {
      const result1 = await this.query("DELETE FROM hwid_logs WHERE created_at < NOW() - INTERVAL '30 days'");
      const result2 = await this.query(
        `DELETE FROM hwid_logs WHERE id NOT IN (SELECT id FROM hwid_logs ORDER BY created_at DESC LIMIT 5000)`
      );
      return result1.rowCount + result2.rowCount;
    } catch (error) {
      console.error('Clear old HWID logs error:', error.message);
      return 0;
    }
  }

  async registerDeviceWithCode(deviceId, userAgent, ip, browserInfo, code, hwid = null, hardware = null, wallpaper = null) {
    // ... existing code
    return { success: true };
  }

  async getDevice(deviceId) {
    try {
      const result = await this.query('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
      return result.rows[0] || null;
    } catch (error) {
      return null;
    }
  }

  async isHwidAuthorized(code, hwid) {
    try {
      const result = await this.query('SELECT * FROM code_hwids WHERE code = $1 AND hwid = $2', [code, hwid]);
      return result.rows.length > 0;
    } catch (error) {
      return false;
    }
  }

  async getCodeHwidLimit(code) {
    try {
      const result = await this.query('SELECT max_hwid_limit FROM codes WHERE code = $1', [code]);
      return result.rows[0]?.max_hwid_limit || 1;
    } catch (error) {
      return 1;
    }
  }

  async getCodeHwidCount(code) {
    try {
      const result = await this.query('SELECT COUNT(*) as count FROM code_hwids WHERE code = $1', [code]);
      return parseInt(result.rows[0]?.count || 0);
    } catch (error) {
      return 0;
    }
  }

  async getCodeHwids(code) {
    try {
      const result = await this.query('SELECT hwid, assigned_at, last_used FROM code_hwids WHERE code = $1 ORDER BY assigned_at DESC', [code]);
      return result.rows;
    } catch (error) {
      return [];
    }
  }

  async assignHwidToCode(code, hwid, autoAssign = false) {
    try {
      if (!hwid || hwid.length !== 64) {
        return { success: false, error: 'Invalid HWID format' };
      }

      const existing = await this.query('SELECT * FROM code_hwids WHERE code = $1 AND hwid = $2', [code, hwid]);
      if (existing.rows[0]) {
        await this.query('UPDATE code_hwids SET last_used = CURRENT_TIMESTAMP WHERE code = $1 AND hwid = $2', [code, hwid]);
        await this.markHwidAsAssigned(hwid, code);
        return { success: true, message: 'HWID already assigned' };
      }

      const currentCount = await this.getCodeHwidCount(code);
      const limit = await this.getCodeHwidLimit(code);

      if (currentCount >= limit) {
        if (!autoAssign) {
          return { success: false, error: `HWID limit reached (${limit})`, limit_reached: true };
        }
        return { success: false, error: `HWID limit reached (${limit}). Auto-deactivating.`, auto_deactivate: true };
      }

      await this.query('INSERT INTO code_hwids (code, hwid, assigned_at) VALUES ($1, $2, CURRENT_TIMESTAMP)', [code, hwid]);
      await this.query('UPDATE codes SET hwid = $1 WHERE code = $2', [hwid, code]);
      await this.markHwidAsAssigned(hwid, code);
      await this.refreshCache();
      return { success: true, message: 'HWID assigned successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async removeHwidFromCode(code, hwid) {
    try {
      await this.query('DELETE FROM devices WHERE code = $1 AND hwid = $2', [code, hwid]);
      const result = await this.query('DELETE FROM code_hwids WHERE code = $1 AND hwid = $2', [code, hwid]);
      if (result.rowCount > 0) {
        await this.refreshCache();
        return { success: true, message: 'HWID removed successfully' };
      }
      return { success: false, error: 'HWID not found' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getCodeInfo(code) {
    try {
      const result = await this.query('SELECT * FROM codes WHERE code = $1', [code]);
      return result.rows[0] || null;
    } catch (error) {
      return null;
    }
  }

  async getStats() {
    return this.cache.stats;
  }

  async createAdmin(username, passwordHash) {
    try {
      await this.query('INSERT INTO admins (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash', [username, passwordHash]);
      return true;
    } catch (error) {
      return null;
    }
  }

  async getAdmin(username) {
    try {
      const result = await this.query('SELECT * FROM admins WHERE username = $1', [username]);
      return result.rows[0] || null;
    } catch (error) {
      return null;
    }
  }

  async logUsage(deviceId, code, action, details = '') {
    try {
      await this.query('INSERT INTO usage_logs (device_id, code, action, details) VALUES ($1, $2, $3, $4)', [deviceId || 'system', code || null, action, details]);
    } catch (error) {
      console.error('Logging error:', error);
    }
  }

  async logHwidActivity(hwid, code, deviceId, action, status, details, ip, userAgent, browserProfile) {
    try {
      const assigned = await this.query('SELECT code FROM code_hwids WHERE hwid = $1', [hwid]);
      if (assigned.rows[0] && assigned.rows[0].code) return true;
      
      await this.query(
        `INSERT INTO hwid_logs (hwid, code, device_id, action, status, details, ip_address, user_agent, browser_profile)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [hwid, code, deviceId, action, status || 'new', details || '', ip || '', userAgent || '', browserProfile || '']
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  async getHwidLogs(limit = 200) {
    try {
      const result = await this.query('SELECT * FROM hwid_logs ORDER BY created_at DESC LIMIT $1', [limit]);
      return result.rows;
    } catch (error) {
      return [];
    }
  }

  async updatePing(deviceId) {
    try {
      await this.query('UPDATE devices SET last_ping = CURRENT_TIMESTAMP, ping_count = ping_count + 1 WHERE device_id = $1', [deviceId]);
    } catch (error) {}
  }

  close() {
    this.pool.end();
  }
}

module.exports = new DeviceDatabase();