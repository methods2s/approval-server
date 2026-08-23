// database-pg.js
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
          hwid TEXT UNIQUE,
          fingerprint TEXT,
          machine_info JSONB,
          hwid_limit INTEGER DEFAULT 1,
          hwid_count INTEGER DEFAULT 0,
          hwid_whitelist TEXT[] DEFAULT ARRAY[]::TEXT[]
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
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

      // Create indexes
      await this.query(`CREATE INDEX IF NOT EXISTS idx_codes_hwid ON codes(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_devices_hwid ON devices(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_codes_username ON codes(username)`);

      console.log('✅ Tables created/verified');
      
      await this.refreshCache();
      
    } catch (error) {
      console.error('❌ Failed to create tables:', error.message);
    }
  }

  // ============================================
  // HWID MANAGEMENT - MULTI-DEVICE SUPPORT
  // ============================================

  async updateCodeHwidLimit(code, hwidLimit) {
    try {
      const result = await this.run(
        'UPDATE codes SET hwid_limit = $1 WHERE code = $2',
        [hwidLimit, code]
      );
      
      if (result.changes > 0) {
        console.log(`✅ HWID limit updated: ${code} -> ${hwidLimit}`);
        await this.refreshCache();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Update HWID limit error:', error);
      return false;
    }
  }

  async registerHwidToCode(code, hwid) {
    try {
      const codeInfo = await this.getCodeInfo(code);
      if (!codeInfo) {
        return { success: false, error: 'Code not found' };
      }
      
      // Check if HWID is already in whitelist
      const isInWhitelist = codeInfo.hwid_whitelist && codeInfo.hwid_whitelist.includes(hwid);
      if (isInWhitelist) {
        return { success: true, message: 'HWID already registered', already_registered: true };
      }
      
      // Check if limit is reached
      const currentCount = codeInfo.hwid_whitelist ? codeInfo.hwid_whitelist.length : 0;
      const limit = codeInfo.hwid_limit || 1;
      
      if (currentCount >= limit) {
        return { 
          success: false, 
          error: `HWID limit reached (${limit}/${limit})`,
          limit_reached: true,
          limit: limit,
          current: currentCount
        };
      }
      
      // Add HWID to whitelist
      await this.run(
        `UPDATE codes 
         SET hwid_whitelist = array_append(hwid_whitelist, $1),
             hwid_count = hwid_count + 1
         WHERE code = $2`,
        [hwid, code]
      );
      
      await this.logUsage('system', code, 'hwid_registered', 
        `HWID registered to code ${code} (${currentCount + 1}/${limit})`);
      
      await this.refreshCache();
      
      return {
        success: true,
        message: `HWID registered successfully (${currentCount + 1}/${limit})`,
        current: currentCount + 1,
        limit: limit
      };
    } catch (error) {
      console.error('Register HWID error:', error);
      return { success: false, error: error.message };
    }
  }

  async removeHwidFromCode(code, hwid) {
    try {
      const codeInfo = await this.getCodeInfo(code);
      if (!codeInfo) {
        return { success: false, error: 'Code not found' };
      }
      
      const isInWhitelist = codeInfo.hwid_whitelist && codeInfo.hwid_whitelist.includes(hwid);
      if (!isInWhitelist) {
        return { success: false, error: 'HWID not found in whitelist' };
      }
      
      await this.run(
        `UPDATE codes 
         SET hwid_whitelist = array_remove(hwid_whitelist, $1),
             hwid_count = hwid_count - 1
         WHERE code = $2`,
        [hwid, code]
      );
      
      // Also revoke devices with this HWID and code
      await this.run(
        `UPDATE devices 
         SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP 
         WHERE code = $1 AND hwid = $2`,
        [code, hwid]
      );
      
      await this.logUsage('system', code, 'hwid_removed', 
        `HWID removed from code ${code}`);
      
      await this.refreshCache();
      
      return {
        success: true,
        message: 'HWID removed successfully'
      };
    } catch (error) {
      console.error('Remove HWID error:', error);
      return { success: false, error: error.message };
    }
  }

  async getCodeHwids(code) {
    try {
      const codeInfo = await this.getCodeInfo(code);
      if (!codeInfo) {
        return { success: false, error: 'Code not found' };
      }
      
      const hwids = codeInfo.hwid_whitelist || [];
      const masked = hwids.map(h => h.substring(0, 16) + '...');
      
      return {
        success: true,
        hwids: masked,
        count: hwids.length,
        limit: codeInfo.hwid_limit || 1,
        full_list: hwids
      };
    } catch (error) {
      console.error('Get HWIDs error:', error);
      return { success: false, error: error.message };
    }
  }

  async getCodeHwidDetails(code) {
    try {
      const codeInfo = await this.getCodeInfo(code);
      if (!codeInfo) {
        return { count: 0, limit: 1, hwids: [] };
      }
      
      const hwids = codeInfo.hwid_whitelist || [];
      return {
        count: hwids.length,
        limit: codeInfo.hwid_limit || 1,
        hwids: hwids.map(h => h.substring(0, 16) + '...'),
        full_hwids: hwids
      };
    } catch (error) {
      console.error('Get HWID details error:', error);
      return { count: 0, limit: 1, hwids: [] };
    }
  }

  async verifyHwidAccess(code, hwid) {
    try {
      const codeInfo = await this.getCodeInfo(code);
      if (!codeInfo) {
        return { valid: false, error: 'Code not found' };
      }
      
      if (!codeInfo.is_active) {
        return { valid: false, error: 'Code is inactive' };
      }
      
      // Check if HWID is in whitelist
      const isInWhitelist = codeInfo.hwid_whitelist && codeInfo.hwid_whitelist.includes(hwid);
      
      if (!isInWhitelist) {
        // Check if there's still room in the whitelist
        const currentCount = codeInfo.hwid_whitelist ? codeInfo.hwid_whitelist.length : 0;
        const limit = codeInfo.hwid_limit || 1;
        
        if (currentCount < limit) {
          // Auto-register this HWID
          const registerResult = await this.registerHwidToCode(code, hwid);
          return {
            valid: true,
            registered: true,
            message: `HWID auto-registered (${currentCount + 1}/${limit})`,
            current: currentCount + 1,
            limit: limit,
            username: codeInfo.username,
            access: codeInfo.access_level,
            subscription: codeInfo.subscription_type,
            subscription_started_at: codeInfo.subscription_started_at,
            subscription_expires_at: codeInfo.expires_at
          };
        }
        
        return { 
          valid: false, 
          error: `HWID not authorized. Limit reached (${currentCount}/${limit})`,
          limit_reached: true,
          current: currentCount,
          limit: limit
        };
      }
      
      return {
        valid: true,
        registered: false,
        username: codeInfo.username,
        access: codeInfo.access_level,
        subscription: codeInfo.subscription_type,
        subscription_started_at: codeInfo.subscription_started_at,
        subscription_expires_at: codeInfo.expires_at,
        status_code: codeInfo.status,
        hwid_count: codeInfo.hwid_count || 0,
        hwid_limit: codeInfo.hwid_limit || 1
      };
    } catch (error) {
      console.error('Verify HWID access error:', error);
      return { valid: false, error: 'Verification failed' };
    }
  }

  // ============================================
  // CODE MANAGEMENT
  // ============================================

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
        `INSERT INTO codes (code, max_devices, created_by, username, notes, access_level, subscription_type, subscription_started_at, expires_at, status, hwid_limit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10)`,
        [code, maxDevices, createdBy, username.trim(), notes || '', accessLevel, subscriptionType, now, expiresAt, 1]
      );
      
      await this.refreshCache();
      
      console.log(`✅ Code generated: ${code} for user: ${username} (${accessLevel}, ${subscriptionType})`);
      return code;
    } catch (error) {
      console.error('Generate code error:', error);
      throw error;
    }
  }

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

  async getCodeInfo(code) {
    try {
      return await this.get('SELECT * FROM codes WHERE code = $1', [code]);
    } catch (error) {
      console.error('Get code info error:', error);
      return null;
    }
  }

  async getAllCodes() {
    try {
      const result = await this.all(
        `SELECT code, username, access_level, subscription_type, subscription_started_at, expires_at, status, is_active, used_count, created_at, notes, created_by, hwid, fingerprint, hwid_limit, hwid_count, hwid_whitelist
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

  async deactivateCode(code) {
    try {
      const devices = await this.all(
        'SELECT device_id FROM devices WHERE code = $1 AND status != $2',
        [code, 'revoked']
      );
      
      for (const device of devices) {
        await this.run(
          'DELETE FROM devices WHERE device_id = $1',
          [device.device_id]
        );
        console.log(`🗑️ Removed device: ${device.device_id}`);
      }
      
      const result = await this.run(
        'UPDATE codes SET is_active = false, status = $1 WHERE code = $2',
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

  async deleteCode(code) {
    try {
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
  // DEVICE MANAGEMENT
  // ============================================

  async registerDeviceWithCode(deviceId, userAgent, ip, browserInfo, code, hwid = null) {
    try {
      const codeInfo = await this.getCodeInfo(code);
      if (!codeInfo) {
        return { success: false, error: 'Invalid code' };
      }

      if (!codeInfo.is_active) {
        return { success: false, error: 'Code is inactive' };
      }

      // If HWID is provided, verify access
      if (hwid) {
        const accessResult = await this.verifyHwidAccess(code, hwid);
        if (!accessResult.valid) {
          return { 
            success: false, 
            error: accessResult.error,
            limit_reached: accessResult.limit_reached,
            current: accessResult.current,
            limit: accessResult.limit
          };
        }
      }

      // Check subscription expiration
      if (codeInfo.subscription_type !== 'Lifetime' && codeInfo.expires_at) {
        const now = new Date();
        const expires = new Date(codeInfo.expires_at);
        if (now > expires) {
          await this.run(
            `UPDATE codes SET status = 'expired' WHERE code = $1`,
            [code]
          );
          return { success: false, error: 'Subscription expired' };
        }
      }

      if (codeInfo.status !== 'active') {
        return { success: false, error: `Code is ${codeInfo.status}` };
      }

      // Check if device already exists
      const existingDevice = await this.getDevice(deviceId);
      if (existingDevice) {
        if (existingDevice.code === code) {
          // Update device info
          await this.run(
            `UPDATE devices 
             SET status = $1, user_agent = $2, ip_address = $3, browser_info = $4, 
                 approved_at = CURRENT_TIMESTAMP, revoked_at = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE device_id = $5`,
            ['approved', userAgent || '', ip || '', browserInfo || '', deviceId]
          );
          
          if (hwid) {
            await this.run('UPDATE devices SET hwid = $1 WHERE device_id = $2', [hwid, deviceId]);
          }
          
          await this.logUsage(deviceId, code, 're-register', 'Device re-registered');
          await this.refreshCache();
          
          const hwidDetails = await this.getCodeHwidDetails(code);
          
          return { 
            success: true, 
            status: 'approved', 
            code: code,
            username: codeInfo.username,
            access: codeInfo.access_level,
            subscription: codeInfo.subscription_type,
            subscription_started_at: codeInfo.subscription_started_at,
            subscription_expires_at: codeInfo.expires_at,
            status_code: codeInfo.status,
            hwid_limit: hwidDetails.limit || 1,
            hwid_used: hwidDetails.count || 0
          };
        }
      }

      // Check HWID limit
      const hwidCount = codeInfo.hwid_whitelist ? codeInfo.hwid_whitelist.length : 0;
      const hwidLimit = codeInfo.hwid_limit || 1;
      
      if (hwidCount >= hwidLimit) {
        return { 
          success: false, 
          error: `Device limit reached (${hwidCount}/${hwidLimit})`,
          limit_reached: true,
          current: hwidCount,
          limit: hwidLimit
        };
      }

      // Register new device
      await this.run(
        `INSERT INTO devices (device_id, user_agent, ip_address, browser_info, code, status, approved_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [deviceId, userAgent || '', ip || '', browserInfo || '', code, 'approved']
      );

      if (hwid) {
        await this.run('UPDATE devices SET hwid = $1 WHERE device_id = $2', [hwid, deviceId]);
      }

      // Auto-register HWID if not already
      if (hwid && !(codeInfo.hwid_whitelist && codeInfo.hwid_whitelist.includes(hwid))) {
        await this.registerHwidToCode(code, hwid);
      }

      await this.run('UPDATE codes SET used_count = used_count + 1 WHERE code = $1', [code]);
      await this.logUsage(deviceId, code, 'register', 'Device registered and auto-approved');
      
      await this.refreshCache();
      
      const hwidDetails = await this.getCodeHwidDetails(code);
      
      return { 
        success: true, 
        status: 'approved', 
        code: code,
        username: codeInfo.username,
        access: codeInfo.access_level,
        subscription: codeInfo.subscription_type,
        subscription_started_at: codeInfo.subscription_started_at,
        subscription_expires_at: codeInfo.expires_at,
        status_code: codeInfo.status,
        hwid_limit: hwidDetails.limit || 1,
        hwid_used: hwidDetails.count || 0
      };
    } catch (error) {
      console.error('Register device error:', error);
      return { success: false, error: error.message };
    }
  }

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
      return await this.all('SELECT * FROM devices WHERE code = $1 ORDER BY created_at DESC', [code]);
    } catch (error) {
      console.error('Get devices by code error:', error);
      return [];
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
  // CACHE
  // ============================================

  async refreshCache() {
    try {
      console.log('🔄 Refreshing cache...');
      
      const [codes, stats, devices] = await Promise.all([
        this.getAllCodes(),
        this.getStats(),
        this.getDevices()
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

  close() {
    this.pool.end();
  }
}

module.exports = new DeviceDatabase();