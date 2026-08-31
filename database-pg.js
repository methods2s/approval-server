// database-pg.js - COMPLETE CLEAN VERSION (No Wallpaper, No HWID Logs, No New HWID)

const { Pool } = require('pg');

class DeviceDatabase {
  constructor() {
    if (!process.env.PGSSLMODE) {
      process.env.PGSSLMODE = 'no-verify';
    }

    let connectionString = process.env.DATABASE_URL || '';
    try {
      const u = new URL(connectionString);
      u.searchParams.delete('sslmode');
      u.searchParams.delete('ssl');
      connectionString = u.toString();
    } catch (e) { /* keep original */ }

    const useSsl = process.env.DATABASE_SSL !== 'false';
    const sslConfig = useSsl ? { rejectUnauthorized: false } : false;

    let connectionConfig = {
      connectionString,
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
    console.log('✅ PostgreSQL Database initialized');
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
        'SELECT code, username, access_level, subscription_type, subscription_started_at, expires_at, status, is_active, created_at, max_hwid_limit FROM codes ORDER BY created_at DESC LIMIT 100',
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

      const ownersResult = await this.queuedQuery(`
        SELECT code,
               ARRAY_AGG(DISTINCT registered_owner) FILTER (
                 WHERE registered_owner IS NOT NULL
                   AND registered_owner <> ''
                   AND LOWER(registered_owner) NOT IN ('unknown', 'n/a', 'na')
               ) AS owners
        FROM devices
        WHERE code IS NOT NULL
        GROUP BY code
      `, [], 3);
      const ownersByCode = {};
      for (const row of (ownersResult.rows || [])) {
        ownersByCode[row.code] = (row.owners || []).filter(Boolean);
      }
      const codesWithOwners = (codes.rows || []).map(c => ({
        ...c,
        owners: ownersByCode[c.code] || []
      }));
      
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
      this.cache.codes = codesWithOwners;
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
  // INIT TABLES - NO WALLPAPER, NO HWID LOGS
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
        await this.queryWithRetry(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS trigger_hwid_specs JSONB`);
        await this.queryWithRetry(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS existing_hwids JSONB`);
        console.log('✅ Trigger columns added to codes table');
      } catch (err) {
        console.log('ℹ️ Trigger columns already exist or error:', err.message);
      }

      // ============================================
      // INDEXES - NO HWID LOGS INDEXES
      // ============================================
      await this.queryWithRetry(`
        CREATE TABLE IF NOT EXISTS group_chat (
          id SERIAL PRIMARY KEY,
          device_id TEXT,
          username TEXT,
          access_level TEXT,
          message TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_group_chat_created ON group_chat(id)`);

      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_codes_hwid ON codes(hwid)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_devices_hwid ON devices(hwid)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_codes_username ON codes(username)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_code_hwids_code ON code_hwids(code)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_code_hwids_hwid ON code_hwids(hwid)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_devices_code_status ON devices(code, status)`);
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
        CREATE TABLE IF NOT EXISTS new_hwids (
          id SERIAL PRIMARY KEY,
          hwid TEXT NOT NULL,
          code TEXT,
          username TEXT,
          source TEXT DEFAULT 'assigned',
          hardware JSONB,
          owner TEXT,
          device_name TEXT,
          profile_name TEXT,
          cpu_name TEXT,
          gpu_name TEXT,
          ram_gb DECIMAL,
          storage_gb DECIMAL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_new_hwids_created ON new_hwids(created_at DESC)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_new_hwids_hwid ON new_hwids(hwid)`);
      await this.queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_new_hwids_code ON new_hwids(code)`);

      console.log('✅ Tables created/verified with all indexes (No Wallpaper, No HWID Logs)');
      await this.refreshCache();
      
    } catch (error) {
      console.error('❌ Failed to create tables:', error.message);
    }
  }

  // ============================================
  // REGISTER DEVICE - NO WALLPAPER, NO HWID LOGS
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
        const assignResult = await this.assignHwidToCode(code, hwid, true, hardware);
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

      await this.removeNewHwidsByHwid(hwid);
      
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

      const extra = await this.all(
        `SELECT hwid FROM codes WHERE code = $1 AND hwid IS NOT NULL AND hwid <> ''`,
        [code]
      );

      const seen = new Set((result || []).map(r => r.hwid));
      const merged = (result || []).slice();
      for (const row of extra || []) {
        if (row.hwid && !seen.has(row.hwid)) {
          seen.add(row.hwid);
          merged.push({ hwid: row.hwid, assigned_at: null, last_used: null });
        }
      }
      
      const hwidsWithSpecs = await Promise.all(merged.map(async (h) => {
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
  // ASSIGN HWID TO CODE - NO HWID LOGS
  // ============================================

  async recordNewHwid(hwid, code = null, source = 'assigned', hardware = null) {
    try {
      if (!hwid) return { success: false };

      const bound = await this.get(
        'SELECT 1 FROM code_hwids WHERE LOWER(hwid) = LOWER($1) LIMIT 1',
        [hwid]
      );
      if (bound) {
        await this.removeNewHwidsByHwid(hwid);
        return { success: true, removed: true };
      }

      const exists = await this.get(
        'SELECT id, cpu_name, owner FROM new_hwids WHERE hwid = $1 AND COALESCE(code, \'\') = COALESCE($2, \'\') AND source = $3 LIMIT 1',
        [hwid, code, source]
      );

      let codeInfo = null;
      if (code) {
        codeInfo = await this.getCodeInfo(code);
      }

      let hw = hardware;
      if (typeof hw === 'string') {
        try { hw = JSON.parse(hw); } catch (e) { hw = null; }
      }
      if (!hw) {
        const device = await this.get(
          `SELECT cpu_name, gpu_name, ram_total_gb, storage_total_gb, device_name, profile_name, registered_owner
           FROM devices WHERE hwid = $1 ORDER BY created_at DESC LIMIT 1`,
          [hwid]
        );
        if (device) {
          hw = {
            cpu: device.cpu_name,
            gpu: device.gpu_name,
            ram_gb: device.ram_total_gb,
            storage_gb: device.storage_total_gb,
            device_name: device.device_name,
            profile_name: device.profile_name,
            registered_owner: device.registered_owner
          };
        }
      }

      const owner = hw?.registered_owner || hw?.owner || null;
      const deviceName = hw?.device_name || hw?.device || null;
      const profileName = hw?.profile_name || hw?.profile || null;
      const cpu = hw?.cpu || hw?.cpu_name || null;
      const gpu = hw?.gpu || hw?.gpu_name || null;
      const ram = hw?.ram_gb || hw?.ram_total_gb || null;
      const storage = hw?.storage_gb || hw?.storage_total_gb || null;

      if (exists) {
        await this.run(
          `UPDATE new_hwids SET
            username = COALESCE($1, username),
            hardware = COALESCE($2::jsonb, hardware),
            owner = COALESCE($3, owner),
            device_name = COALESCE($4, device_name),
            profile_name = COALESCE($5, profile_name),
            cpu_name = COALESCE($6, cpu_name),
            gpu_name = COALESCE($7, gpu_name),
            ram_gb = COALESCE($8, ram_gb),
            storage_gb = COALESCE($9, storage_gb)
           WHERE id = $10`,
          [
            codeInfo?.username || null,
            hw ? JSON.stringify(hw) : null,
            owner, deviceName, profileName, cpu, gpu, ram, storage,
            exists.id
          ]
        );
        return { success: true, updated: true };
      }

      await this.run(
        `INSERT INTO new_hwids
          (hwid, code, username, source, hardware, owner, device_name, profile_name, cpu_name, gpu_name, ram_gb, storage_gb)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)`,
        [
          hwid,
          code || null,
          codeInfo?.username || null,
          source,
          hw ? JSON.stringify(hw) : null,
          owner,
          deviceName,
          profileName,
          cpu,
          gpu,
          ram,
          storage
        ]
      );

      console.log(`🆕 Recorded new HWID ${hwid.substring(0, 16)}... source=${source} code=${code || 'n/a'}`);
      return { success: true };
    } catch (error) {
      console.error('Record new HWID error:', error);
      return { success: false, error: error.message };
    }
  }

  async getNewHwids(limit = 200) {
    try {
      await this.run(`
        DELETE FROM new_hwids n
        WHERE EXISTS (SELECT 1 FROM code_hwids ch WHERE LOWER(ch.hwid) = LOWER(n.hwid))
           OR (n.code IS NOT NULL AND n.code <> '')
           OR n.source = 'limit_exceeded'
      `);
      const rows = await this.all(
        `SELECT n.* FROM new_hwids n
         WHERE NOT EXISTS (SELECT 1 FROM code_hwids ch WHERE LOWER(ch.hwid) = LOWER(n.hwid))
           AND (n.code IS NULL OR n.code = '')
           AND n.source <> 'limit_exceeded'
         ORDER BY n.created_at DESC
         LIMIT $1`,
        [Math.min(parseInt(limit) || 200, 500)]
      );
      return rows || [];
    } catch (error) {
      console.error('Get new HWIDs error:', error);
      return [];
    }
  }

  async removeNewHwidsByHwid(hwid) {
    try {
      if (!hwid) return { success: false };
      const result = await this.run('DELETE FROM new_hwids WHERE LOWER(hwid) = LOWER($1)', [hwid]);
      return { success: true, deleted: result.changes || 0 };
    } catch (error) {
      console.error('Remove new HWIDs by hwid error:', error);
      return { success: false, error: error.message };
    }
  }

  async deleteNewHwid(id) {
    try {
      const result = await this.run('DELETE FROM new_hwids WHERE id = $1', [id]);
      return { success: result.changes > 0 };
    } catch (error) {
      console.error('Delete new HWID error:', error);
      return { success: false, error: error.message };
    }
  }

  async clearNewHwids() {
    try {
      const result = await this.run('DELETE FROM new_hwids');
      return { success: true, deleted: result.changes || 0 };
    } catch (error) {
      console.error('Clear new HWIDs error:', error);
      return { success: false, error: error.message };
    }
  }

  async assignHwidToCode(code, hwid, autoAssign = false, hardware = null) {
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
        await this.removeNewHwidsByHwid(hwid);
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

      let currentCount = await this.getCodeHwidCount(code);
      const limit = await this.getCodeHwidLimit(code);
      const codeRow = await this.get('SELECT hwid FROM codes WHERE code = $1', [code]);
      if (codeRow && codeRow.hwid && codeRow.hwid !== hwid && currentCount < 1) {
        currentCount = 1;
      }

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
        
        console.log(`🆕 NEW HWID (TRIGGER): ${hwid.substring(0, 16)}...`);
        await this.removeNewHwidsByHwid(hwid);
        
        // Log the trigger via usage_logs instead of hwid_logs
        await this.logUsage(
          'system',
          code,
          'auto_deactivation_trigger',
          `🚨 HWID limit reached (${currentCount}/${limit}) - TRIGGERED AUTO-DEACTIVATION | NEW HWID: ${hwid.substring(0, 16)}...`
        );
        
        console.log(`✅ Logged auto_deactivation_trigger for NEW HWID (${hwid.substring(0, 16)}...)`);
        
        return {
          success: false,
          error: `HWID limit reached (${limit}). Auto-deactivating code.`,
          limit_reached: true,
          current_count: currentCount,
          max_limit: limit,
          auto_deactivate: true,
          new_hwid: hwid,
          new_hwid_details: null
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

      await this.removeNewHwidsByHwid(hwid);

      await this.refreshCache();
      return { success: true, message: 'HWID assigned successfully', auto_assigned: autoAssign };
    } catch (error) {
      console.error('Assign HWID error:', error);
      return { success: false, error: error.message };
    }
  }

  async removeHwidFromCode(code, hwid) {
    try {
      const devDel = await this.run(
        'DELETE FROM devices WHERE code = $1 AND hwid = $2',
        [code, hwid]
      );
      const result = await this.run(
        'DELETE FROM code_hwids WHERE code = $1 AND hwid = $2',
        [code, hwid]
      );
      const codeRow = await this.get('SELECT hwid FROM codes WHERE code = $1', [code]);
      const wasPrimary = !!(codeRow && codeRow.hwid === hwid);
      const deletedLink = (result && result.changes || 0) > 0;
      const deletedDev = (devDel && devDel.changes || 0) > 0;

      if (deletedLink || wasPrimary) {
        const remaining = await this.all(
          'SELECT hwid FROM code_hwids WHERE code = $1 ORDER BY assigned_at DESC',
          [code]
        );
        if (remaining && remaining.length > 0) {
          await this.run('UPDATE codes SET hwid = $1 WHERE code = $2', [remaining[0].hwid, code]);
        } else {
          await this.run('UPDATE codes SET hwid = NULL WHERE code = $1', [code]);
        }
      }

      await this.refreshCache();
      if (deletedLink || wasPrimary || deletedDev) {
        return { success: true, message: 'HWID removed successfully', devices_deleted: (devDel && devDel.changes) || 0 };
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
  // AUTO-DEACTIVATE CODE - NO HWID LOGS
  // ============================================

  async autoDeactivateCode(code, reason = 'unauthorized_use', newHwid = null, newHwidDetails = null) {
    try {
      console.log(`🔥 AUTO-DEACTIVATING CODE: ${code}`);
      console.log(`   Reason: ${reason}`);
      console.log(`   NEW HWID (Trigger): ${newHwid ? newHwid.substring(0, 16) + '...' : 'null'}`);
      
      const existingHwids = await this.getCodeHwids(code);
      const codeHwidRow = await this.get('SELECT hwid FROM codes WHERE code = $1', [code]);
      if (codeHwidRow && codeHwidRow.hwid && !(existingHwids || []).some(h => h.hwid === codeHwidRow.hwid)) {
        existingHwids.push({ hwid: codeHwidRow.hwid, assigned_at: null, last_used: null, hardware: null });
      }
      const existingOnly = (existingHwids || []).filter(h => h && h.hwid && h.hwid !== newHwid);
      console.log(`   Existing HWIDs: ${existingOnly.length}`);
      if (existingHwids.length > 0) {
        console.log(`   First existing HWID: ${existingHwids[0].hwid.substring(0, 16)}...`);
      }
      
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
        await this.removeNewHwidsByHwid(newHwid);
        let details = `🚨 This HWID triggered the auto-deactivation of code ${code} due to: ${reason}`;
        if (newHwidDetails) {
          details += ` | CPU: ${newHwidDetails.cpu || 'N/A'} | GPU: ${newHwidDetails.gpu || 'N/A'} | RAM: ${newHwidDetails.ram || 0}GB | Storage: ${newHwidDetails.storage || 0}GB | Device: ${newHwidDetails.device || 'N/A'} | Profile: ${newHwidDetails.profile || 'N/A'} | Owner: ${newHwidDetails.owner || 'N/A'}`;
        }
        
        // Log via usage_logs instead of hwid_logs
        await this.logUsage(
          'system',
          code,
          'auto_deactivation_trigger',
          details
        );
        
        // SAVE TRIGGER HWID TO CODES TABLE
        const specsJson = newHwidDetails ? JSON.stringify({
          cpu: newHwidDetails.cpu || newHwidDetails.cpu_name || 'Unknown',
          gpu: newHwidDetails.gpu || newHwidDetails.gpu_name || 'Unknown',
          ram_gb: newHwidDetails.ram || newHwidDetails.ram_gb || newHwidDetails.ram_total_gb || 0,
          storage_gb: newHwidDetails.storage || newHwidDetails.storage_gb || newHwidDetails.storage_total_gb || 0,
          device: newHwidDetails.device || newHwidDetails.device_name || 'Unknown',
          profile: newHwidDetails.profile || newHwidDetails.profile_name || 'Default',
          owner: newHwidDetails.owner || newHwidDetails.registered_owner || 'Unknown'
        }) : null;
        const updateResult = await this.run(
          'UPDATE codes SET trigger_hwid = $1, trigger_reason = $2, triggered_at = CURRENT_TIMESTAMP, trigger_hwid_specs = $3::jsonb WHERE code = $4',
          [newHwid, reason, specsJson, code]
        );
        
        console.log(`✅ Trigger HWID (NEW HWID) saved: ${newHwid.substring(0, 16)}...`);
      } else {
        console.log(`⚠️ No new HWID provided for code ${code}`);
      }
      
      // CLEAR OWNERS FROM DEVICES BEFORE DELETING
      await this.run(
        'UPDATE devices SET registered_owner = NULL, profile_name = NULL, device_name = NULL WHERE code = $1',
        [code]
      );
      
      // Update code status to inactive
      await this.run(
        'UPDATE codes SET is_active = false, status = $1 WHERE code = $2',
        [status, code]
      );
      
      // Update devices status to revoked
      await this.run(
        'UPDATE devices SET status = $1, revoked_at = CURRENT_TIMESTAMP WHERE code = $2',
        ['revoked', code]
      );
      
      const countResult = await this.get(
        'SELECT COUNT(*) as count FROM devices WHERE code = $1',
        [code]
      );
      const deviceCount = countResult ? parseInt(countResult.count) : 0;
      
      // DELETE code_hwids BUT SAVE THEM FIRST
      await this.run(
        'DELETE FROM code_hwids WHERE code = $1',
        [code]
      );
      
      await this.run(
        'UPDATE codes SET hwid = NULL WHERE code = $1',
        [code]
      );
      
      for (const h of existingOnly) {
        if (h.hardware) continue;
        const device = await this.get(
          'SELECT cpu_name, gpu_name, ram_total_gb, storage_total_gb, device_name, profile_name, registered_owner FROM devices WHERE hwid = $1 ORDER BY created_at DESC LIMIT 1',
          [h.hwid]
        );
        if (device) {
          h.hardware = {
            cpu: device.cpu_name,
            gpu: device.gpu_name,
            ram_gb: device.ram_total_gb || 0,
            device_name: device.device_name,
            profile_name: device.profile_name,
            registered_owner: device.registered_owner
          };
        }
      }
      const existingHwidsPayload = existingOnly.map(h => {
        const hw = h.hardware || {};
        const hardware = {
          cpu: hw.cpu || hw.cpu_name || null,
          cpu_name: hw.cpu_name || hw.cpu || null,
          gpu: hw.gpu || hw.gpu_name || null,
          gpu_name: hw.gpu_name || hw.gpu || null,
          ram_gb: hw.ram_gb || hw.ram_total_gb || 0,
          ram_total_gb: hw.ram_total_gb || hw.ram_gb || 0,
          storage_gb: hw.storage_gb || hw.storage_total_gb || 0,
          storage_total_gb: hw.storage_total_gb || hw.storage_gb || 0,
          device_name: hw.device_name || hw.device || null,
          profile_name: hw.profile_name || hw.profile || null,
          registered_owner: hw.registered_owner || hw.owner || null,
          owner: hw.registered_owner || hw.owner || null
        };
        return {
          hwid: h.hwid,
          assigned_at: h.assigned_at,
          last_used: h.last_used,
          hardware
        };
      });
      await this.run(
        'UPDATE codes SET existing_hwids = $1::jsonb, notes = $2 WHERE code = $3',
        [
          JSON.stringify(existingHwidsPayload),
          existingHwidsPayload.length ? `EXISTING_HWIDS:${JSON.stringify(existingHwidsPayload)}` : null,
          code
        ]
      );
      console.log(`✅ Saved ${existingHwidsPayload.length} existing HWIDs for code ${code}`);
      
      await this.logUsage(
        'system', 
        code, 
        'auto_deactivated_' + reason, 
        `🔒 Code ${code} auto-deactivated due to ${reason}. ${deviceCount} devices revoked. NEW HWID (Trigger): ${newHwid || 'N/A'}. Existing HWIDs: ${existingHwids.length}. Owners cleared.`
      );
      
      await this.refreshCache();
      
      return {
        success: true,
        code: code,
        devices_revoked: deviceCount,
        reason: reason,
        status: status,
        new_hwid: newHwid,
        existing_hwids: existingHwids
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
      console.log('📊 Fetching auto-deactivated codes with HWID details...');
      
      const codesResult = await this.queuedQuery(`
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
          c.trigger_hwid_specs,
          c.existing_hwids,
          c.notes
        FROM codes c
        WHERE c.status IN ('auto_deactivated_limit_exceeded', 'auto_deactivated', 'auto_deactivated_multiple_hwids', 'auto_deactivated_unauthorized')
        AND c.is_active = false
        AND c.trigger_hwid IS NOT NULL
        ORDER BY c.triggered_at DESC NULLS LAST, c.created_at DESC
      `, [], 5);
      
      const codes = codesResult.rows || [];
      console.log(`✅ Found ${codes.length} auto-deactivated codes with trigger HWID`);
      
      const result = [];
      for (const code of codes) {
        let hwids = [];
        let existingHwidsFromNotes = [];

        if (code.existing_hwids) {
          try {
            existingHwidsFromNotes = typeof code.existing_hwids === 'string'
              ? JSON.parse(code.existing_hwids)
              : code.existing_hwids;
          } catch (e) {
            existingHwidsFromNotes = [];
          }
        }
        
        if ((!existingHwidsFromNotes || existingHwidsFromNotes.length === 0) &&
            code.notes && String(code.notes).startsWith('EXISTING_HWIDS:')) {
          try {
            const jsonStr = code.notes.replace('EXISTING_HWIDS:', '');
            existingHwidsFromNotes = JSON.parse(jsonStr);
          } catch (e) {
            existingHwidsFromNotes = [];
          }
        }
        
        const hwidsResult = await this.queuedQuery(`
          SELECT 
            ch.hwid,
            ch.assigned_at,
            ch.last_used,
            json_build_object(
              'cpu_name', COALESCE(d.cpu_name, 'Unknown'),
              'gpu_name', COALESCE(d.gpu_name, 'Unknown'),
              'ram_total_gb', COALESCE(d.ram_total_gb, 0),
              'storage_total_gb', COALESCE(d.storage_total_gb, 0),
              'device_name', COALESCE(d.device_name, 'Unknown'),
              'profile_name', COALESCE(d.profile_name, 'Default'),
              'registered_owner', COALESCE(d.registered_owner, 'Unknown')
            ) as hardware
          FROM code_hwids ch
          LEFT JOIN devices d ON d.hwid = ch.hwid
          WHERE ch.code = $1
          ORDER BY ch.assigned_at DESC
        `, [code.code], 5);
        
        if (existingHwidsFromNotes.length > 0) {
          hwids = existingHwidsFromNotes;
        } else if (hwidsResult.rows.length > 0) {
          hwids = hwidsResult.rows;
        } else if (code.code_hwid && code.code_hwid !== code.trigger_hwid) {
          const d = await this.get(
            `SELECT hwid, cpu_name, gpu_name, ram_total_gb, storage_total_gb, device_name, profile_name, registered_owner
             FROM devices WHERE hwid = $1 ORDER BY created_at DESC LIMIT 1`,
            [code.code_hwid]
          );
          hwids = d ? [{
            hwid: d.hwid || code.code_hwid,
            hardware: {
              cpu_name: d.cpu_name,
              gpu_name: d.gpu_name,
              ram_total_gb: d.ram_total_gb,
              device_name: d.device_name,
              profile_name: d.profile_name,
              registered_owner: d.registered_owner
            }
          }] : [{ hwid: code.code_hwid, hardware: null }];
        }
        
        let triggerHardware = null;
        let triggerHwid = code.trigger_hwid;

        if (code.trigger_hwid_specs) {
          const specs = typeof code.trigger_hwid_specs === 'string'
            ? JSON.parse(code.trigger_hwid_specs)
            : code.trigger_hwid_specs;
          triggerHardware = {
            cpu_name: specs.cpu || specs.cpu_name || 'Unknown',
            gpu_name: specs.gpu || specs.gpu_name || 'Unknown',
            ram_total_gb: specs.ram_gb || specs.ram_total_gb || 0,
            storage_total_gb: specs.storage_gb || specs.storage_total_gb || 0,
            device_name: specs.device || specs.device_name || 'Unknown',
            profile_name: specs.profile || specs.profile_name || 'Default',
            registered_owner: specs.owner || specs.registered_owner || 'Unknown'
          };
        } else if (triggerHwid) {
          const logResult = await this.queuedQuery(`
            SELECT details FROM usage_logs 
            WHERE code = $1 
            AND action = 'auto_deactivation_trigger'
            ORDER BY created_at DESC 
            LIMIT 1
          `, [code.code], 5);
          
          if (logResult.rows.length > 0) {
            const details = logResult.rows[0].details || '';
            const cpuMatch = details.match(/CPU:\s*([^,|]+)/i);
            const gpuMatch = details.match(/GPU:\s*([^,|]+)/i);
            const ramMatch = details.match(/RAM:\s*([^,|]+)\s*GB/i);
            const storageMatch = details.match(/Storage:\s*([^,|]+)\s*GB/i);
            const deviceMatch = details.match(/Device:\s*([^,|]+)/i);
            const profileMatch = details.match(/Profile:\s*([^,|]+)/i);
            const ownerMatch = details.match(/Owner:\s*([^,|]+)/i);
            triggerHardware = {};
            if (cpuMatch) triggerHardware.cpu_name = cpuMatch[1].trim();
            if (gpuMatch) triggerHardware.gpu_name = gpuMatch[1].trim();
            if (ramMatch) triggerHardware.ram_total_gb = parseFloat(ramMatch[1].trim());
            if (storageMatch) triggerHardware.storage_total_gb = parseFloat(storageMatch[1].trim());
            if (deviceMatch) triggerHardware.device_name = deviceMatch[1].trim();
            if (profileMatch) triggerHardware.profile_name = profileMatch[1].trim();
            if (ownerMatch) triggerHardware.registered_owner = ownerMatch[1].trim();
            if (Object.keys(triggerHardware).length === 0) triggerHardware = null;
          }
        }
        
        const countResult = await this.queuedQuery(`
          SELECT COUNT(*) as count FROM code_hwids WHERE code = $1
        `, [code.code], 5);
        
        result.push({
          code: code.code,
          username: code.username || 'N/A',
          access_level: code.access_level || 'VIP',
          subscription_type: code.subscription_type || 'Lifetime',
          status: code.status,
          is_active: code.is_active,
          created_at: code.created_at,
          expires_at: code.expires_at,
          max_hwid_limit: code.max_hwid_limit || 1,
          code_hwid: code.code_hwid,
          trigger_hwid: code.trigger_hwid,
          trigger_reason: code.trigger_reason,
          triggered_at: code.triggered_at,
          triggered_at_display: code.triggered_at ? new Date(code.triggered_at).toISOString() : null,
          hwid_count: Math.max(parseInt(countResult.rows[0]?.count || 0), (hwids || []).length),
          hwids: hwids || [],
          existing_hwids: hwids || [],
          trigger_hardware: triggerHardware,
          trigger_hwid_specs: triggerHardware,
          notes: code.notes
        });
      }
      
      console.log(`✅ Processed ${result.length} auto-deactivated codes with details`);
      return result;
    } catch (error) {
      console.error('❌ Get auto-deactivated codes with HWID details error:', error.message);
      console.error('   Stack:', error.stack);
      return [];
    }
  }

  // ============================================
  // DELETE AUTO-DEACTIVATED CODE LOGS (NOT THE CODE) - FIXED
  // ============================================

  async deleteAutoDeactivatedLogs(code) {
    try {
      console.log(`🗑️ Deleting logs for auto-deactivated code: ${code}`);
      
      const codeInfo = await this.get(
        'SELECT trigger_hwid FROM codes WHERE code = $1',
        [code]
      );
      
      let deletedCount = 0;
      
      // Delete usage logs for this code (instead of hwid_logs)
      const usageResult = await this.run(
        'DELETE FROM usage_logs WHERE code = $1 AND action LIKE $2',
        [code, 'auto_deactivation_trigger%']
      );
      deletedCount += usageResult.changes || 0;
      
      // ✅ CRITICAL FIX: Update status so code no longer appears in auto-deactivated list
      await this.run(
        `UPDATE codes 
         SET status = 'inactive', 
             trigger_hwid = NULL, 
             trigger_reason = NULL, 
             triggered_at = NULL,
             notes = NULL,
             is_active = false
         WHERE code = $1`,
        [code]
      );
      
      console.log(`✅ Deleted ${deletedCount} log entries for code ${code}`);
      console.log(`✅ Code ${code} status changed to 'inactive' (removed from auto-deactivated list)`);
      
      // Refresh cache to reflect changes immediately
      await this.refreshCache();
      
      return {
        success: true,
        deleted: deletedCount,
        message: `Deleted ${deletedCount} log entries for code ${code}`
      };
    } catch (error) {
      console.error('❌ Delete auto-deactivated logs error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ============================================
  // CODE MANAGEMENT - WITH OWNER CLEAR
  // ============================================

  calculateExpiration(startDate, subscriptionType) {
    const date = new Date(startDate);
    const months = {
      '1 Month': 1,
      'Per Month': 1,
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

  async getOwnersByCode() {
    try {
      const result = await this.all(`
        SELECT code,
               ARRAY_AGG(DISTINCT registered_owner) FILTER (
                 WHERE registered_owner IS NOT NULL
                   AND registered_owner <> ''
                   AND LOWER(registered_owner) NOT IN ('unknown', 'n/a', 'na')
               ) AS owners
        FROM devices
        WHERE code IS NOT NULL
        GROUP BY code
      `);
      const map = {};
      for (const row of (result || [])) {
        map[row.code] = (row.owners || []).filter(Boolean);
      }
      return map;
    } catch (error) {
      console.error('Get owners by code error:', error);
      return {};
    }
  }

  async getAllCodes() {
    try {
      const result = await this.all(
        `SELECT code, username, access_level, subscription_type, subscription_started_at, expires_at, status, is_active, used_count, created_at, notes, created_by, hwid, fingerprint, max_hwid_limit, trigger_hwid, trigger_reason, triggered_at
         FROM codes ORDER BY created_at DESC LIMIT 500`
      );
      const ownersByCode = await this.getOwnersByCode();
      return (result || []).map(c => ({
        ...c,
        owners: ownersByCode[c.code] || []
      }));
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

  // ============================================
  // DEACTIVATE CODE - WITH OWNER CLEAR
  // ============================================

  async deactivateCode(code) {
    try {
      const countResult = await this.get(
        'SELECT COUNT(*) as count FROM devices WHERE code = $1',
        [code]
      );
      const deviceCount = countResult ? parseInt(countResult.count) : 0;
      
      // CLEAR OWNERS FROM DEVICES BEFORE DELETING
      await this.run(
        'UPDATE devices SET registered_owner = NULL, profile_name = NULL, device_name = NULL WHERE code = $1',
        [code]
      );
      
      await this.run('DELETE FROM code_hwids WHERE code = $1', [code]);
      await this.run('DELETE FROM devices WHERE code = $1', [code]);
      
      const result = await this.run(
        'UPDATE codes SET is_active = false, status = $1, hwid = NULL, trigger_hwid = NULL, trigger_reason = NULL, triggered_at = NULL, notes = NULL WHERE code = $2',
        ['inactive', code]
      );
      
      await this.refreshCache();
      
      if (result.changes > 0) {
        console.log(`✅ Code deactivated: ${code} - ${deviceCount} devices removed. Owners cleared.`);
        return { success: true, devicesRemoved: deviceCount };
      }
      return { success: false, devicesRemoved: 0 };
    } catch (error) {
      console.error('Deactivate code error:', error);
      return { success: false, devicesRemoved: 0, error: error.message };
    }
  }

  // ============================================
  // REACTIVATE CODE - WITH OWNER CLEAR
  // ============================================

  async reactivateCode(code, subscriptionType = 'Lifetime') {
    try {
      const codeInfo = await this.getCodeInfo(code);
      if (!codeInfo) {
        return { success: false, error: 'Code not found' };
      }

      // CLEAR OWNERS FROM DEVICES BEFORE REACTIVATING
      await this.run(
        'UPDATE devices SET registered_owner = NULL, profile_name = NULL, device_name = NULL WHERE code = $1',
        [code]
      );

      if (!codeInfo.is_active || codeInfo.status === 'inactive' || codeInfo.status.includes('auto_deactivated')) {
        await this.run(
          'DELETE FROM code_hwids WHERE code = $1',
          [code]
        );
        await this.run(
          'UPDATE codes SET hwid = NULL, trigger_hwid = NULL, trigger_reason = NULL, triggered_at = NULL, notes = NULL WHERE code = $1',
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
             triggered_at = NULL,
             notes = NULL
         WHERE code = $4`,
        [subscriptionType, now, expiresAt, code]
      );
      
      await this.refreshCache();
      
      if (result.changes > 0) {
        console.log(`✅ Code reactivated: ${code} (${subscriptionType}). Owners cleared.`);
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
  // LOGGING - Only usage_logs, no hwid_logs
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

  // ✅ FIX: Add updatePing function
  async updatePing(deviceId) {
    try {
      const row = await this.get(
        `UPDATE devices
         SET last_ping = CURRENT_TIMESTAMP, ping_count = ping_count + 1, updated_at = CURRENT_TIMESTAMP
         WHERE device_id = $1
         RETURNING code, hwid`,
        [deviceId]
      );
      if (row && row.code && row.hwid) {
        await this.run(
          'UPDATE code_hwids SET last_used = CURRENT_TIMESTAMP WHERE code = $1 AND hwid = $2',
          [row.code, row.hwid]
        );
      }
    } catch (error) {
      console.error('Update ping error:', error);
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

  async getChatMessages(afterId = 0, limit = 40) {
    try {
      const rows = await this.all(
        `SELECT id, username, access_level, message, created_at
         FROM group_chat
         WHERE id > $1
         ORDER BY id ASC
         LIMIT $2`,
        [parseInt(afterId, 10) || 0, Math.min(80, parseInt(limit, 10) || 40)]
      );
      return rows || [];
    } catch (e) {
      console.error('getChatMessages:', e.message);
      return [];
    }
  }

  async addChatMessage(deviceId, message) {
    const text = String(message || '').trim().slice(0, 200);
    if (!text) return { success: false, error: 'Empty message' };
    const device = await this.get(
      'SELECT device_id, code, status FROM devices WHERE device_id = $1',
      [deviceId]
    );
    if (!device || !device.code || device.status === 'revoked') {
      return { success: false, error: 'Not approved' };
    }
    const codeInfo = await this.getCodeInfo(device.code);
    if (!codeInfo || !codeInfo.is_active || codeInfo.status !== 'active') {
      return { success: false, error: 'Code inactive' };
    }
    const row = await this.get(
      `INSERT INTO group_chat (device_id, username, access_level, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, access_level, message, created_at`,
      [deviceId, codeInfo.username || 'User', codeInfo.access_level || 'VIP', text]
    );
    return { success: true, message: row };
  }

  async cleanupInactiveDevices(daysInactive = 14) {
    try {
      const days = Math.max(7, parseInt(daysInactive, 10) || 14);

      const staleHwids = await this.query(`
        DELETE FROM code_hwids
        WHERE COALESCE(last_used, assigned_at) < NOW() - ($1 * INTERVAL '1 day')
        RETURNING code, hwid
      `, [days]);

      const result = await this.query(`
        DELETE FROM devices
        WHERE COALESCE(last_ping, updated_at, created_at) < NOW() - ($1 * INTERVAL '1 day')
        RETURNING device_id, code, hwid
      `, [days]);

      const removedHwids = staleHwids.rowCount || 0;
      const removedDevices = result.rowCount || 0;

      if (removedDevices > 0) {
        const codes = new Set();
        for (const row of result.rows) {
          if (row.code) codes.add(row.code);
          if (row.hwid && row.code) {
            await this.query(
              'DELETE FROM code_hwids WHERE code = $1 AND hwid = $2',
              [row.code, row.hwid]
            );
          }
        }
        for (const code of codes) {
          const left = await this.get(
            'SELECT COUNT(*) as count FROM devices WHERE code = $1',
            [code]
          );
          await this.query(
            'UPDATE codes SET used_count = $1 WHERE code = $2',
            [parseInt(left && left.count, 10) || 0, code]
          );
        }
      }

      if (removedDevices || removedHwids) {
        console.log(`🧹 Inactive cleanup (${days}d): ${removedDevices} devices, ${removedHwids} HWID slots`);
        await this.refreshCache();
      }

      return { devices: removedDevices, hwids: removedHwids, days };
    } catch (error) {
      console.error('Cleanup inactive devices error:', error);
      return { devices: 0, hwids: 0, error: error.message };
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
// EXPORT ONLY
// ============================================
module.exports = new DeviceDatabase();