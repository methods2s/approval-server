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
      // Codes table with hardware specs columns
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
          max_hwid_limit INTEGER DEFAULT 1,
          cpu_name TEXT,
          gpu_name TEXT,
          ram_total_gb DECIMAL,
          storage_total_gb DECIMAL,
          device_name TEXT,
          profile_name TEXT
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
        { name: 'hwid', type: 'TEXT' },
        { name: 'fingerprint', type: 'TEXT' },
        { name: 'machine_info', type: 'JSONB' },
        { name: 'max_hwid_limit', type: 'INTEGER DEFAULT 1' },
        { name: 'cpu_name', type: 'TEXT' },
        { name: 'gpu_name', type: 'TEXT' },
        { name: 'ram_total_gb', type: 'DECIMAL' },
        { name: 'storage_total_gb', type: 'DECIMAL' },
        { name: 'device_name', type: 'TEXT' },
        { name: 'profile_name', type: 'TEXT' }
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

      // Devices table - simplified
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
          browser_profile TEXT
        )
      `);

      // Add device columns if not exist
      const deviceColumns = [
        { name: 'hwid', type: 'TEXT' },
        { name: 'browser_profile', type: 'TEXT' }
      ];

      for (const col of deviceColumns) {
        try {
          await this.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
        } catch (e) {
          // Column might already exist
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

      // Indexes
      await this.query(`CREATE INDEX IF NOT EXISTS idx_codes_hwid ON codes(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_devices_hwid ON devices(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_codes_username ON codes(username)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_code_hwids_code ON code_hwids(code)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_code_hwids_hwid ON code_hwids(hwid)`);

      console.log('✅ Tables created/verified');
      
      await this.refreshCache();
      
    } catch (error) {
      console.error('❌ Failed to create tables:', error.message);
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
      return await this.all(
        'SELECT hwid, assigned_at, last_used FROM code_hwids WHERE code = $1 ORDER BY assigned_at DESC',
        [code]
      );
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

      await this.refreshCache();
      return { success: true, message: 'HWID assigned successfully', auto_assigned: autoAssign };
    } catch (error) {
      console.error('Assign HWID error:', error);
      return { success: false, error: error.message };
    }
  }

  async removeHwidFromCode(code, hwid) {
    try {
      const count = await this.getCodeHwidCount(code);
      if (count <= 1) {
        return { 
          success: false, 
          error: 'Cannot remove the last HWID. Deactivate the code first.' 
        };
      }

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
        }
        await this.refreshCache();
        return { success: true, message: 'HWID removed successfully' };
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
        `SELECT code, username, access_level, subscription_type, subscription_started_at, expires_at, status, is_active, used_count, created_at, notes, created_by, hwid, fingerprint, max_hwid_limit, cpu_name, gpu_name, ram_total_gb, storage_total_gb, device_name, profile_name
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
        status: codeInfo ? codeInfo.status : null,
        cpu: codeInfo ? codeInfo.cpu_name : null,
        gpu: codeInfo ? codeInfo.gpu_name : null,
        ram: codeInfo ? codeInfo.ram_total_gb : null,
        storage: codeInfo ? codeInfo.storage_total_gb : null,
        device: codeInfo ? codeInfo.device_name : null,
        profile: codeInfo ? codeInfo.profile_name : null
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
  // DEVICE REGISTRATION
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
            status_code: codeInfo.status,
            hwid_auto_assigned: !isAuthorized
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
        status_code: codeInfo.status,
        hwid_auto_assigned: !isAuthorized
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