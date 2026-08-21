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
      await this.query(`
        CREATE TABLE IF NOT EXISTS codes (
          code TEXT PRIMARY KEY,
          max_devices INTEGER DEFAULT 10,
          used_count INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT TRUE,
          created_by TEXT,
          username TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          notes TEXT
        )
      `);

      // Add username column if it doesn't exist
      try {
        await this.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS username TEXT`);
        console.log('✅ Username column verified');
      } catch (e) {
        console.log('ℹ️ Username column already exists or could not be added');
      }

      await this.query(`
        CREATE TABLE IF NOT EXISTS devices (
          id SERIAL PRIMARY KEY,
          device_id TEXT UNIQUE NOT NULL,
          user_agent TEXT,
          ip_address TEXT,
          browser_info TEXT,
          code TEXT,
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

      console.log('✅ Tables created/verified');
      
      await this.refreshCache();
      
    } catch (error) {
      console.error('❌ Failed to create tables:', error.message);
    }
  }

  async usernameColumnExists() {
    try {
      const result = await this.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'codes' AND column_name = 'username'
      `);
      return result.rows.length > 0;
    } catch (error) {
      return false;
    }
  }

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

  async getCachedCodes() {
    if (!this.cache.hasInitialData) {
      await this.refreshCache();
    }
    return this.cache.codes || [];
  }

  async getCachedStats() {
    if (!this.cache.hasInitialData) {
      await this.refreshCache();
    }
    return this.cache.stats || { total: 0, approved: 0, revoked: 0, totalPings: 0, totalCodes: 0, activeCodes: 0, pendingRequests: 0 };
  }

  async getCachedDevices() {
    if (!this.cache.hasInitialData) {
      await this.refreshCache();
    }
    return this.cache.devices || [];
  }

  async getCachedRequests() {
    if (!this.cache.hasInitialData) {
      await this.refreshCache();
    }
    return this.cache.requests || [];
  }

  async generateCode(maxDevices = 10, createdBy = 'admin', username = '', notes = '') {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code = code.slice(0, 4) + '-' + code.slice(4);

    try {
      await this.run(
        'INSERT INTO codes (code, max_devices, created_by, username, notes) VALUES ($1, $2, $3, $4, $5)',
        [code, maxDevices, createdBy, username, notes || '']
      );
      
      await this.refreshCache();
      
      console.log(`✅ Code generated: ${code} for user: ${username}`);
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

  async getAllCodes() {
    try {
      const result = await this.all('SELECT * FROM codes ORDER BY created_at DESC');
      return result || [];
    } catch (error) {
      console.error('Get all codes error:', error);
      return this.cache.codes || [];
    }
  }

  async getActiveCodes() {
    try {
      const result = await this.all(
        'SELECT * FROM codes WHERE is_active = true ORDER BY created_at DESC'
      );
      return result || [];
    } catch (error) {
      console.error('Get active codes error:', error);
      return this.cache.codes || [];
    }
  }

  async getPendingCodeRequests() {
    try {
      return await this.all(
        'SELECT * FROM requests WHERE code IS NULL AND status = $1 ORDER BY requested_at DESC',
        ['pending']
      );
    } catch (error) {
      console.error('Get pending code requests error:', error);
      return [];
    }
  }

  async getCodeUsage(code) {
    try {
      const devices = await this.all(
        'SELECT * FROM devices WHERE code = $1 AND status != $2',
        [code, 'revoked']
      );
      const codeInfo = await this.getCodeInfo(code);
      return {
        code: code,
        used: devices.length,
        max: codeInfo ? codeInfo.max_devices : 0,
        devices: devices
      };
    } catch (error) {
      console.error('Get code usage error:', error);
      return { code, used: 0, max: 0, devices: [] };
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
        'UPDATE codes SET is_active = false, used_count = 0 WHERE code = $1',
        [code]
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

  async extendCode(code, maxDevices) {
    try {
      const result = await this.run(
        'UPDATE codes SET max_devices = $1, is_active = true WHERE code = $2',
        [maxDevices, code]
      );
      
      await this.refreshCache();
      
      if (result.changes > 0) {
        console.log(`✅ Code extended: ${code} -> max ${maxDevices} devices`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Extend code error:', error);
      return false;
    }
  }

  async registerDeviceWithCode(deviceId, userAgent, ip, browserInfo, code) {
    try {
      const codeInfo = await this.getCodeInfo(code);
      if (!codeInfo) {
        return { success: false, error: 'Invalid code' };
      }

      if (!codeInfo.is_active) {
        return { success: false, error: 'Code is inactive' };
      }

      const existingDevice = await this.getDevice(deviceId);
      if (existingDevice) {
        if (existingDevice.code === code) {
          await this.run(
            'UPDATE devices SET status = $1, user_agent = $2, ip_address = $3, browser_info = $4, approved_at = CURRENT_TIMESTAMP, revoked_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE device_id = $5',
            ['approved', userAgent || '', ip || '', browserInfo || '', deviceId]
          );
          await this.logUsage(deviceId, code, 're-register', 'Device re-registered');
          
          await this.refreshCache();
          
          return { success: true, status: 'approved', code: code };
        }
      }

      const usage = await this.getCodeUsage(code);
      if (usage.used >= usage.max) {
        await this.logUsage(deviceId, code, 'registration_failed', 'Code limit reached');
        return { success: false, error: `Code limit reached (${usage.max} devices max)`, limitReached: true };
      }

      await this.run(
        'INSERT INTO devices (device_id, user_agent, ip_address, browser_info, code, status, approved_at) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)',
        [deviceId, userAgent || '', ip || '', browserInfo || '', code, 'approved']
      );

      await this.run('UPDATE codes SET used_count = used_count + 1 WHERE code = $1', [code]);
      await this.logUsage(deviceId, code, 'register', 'Device registered and auto-approved');
      
      await this.refreshCache();
      
      return { success: true, status: 'approved', code: code };
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
        
        console.log(`🗑️ User ${deviceId} removed, slot freed for code ${code}`);
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
          await this.logUsage(deviceId, device.code, 'revoke', 'Device revoked, slot freed');
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('Revoke device error:', error);
      return false;
    }
  }

  async reactivateDevice(deviceId) {
    try {
      const device = await this.getDevice(deviceId);
      if (!device) return false;

      if (device.code) {
        const codeInfo = await this.getCodeInfo(device.code);
        if (!codeInfo || !codeInfo.is_active) {
          return { success: false, error: 'Code is inactive' };
        }
        const usage = await this.getCodeUsage(device.code);
        if (usage.used >= codeInfo.max_devices) {
          return { success: false, error: 'Code is full' };
        }
      }

      const result = await this.run(
        'UPDATE devices SET status = $1, approved_at = CURRENT_TIMESTAMP, revoked_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE device_id = $2',
        ['approved', deviceId]
      );
      
      if (result.changes > 0) {
        if (device.code) {
          await this.run('UPDATE codes SET used_count = used_count + 1 WHERE code = $1', [device.code]);
          await this.logUsage(deviceId, device.code, 'reactivate', 'Device reactivated');
        }
        return { success: true };
      }
      return false;
    } catch (error) {
      console.error('Reactivate device error:', error);
      return { success: false, error: error.message };
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
      return { 
        exists: true, 
        status: device.status,
        code: device.code,
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

  async createRequest(deviceId, code, reason = '') {
    try {
      const device = await this.getDevice(deviceId);
      if (!device) {
        return { success: false, error: 'Device not found' };
      }

      const existing = await this.get(
        'SELECT * FROM requests WHERE device_id = $1 AND status = $2',
        [deviceId, 'pending']
      );
      if (existing) {
        return { success: false, error: 'You already have a pending request' };
      }

      const result = await this.run(
        'INSERT INTO requests (device_id, code, reason) VALUES ($1, $2, $3)',
        [deviceId, code || device.code, reason || 'Need more slots']
      );
      await this.logUsage(deviceId, code || device.code, 'request', 'Device requested more slots');
      return { success: true, id: result.lastID };
    } catch (error) {
      console.error('Create request error:', error);
      return { success: false, error: 'Failed to create request' };
    }
  }

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

  async getAllRequests() {
    try {
      return await this.all(
        'SELECT r.*, d.status as device_status FROM requests r LEFT JOIN devices d ON r.device_id = d.device_id ORDER BY r.requested_at DESC'
      );
    } catch (error) {
      console.error('Get all requests error:', error);
      return [];
    }
  }

  async respondToRequest(requestId, status, adminResponse = '') {
    try {
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
            await this.extendCode(request.code, newLimit);
            await this.logUsage(request.device_id, request.code, 'code_extended', 
              `Extended to ${newLimit} devices due to request`);
          }
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('Respond to request error:', error);
      return false;
    }
  }

  async getRequestByDevice(deviceId) {
    try {
      return await this.all(
        'SELECT * FROM requests WHERE device_id = $1 ORDER BY requested_at DESC',
        [deviceId]
      );
    } catch (error) {
      console.error('Get request by device error:', error);
      return [];
    }
  }

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

  async getStats() {
    try {
      const total = await this.get('SELECT COUNT(*) as count FROM devices');
      const pending = await this.get("SELECT COUNT(*) as count FROM devices WHERE status = 'pending'");
      const approved = await this.get("SELECT COUNT(*) as count FROM devices WHERE status = 'approved'");
      const revoked = await this.get("SELECT COUNT(*) as count FROM devices WHERE status = 'revoked'");
      const totalPings = await this.get('SELECT COALESCE(SUM(ping_count), 0) as total FROM devices');
      const totalCodes = await this.get('SELECT COUNT(*) as count FROM codes');
      const activeCodes = await this.get("SELECT COUNT(*) as count FROM codes WHERE is_active = true");
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

  close() {
    this.pool.end();
  }
}

module.exports = new DeviceDatabase();