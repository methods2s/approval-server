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

  async initTables() {
    try {
      // Codes table with HWID support
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
          machine_info JSONB
        )
      `);

      // Add missing columns if they don't exist
      const columnsToAdd = [
        { name: 'username', type: 'TEXT' },
        { name: 'access_level', type: 'TEXT DEFAULT \'VIP\'' },
        { name: 'subscription_type', type: 'TEXT DEFAULT \'Lifetime\'' },
        { name: 'subscription_started_at', type: 'TIMESTAMP' },
        { name: 'expires_at', type: 'TIMESTAMP' },
        { name: 'status', type: 'TEXT DEFAULT \'active\'' },
        { name: 'hwid', type: 'TEXT UNIQUE' },
        { name: 'fingerprint', type: 'TEXT' },
        { name: 'machine_info', type: 'JSONB' }
      ];

      for (const col of columnsToAdd) {
        try {
          await this.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
        } catch (e) {
          // Column might already exist
        }
      }

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

      // Add hwid to devices if not exists
      try {
        await this.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS hwid TEXT`);
      } catch (e) {}

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
  // AUTO-DEACTIVATE CODE WITH REASON
  // ============================================

  async autoDeactivateCode(code, reason = 'unauthorized_use') {
    try {
        // Deactivate the code
        await this.run(
            'UPDATE codes SET is_active = false, status = $1 WHERE code = $2',
            ['auto_deactivated', code]
        );
        
        // Get all devices using this code
        const devices = await this.all(
            'SELECT device_id FROM devices WHERE code = $1',
            [code]
        );
        
        // Revoke all devices
        for (const dev of devices) {
            await this.run(
                'UPDATE devices SET status = $1, revoked_at = CURRENT_TIMESTAMP WHERE device_id = $2',
                ['revoked', dev.device_id]
            );
            await this.logUsage(
                dev.device_id, 
                code, 
                'auto_revoked', 
                `🔒 Device auto-revoked due to ${reason}`
            );
        }
        
        await this.logUsage(
            'system', 
            code, 
            'auto_deactivated', 
            `🔒 Code ${code} auto-deactivated due to ${reason}`
        );
        
        await this.refreshCache();
        
        return {
            success: true,
            code: code,
            devices_revoked: devices.length,
            reason: reason
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
  // AUTO-DETECT UNAUTHORIZED HWID USAGE
  // ============================================

  async autoDetectUnauthorizedUsage(code, newHwid, deviceId) {
    try {
      // Get the code info
      const codeInfo = await this.get('SELECT * FROM codes WHERE code = $1', [code]);
      
      if (!codeInfo) {
        return { 
          detected: false, 
          message: 'Code not found' 
        };
      }
      
      // Check if the code is already assigned to a different HWID
      if (codeInfo.hwid && codeInfo.hwid !== newHwid) {
        console.log(`🚨 UNAUTHORIZED USAGE DETECTED!`);
        console.log(`📌 Code: ${code}`);
        console.log(`🖥️ Original HWID: ${codeInfo.hwid.substring(0, 16)}...`);
        console.log(`🖥️ Attempted HWID: ${newHwid.substring(0, 16)}...`);
        console.log(`📱 Device: ${deviceId}`);
        
        // Log the unauthorized attempt
        await this.logUsage(
          deviceId, 
          code, 
          'unauthorized_attempt', 
          `⚠️ UNAUTHORIZED: Code ${code} attempted on different computer. Original HWID: ${codeInfo.hwid.substring(0, 16)}..., Attempted HWID: ${newHwid.substring(0, 16)}...`
        );
        
        // AUTO-DEACTIVATE the code
        const result = await this.autoDeactivateCode(code, 'unauthorized_use');
        
        return {
          detected: true,
          action: 'deactivated',
          code: code,
          original_hwid: codeInfo.hwid,
          attempted_hwid: newHwid,
          devices_revoked: result.devices_revoked || 0,
          message: `⚠️ UNAUTHORIZED! Code ${code} has been auto-deactivated. ${result.devices_revoked || 0} devices revoked.`
        };
      }
      
      // Check if HWID is already used by another code
      const existingHwid = await this.get(
        'SELECT * FROM codes WHERE hwid = $1 AND code != $2',
        [newHwid, code]
      );
      
      if (existingHwid) {
        console.log(`🚨 HWID ALREADY REGISTERED TO ANOTHER CODE!`);
        console.log(`🖥️ HWID: ${newHwid.substring(0, 16)}...`);
        console.log(`📌 Existing Code: ${existingHwid.code}`);
        
        await this.logUsage(
          deviceId, 
          code, 
          'hwid_already_registered', 
          `⚠️ HWID ${newHwid.substring(0, 16)}... already registered to code ${existingHwid.code}`
        );
        
        return {
          detected: true,
          action: 'blocked',
          code: code,
          existing_code: existingHwid.code,
          message: `⚠️ This computer is already registered to code: ${existingHwid.code}`
        };
      }
      
      return {
        detected: false,
        message: 'No unauthorized usage detected'
      };
      
    } catch (error) {
      console.error('Auto-detect unauthorized usage error:', error);
      return { 
        detected: false, 
        error: error.message 
      };
    }
  }

  // ============================================
  // HWID CODE MANAGEMENT
  // ============================================

  async getCodeByHwid(hwid) {
    try {
      return await this.get(
        'SELECT * FROM codes WHERE hwid = $1 AND is_active = true',
        [hwid]
      );
    } catch (error) {
      console.error('Get code by HWID error:', error);
      return null;
    }
  }

  async verifyHwidCode(code, hwid) {
    try {
      const result = await this.get(
        'SELECT * FROM codes WHERE code = $1 AND hwid = $2 AND is_active = true',
        [code, hwid]
      );
      
      if (!result) {
        return { valid: false, error: 'Invalid HWID/code combination' };
      }
      
      // Check expiration
      if (result.subscription_type !== 'Lifetime' && result.expires_at) {
        const now = new Date();
        const expires = new Date(result.expires_at);
        if (now > expires) {
          await this.run(`UPDATE codes SET status = 'expired' WHERE code = $1`, [code]);
          return { valid: false, error: 'Subscription expired' };
        }
      }
      
      return {
        valid: true,
        username: result.username,
        access: result.access_level,
        subscription: result.subscription_type,
        subscription_started_at: result.subscription_started_at,
        subscription_expires_at: result.expires_at,
        status_code: result.status
      };
    } catch (error) {
      console.error('Verify HWID code error:', error);
      return { valid: false, error: 'Verification failed' };
    }
  }

  async addHwidCode(code, hwid, fingerprint, username, accessLevel = 'VIP', subscriptionType = 'Lifetime', createdBy = 'admin') {
    try {
      // Check if HWID already has a code
      const existing = await this.getCodeByHwid(hwid);
      if (existing) {
        return {
          success: false,
          error: `This computer is already registered with code: ${existing.code}`,
          existing_code: existing.code
        };
      }
      
      // Check if code already exists
      const existingCode = await this.get('SELECT * FROM codes WHERE code = $1', [code]);
      if (existingCode) {
        return {
          success: false,
          error: `Code ${code} already exists`
        };
      }
      
      const now = new Date().toISOString();
      const expiresAt = subscriptionType === 'Lifetime' ? null : this.calculateExpiration(now, subscriptionType);
      
      await this.run(
        `INSERT INTO codes (code, hwid, fingerprint, username, max_devices, created_by, notes, access_level, subscription_type, subscription_started_at, expires_at, status, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', true)`,
        [code, hwid, fingerprint || hwid.substring(0, 16) + '...', username.trim(), 10, createdBy, `HWID: ${fingerprint || hwid.substring(0, 16)}`, accessLevel, subscriptionType, now, expiresAt]
      );
      
      await this.logUsage('admin', code, 'hwid_code_added', 
        `HWID code ${code} added for ${username} by ${createdBy}`);
      
      await this.refreshCache();
      
      return {
        success: true,
        code: code,
        username: username,
        hwid: hwid,
        fingerprint: fingerprint,
        access: accessLevel,
        subscription: subscriptionType,
        expires_at: expiresAt
      };
      
    } catch (error) {
      console.error('Add HWID code error:', error);
      return { success: false, error: error.message };
    }
  }

  async getHwidCodes() {
    try {
      return await this.all(`
        SELECT code, hwid, fingerprint, username, access_level, subscription_type, 
               is_active, used_count, created_at, expires_at, status, created_by
        FROM codes 
        WHERE hwid IS NOT NULL
        ORDER BY created_at DESC
      `);
    } catch (error) {
      console.error('Get HWID codes error:', error);
      return [];
    }
  }

  // ============================================
  // CLEANUP INACTIVE DEVICES
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
        `INSERT INTO codes (code, max_devices, created_by, username, notes, access_level, subscription_type, subscription_started_at, expires_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')`,
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
        `SELECT code, username, access_level, subscription_type, subscription_started_at, expires_at, status, is_active, used_count, created_at, notes, created_by, hwid, fingerprint
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

  async reactivateCode(code, subscriptionType = 'Lifetime') {
    try {
      const codeInfo = await this.getCodeInfo(code);
      if (!codeInfo) {
        return { success: false, error: 'Code not found' };
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
  // DEVICE REGISTRATION WITH HWID
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

      // If HWID is provided, verify it matches
      if (hwid) {
        const hwidCheck = await this.verifyHwidCode(code, hwid);
        if (!hwidCheck.valid) {
          return { success: false, error: 'This code is not registered to this computer' };
        }
      }

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

      const existingDevice = await this.getDevice(deviceId);
      if (existingDevice) {
        if (existingDevice.code === code) {
          await this.run(
            'UPDATE devices SET status = $1, user_agent = $2, ip_address = $3, browser_info = $4, approved_at = CURRENT_TIMESTAMP, revoked_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE device_id = $5',
            ['approved', userAgent || '', ip || '', browserInfo || '', deviceId]
          );
          if (hwid) {
            await this.run('UPDATE devices SET hwid = $1 WHERE device_id = $2', [hwid, deviceId]);
          }
          await this.logUsage(deviceId, code, 're-register', 'Device re-registered');
          
          await this.refreshCache();
          
          return { 
            success: true, 
            status: 'approved', 
            code: code,
            username: codeInfo.username,
            access: codeInfo.access_level,
            subscription: codeInfo.subscription_type,
            subscription_started_at: codeInfo.subscription_started_at,
            subscription_expires_at: codeInfo.expires_at,
            status_code: codeInfo.status
          };
        }
      }

      await this.run(
        'INSERT INTO devices (device_id, user_agent, ip_address, browser_info, code, status, approved_at) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)',
        [deviceId, userAgent || '', ip || '', browserInfo || '', code, 'approved']
      );

      if (hwid) {
        await this.run('UPDATE devices SET hwid = $1 WHERE device_id = $2', [hwid, deviceId]);
      }

      await this.run('UPDATE codes SET used_count = used_count + 1 WHERE code = $1', [code]);
      await this.logUsage(deviceId, code, 'register', 'Device registered and auto-approved');
      
      await this.refreshCache();
      
      return { 
        success: true, 
        status: 'approved', 
        code: code,
        username: codeInfo.username,
        access: codeInfo.access_level,
        subscription: codeInfo.subscription_type,
        subscription_started_at: codeInfo.subscription_started_at,
        subscription_expires_at: codeInfo.expires_at,
        status_code: codeInfo.status
      };
    } catch (error) {
      console.error('Register device error:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // DEVICE MANAGEMENT
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

  close() {
    this.pool.end();
  }
}

module.exports = new DeviceDatabase();