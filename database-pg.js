// database-pg.js - COMPLETE WITH SSL FIX FOR RENDER

const { Pool } = require('pg');

// ============================================
// QUERY CACHE
// ============================================
class QueryCache {
  constructor(ttl = 30000) {
    this.cache = new Map();
    this.ttl = ttl;
  }
  
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }
  
  set(key, value) {
    this.cache.set(key, {
      value: value,
      timestamp: Date.now()
    });
  }
  
  clear() {
    this.cache.clear();
  }
  
  clearPrefix(prefix) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}

// ============================================
// CONNECTION QUEUE
// ============================================
class ConnectionQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.maxQueueSize = 1000;
    this.stats = {
      totalProcessed: 0,
      totalErrors: 0,
      averageWaitTime: 0
    };
  }
  
  async add(fn) {
    return new Promise((resolve, reject) => {
      if (this.queue.length > this.maxQueueSize) {
        reject(new Error('Queue is full - too many concurrent requests'));
        return;
      }
      
      const startTime = Date.now();
      this.queue.push({ 
        fn, 
        resolve, 
        reject,
        startTime 
      });
      
      this.process();
    });
  }
  
  async process() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    const item = this.queue.shift();
    const waitTime = Date.now() - item.startTime;
    
    try {
      const result = await item.fn();
      item.resolve(result);
      this.stats.totalProcessed++;
      this.stats.averageWaitTime = (this.stats.averageWaitTime + waitTime) / 2;
    } catch (error) {
      item.reject(error);
      this.stats.totalErrors++;
    } finally {
      this.processing = false;
      setImmediate(() => this.process());
    }
  }
  
  getStats() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.processing,
      maxQueueSize: this.maxQueueSize,
      totalProcessed: this.stats.totalProcessed,
      totalErrors: this.stats.totalErrors,
      averageWaitTime: Math.round(this.stats.averageWaitTime) + 'ms'
    };
  }
}

// ============================================
// MAIN DATABASE CLASS - FIXED SSL FOR RENDER
// ============================================
class DeviceDatabase {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const isProduction = process.env.NODE_ENV === 'production';
    const isSupabase = connectionString && connectionString.includes('supabase');
    
    console.log('📡 Connecting to database...');
    console.log(`🔗 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    console.log(`🔗 Connection string: ${connectionString ? connectionString.substring(0, 50) + '...' : 'Not set'}`);
    
    // ============================================
    // SSL CONFIGURATION - Works for both local and Render
    // ============================================
    let sslConfig;
    
    if (isProduction) {
      // Production (Render) - Need SSL with rejectUnauthorized false
      sslConfig = {
        rejectUnauthorized: false
      };
    } else {
      // Local development - Disable SSL
      sslConfig = false;
    }
    
    this.pool = new Pool({
      connectionString: connectionString,
      ssl: sslConfig,
      max: parseInt(process.env.DB_POOL_MAX) || 10,
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 60000,
      connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT) || 120000,
      maxUses: parseInt(process.env.DB_POOL_MAX_USES) || 1000,
      allowExitOnIdle: false,
      max_lifetime: 3600000,
      statement_timeout: 120000,
      query_timeout: 120000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 30000,
      application_name: 'wantmatures_server',
      connect_timeout: 60,
      keepalives: 1,
      keepalives_idle: 60,
      keepalives_interval: 30,
      keepalives_count: 5,
      idle_in_transaction_session_timeout: 120000
    });
    
    // Pool event handlers
    this.pool.on('error', (err) => {
      console.error('❌ Database pool error:', err);
    });
    
    this.pool.on('connect', () => {
      console.log('🔗 New database connection established');
    });
    
    this.pool.on('remove', () => {
      console.log('🔌 Database connection removed from pool');
    });
    
    // Initialize components
    this.queryCache = new QueryCache(30000);
    this.connectionQueue = new ConnectionQueue();
    
    // Memory cache
    this.cache = {
      codes: [],
      stats: { 
        total: 0, 
        pending: 0,
        approved: 0, 
        revoked: 0, 
        totalPings: 0, 
        totalCodes: 0, 
        activeCodes: 0, 
        pendingRequests: 0 
      },
      devices: [],
      requests: [],
      lastUpdate: 0,
      hasInitialData: false
    };
    
    // Initialize database
    this.initDatabase();
    this.startPoolMonitoring();
    
    console.log('✅ PostgreSQL Database initialized');
    console.log(`📊 Connection Pool: max=${this.pool.options.max}, min=${this.pool.options.min}`);
    console.log(`🔒 SSL: ${this.pool.options.ssl ? 'Enabled' : 'Disabled'}`);
  }

  // ============================================
  // POOL MONITORING
  // ============================================

  getPoolStats() {
    try {
      return {
        totalConnections: this.pool.totalCount || 0,
        idleConnections: this.pool.idleCount || 0,
        waitingClients: this.pool.waitingCount || 0,
        maxConnections: this.pool.options.max || 10,
        minConnections: this.pool.options.min || 2,
        usagePercent: this.pool.totalCount ? 
          Math.round((this.pool.totalCount / this.pool.options.max) * 100) : 0
      };
    } catch (error) {
      return {
        totalConnections: 0,
        idleConnections: 0,
        waitingClients: 0,
        maxConnections: 10,
        minConnections: 2,
        usagePercent: 0
      };
    }
  }

  getQueueStats() {
    return this.connectionQueue.getStats();
  }

  async monitorPoolHealth() {
    const poolStats = this.getPoolStats();
    const queueStats = this.getQueueStats();
    
    console.log('📊 Database Health:');
    console.log(`   Pool: ${poolStats.totalConnections}/${poolStats.maxConnections} (${poolStats.usagePercent}%)`);
    console.log(`   Idle: ${poolStats.idleConnections}, Waiting: ${poolStats.waitingClients}`);
    console.log(`   Queue: ${queueStats.queueLength} pending`);
    
    if (poolStats.usagePercent > 80) {
      console.warn(`⚠️ Pool at ${poolStats.usagePercent}%`);
    }
    
    if (poolStats.waitingClients > 5) {
      console.warn(`⚠️ ${poolStats.waitingClients} clients waiting`);
    }
    
    return { poolStats, queueStats };
  }

  startPoolMonitoring() {
    setInterval(async () => {
      try {
        await this.monitorPoolHealth();
      } catch (e) {}
    }, 60000);
  }

  // ============================================
  // INIT DATABASE
  // ============================================
  
  async initDatabase() {
    try {
      await this.testConnection();
      await this.initTables();
      await this.refreshCache();
      console.log('✅ Database initialization complete!');
    } catch (error) {
      console.error('❌ Database initialization failed:', error.message);
      console.log('💡 Please check your DATABASE_URL in .env file');
      console.log('💡 Make sure your IP is allowed in Supabase dashboard');
    }
  }

  // ============================================
  // TEST CONNECTION WITH RETRY
  // ============================================

  async testConnection(retries = 5) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`🔄 Testing connection (attempt ${attempt}/${retries})...`);
        const result = await this.query('SELECT NOW() as time, version() as version');
        console.log('✅ Database connection successful!');
        console.log(`📅 Server time: ${result.rows[0].time}`);
        console.log(`📦 PostgreSQL: ${result.rows[0].version}`);
        return true;
      } catch (error) {
        console.error(`❌ Connection attempt ${attempt} failed:`, error.message);
        if (attempt < retries) {
          const delay = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      }
    }
  }

  // ============================================
  // QUERY METHODS WITH RETRY AND TIMEOUT
  // ============================================

  async query(sql, params = [], retries = 5) {
    return this.connectionQueue.add(async () => {
      let client = null;
      let lastError = null;
      
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          client = await this.pool.connect();
          const startTime = Date.now();
          const result = await client.query(sql, params);
          const duration = Date.now() - startTime;
          
          if (duration > 5000) {
            console.warn(`⚠️ Slow query (${duration}ms): ${sql.substring(0, 100)}...`);
          }
          
          if (client) {
            client.release();
            client = null;
          }
          
          return result;
        } catch (error) {
          lastError = error;
          console.error(`❌ Query attempt ${attempt}/${retries} failed:`, error.message);
          
          if (client) {
            try { client.release(); } catch (e) {}
            client = null;
          }
          
          if (error.code === '42701' || error.message.includes('already exists')) {
            throw error;
          }
          
          if (error.message.includes('Queue is full')) {
            throw error;
          }
          
          if (attempt < retries) {
            const backoff = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
            console.log(`⏳ Retrying in ${backoff}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoff));
          }
        }
      }
      
      if (client) {
        try { client.release(); } catch (e) {}
      }
      
      throw lastError || new Error('Query failed after all retries');
    });
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
      console.log('🔄 Creating/verifying tables...');
      
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
        } catch (e) {}
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

      // Devices table
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

      // Add hardware and wallpaper columns
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
        } catch (e) {}
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

      // Indexes
      await this.query(`CREATE INDEX IF NOT EXISTS idx_codes_hwid ON codes(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_devices_hwid ON devices(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_codes_username ON codes(username)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_code_hwids_code ON code_hwids(code)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_code_hwids_hwid ON code_hwids(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_hwid_logs_hwid ON hwid_logs(hwid)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_hwid_logs_created_at ON hwid_logs(created_at DESC)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_hwid_logs_status ON hwid_logs(status)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_devices_code ON devices(code)`);
      await this.query(`CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status)`);

      console.log('✅ Tables created/verified');
      
    } catch (error) {
      console.error('❌ Failed to create tables:', error.message);
      throw error;
    }
  }

  // ============================================
  // CACHED QUERIES
  // ============================================

  async getCodeInfo(code) {
    const cacheKey = `code_${code}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached) return cached;
    
    try {
      const result = await this.get('SELECT * FROM codes WHERE code = $1', [code]);
      if (result) {
        this.queryCache.set(cacheKey, result);
      }
      return result;
    } catch (error) {
      console.error('Get code info error:', error);
      return null;
    }
  }

  async getDevice(deviceId) {
    const cacheKey = `device_${deviceId}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached) return cached;
    
    try {
      const result = await this.get('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
      if (result) {
        this.queryCache.set(cacheKey, result);
      }
      return result;
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

      await this.run('UPDATE codes SET used_count = used_count + 1 WHERE code = $1', [code]);
      
      await this.logUsage(deviceId, code, 'register', 
        `Device registered | Profile: ${profileName} | CPU: ${cpuName} | GPU: ${gpuName} | Wallpaper: ${wallpaperName || 'None'}`
      );
      
      // Clear cache
      this.queryCache.clearPrefix(`device_${deviceId}`);
      this.queryCache.clearPrefix(`code_${code}`);
      
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
  // HWID METHODS
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
      this.queryCache.clearPrefix(`code_${code}`);
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

      this.queryCache.clearPrefix(`code_${code}`);
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
        this.queryCache.clearPrefix(`code_${code}`);
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
        
        this.queryCache.clearPrefix(`code_${code}`);
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
      const devices = await this.all(
        'SELECT device_id FROM devices WHERE code = $1 AND status != $2',
        [code, 'revoked']
      );
      
      await this.run(
        'DELETE FROM code_hwids WHERE code = $1',
        [code]
      );
      
      for (const device of devices) {
        await this.run(
          'DELETE FROM devices WHERE device_id = $1',
          [device.device_id]
        );
        console.log(`🗑️ Removed device: ${device.device_id}`);
      }
      
      const result = await this.run(
        'UPDATE codes SET is_active = false, status = $1, hwid = NULL WHERE code = $2',
        ['inactive', code]
      );
      
      this.queryCache.clearPrefix(`code_${code}`);
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
      
      this.queryCache.clearPrefix(`code_${code}`);
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
      
      this.queryCache.clearPrefix(`code_${code}`);
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
      
      this.queryCache.clearPrefix(`code_${code}`);
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
      
      this.queryCache.clearPrefix(`code_${code}`);
      await this.refreshCache();
      
      if (result.changes > 0) {
        console.log(`✅ Code subscription updated: ${code} -> ${subscriptionType}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Update subscription error:', error);
      return false;
    }
  }

  async deleteCode(code) {
    try {
      await this.run('DELETE FROM code_hwids WHERE code = $1', [code]);
      await this.run('DELETE FROM devices WHERE code = $1', [code]);
      const result = await this.run('DELETE FROM codes WHERE code = $1', [code]);
      
      this.queryCache.clear();
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

  async getNewUniqueHwids(limit = 100) {
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
            CASE 
                WHEN ch.code IS NOT NULL THEN 'assigned'
                ELSE 'new'
            END as assignment_status,
            ch.code as assigned_code,
            d.cpu_name,
            d.gpu_name,
            d.ram_total_gb,
            d.storage_total_gb,
            d.device_name,
            d.browser_profile as device_profile,
            d.wallpaper_name
        FROM hwid_logs l
        LEFT JOIN code_hwids ch ON l.hwid = ch.hwid
        LEFT JOIN devices d ON l.hwid = d.hwid
        WHERE (l.status = 'new' OR l.status = 'seen')
        AND ch.code IS NULL
        ORDER BY l.created_at DESC
        LIMIT $1
      `, [limit]);
      
      const uniqueMap = new Map();
      for (const row of result) {
        if (!uniqueMap.has(row.hwid)) {
          uniqueMap.set(row.hwid, row);
        }
      }
      
      return Array.from(uniqueMap.values());
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

  async getHwidLogsWithAssignment(limit = 200, status = null) {
    try {
      let query = `
        SELECT 
            l.*,
            CASE 
                WHEN ch.code IS NOT NULL THEN 'assigned'
                ELSE 'unassigned'
            END as assignment_status,
            ch.code as assigned_code,
            c.username as assigned_username
        FROM hwid_logs l
        LEFT JOIN code_hwids ch ON l.hwid = ch.hwid
        LEFT JOIN codes c ON ch.code = c.code
        WHERE ch.code IS NULL
      `;
      const params = [];
      
      if (status) {
        query += ` AND l.status = $1`;
        params.push(status);
      }
      
      query += ` ORDER BY l.created_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);
      
      const result = await this.all(query, params);
      return result || [];
    } catch (error) {
      console.error('❌ Get HWID logs with assignment error:', error.message);
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
        
        this.queryCache.clearPrefix(`device_${deviceId}`);
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
        this.queryCache.clearPrefix(`device_${deviceId}`);
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
      this.queryCache.clearPrefix(`device_${deviceId}`);
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
      const startTime = Date.now();
      
      const results = await Promise.allSettled([
        this.getAllCodes().catch(e => { 
          console.error('❌ Codes fetch error:', e.message); 
          return []; 
        }),
        this.getStats().catch(e => { 
          console.error('❌ Stats fetch error:', e.message); 
          return {}; 
        }),
        this.getDevices().catch(e => { 
          console.error('❌ Devices fetch error:', e.message); 
          return []; 
        }),
        this.getPendingRequests().catch(e => { 
          console.error('❌ Requests fetch error:', e.message); 
          return []; 
        })
      ]);
      
      const [codesResult, statsResult, devicesResult, requestsResult] = results;
      
      if (codesResult.status === 'fulfilled' && codesResult.value.length > 0) {
        this.cache.codes = codesResult.value;
      } else if (!this.cache.hasInitialData) {
        this.cache.codes = [];
      }
      
      if (statsResult.status === 'fulfilled' && Object.keys(statsResult.value).length > 0) {
        this.cache.stats = statsResult.value;
      }
      
      if (devicesResult.status === 'fulfilled' && devicesResult.value.length > 0) {
        this.cache.devices = devicesResult.value;
      } else if (!this.cache.hasInitialData) {
        this.cache.devices = [];
      }
      
      if (requestsResult.status === 'fulfilled' && requestsResult.value.length > 0) {
        this.cache.requests = requestsResult.value;
      } else if (!this.cache.hasInitialData) {
        this.cache.requests = [];
      }
      
      this.cache.lastUpdate = Date.now();
      this.cache.hasInitialData = true;
      
      const duration = Date.now() - startTime;
      console.log(`✅ Cache refreshed in ${duration}ms: ${this.cache.codes.length} codes, ${this.cache.devices.length} devices`);
      
      await this.monitorPoolHealth();
      
      return this.cache;
    } catch (error) {
      console.error('Cache refresh error:', error);
      return this.cache;
    }
  }

  getCachedData() {
    return {
      codes: this.cache.codes || [],
      stats: this.cache.stats || { total: 0, pending: 0, approved: 0, revoked: 0, totalPings: 0, totalCodes: 0, activeCodes: 0, pendingRequests: 0 },
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
        UPDATE devices 
        SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP 
        WHERE last_ping < NOW() - INTERVAL '7 days'
        AND status != 'revoked'
        RETURNING device_id, code
      `);
      
      if (result.rowCount > 0) {
        console.log(`🧹 Cleaned up ${result.rowCount} inactive devices`);
        
        for (const row of result.rows) {
          await this.query(
            `UPDATE codes SET used_count = GREATEST(used_count - 1, 0) WHERE code = $1`,
            [row.code]
          );
          this.queryCache.clearPrefix(`device_${row.device_id}`);
        }
      }
      
      return result.rowCount;
    } catch (error) {
      console.error('Cleanup inactive devices error:', error);
      return 0;
    }
  }

  // ============================================
  // BULK OPERATIONS
  // ============================================

  async bulkRegisterDevices(devices) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const device of devices) {
        await client.query(
          `INSERT INTO devices (device_id, user_agent, ip_address, code, hwid, status, approved_at)
           VALUES ($1, $2, $3, $4, $5, 'approved', CURRENT_TIMESTAMP)
           ON CONFLICT (device_id) DO UPDATE SET 
             user_agent = EXCLUDED.user_agent,
             ip_address = EXCLUDED.ip_address,
             code = EXCLUDED.code,
             hwid = EXCLUDED.hwid,
             status = 'approved',
             approved_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP`,
          [device.device_id, device.user_agent, device.ip, device.code, device.hwid]
        );
      }
      
      await client.query('COMMIT');
      this.queryCache.clear();
      await this.refreshCache();
      return { success: true, count: devices.length };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ============================================
  // QUEUE STATS
  // ============================================

  getQueueStats() {
    return this.connectionQueue.getStats();
  }

  // ============================================
  // CLOSE CONNECTION
  // ============================================

  close() {
    this.pool.end();
  }
}

module.exports = new DeviceDatabase();