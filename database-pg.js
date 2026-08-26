// database-pg.js - COMPLETE CLEAN VERSION (No Wallpaper, HWID + Hardware Only)

const { Pool } = require('pg');

class DeviceDatabase {
  constructor() {
    const sslConfig = process.env.DATABASE_SSL === 'false' ? false : {
      rejectUnauthorized: false,
      sslmode: 'require'
    };
    
    let connectionConfig = {
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
      max: parseInt(process.env.DATABASE_POOL_MAX) || 30,
      min: parseInt(process.env.DATABASE_POOL_MIN) || 10,
      idleTimeoutMillis: parseInt(process.env.DATABASE_IDLE_TIMEOUT) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DATABASE_CONNECTION_TIMEOUT) || 10000,
      maxUses: parseInt(process.env.DATABASE_MAX_USES) || 200,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5000,
      statement_timeout: 30000,
      query_timeout: 30000,
      acquireTimeoutMillis: 10000
    };

    if (sslConfig) {
      connectionConfig = {
        ...connectionConfig,
        ssl: {
          rejectUnauthorized: false,
          ca: process.env.DATABASE_CA || undefined,
          key: process.env.DATABASE_KEY || undefined,
          cert: process.env.DATABASE_CERT || undefined
        }
      };
    }

    this.pool = new Pool(connectionConfig);
    
    this.cache = {
      codes: [],
      stats: { total: 0, approved: 0, revoked: 0, totalPings: 0, totalCodes: 0, activeCodes: 0, pendingRequests: 0 },
      devices: [],
      requests: [],
      hwidLogs: [],
      hardwareSpecs: {},
      lastUpdate: 0,
      hasInitialData: false
    };
    
    this.cacheTTL = parseInt(process.env.CACHE_TTL) || 60;
    this.queryQueue = [];
    this.activeQueries = 0;
    this.maxConcurrentQueries = parseInt(process.env.MAX_CONCURRENT_QUERIES) || 25;
    this.recentQueries = new Map();
    this.queryDedupeWindow = 5000;
    
    this.pool.on('connect', () => {});
    this.pool.on('acquire', () => {});
    this.pool.on('remove', () => {});
    this.pool.on('error', (err) => {
      console.error('❌ Database pool error:', err);
    });
    
    this.initTables();
    console.log('✅ PostgreSQL Database initialized for 100-200 users');
    console.log(`📊 Pool: max=${this.pool.options.max}, min=${this.pool.options.min}`);
    console.log(`⏱️  Cache TTL: ${this.cacheTTL}s`);
    console.log(`📈 Max Concurrent Queries: ${this.maxConcurrentQueries}`);
  }

  getQueryKey(sql, params) {
    return `${sql}:${JSON.stringify(params)}`;
  }

  async queuedQuery(sql, params = [], priority = 0) {
    const key = this.getQueryKey(sql, params);
    
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      const recent = this.recentQueries.get(key);
      if (recent && Date.now() - recent.timestamp < this.queryDedupeWindow) {
        return recent.result;
      }
    }
    
    return new Promise((resolve, reject) => {
      this.queryQueue.push({ 
        sql, 
        params, 
        priority, 
        resolve, 
        reject,
        timestamp: Date.now(),
        key: key
      });
      
      this.queryQueue.sort((a, b) => b.priority - a.priority);
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.activeQueries >= this.maxConcurrentQueries || this.queryQueue.length === 0) {
      return;
    }

    const task = this.queryQueue.shift();
    this.activeQueries++;

    try {
      const result = await this.query(task.sql, task.params);
      
      if (task.sql.trim().toUpperCase().startsWith('SELECT')) {
        this.recentQueries.set(task.key, {
          result: result,
          timestamp: Date.now()
        });
        
        for (const [key, value] of this.recentQueries) {
          if (Date.now() - value.timestamp > this.queryDedupeWindow) {
            this.recentQueries.delete(key);
          }
        }
      }
      
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    } finally {
      this.activeQueries--;
      this.processQueue();
    }
  }

  async query(sql, params = []) {
    let client = null;
    let attempt = 0;
    const maxAttempts = 3;
    
    while (attempt < maxAttempts) {
      try {
        client = await this.pool.connect();
        await client.query('SET statement_timeout = 30000');
        const result = await client.query(sql, params);
        return result;
      } catch (error) {
        if (error.code === '53300' || error.message.includes('remaining connection slots')) {
          attempt++;
          if (attempt < maxAttempts) {
            const delay = attempt * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        throw error;
      } finally {
        if (client) {
          try {
            client.release();
          } catch (e) {}
        }
      }
    }
  }

  async queryWithRetry(sql, params = [], maxRetries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let client = null;
      try {
        client = await this.pool.connect();
        await client.query('SET statement_timeout = 30000');
        const result = await client.query(sql, params);
        return result;
      } catch (error) {
        lastError = error;
        if (error.code === '53300' || 
            error.message.includes('remaining connection slots')) {
          if (attempt < maxRetries) {
            const delay = attempt * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        throw error;
      } finally {
        if (client) {
          try {
            client.release();
          } catch (e) {}
        }
      }
    }
    throw lastError;
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
  // HIGH PRIORITY METHODS
  // ============================================

  async getCodeInfo(code) {
    try {
      const result = await this.queuedQuery('SELECT * FROM codes WHERE code = $1', [code], 10);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Get code info error:', error);
      return null;
    }
  }

  async getDevice(deviceId) {
    try {
      const result = await this.queuedQuery('SELECT * FROM devices WHERE device_id = $1', [deviceId], 8);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Get device error:', error);
      return null;
    }
  }

  async isHwidAuthorized(code, hwid) {
    try {
      const result = await this.queuedQuery(
        'SELECT * FROM code_hwids WHERE code = $1 AND hwid = $2',
        [code, hwid],
        9
      );
      return !!result.rows[0];
    } catch (error) {
      console.error('Check HWID authorized error:', error);
      return false;
    }
  }

  async getDashboardData() {
    if (this.cache.hasInitialData && this.cache.lastUpdate > Date.now() - this.cacheTTL * 1000) {
      return this.cache;
    }

    try {
      const stats = await this.queuedQuery(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) as revoked,
          SUM(ping_count) as totalPings
        FROM devices
      `, [], 5);
      
      const [totalCodes, activeCodes, pendingRequests] = await Promise.all([
        this.queuedQuery('SELECT COUNT(*) as count FROM codes', [], 5),
        this.queuedQuery("SELECT COUNT(*) as count FROM codes WHERE is_active = true AND status = 'active'", [], 5),
        this.queuedQuery("SELECT COUNT(*) as count FROM requests WHERE status = 'pending'", [], 5)
      ]);
      
      const codes = await this.queuedQuery(
        'SELECT code, username, access_level, subscription_type, status, is_active, created_at, max_hwid_limit FROM codes ORDER BY created_at DESC LIMIT 100',
        [], 3
      );
      
      const devices = await this.queuedQuery(
        `SELECT device_id, status, code, last_ping, created_at, profile_name, device_name, registered_owner, cpu_name, gpu_name, ram_total_gb, storage_total_gb
        FROM devices ORDER BY created_at DESC LIMIT 100`,
        [], 3
      );
      
      const requests = await this.queuedQuery(
        "SELECT * FROM requests WHERE status = 'pending' ORDER BY requested_at ASC LIMIT 50",
        [], 3
      );
      
      const statsData = {
        total: parseInt(stats.rows[0]?.total || 0),
        approved: parseInt(stats.rows[0]?.approved || 0),
        revoked: parseInt(stats.rows[0]?.revoked || 0),
        totalPings: parseInt(stats.rows[0]?.totalPings || 0),
        totalCodes: parseInt(totalCodes.rows[0]?.count || 0),
        activeCodes: parseInt(activeCodes.rows[0]?.count || 0),
        pendingRequests: parseInt(pendingRequests.rows[0]?.count || 0)
      };
      
      this.cache.stats = statsData;
      this.cache.codes = codes.rows;
      this.cache.devices = devices.rows;
      this.cache.requests = requests.rows;
      this.cache.lastUpdate = Date.now();
      this.cache.hasInitialData = true;
      
      return this.cache;
    } catch (error) {
      console.error('Error getting dashboard data:', error);
      return this.cache;
    }
  }

  async getHwidLogsWithAssignment(limit = 50, status = null, offset = 0) {
    try {
      let query = `
        SELECT 
            l.id,
            l.hwid,
            l.code,
            l.device_id,
            l.action,
            l.status,
            l.details,
            l.created_at,
            l.ip_address,
            l.browser_profile,
            CASE 
                WHEN ch.code IS NOT NULL THEN 'assigned'
                ELSE 'unassigned'
            END as assignment_status,
            ch.code as assigned_code,
            c.username as assigned_username,
            SUBSTRING(l.hwid, 1, 16) || '...' || SUBSTRING(l.hwid, 49, 16) as hwid_masked
        FROM hwid_logs l
        LEFT JOIN code_hwids ch ON l.hwid = ch.hwid
        LEFT JOIN codes c ON ch.code = c.code
        WHERE 1=1
      `;
      const params = [];
      
      if (status) {
        query += ` AND l.status = $1`;
        params.push(status);
      }
      
      query += ` ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(Math.min(limit, 100), offset);
      
      const result = await this.all(query, params);
      return result || [];
    } catch (error) {
      console.error('❌ Get HWID logs with assignment error:', error.message);
      return [];
    }
  }

  async getHwidLogsCount(status = null) {
    try {
      let query = 'SELECT COUNT(*) as count FROM hwid_logs';
      const params = [];
      
      if (status) {
        query += ` WHERE status = $1`;
        params.push(status);
      }
      
      const result = await this.get(query, params);
      return result ? parseInt(result.count) : 0;
    } catch (error) {
      console.error('❌ Get HWID logs count error:', error.message);
      return 0;
    }
  }

  async getHardwareSpecs(deviceId) {
    try {
      const cacheKey = `hw_${deviceId}`;
      if (this.cache.hardwareSpecs[cacheKey] && 
          Date.now() - this.cache.hardwareSpecs[cacheKey].timestamp < 120000) {
        return this.cache.hardwareSpecs[cacheKey].data;
      }
      
      const result = await this.get(
        `SELECT cpu_name, gpu_name, ram_total_gb, storage_total_gb, profile_name, device_name, registered_owner 
         FROM devices WHERE device_id = $1`,
        [deviceId]
      );
      
      if (result) {
        this.cache.hardwareSpecs[cacheKey] = {
          data: result,
          timestamp: Date.now()
        };
      }
      
      return result || null;
    } catch (error) {
      console.error('Get hardware specs error:', error);
      return null;
    }
  }

  async batchUpdateDevices(updates) {
    if (!updates || updates.length === 0) return { success: true, updated: 0 };
    
    try {
      const values = updates.map((u, i) => 
        `($${i * 2 + 1}, $${i * 2 + 2})`
      ).join(',');
      
      const params = [];
      updates.forEach(u => {
        params.push(u.device_id, u.status);
      });
      
      const result = await this.run(
        `UPDATE devices AS d SET 
          status = u.status,
          updated_at = CURRENT_TIMESTAMP
        FROM (VALUES ${values}) AS u(device_id, status)
        WHERE d.device_id = u.device_id`,
        params
      );
      
      return { success: true, updated: result.changes };
    } catch (error) {
      console.error('Batch update error:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // INIT TABLES - NO WALLPAPER
  // ============================================

  async initTables() {
    try {
      console.log('🔧 Creating/verifying tables...');
      
      await this.queryWithRetry(`
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
          trigger_hwid TEXT,
          trigger_reason TEXT,
          triggered_at TIMESTAMP
        )
      `);

      await this.queryWithRetry(`
        CREATE TABLE IF NOT EXISTS code_hwids (
          id SERIAL PRIMARY KEY,
          code TEXT NOT NULL REFERENCES codes(code) ON DELETE CASCADE,
          hwid TEXT NOT NULL,
          assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_used TIMESTAMP,
          UNIQUE(code, hwid)
        )
      `);

      await this.queryWithRetry(`
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
          registered_owner TEXT
        )
      `);

      // ALTER TABLE for registered_owner
      try {
        await this.queryWithRetry(`
          ALTER TABLE devices ADD COLUMN IF NOT EXISTS registered_owner TEXT
        `);
        console.log('✅ registered_owner column verified/added');
      } catch (err) {
        console.log('ℹ️ registered_owner column already exists or error:', err.message);
      }

      // Remove wallpaper columns if they exist
      try {
        await this.queryWithRetry(`ALTER TABLE devices DROP COLUMN IF EXISTS wallpaper_name`);
        await this.queryWithRetry(`ALTER TABLE devices DROP COLUMN IF EXISTS wallpaper_size_kb`);
        await this.queryWithRetry(`ALTER TABLE devices DROP COLUMN IF EXISTS wallpaper_width`);
        await this.queryWithRetry(`ALTER TABLE devices DROP COLUMN IF EXISTS wallpaper_height`);
        await this.queryWithRetry(`ALTER TABLE devices DROP COLUMN IF EXISTS wallpaper_base64`);
        console.log('✅ Wallpaper columns removed (if they existed)');
      } catch (err) {
        console.log('ℹ️ Wallpaper columns already removed or error:', err.message);
      }

      // Add trigger columns to codes table
      try {
        await this.queryWithRetry(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS trigger_hwid TEXT`);
        await this.queryWithRetry(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS trigger_reason TEXT`);
        await this.queryWithRetry(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS triggered_at TIMESTAMP`);
        console.log('✅ Trigger columns added to codes table');
      } catch (err) {
        console.log('ℹ️ Trigger columns already exist or error:', err.message);
      }

      // ============================================
      // INDEXES
      // ============================================
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_codes_hwid ON codes(hwid)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_devices_hwid ON devices(hwid)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_codes_username ON codes(username)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_code_hwids_code ON code_hwids(code)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_code_hwids_hwid ON code_hwids(hwid)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_devices_code_status ON devices(code, status)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_hwid_logs_status_created ON hwid_logs(status, created_at DESC)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_hwid_logs_hwid_created ON hwid_logs(hwid, created_at DESC)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_codes_status_active ON codes(status, is_active)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_devices_registered_owner ON devices(registered_owner)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_codes_trigger_hwid ON codes(trigger_hwid)`);

      await this.queryWithRetry(`
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

      await this.queryWithRetry(`
        CREATE TABLE IF NOT EXISTS usage_logs (
          id SERIAL PRIMARY KEY,
          device_id TEXT,
          code TEXT,
          action TEXT NOT NULL,
          details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await this.queryWithRetry(`
        CREATE TABLE IF NOT EXISTS admins (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await this.queryWithRetry(`
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

      console.log('✅ Tables created/verified with all indexes (No Wallpaper)');
      await this.refreshCache();
      
    } catch (error) {
      console.error('❌ Failed to create tables:', error.message);
    }
  }

  // ============================================
  // REGISTER DEVICE - NO WALLPAPER
  // ============================================

  async registerDeviceWithCode(deviceId, userAgent, ip, browserInfo, code, hwid = null, hardware = null) {
    try {
      const codeInfoResult = await this.queuedQuery(
        'SELECT * FROM codes WHERE code = $1', 
        [code], 
        10
      );
      const codeInfo = codeInfoResult.rows[0];
      
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

      let isAuthorized = false;
      if (hwid) {
        const authResult = await this.queuedQuery(
          'SELECT * FROM code_hwids WHERE code = $1 AND hwid = $2',
          [code, hwid],
          9
        );
        isAuthorized = !!authResult.rows[0];
      }

      if (!isAuthorized && hwid) {
        const assignResult = await this.assignHwidToCode(code, hwid, true);
        if (!assignResult.success) {
          if (assignResult.auto_deactivate) {
            const deactivateResult = await this.autoDeactivateCode(code, 'hwid_limit_exceeded_auto_assign', hwid, assignResult.new_hwid_details);
            return {
              success: false,
              error: `HWID limit reached. Code auto-deactivated.`,
              auto_deactivated: true,
              devices_revoked: deactivateResult.devices_revoked || 0,
              new_hwid: hwid
            };
          }
          return { success: false, error: assignResult.error };
        }
        isAuthorized = true;
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

      let cpuName = 'Unknown', gpuName = 'Unknown', ramTotal = 0, storageTotal = 0, deviceName = 'Unknown', profileName = 'Default';
      let registeredOwner = 'Unknown';

      if (hardware) {
        const hw = typeof hardware === 'string' ? JSON.parse(hardware) : hardware;
        cpuName = hw.cpu || hw.cpu_name || 'Unknown';
        gpuName = hw.gpu || hw.gpu_name || 'Unknown';
        ramTotal = hw.ram_gb || hw.ram_total_gb || 0;
        storageTotal = hw.storage_gb || hw.storage_total_gb || 0;
        deviceName = hw.device_name || 'Unknown';
        profileName = hw.profile_name || 'Default';
        registeredOwner = hw.registered_owner || 'Unknown';
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
            registered_owner = $13,
            approved_at = CURRENT_TIMESTAMP,
            revoked_at = NULL
          WHERE device_id = $14`,
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
            registeredOwner,
            deviceId
          ]
        );
      } else {
        await this.run(
          `INSERT INTO devices (
            device_id, user_agent, ip_address, browser_info, code, hwid,
            status, approved_at, browser_profile,
            cpu_name, gpu_name, ram_total_gb, storage_total_gb,
            profile_name, device_name, registered_owner
          ) VALUES ($1, $2, $3, $4, $5, $6, 'approved', CURRENT_TIMESTAMP, $7,
            $8, $9, $10, $11, $12, $13, $14)`,
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
            registeredOwner
          ]
        );
      }

      await this.run('UPDATE codes SET used_count = used_count + 1 WHERE code = $1', [code]);
      
      await this.logUsage(deviceId, code, 'register', 
        `Device registered | Profile: ${profileName} | Owner: ${registeredOwner}`
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
        registered_owner: registeredOwner
      };
      
    } catch (error) {
      console.error('Register device error:', error);
      return { success: false, error: error.message };
    }
  }

  async getDevices(status = null, limit = 100, offset = 0) {
    try {
      let query = 'SELECT device_id, status, code, last_ping, created_at, profile_name, device_name, registered_owner, cpu_name, gpu_name, ram_total_gb, storage_total_gb FROM devices';
      const params = [];
      
      if (status) {
        query += ' WHERE status = $1';
        params.push(status);
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(Math.min(limit, 200), offset);
      
      return await this.all(query, params);
    } catch (error) {
      console.error('Get devices error:', error);
      return this.cache.devices || [];
    }
  }

  async getDevicesByCode(code) {
    try {
      const result = await this.queuedQuery(
        'SELECT device_id, status, last_ping, created_at, profile_name, device_name, registered_owner FROM devices WHERE code = $1 ORDER BY created_at DESC LIMIT 50', 
        [code],
        7
      );
      return result.rows || [];
    } catch (error) {
      console.error('Get devices by code error:', error);
      return [];
    }
  }

  // ============================================
  // HWID MANAGEMENT
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
      
      const hwidsWithSpecs = await Promise.all(result.map(async (h) => {
        const device = await this.get(
          'SELECT cpu_name, gpu_name, ram_total_gb, storage_total_gb, device_name, profile_name, registered_owner FROM devices WHERE hwid = $1 ORDER BY created_at DESC LIMIT 1',
          [h.hwid]
        );
        return {
          ...h,
          hardware: device ? {
            cpu: device.cpu_name || 'Unknown',
            gpu: device.gpu_name || 'Unknown',
            ram_gb: device.ram_total_gb || 0,
            storage_gb: device.storage_total_gb || 0,
            device_name: device.device_name || 'Unknown',
            profile_name: device.profile_name || 'Unknown',
            registered_owner: device.registered_owner || 'Unknown'
          } : null
        };
      }));
      
      return hwidsWithSpecs;
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

  // ============================================
  // ASSIGN HWID TO CODE
  // ============================================

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
        
        // Get hardware details of the new HWID
        const device = await this.get(
          'SELECT cpu_name, gpu_name, ram_total_gb, storage_total_gb, device_name, profile_name, registered_owner FROM devices WHERE hwid = $1 ORDER BY created_at DESC LIMIT 1',
          [hwid]
        );
        
        let hwidDetails = null;
        if (device) {
          hwidDetails = {
            cpu: device.cpu_name || 'N/A',
            gpu: device.gpu_name || 'N/A',
            ram: device.ram_total_gb || 0,
            storage: device.storage_total_gb || 0,
            device: device.device_name || 'N/A',
            profile: device.profile_name || 'N/A',
            owner: device.registered_owner || 'N/A'
          };
        }
        
        // Log the new HWID before auto-deactivation
        await this.logHwidActivity(
          hwid,
          code,
          'system',
          'auto_deactivation_trigger',
          'new',
          `🚨 HWID limit reached (${currentCount}/${limit}) - TRIGGERED AUTO-DEACTIVATION | CPU: ${hwidDetails?.cpu || 'N/A'} | GPU: ${hwidDetails?.gpu || 'N/A'} | RAM: ${hwidDetails?.ram || 0}GB | Storage: ${hwidDetails?.storage || 0}GB | Device: ${hwidDetails?.device || 'N/A'} | Profile: ${hwidDetails?.profile || 'N/A'} | Owner: ${hwidDetails?.owner || 'N/A'}`,
          null,
          null,
          null
        );
        
        return {
          success: false,
          error: `HWID limit reached (${limit}). Auto-deactivating code.`,
          limit_reached: true,
          current_count: currentCount,
          max_limit: limit,
          auto_deactivate: true,
          new_hwid: hwid,
          new_hwid_details: hwidDetails
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

  async autoDeactivateCode(code, reason = 'unauthorized_use', newHwid = null, newHwidDetails = null) {
    try {
      let status = 'auto_deactivated';
      if (reason === 'multiple_hwids_detected') {
        status = 'auto_deactivated_multiple_hwids';
      } else if (reason === 'hwid_limit_exceeded' || reason === 'hwid_limit_exceeded_auto_assign') {
        status = 'auto_deactivated_limit_exceeded';
      } else if (reason === 'unauthorized_use') {
        status = 'auto_deactivated_unauthorized';
      }
      
      // Save trigger HWID to codes table
      if (newHwid) {
        let details = `🚨 This HWID triggered the auto-deactivation of code ${code} due to: ${reason}`;
        if (newHwidDetails) {
          details += ` | CPU: ${newHwidDetails.cpu || 'N/A'} | GPU: ${newHwidDetails.gpu || 'N/A'} | RAM: ${newHwidDetails.ram || 0}GB | Storage: ${newHwidDetails.storage || 0}GB | Device: ${newHwidDetails.device || 'N/A'} | Profile: ${newHwidDetails.profile || 'N/A'} | Owner: ${newHwidDetails.owner || 'N/A'}`;
        }
        
        await this.logHwidActivity(
          newHwid,
          code,
          'system',
          'auto_deactivation_trigger',
          'trigger_new_hwid',
          details,
          null,
          null,
          null
        );
        
        // SAVE TRIGGER HWID TO CODES TABLE
        await this.run(
          'UPDATE codes SET trigger_hwid = $1, trigger_reason = $2, triggered_at = CURRENT_TIMESTAMP WHERE code = $3',
          [newHwid, reason, code]
        );
        
        console.log(`✅ Trigger HWID saved for code ${code}: ${newHwid.substring(0, 16)}...`);
      }
      
      await this.run(
        'UPDATE codes SET is_active = false, status = $1 WHERE code = $2',
        [status, code]
      );
      
      await this.run(
        'UPDATE devices SET status = $1, revoked_at = CURRENT_TIMESTAMP WHERE code = $2',
        ['revoked', code]
      );
      
      const countResult = await this.get(
        'SELECT COUNT(*) as count FROM devices WHERE code = $1',
        [code]
      );
      const deviceCount = countResult ? parseInt(countResult.count) : 0;
      
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
        `🔒 Code ${code} auto-deactivated due to ${reason}. ${deviceCount} devices revoked. New HWID: ${newHwid || 'N/A'}`
      );
      
      await this.refreshCache();
      
      return {
        success: true,
        code: code,
        devices_revoked: deviceCount,
        reason: reason,
        status: status,
        new_hwid: newHwid
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
  // GET AUTO-DEACTIVATED CODES WITH HWID DETAILS
  // ============================================

  async getAutoDeactivatedCodesWithHwidDetails() {
    try {
      const result = await this.queuedQuery(`
        SELECT 
          c.code,
          c.username,
          c.access_level,
          c.subscription_type,
          c.status,
          c.is_active,
          c.created_at,
          c.expires_at,
          c.max_hwid_limit,
          c.hwid as code_hwid,
          c.trigger_hwid,
          c.trigger_reason,
          c.triggered_at,
          (
            SELECT COUNT(*) FROM code_hwids WHERE code = c.code
          ) as hwid_count,
          (
            SELECT json_agg(
              json_build_object(
                'hwid', ch.hwid,
                'assigned_at', ch.assigned_at,
                'last_used', ch.last_used,
                'hardware', (
                  SELECT json_build_object(
                    'cpu_name', d.cpu_name,
                    'gpu_name', d.gpu_name,
                    'ram_total_gb', d.ram_total_gb,
                    'storage_total_gb', d.storage_total_gb,
                    'device_name', d.device_name,
                    'profile_name', d.profile_name,
                    'registered_owner', d.registered_owner
                  )
                  FROM devices d 
                  WHERE d.hwid = ch.hwid 
                  ORDER BY d.created_at DESC 
                  LIMIT 1
                )
              )
            ) 
            FROM code_hwids ch 
            WHERE ch.code = c.code
          ) as hwids,
          (
            SELECT json_agg(
              json_build_object(
                'hwid', l.hwid,
                'action', l.action,
                'status', l.status,
                'details', l.details,
                'created_at', l.created_at,
                'browser_profile', l.browser_profile
              )
              ORDER BY l.created_at DESC
              LIMIT 20
            )
            FROM hwid_logs l 
            WHERE (l.code = c.code OR l.hwid = c.trigger_hwid)
            AND (l.status = 'new' OR l.status = 'seen' OR l.action = 'auto_deactivation_trigger')
            ORDER BY l.created_at DESC
            LIMIT 20
          ) as recent_hwid_logs,
          (
            SELECT json_build_object(
              'hwid', l.hwid,
              'action', l.action,
              'status', l.status,
              'details', l.details,
              'created_at', l.created_at,
              'browser_profile', l.browser_profile
            )
            FROM hwid_logs l 
            WHERE l.hwid = c.trigger_hwid 
            AND l.action = 'auto_deactivation_trigger'
            ORDER BY l.created_at DESC 
            LIMIT 1
          ) as trigger_log
        FROM codes c
        WHERE c.status IN ('auto_deactivated_limit_exceeded', 'auto_deactivated')
        AND c.is_active = false
        ORDER BY c.created_at DESC
      `, [], 5);
      
      return result.rows || [];
    } catch (error) {
      console.error('❌ Get auto-deactivated codes with HWID details error:', error.message);
      return [];
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
        `SELECT code, username, access_level, subscription_type, subscription_started_at, expires_at, status, is_active, used_count, created_at, notes, created_by, hwid, fingerprint, max_hwid_limit, trigger_hwid, trigger_reason, triggered_at
         FROM codes ORDER BY created_at DESC LIMIT 500`
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
        `SELECT * FROM codes WHERE is_active = true AND status = 'active' ORDER BY created_at DESC LIMIT 500`
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
        `SELECT * FROM devices WHERE code = $1 AND status != 'revoked' LIMIT 100`,
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
      const countResult = await this.get(
        'SELECT COUNT(*) as count FROM devices WHERE code = $1',
        [code]
      );
      const deviceCount = countResult ? parseInt(countResult.count) : 0;
      
      await this.run('DELETE FROM code_hwids WHERE code = $1', [code]);
      await this.run('DELETE FROM devices WHERE code = $1', [code]);
      
      const result = await this.run(
        'UPDATE codes SET is_active = false, status = $1, hwid = NULL, trigger_hwid = NULL, trigger_reason = NULL, triggered_at = NULL WHERE code = $2',
        ['inactive', code]
      );
      
      await this.refreshCache();
      
      if (result.changes > 0) {
        console.log(`✅ Code deactivated: ${code} - ${deviceCount} devices removed`);
        return { success: true, devicesRemoved: deviceCount };
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

      if (!codeInfo.is_active || codeInfo.status === 'inactive' || codeInfo.status.includes('auto_deactivated')) {
        await this.run(
          'DELETE FROM code_hwids WHERE code = $1',
          [code]
        );
        await this.run(
          'UPDATE codes SET hwid = NULL, trigger_hwid = NULL, trigger_reason = NULL, triggered_at = NULL WHERE code = $1',
          [code]
        );
      }

      const now = new Date().toISOString();
      const expiresAt = subscriptionType === 'Lifetime' ? null : this.calculateExpiration(now, subscriptionType);
      
      const result = await this.run(
        `UPDATE codes 
         SET is_active = true, 
             status = 'active', 
             subscription_type = $1,
             subscription_started_at = $2,
             expires_at = $3,
             trigger_hwid = NULL,
             trigger_reason = NULL,
             triggered_at = NULL
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

  async getHwidLogs(limit = 50, status = null, offset = 0) {
    try {
      let query = 'SELECT id, hwid, code, device_id, action, status, details, created_at, ip_address, browser_profile FROM hwid_logs';
      const params = [];
      
      if (status) {
        query += ' WHERE status = $1';
        params.push(status);
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(Math.min(limit, 100), offset);
      
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
        'SELECT id, hwid, code, device_id, action, status, details, created_at FROM hwid_logs WHERE hwid = $1 ORDER BY created_at DESC LIMIT $2',
        [hwid, Math.min(limit, 100)]
      );
    } catch (error) {
      console.error('❌ Get HWID logs by HWID error:', error.message);
      return [];
    }
  }

  async getNewHwidCount() {
    try {
      const result = await this.get(
        "SELECT COUNT(*) as count FROM hwid_logs WHERE status = 'new'"
      );
      return result ? parseInt(result.count) : 0;
    } catch (error) {
      console.error('❌ Get new HWID count error:', error.message);
      return 0;
    }
  }

  async markHwidAsSeen(hwid) {
    try {
      await this.run(
        "UPDATE hwid_logs SET status = 'seen' WHERE hwid = $1 AND status = 'new'",
        [hwid]
      );
      return true;
    } catch (error) {
      console.error('❌ Mark HWID as seen error:', error.message);
      return false;
    }
  }

  // ============================================
  // NEW HWID METHODS
  // ============================================

  async getNewUniqueHwids(limit = 50, offset = 0) {
    try {
      const result = await this.all(`
        SELECT DISTINCT 
            l.hwid,
            l.code,
            l.device_id,
            l.action,
            l.details,
            l.created_at,
            l.ip_address,
            l.user_agent,
            l.browser_profile,
            l.status,
            SUBSTRING(l.hwid, 1, 16) || '...' || SUBSTRING(l.hwid, 49, 16) as hwid_masked,
            CASE 
                WHEN ch.code IS NOT NULL THEN 'assigned'
                ELSE 'new'
            END as assignment_status,
            ch.code as assigned_code
        FROM hwid_logs l
        LEFT JOIN code_hwids ch ON l.hwid = ch.hwid
        WHERE (l.status = 'new' OR l.status = 'seen')
        AND ch.code IS NULL
        ORDER BY l.created_at DESC
        LIMIT $1 OFFSET $2
      `, [Math.min(limit, 100), offset]);
      
      return result || [];
    } catch (error) {
      console.error('❌ Get new unique HWIDs error:', error.message);
      return [];
    }
  }

  async getUniqueNewHwidCount() {
    try {
      const result = await this.get(`
        SELECT COUNT(DISTINCT hwid) as count 
        FROM hwid_logs 
        WHERE status IN ('new', 'seen')
        AND hwid NOT IN (SELECT hwid FROM code_hwids)
      `);
      return result ? parseInt(result.count) : 0;
    } catch (error) {
      console.error('❌ Get unique new HWID count error:', error.message);
      return 0;
    }
  }

  async markHwidAsAssigned(hwid, code) {
    try {
      await this.run(
        "UPDATE hwid_logs SET status = 'assigned' WHERE hwid = $1",
        [hwid]
      );
      return true;
    } catch (error) {
      console.error('❌ Mark HWID as assigned error:', error.message);
      return false;
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
        registered_owner: device.registered_owner || 'Unknown',
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
      params.push(Math.min(limit, 200));
      
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
      if (this.cache.hasInitialData && this.cache.lastUpdate > Date.now() - this.cacheTTL * 1000) {
        return this.cache.stats;
      }
      
      const [total, pending, approved, revoked, totalPings, totalCodes, activeCodes, pendingRequests] = await Promise.all([
        this.get('SELECT COUNT(*) as count FROM devices'),
        this.get("SELECT COUNT(*) as count FROM devices WHERE status = 'pending'"),
        this.get("SELECT COUNT(*) as count FROM devices WHERE status = 'approved'"),
        this.get("SELECT COUNT(*) as count FROM devices WHERE status = 'revoked'"),
        this.get('SELECT COALESCE(SUM(ping_count), 0) as total FROM devices'),
        this.get('SELECT COUNT(*) as count FROM codes'),
        this.get("SELECT COUNT(*) as count FROM codes WHERE is_active = true AND status = 'active'"),
        this.get("SELECT COUNT(*) as count FROM requests WHERE status = 'pending'")
      ]);

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
      
      this.cache.stats = stats;
      this.cache.lastUpdate = Date.now();
      
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
        "SELECT r.*, d.status as device_status FROM requests r LEFT JOIN devices d ON r.device_id = d.device_id WHERE r.status = 'pending' ORDER BY r.requested_at ASC LIMIT 50",
        []
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
        this.cache.codes = codes;
        console.log(`✅ Updated codes cache with ${codes.length} codes`);
      }
      
      if (stats !== null && stats !== undefined && Object.keys(stats).length > 0) {
        this.cache.stats = stats;
      }
      
      if (devices !== null && devices !== undefined) {
        this.cache.devices = devices;
        console.log(`✅ Updated devices cache with ${devices.length} devices`);
      }
      
      if (requests !== null && requests !== undefined) {
        this.cache.requests = requests;
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
        WHERE last_ping < NOW() - INTERVAL '30 days'
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
  // CONNECTION POOL STATUS
  // ============================================

  getPoolStatus() {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
      max: this.pool.options.max,
      min: this.pool.options.min,
      used: this.pool.totalCount - this.pool.idleCount
    };
  }

  close() {
    this.pool.end();
  }
}

// ============================================
// EXPORT ONLY - NO SERVER STARTUP CODE HERE
// ============================================
module.exports = new DeviceDatabase();