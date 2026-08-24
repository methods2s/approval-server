// database-pg.js - Complete with New HWID Registry and Auto-Delete

const { Pool } = require('pg');

class DeviceDatabase {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      },
      max: 10,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 2000,
      maxUses: 100
    });
    
    this.cache = {
      codes: [],
      stats: { total: 0, approved: 0, revoked: 0, totalPings: 0, totalCodes: 0, activeCodes: 0, pendingRequests: 0 },
      devices: [],
      requests: [],
      lastUpdate: 0,
      hasInitialData: false
    };
    
    this.pool.on('error', (err) => {
      console.error('Database pool error:', err);
    });
    
    this.initTables();
    console.log('✅ PostgreSQL Database initialized');
  }

  async query(sql, params = []) {
    let client = null;
    try {
      client = await this.pool.connect();
      const result = await client.query(sql, params);
      return result;
    } catch (error) {
      throw error;
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          // Ignore release errors
        }
      }
    }
  }

  async safeQuery(sql, params = []) {
    try {
      return await this.query(sql, params);
    } catch (error) {
      if (error.code === '42701' || error.message.includes('already exists')) {
        return null;
      }
      throw error;
    }
  }

  async run(sql, params = []) {
    const result = await this.query(sql, params);
    return { 
      changes: result.rowCount, 
      lastID: result.rows[0]?.id || null 
    };
  }

  async get(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows[0] || null;
  }

  async all(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows;
  }

  // ============================================
  // INIT TABLES
  // ============================================

  async initTables() {
    try {
      // Codes table
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

      // Add missing columns to codes table
      const columnsToAdd = [
        { name: 'username', type: 'TEXT' },
        { name: 'access_level', type: 'TEXT DEFAULT \'VIP\'' },
        { name: 'subscription_type', type: 'TEXT DEFAULT \'Lifetime\'' },
        { name: 'subscription_started_at', type: 'TIMESTAMP' },
        { name: 'expires_at', type: 'TIMESTAMP' },
        { name: 'status', type: 'TEXT DEFAULT \'active\'' },
        { name: 'hwid', type: 'TEXT' },
        { name: 'fingerprint', type: 'TEXT' },
        { name: 'machine_info', type: 'JSONB' },
        { name: 'max_hwid_limit', type: 'INTEGER DEFAULT 1' }
      ];

      for (const col of columnsToAdd) {
        try {
          await this.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
        } catch (e) {
          // Column might already exist
        }
      }

      // code_hwids table
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

      // Devices table with wallpaper columns
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

      // Add hardware and wallpaper columns to devices table
      const deviceColumns = [
        { name: 'hwid', type: 'TEXT' },
        { name: 'browser_profile', type: 'TEXT' },
        { name: 'cpu_name', type: 'TEXT' },
        { name: 'gpu_name', type: 'TEXT' },
        { name: 'ram_total_gb', type: 'DECIMAL' },
        { name: 'storage_total_gb', type: 'DECIMAL' },
        { name: 'profile_name', type: 'TEXT' },
        { name: 'device_name', type: 'TEXT' },
        { name: 'wallpaper_name', type: 'TEXT' },
        { name: 'wallpaper_size_kb', type: 'DECIMAL' },
        { name: 'wallpaper_width', type: 'INTEGER' },
        { name: 'wallpaper_height', type: 'INTEGER' },
        { name: 'wallpaper_base64', type: 'TEXT' }
      ];

      for (const col of deviceColumns) {
        try {
          await this.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
          console.log(`✅ Added column ${col.name} to devices table`);
        } catch (e) {
          console.log(`ℹ️ Column ${col.name} already exists or error:`, e.message);
        }
      }

      // Requests table
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

      // Usage logs table
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

      // Admins table
      await this.query(`
        CREATE TABLE IF NOT EXISTS admins (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // HWID LOGS TABLE
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

      // NEW HWID REGISTRY TABLE
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
      await this.query(`CREATE INDEX IF NOT EXISTS idx_hwid_logs_status ON hwid_logs(status)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_new_hwid_registry_hwid ON new_hwid_registry(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_new_hwid_registry_status ON new_hwid_registry(status)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_new_hwid_registry_detected_at ON new_hwid_registry(detected_at DESC)`);

      // Auto-delete function for HWID logs
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

  // ============================================
  // NEW HWID REGISTRY METHODS
  // ============================================

  async addNewHwidToRegistry(hwid, hardware, browserProfile) {
    try {
      // Check if exists
      const existing = await this.get(
        'SELECT * FROM new_hwid_registry WHERE hwid = $1',
        [hwid]
      );
      
      if (existing) {
        // Update last_seen
        await this.run(
          'UPDATE new_hwid_registry SET last_seen = CURRENT_TIMESTAMP WHERE hwid = $1',
          [hwid]
        );
        return existing;
      }
      
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
      
      if (browserProfile) {
        profileName = browserProfile;
      }
      
      await this.run(
        `INSERT INTO new_hwid_registry (hwid, cpu_name, gpu_name, ram_total_gb, storage_total_gb, device_name, browser_profile, detected_at, last_seen, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'new')`,
        [hwid, cpuName, gpuName, ramTotal, storageTotal, deviceName, profileName]
      );
      
      const inserted = await this.get(
        'SELECT * FROM new_hwid_registry WHERE hwid = $1',
        [hwid]
      );
      
      console.log(`🆕 New HWID added to registry: ${hwid.substring(0, 16)}...`);
      return inserted;
    } catch (error) {
      console.error('Add new HWID to registry error:', error.message);
      return null;
    }
  }

  async markHwidAsAssigned(hwid, code) {
    try {
      await this.run(
        `UPDATE new_hwid_registry 
         SET status = 'assigned', code_assigned = $1, assigned_at = CURRENT_TIMESTAMP 
         WHERE hwid = $2`,
        [code, hwid]
      );
      // Also delete from hwid_logs since may code na
      await this.run(
        'DELETE FROM hwid_logs WHERE hwid = $1 AND code IS NULL',
        [hwid]
      );
      return true;
    } catch (error) {
      console.error('Mark HWID as assigned error:', error.message);
      return false;
    }
  }

  async getNewHwids(limit = 100) {
    try {
      return await this.all(
        `SELECT * FROM new_hwid_registry 
         WHERE status = 'new' 
         ORDER BY detected_at DESC 
         LIMIT $1`,
        [limit]
      );
    } catch (error) {
      console.error('Get new HWIDs error:', error.message);
      return [];
    }
  }

  async getNewHwidCount() {
    try {
      const result = await this.get(
        "SELECT COUNT(*) as count FROM new_hwid_registry WHERE status = 'new'"
      );
      return result ? parseInt(result.count) : 0;
    } catch (error) {
      console.error('Get new HWID count error:', error.message);
      return 0;
    }
  }

  async removeNewHwid(hwid) {
    try {
      const result = await this.run(
        'DELETE FROM new_hwid_registry WHERE hwid = $1 AND status = $2',
        [hwid, 'new']
      );
      return result.changes > 0;
    } catch (error) {
      console.error('Remove new HWID error:', error.message);
      return false;
    }
  }

  async clearOldHwidLogs() {
    try {
      // Delete logs older than 30 days
      const result1 = await this.run(
        "DELETE FROM hwid_logs WHERE created_at < NOW() - INTERVAL '30 days'"
      );
      // Keep only last 5000 logs
      const result2 = await this.run(
        `DELETE FROM hwid_logs WHERE id NOT IN (
          SELECT id FROM hwid_logs ORDER BY created_at DESC LIMIT 5000
        )`
      );
      console.log(`🧹 Cleaned HWID logs: ${result1.changes} old logs, ${result2.changes} overflow logs`);
      return result1.changes + result2.changes;
    } catch (error) {
      console.error('Clear old HWID logs error:', error.message);
      return 0;
    }
  }

  // ============================================
  // REGISTER DEVICE WITH WALLPAPER
  // ============================================

  async registerDeviceWithCode(deviceId, userAgent, ip, browserInfo, code, hwid = null, hardware = null, wallpaper = null) {
    try {
      const codeInfo = await this.getCodeInfo(code);
      if (!codeInfo) {
        return { success: false, error: 'Invalid code' };
      }

      if (!codeInfo.is_active) {
        return { success: false, error: 'Code is inactive' };
      }

      if (codeInfo.subscription_type !== 'Lifetime' && codeInfo.expires_at) {
        const now = new Date();
        const expires = new Date(codeInfo.expires_at);
        if (now > expires) {
          await this.run(`UPDATE codes SET status = 'expired' WHERE code = $1`, [code]);
          return { success: false, error: 'Subscription expired' };
        }
      }

      if (codeInfo.status !== 'active') {
        return { success: false, error: `Code is ${codeInfo.status}` };
      }

      // Add to new HWID registry if not assigned
      if (hwid) {
        const existingHwid = await this.get(
          'SELECT code FROM code_hwids WHERE hwid = $1',
          [hwid]
        );
        
        if (!existingHwid) {
          await this.addNewHwidToRegistry(hwid, hardware, browserInfo?.profile_name);
          console.log(`🆕 Added HWID to new registry: ${hwid.substring(0, 16)}...`);
        }
      }

      let isAuthorized = false;
      if (hwid) {
        isAuthorized = await this.isHwidAuthorized(code, hwid);
      }

      if (!isAuthorized && hwid) {
        console.log(`🔄 HWID not authorized for code ${code}, attempting auto-assignment...`);
        
        const assignResult = await this.assignHwidToCode(code, hwid, true);
        
        if (!assignResult.success) {
          if (assignResult.auto_deactivate) {
            console.log(`🔥 Auto-deactivating code ${code} due to HWID limit exceeded`);
            const deactivateResult = await this.autoDeactivateCode(code, 'hwid_limit_exceeded_auto_assign');
            
            return {
              success: false,
              error: `HWID limit reached (${assignResult.max_limit}). Code auto-deactivated.`,
              auto_deactivated: true,
              devices_revoked: deactivateResult.devices_revoked || 0
            };
          }
          return { success: false, error: assignResult.error };
        }
        
        console.log(`✅ HWID auto-assigned to code ${code}`);
        isAuthorized = true;
        
        await this.logUsage(deviceId, code, 'hwid_auto_assigned', 
          `HWID ${hwid.substring(0, 16)}... auto-assigned to code ${code}`);
      }

      if (!isAuthorized && hwid) {
        return { 
          success: false, 
          error: 'This computer is not authorized for this code',
          needsRegistration: true
        };
      }

      if (!hwid) {
        return { 
          success: false, 
          error: 'HWID is required for registration' 
        };
      }

      // Parse hardware and wallpaper
      let cpuName = 'Unknown', gpuName = 'Unknown', ramTotal = 0, storageTotal = 0, deviceName = 'Unknown', profileName = 'Default';
      let wallpaperName = null, wallpaperSizeKb = 0, wallpaperWidth = 0, wallpaperHeight = 0, wallpaperBase64 = null;

      if (hardware) {
        const hw = typeof hardware === 'string' ? JSON.parse(hardware) : hardware;
        cpuName = hw.cpu || 'Unknown';
        gpuName = hw.gpu || 'Unknown';
        ramTotal = hw.ram_gb || 0;
        storageTotal = hw.storage_gb || 0;
        deviceName = hw.device_name || 'Unknown';
        profileName = hw.profile_name || 'Default';
      }

      if (wallpaper) {
        const wp = typeof wallpaper === 'string' ? JSON.parse(wallpaper) : wallpaper;
        wallpaperName = wp.file_name || null;
        wallpaperSizeKb = wp.size_kb || 0;
        wallpaperWidth = wp.width || 0;
        wallpaperHeight = wp.height || 0;
        wallpaperBase64 = wp.image_base64 || null;
        
        console.log(`🖼️ Wallpaper: ${wallpaperName} (${wallpaperSizeKb} KB) ${wallpaperWidth}x${wallpaperHeight}`);
      }

      const existingDevice = await this.getDevice(deviceId);
      
      if (existingDevice) {
        await this.run(
          `UPDATE devices SET 
            user_agent = $1, 
            ip_address = $2, 
            browser_info = $3, 
            code = $4,
            hwid = $5,
            status = 'approved',
            updated_at = CURRENT_TIMESTAMP,
            browser_profile = $6,
            cpu_name = $7,
            gpu_name = $8,
            ram_total_gb = $9,
            storage_total_gb = $10,
            profile_name = $11,
            device_name = $12,
            wallpaper_name = $13,
            wallpaper_size_kb = $14,
            wallpaper_width = $15,
            wallpaper_height = $16,
            wallpaper_base64 = $17,
            approved_at = CURRENT_TIMESTAMP,
            revoked_at = NULL
          WHERE device_id = $18`,
          [
            userAgent || '',
            ip || '',
            JSON.stringify(browserInfo || {}),
            code,
            hwid,
            profileName,
            cpuName,
            gpuName,
            ramTotal,
            storageTotal,
            profileName,
            deviceName,
            wallpaperName,
            wallpaperSizeKb,
            wallpaperWidth,
            wallpaperHeight,
            wallpaperBase64,
            deviceId
          ]
        );
        
        console.log(`✅ Device ${deviceId} updated with wallpaper: ${wallpaperName}`);
        
      } else {
        await this.run(
          `INSERT INTO devices (
            device_id, user_agent, ip_address, browser_info, code, hwid,
            status, approved_at, browser_profile,
            cpu_name, gpu_name, ram_total_gb, storage_total_gb,
            profile_name, device_name,
            wallpaper_name, wallpaper_size_kb, wallpaper_width, wallpaper_height, wallpaper_base64
          ) VALUES ($1, $2, $3, $4, $5, $6, 'approved', CURRENT_TIMESTAMP, $7,
            $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18)`,
          [
            deviceId,
            userAgent || '',
            ip || '',
            JSON.stringify(browserInfo || {}),
            code,
            hwid,
            profileName,
            cpuName,
            gpuName,
            ramTotal,
            storageTotal,
            profileName,
            deviceName,
            wallpaperName,
            wallpaperSizeKb,
            wallpaperWidth,
            wallpaperHeight,
            wallpaperBase64
          ]
        );
        
        console.log(`✅ New device ${deviceId} registered with wallpaper: ${wallpaperName}`);
      }

      // Mark HWID as assigned in registry
      await this.markHwidAsAssigned(hwid, code);

      await this.run('UPDATE codes SET used_count = used_count + 1 WHERE code = $1', [code]);
      
      await this.logUsage(deviceId, code, 'register', 
        `Device registered | Profile: ${profileName} | CPU: ${cpuName} | GPU: ${gpuName} | Wallpaper: ${wallpaperName || 'None'}`
      );
      
      await this.refreshCache();

      const updatedCodeInfo = await this.getCodeInfo(code);

      return { 
        success: true, 
        status: 'approved', 
        code: code,
        username: updatedCodeInfo.username,
        access: updatedCodeInfo.access_level,
        subscription: updatedCodeInfo.subscription_type,
        subscription_started_at: updatedCodeInfo.subscription_started_at,
        subscription_expires_at: updatedCodeInfo.expires_at,
        status_code: updatedCodeInfo.status,
        hwid_auto_assigned: !isAuthorized,
        wallpaper: {
          name: wallpaperName,
          size_kb: wallpaperSizeKb,
          width: wallpaperWidth,
          height: wallpaperHeight,
          has_base64: !!wallpaperBase64
        }
      };
      
    } catch (error) {
      console.error('Register device error:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // GET DEVICE
  // ============================================

  async getDevice(deviceId) {
    try {
      return await this.get('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
    } catch (error) {
      console.error('Get device error:', error);
      return null;
    }
  }

  async getDevices(status = null) {
    try {
      let query = 'SELECT * FROM devices';
      const params = [];
      
      if (status) {
        query += ' WHERE status = $1';
        params.push(status);
      }
      
      query += ' ORDER BY created_at DESC';
      return await this.all(query, params);
    } catch (error) {
      console.error('Get devices error:', error);
      return this.cache.devices || [];
    }
  }

  async getDevicesByCode(code) {
    try {
      return await this.all(
        'SELECT * FROM devices WHERE code = $1 ORDER BY created_at DESC', 
        [code]
      );
    } catch (error) {
      console.error('Get devices by code error:', error);
      return [];
    }
  }

  // ============================================
  // MULTI-HWID SUPPORT METHODS
  // ============================================

  async getCodeHwidLimit(code) {
    try {
      const result = await this.get(
        'SELECT max_hwid_limit FROM codes WHERE code = $1',
        [code]
      );
      return result ? result.max_hwid_limit : 1;
    } catch (error) {
      console.error('Get HWID limit error:', error);
      return 1;
    }
  }

  async updateCodeHwidLimit(code, limit) {
    try {
      if (limit < 1) limit = 1;
      if (limit > 10) limit = 10;
      
      const result = await this.run(
        'UPDATE codes SET max_hwid_limit = $1 WHERE code = $2',
        [limit, code]
      );
      await this.refreshCache();
      return result.changes > 0;
    } catch (error) {
      console.error('Update HWID limit error:', error);
      return false;
    }
  }

  async getCodeHwids(code) {
    try {
      const result = await this.all(
        'SELECT hwid, assigned_at, last_used FROM code_hwids WHERE code = $1 ORDER BY assigned_at DESC',
        [code]
      );
      return Array.isArray(result) ? result : [];
    } catch (error) {
      console.error('Get code HWIDs error:', error);
      return [];
    }
  }

  async getCodeHwidCount(code) {
    try {
      const result = await this.get(
        'SELECT COUNT(*) as count FROM code_hwids WHERE code = $1',
        [code]
      );
      return result ? parseInt(result.count) : 0;
    } catch (error) {
      console.error('Get HWID count error:', error);
      return 0;
    }
  }

  async isHwidAuthorized(code, hwid) {
    try {
      const result = await this.get(
        'SELECT * FROM code_hwids WHERE code = $1 AND hwid = $2',
        [code, hwid]
      );
      return !!result;
    } catch (error) {
      console.error('Check HWID authorized error:', error);
      return false;
    }
  }

  async assignHwidToCode(code, hwid, autoAssign = false) {
    try {
      if (!hwid || hwid.length !== 64) {
        return { success: false, error: 'Invalid HWID format' };
      }

      const existing = await this.get(
        'SELECT * FROM code_hwids WHERE code = $1 AND hwid = $2',
        [code, hwid]
      );
      if (existing) {
        await this.run(
          'UPDATE code_hwids SET last_used = CURRENT_TIMESTAMP WHERE code = $1 AND hwid = $2',
          [code, hwid]
        );
        // Mark as assigned in registry
        await this.markHwidAsAssigned(hwid, code);
        return { success: true, message: 'HWID already assigned, updated last_used' };
      }

      const otherCode = await this.get(
        'SELECT code FROM code_hwids WHERE hwid = $1 AND code != $2',
        [hwid, code]
      );
      if (otherCode) {
        return { 
          success: false, 
          error: `HWID is already assigned to code: ${otherCode.code}` 
        };
      }

      const currentCount = await this.getCodeHwidCount(code);
      const limit = await this.getCodeHwidLimit(code);

      if (currentCount >= limit) {
        if (!autoAssign) {
          return { 
            success: false, 
            error: `HWID limit reached (${limit}). Remove some HWIDs first.`,
            limit_reached: true,
            current_count: currentCount,
            max_limit: limit
          };
        }
        return {
          success: false,
          error: `HWID limit reached (${limit}). Auto-deactivating code.`,
          limit_reached: true,
          current_count: currentCount,
          max_limit: limit,
          auto_deactivate: true
        };
      }

      await this.run(
        'INSERT INTO code_hwids (code, hwid, assigned_at) VALUES ($1, $2, CURRENT_TIMESTAMP)',
        [code, hwid]
      );

      await this.run(
        'UPDATE codes SET hwid = $1 WHERE code = $2',
        [hwid, code]
      );

      // Mark as assigned in registry
      await this.markHwidAsAssigned(hwid, code);

      await this.refreshCache();
      return { success: true, message: 'HWID assigned successfully', auto_assigned: autoAssign };
    } catch (error) {
      console.error('Assign HWID error:', error);
      return { success: false, error: error.message };
    }
  }

  async removeHwidFromCode(code, hwid) {
    try {
      await this.run(
        'DELETE FROM devices WHERE code = $1 AND hwid = $2',
        [code, hwid]
      );

      const result = await this.run(
        'DELETE FROM code_hwids WHERE code = $1 AND hwid = $2',
        [code, hwid]
      );

      if (result.changes > 0) {
        const remaining = await this.getCodeHwids(code);
        if (remaining && remaining.length > 0) {
          await this.run(
            'UPDATE codes SET hwid = $1 WHERE code = $2',
            [remaining[0].hwid, code]
          );
        } else {
          await this.run(
            'UPDATE codes SET hwid = NULL WHERE code = $1',
            [code]
          );
        }
        await this.refreshCache();
        return { 
          success: true, 
          message: 'HWID removed successfully',
          devices_deleted: result.changes 
        };
      }
      return { success: false, error: 'HWID not found' };
    } catch (error) {
      console.error('Remove HWID error:', error);
      return { success: false, error: error.message };
    }
  }

  async verifyHwidAccess(code, hwid) {
    try {
      const authorized = await this.isHwidAuthorized(code, hwid);
      if (!authorized) {
        return { 
          valid: false, 
          error: 'This computer is not authorized for this code',
          needsRegistration: true
        };
      }

      const codeInfo = await this.get(
        'SELECT * FROM codes WHERE code = $1 AND is_active = true',
        [code]
      );

      if (!codeInfo) {
        return { valid: false, error: 'Invalid or inactive code' };
      }

      if (codeInfo.subscription_type !== 'Lifetime' && codeInfo.expires_at) {
        const now = new Date();
        const expires = new Date(codeInfo.expires_at);
        if (now > expires) {
          await this.run(`UPDATE codes SET status = 'expired' WHERE code = $1`, [code]);
          return { valid: false, error: 'Subscription expired' };
        }
      }

      if (codeInfo.status !== 'active') {
        return { valid: false, error: `Code is ${codeInfo.status}` };
      }

      await this.run(
        'UPDATE code_hwids SET last_used = CURRENT_TIMESTAMP WHERE code = $1 AND hwid = $2',
        [code, hwid]
      );

      return {
        valid: true,
        username: codeInfo.username,
        access: codeInfo.access_level,
        subscription: codeInfo.subscription_type,
        subscription_started_at: codeInfo.subscription_started_at,
        subscription_expires_at: codeInfo.expires_at,
        status_code: codeInfo.status,
        hwid_limit: codeInfo.max_hwid_limit || 1
      };
    } catch (error) {
      console.error('Verify HWID access error:', error);
      return { valid: false, error: 'Verification failed' };
    }
  }

  // ============================================
  // AUTO-DEACTIVATE CODE
  // ============================================

  async autoDeactivateCode(code, reason = 'unauthorized_use') {
    try {
        let status = 'auto_deactivated';
        if (reason === 'multiple_hwids_detected') {
            status = 'auto_deactivated_multiple_hwids';
        } else if (reason === 'hwid_limit_exceeded' || reason === 'hwid_limit_exceeded_auto_assign') {
            status = 'auto_deactivated_limit_exceeded';
        } else if (reason === 'unauthorized_use') {
            status = 'auto_deactivated_unauthorized';
        }
        
        await this.run(
            'UPDATE codes SET is_active = false, status = $1 WHERE code = $2',
            [status, code]
        );
        
        const devices = await this.all(
            'SELECT device_id FROM devices WHERE code = $1',
            [code]
        );
        
        for (const dev of devices) {
            await this.run(
                'UPDATE devices SET status = $1, revoked_at = CURRENT_TIMESTAMP WHERE device_id = $2',
                ['revoked', dev.device_id]
            );
            await this.logUsage(
                dev.device_id, 
                code, 
                'auto_revoked_' + reason, 
                `🔒 Device auto-revoked due to ${reason}`
            );
        }
        
        // Remove all HWIDs
        await this.run(
            'DELETE FROM code_hwids WHERE code = $1',
            [code]
        );
        
        await this.run(
            'UPDATE codes SET hwid = NULL WHERE code = $1',
            [code]
        );
        
        await this.logUsage(
            'system', 
            code, 
            'auto_deactivated_' + reason, 
            `🔒 Code ${code} auto-deactivated due to ${reason}. ${devices.length} devices revoked.`
        );
        
        await this.refreshCache();
        
        return {
            success: true,
            code: code,
            devices_revoked: devices.length,
            reason: reason,
            status: status
        };
    } catch (error) {
        console.error('Auto-deactivate code error:', error);
        return {
            success: false,
            error: error.message
        };
    }
  }

  // ============================================
  // CODE MANAGEMENT
  // ============================================

  calculateExpiration(startDate, subscriptionType) {
    const date = new Date(startDate);
    const months = {
      '3 Months': 3,
      '6 Months': 6,
      '9 Months': 9,
      '12 Months': 12
    };
    const monthOffset = months[subscriptionType] || 0;
    if (monthOffset > 0) {
      date.setMonth(date.getMonth() + monthOffset);
      return date.toISOString();
    }
    return null;
  }

  async generateCode(maxDevices = 10, createdBy = 'admin', username = '', notes = '', accessLevel = 'VIP', subscriptionType = 'Lifetime') {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code = code.slice(0, 4) + '-' + code.slice(4);

    try {
      const now = new Date().toISOString();
      const expiresAt = subscriptionType === 'Lifetime' ? null : this.calculateExpiration(now, subscriptionType);
      
      await this.run(
        `INSERT INTO codes (code, max_devices, created_by, username, notes, access_level, subscription_type, subscription_started_at, expires_at, status, max_hwid_limit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', 1)`,
        [code, maxDevices, createdBy, username.trim(), notes || '', accessLevel, subscriptionType, now, expiresAt]
      );
      
      await this.refreshCache();
      
      console.log(`✅ Code generated: ${code} for user: ${username} (${accessLevel}, ${subscriptionType})`);
      return code;
    } catch (error) {
      console.error('Generate code error:', error);
      throw error;
    }
  }

  async getCodeInfo(code) {
    try {
      return await this.get('SELECT * FROM codes WHERE code = $1', [code]);
    } catch (error) {
      console.error('Get code info error:', error);
      return null;
    }
  }

  async getCodeWithAuth(code, username) {
    try {
      const result = await this.get(
        `SELECT * FROM codes WHERE code = $1 AND username = $2 AND is_active = true`,
        [code, username]
      );
      return result;
    } catch (error) {
      console.error('Get code with auth error:', error);
      return null;
    }
  }

  async validateCodeAccess(code, username) {
    try {
      const codeInfo = await this.getCodeWithAuth(code, username);
      
      if (!codeInfo) {
        return { valid: false, error: 'Invalid code or username' };
      }

      if (!codeInfo.is_active) {
        return { valid: false, error: 'Code is inactive' };
      }

      if (codeInfo.status !== 'active') {
        return { valid: false, error: `Code is ${codeInfo.status}` };
      }

      if (codeInfo.subscription_type !== 'Lifetime' && codeInfo.expires_at) {
        const now = new Date();
        const expires = new Date(codeInfo.expires_at);
        if (now > expires) {
          await this.run(
            `UPDATE codes SET status = 'expired' WHERE code = $1`,
            [code]
          );
          return { valid: false, error: 'Subscription expired' };
        }
      }

      return {
        valid: true,
        username: codeInfo.username,
        access: codeInfo.access_level,
        subscription: codeInfo.subscription_type,
        subscription_started_at: codeInfo.subscription_started_at,
        subscription_expires_at: codeInfo.expires_at,
        status: codeInfo.status
      };
    } catch (error) {
      console.error('Validate code access error:', error);
      return { valid: false, error: 'Validation failed' };
    }
  }

  async getAllCodes() {
    try {
      const result = await this.all(
        `SELECT code, username, access_level, subscription_type, subscription_started_at, expires_at, status, is_active, used_count, created_at, notes, created_by, hwid, fingerprint, max_hwid_limit
         FROM codes ORDER BY created_at DESC`
      );
      return result || [];
    } catch (error) {
      console.error('Get all codes error:', error);
      return this.cache.codes || [];
    }
  }

  async getActiveCodes() {
    try {
      const result = await this.all(
        `SELECT * FROM codes WHERE is_active = true AND status = 'active' ORDER BY created_at DESC`
      );
      return result || [];
    } catch (error) {
      console.error('Get active codes error:', error);
      return this.cache.codes || [];
    }
  }

  async getCodeUsage(code) {
    try {
      const devices = await this.all(
        `SELECT * FROM devices WHERE code = $1 AND status != 'revoked'`,
        [code]
      );
      const codeInfo = await this.getCodeInfo(code);
      return {
        code: code,
        used: devices.length,
        devices: devices,
        username: codeInfo ? codeInfo.username : null,
        access_level: codeInfo ? codeInfo.access_level : null,
        subscription_type: codeInfo ? codeInfo.subscription_type : null,
        status: codeInfo ? codeInfo.status : null
      };
    } catch (error) {
      console.error('Get code usage error:', error);
      return { code, used: 0, devices: [], username: null, access_level: null, subscription_type: null, status: null };
    }
  }

  async deactivateCode(code) {
    try {
      // Get devices first
      const devices = await this.all(
        'SELECT device_id FROM devices WHERE code = $1 AND status != $2',
        [code, 'revoked']
      );
      
      // Remove all HWIDs for this code
      await this.run(
        'DELETE FROM code_hwids WHERE code = $1',
        [code]
      );
      
      // Remove devices
      for (const device of devices) {
        await this.run(
          'DELETE FROM devices WHERE device_id = $1',
          [device.device_id]
        );
        console.log(`🗑️ Removed device: ${device.device_id}`);
      }
      
      // Update code status
      const result = await this.run(
        'UPDATE codes SET is_active = false, status = $1, hwid = NULL WHERE code = $2',
        ['inactive', code]
      );
      
      await this.refreshCache();
      
      if (result.changes > 0) {
        console.log(`✅ Code deactivated: ${code} - ${devices.length} devices removed`);
        return { success: true, devicesRemoved: devices.length };
      }
      return { success: false, devicesRemoved: 0 };
    } catch (error) {
      console.error('Deactivate code error:', error);
      return { success: false, devicesRemoved: 0, error: error.message };
    }
  }

  async reactivateCode(code, subscriptionType = 'Lifetime') {
    try {
      const codeInfo = await this.getCodeInfo(code);
      if (!codeInfo) {
        return { success: false, error: 'Code not found' };
      }

      // Remove all HWIDs if code was inactive
      if (!codeInfo.is_active || codeInfo.status === 'inactive' || codeInfo.status.includes('auto_deactivated')) {
        await this.run(
          'DELETE FROM code_hwids WHERE code = $1',
          [code]
        );
        await this.run(
          'UPDATE codes SET hwid = NULL WHERE code = $1',
          [code]
        );
        console.log(`🔄 HWIDs removed during reactivation of code ${code}`);
      }

      const now = new Date().toISOString();
      const expiresAt = subscriptionType === 'Lifetime' ? null : this.calculateExpiration(now, subscriptionType);
      
      const result = await this.run(
        `UPDATE codes 
         SET is_active = true, 
             status = 'active', 
             subscription_type = $1,
             subscription_started_at = $2,
             expires_at = $3
         WHERE code = $4`,
        [subscriptionType, now, expiresAt, code]
      );
      
      await this.refreshCache();
      
      if (result.changes > 0) {
        console.log(`✅ Code reactivated: ${code} (${subscriptionType})`);
        return { success: true };
      }
      return { success: false };
    } catch (error) {
      console.error('Reactivate code error:', error);
      return { success: false, error: error.message };
    }
  }

  async updateCodeAccess(code, accessLevel) {
    try {
      const result = await this.run(
        'UPDATE codes SET access_level = $1 WHERE code = $2',
        [accessLevel, code]
      );
      
      await this.refreshCache();
      
      if (result.changes > 0) {
        console.log(`✅ Code access updated: ${code} -> ${accessLevel}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Update code access error:', error);
      return false;
    }
  }

  async updateCodeUsername(code, username) {
    try {
      const result = await this.run(
        'UPDATE codes SET username = $1 WHERE code = $2',
        [username.trim(), code]
      );
      
      await this.refreshCache();
      
      if (result.changes > 0) {
        console.log(`✅ Code username updated: ${code} -> ${username}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Update code username error:', error);
      return false;
    }
  }

  async updateCodeSubscription(code, subscriptionType) {
    try {
      const codeInfo = await this.getCodeInfo(code);
      if (!codeInfo) return false;

      const now = new Date().toISOString();
      const expiresAt = subscriptionType === 'Lifetime' ? null : this.calculateExpiration(now, subscriptionType);
      
      const result = await this.run(
        `UPDATE codes 
         SET subscription_type = $1,
             subscription_started_at = $2,
             expires_at = $3,
             status = 'active',
             is_active = true
         WHERE code = $4`,
        [subscriptionType, now, expiresAt, code]
      );
      
      await this.refreshCache();
      
      if (result.changes > 0) {
        console.log(`✅ Code subscription updated: ${code} -> ${subscriptionType}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Update code subscription error:', error);
      return false;
    }
  }

  async deleteCode(code) {
    try {
      await this.run('DELETE FROM code_hwids WHERE code = $1', [code]);
      await this.run('DELETE FROM devices WHERE code = $1', [code]);
      const result = await this.run('DELETE FROM codes WHERE code = $1', [code]);
      
      await this.refreshCache();
      
      if (result.changes > 0) {
        console.log(`🗑️ Code deleted: ${code}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Delete code error:', error);
      return false;
    }
  }

  // ============================================
  // HWID LOGGING
  // ============================================

  async logHwidActivity(hwid, code, deviceId, action, status, details, ip, userAgent, browserProfile) {
    try {
      // Check if HWID is already assigned to a code
      const assigned = await this.get(
        'SELECT code FROM code_hwids WHERE hwid = $1',
        [hwid]
      );
      
      // If HWID has a code, don't log it
      if (assigned && assigned.code) {
        console.log(`ℹ️ Skipping HWID log - HWID already assigned to code: ${assigned.code}`);
        return true;
      }
      
      await this.run(
        `INSERT INTO hwid_logs (hwid, code, device_id, action, status, details, ip_address, user_agent, browser_profile)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [hwid, code, deviceId, action, status || 'new', details || '', ip || '', userAgent || '', browserProfile || '']
      );
      console.log(`📝 HWID Log: ${action} - ${hwid.substring(0, 16)}... (${status || 'new'})`);
      return true;
    } catch (error) {
      console.error('❌ Error logging HWID activity:', error.message);
      return false;
    }
  }

  async getHwidLogs(limit = 200, status = null) {
    try {
      let query = 'SELECT * FROM hwid_logs ORDER BY created_at DESC LIMIT $1';
      const params = [limit];
      
      if (status) {
        query = 'SELECT * FROM hwid_logs WHERE status = $1 ORDER BY created_at DESC LIMIT $2';
        params.unshift(status);
      }
      
      const result = await this.all(query, params);
      return result || [];
    } catch (error) {
      console.error('❌ Get HWID logs error:', error.message);
      return [];
    }
  }

  async getHwidLogsByHwid(hwid, limit = 50) {
    try {
      return await this.all(
        'SELECT * FROM hwid_logs WHERE hwid = $1 ORDER BY created_at DESC LIMIT $2',
        [hwid, limit]
      );
    } catch (error) {
      console.error('❌ Get HWID logs by HWID error:', error.message);
      return [];
    }
  }

  async getHwidLogsCount() {
    try {
      const result = await this.get(
        "SELECT COUNT(*) as count FROM hwid_logs"
      );
      return result ? parseInt(result.count) : 0;
    } catch (error) {
      console.error('❌ Get HWID logs count error:', error.message);
      return 0;
    }
  }

  // ============================================
  // DEVICE MANAGEMENT
  // ============================================

  async getDeviceStatus(deviceId) {
    try {
      const device = await this.getDevice(deviceId);
      if (!device) {
        return { exists: false, status: 'not_found' };
      }
      
      const codeInfo = await this.getCodeInfo(device.code);
      
      return { 
        exists: true, 
        status: device.status,
        code: device.code,
        username: codeInfo ? codeInfo.username : null,
        access: codeInfo ? codeInfo.access_level : null,
        subscription: codeInfo ? codeInfo.subscription_type : null,
        subscription_started_at: codeInfo ? codeInfo.subscription_started_at : null,
        subscription_expires_at: codeInfo ? codeInfo.expires_at : null,
        status_code: codeInfo ? codeInfo.status : null,
        wallpaper: device.wallpaper_name ? {
          name: device.wallpaper_name,
          size_kb: device.wallpaper_size_kb,
          width: device.wallpaper_width,
          height: device.wallpaper_height,
          has_base64: !!device.wallpaper_base64
        } : null,
        device: {
          id: device.device_id,
          approved_at: device.approved_at,
          revoked_at: device.revoked_at
        }
      };
    } catch (error) {
      console.error('Get device status error:', error);
      return { exists: false, status: 'error' };
    }
  }

  async removeUser(deviceId) {
    try {
      const device = await this.getDevice(deviceId);
      if (!device) return false;

      const code = device.code;
      
      const result = await this.run('DELETE FROM devices WHERE device_id = $1', [deviceId]);
      
      if (result.changes > 0) {
        if (code) {
          await this.run('UPDATE codes SET used_count = used_count - 1 WHERE code = $1', [code]);
          await this.logUsage(deviceId, code, 'remove_user', 'User removed, slot freed');
        }
        
        await this.refreshCache();
        
        console.log(`🗑️ User ${deviceId} removed`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Remove user error:', error);
      return false;
    }
  }

  async revokeDevice(deviceId) {
    try {
      const device = await this.getDevice(deviceId);
      if (!device) return false;

      const result = await this.run(
        'UPDATE devices SET status = $1, revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE device_id = $2',
        ['revoked', deviceId]
      );
      
      if (result.changes > 0) {
        if (device.code) {
          await this.run('UPDATE codes SET used_count = used_count - 1 WHERE code = $1', [device.code]);
          await this.logUsage(deviceId, device.code, 'revoke', 'Device revoked');
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('Revoke device error:', error);
      return false;
    }
  }

  async updatePing(deviceId) {
    try {
      await this.run(
        'UPDATE devices SET last_ping = CURRENT_TIMESTAMP, ping_count = ping_count + 1, updated_at = CURRENT_TIMESTAMP WHERE device_id = $1',
        [deviceId]
      );
    } catch (error) {
      console.error('Update ping error:', error);
    }
  }

  // ============================================
  // LOGGING
  // ============================================

  async logUsage(deviceId, code, action, details = '') {
    try {
      await this.run(
        'INSERT INTO usage_logs (device_id, code, action, details) VALUES ($1, $2, $3, $4)',
        [deviceId || 'system', code || null, action, details]
      );
    } catch (error) {
      console.error('Logging error:', error);
    }
  }

  async getUsageLogs(deviceId = null, limit = 100) {
    try {
      let query = 'SELECT * FROM usage_logs';
      const params = [];
      
      if (deviceId) {
        query += ' WHERE device_id = $1';
        params.push(deviceId);
      }
      
      query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
      params.push(limit);
      
      return await this.all(query, params);
    } catch (error) {
      console.error('Get usage logs error:', error);
      return [];
    }
  }

  // ============================================
  // STATS
  // ============================================

  async getStats() {
    try {
      const total = await this.get('SELECT COUNT(*) as count FROM devices');
      const pending = await this.get("SELECT COUNT(*) as count FROM devices WHERE status = 'pending'");
      const approved = await this.get("SELECT COUNT(*) as count FROM devices WHERE status = 'approved'");
      const revoked = await this.get("SELECT COUNT(*) as count FROM devices WHERE status = 'revoked'");
      const totalPings = await this.get('SELECT COALESCE(SUM(ping_count), 0) as total FROM devices');
      const totalCodes = await this.get('SELECT COUNT(*) as count FROM codes');
      const activeCodes = await this.get("SELECT COUNT(*) as count FROM codes WHERE is_active = true AND status = 'active'");
      const pendingRequests = await this.get("SELECT COUNT(*) as count FROM requests WHERE status = 'pending'");

      const stats = {
        total: parseInt(total?.count || 0),
        pending: parseInt(pending?.count || 0),
        approved: parseInt(approved?.count || 0),
        revoked: parseInt(revoked?.count || 0),
        totalPings: parseInt(totalPings?.total || 0),
        totalCodes: parseInt(totalCodes?.count || 0),
        activeCodes: parseInt(activeCodes?.count || 0),
        pendingRequests: parseInt(pendingRequests?.count || 0)
      };
      
      return stats;
    } catch (error) {
      console.error('Get stats error:', error);
      return this.cache.stats || {
        total: 0,
        pending: 0,
        approved: 0,
        revoked: 0,
        totalPings: 0,
        totalCodes: 0,
        activeCodes: 0,
        pendingRequests: 0
      };
    }
  }

  // ============================================
  // ADMIN
  // ============================================

  async createAdmin(username, passwordHash) {
    try {
      const result = await this.run(
        'INSERT INTO admins (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash',
        [username, passwordHash]
      );
      return result;
    } catch (error) {
      console.error('Create admin error:', error);
      return null;
    }
  }

  async getAdmin(username) {
    try {
      return await this.get('SELECT * FROM admins WHERE username = $1', [username]);
    } catch (error) {
      console.error('Get admin error:', error);
      return null;
    }
  }

  // ============================================
  // REQUEST MANAGEMENT
  // ============================================

  async getPendingRequests() {
    try {
      return await this.all(
        'SELECT r.*, d.status as device_status FROM requests r LEFT JOIN devices d ON r.device_id = d.device_id WHERE r.status = $1 ORDER BY r.requested_at ASC',
        ['pending']
      );
    } catch (error) {
      console.error('Get pending requests error:', error);
      return this.cache.requests || [];
    }
  }

  async respondToRequest(requestId, status, adminResponse = '') {
    const request = await this.get('SELECT * FROM requests WHERE id = $1', [requestId]);
    if (!request) return false;

    const result = await this.run(
      'UPDATE requests SET status = $1, responded_at = CURRENT_TIMESTAMP, admin_response = $2 WHERE id = $3',
      [status, adminResponse, requestId]
    );
    
    if (result.changes > 0) {
      await this.logUsage(request.device_id, request.code, 'request_response', 
        `Request ${status}: ${adminResponse}`);
      
      if (status === 'approved' && request.code) {
        const codeInfo = await this.getCodeInfo(request.code);
        if (codeInfo) {
          const newLimit = codeInfo.max_devices + 1;
          await this.updateCodeAccess(request.code, newLimit);
          await this.logUsage(request.device_id, request.code, 'code_extended', 
            `Extended to ${newLimit} devices due to request`);
        }
      }
      return true;
    }
    return false;
  }

  // ============================================
  // CACHE
  // ============================================

  async refreshCache() {
    try {
      console.log('🔄 Refreshing cache...');
      
      const [codes, stats, devices, requests] = await Promise.all([
        this.getAllCodes(),
        this.getStats(),
        this.getDevices(),
        this.getPendingRequests()
      ]);
      
      if (codes !== null && codes !== undefined) {
        if (codes.length > 0) {
          this.cache.codes = codes;
          console.log(`✅ Updated codes cache with ${codes.length} codes`);
        } else if (codes.length === 0 && this.cache.hasInitialData) {
          console.log(`⚠️ Database returned 0 codes, keeping existing ${this.cache.codes.length} codes in cache`);
        } else if (codes.length === 0 && !this.cache.hasInitialData) {
          this.cache.codes = [];
          console.log('ℹ️ First load, no codes found');
        }
      }
      
      if (stats !== null && stats !== undefined && Object.keys(stats).length > 0) {
        this.cache.stats = stats;
      }
      
      if (devices !== null && devices !== undefined) {
        if (devices.length > 0 || !this.cache.hasInitialData) {
          this.cache.devices = devices;
        } else {
          console.log(`⚠️ Database returned 0 devices, keeping existing ${this.cache.devices.length} devices in cache`);
        }
      }
      
      if (requests !== null && requests !== undefined) {
        if (requests.length > 0 || !this.cache.hasInitialData) {
          this.cache.requests = requests;
        }
      }
      
      this.cache.lastUpdate = Date.now();
      this.cache.hasInitialData = true;
      
      console.log(`✅ Cache: ${this.cache.codes.length} codes, ${this.cache.devices.length} devices`);
      
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

  // ============================================
  // CLEANUP
  // ============================================

  async cleanupInactiveDevices() {
    try {
      const result = await this.query(`
        DELETE FROM devices 
        WHERE last_ping < NOW() - INTERVAL '7 days'
        AND status != 'revoked'
        RETURNING device_id, code
      `);
      
      if (result.rowCount > 0) {
        console.log(`🧹 Cleaned up ${result.rowCount} inactive devices`);
        
        for (const row of result.rows) {
          await this.query(
            `UPDATE codes SET used_count = used_count - 1 WHERE code = $1`,
            [row.code]
          );
        }
      }
      
      return result.rowCount;
    } catch (error) {
      console.error('Cleanup inactive devices error:', error);
      return 0;
    }
  }

  close() {
    this.pool.end();
  }
}

module.exports = new DeviceDatabase();