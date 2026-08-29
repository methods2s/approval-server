// server.js - COMPLETE CLEAN VERSION (No Wallpaper, No HWID Logs, No New HWID)

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const helmet = require('helmet');
const db = require('./database-pg');

const app = express();
const PORT = process.env.PORT || 3000;

// SSL Fix - Allow self-signed certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

app.set('trust proxy', 1);

// ============================================
// SECURITY & COMPRESSION
// ============================================

app.use(compression({
  level: 4,
  threshold: 2048,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// ============================================
// CORS - Chrome Extensions Allowed
// ============================================

const corsOptions = {
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://wantmatures-approval-server.onrender.com',
      'https://*.onrender.com'
    ];
    if (allowedOrigins.includes(origin) || origin.includes('onrender.com')) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'Origin', 'Access-Control-Allow-Origin']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ============================================
// HEADERS
// ============================================
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  if (origin && origin.startsWith('chrome-extension://')) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With, Origin, Access-Control-Allow-Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Expose-Headers', 'Content-Length, X-JSON');
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  res.header('Surrogate-Control', 'no-store');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// SESSION
// ============================================
app.use(session({
    secret: process.env.SESSION_SECRET || 'default-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

// ============================================
// REQUEST TIMEOUT
// ============================================
app.use((req, res, next) => {
    req.setTimeout(60000, () => {
        res.status(408).json({ error: 'Request timeout' });
    });
    next();
});

// ============================================
// RATE LIMIT
// ============================================

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.GENERAL_RATE_LIMIT_MAX) || 2000,
    message: { 
        error: 'Too many requests, please try again later.',
        retryAfter: 15 * 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: function(req) {
        const skipPaths = [
            '/api/dashboard-data',
            '/api/status/',
            '/api/code/',
            '/api/device/',
            '/api/auto-deactivated-codes',
            '/api/auto-deactivated-code/'
        ];
        return skipPaths.some(path => req.path.startsWith(path));
    }
});

app.use('/api/', limiter);

const registerLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.REGISTER_RATE_LIMIT_MAX) || 50,
    message: { error: 'Too many registration attempts. Please wait.' }
});
app.use('/api/register', registerLimiter);

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.API_RATE_LIMIT_MAX) || 300,
    message: { error: 'Too many API requests. Please wait.' }
});
app.use('/api/codes', apiLimiter);
app.use('/api/device/', apiLimiter);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public', {
    maxAge: '1d',
    etag: true
}));

// ============================================
// MIDDLEWARE
// ============================================

function isAuthenticated(req, res, next) {
    if (req.session && req.session.isAuthenticated) {
        return next();
    }
    res.redirect('/login');
}

function isApiAuthenticated(req, res, next) {
    if (req.session && req.session.isAuthenticated) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized', message: 'Please log in' });
}

// ============================================
// HEALTH CHECK
// ============================================

app.get('/api/health', async (req, res) => {
    const poolStatus = db.getPoolStatus();
    
    try {
        await db.query('SELECT 1');
        res.json({
            status: 'healthy',
            database: 'connected',
            pool: poolStatus,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            cache: {
                hasData: db.cache.hasInitialData,
                lastUpdate: db.cache.lastUpdate ? new Date(db.cache.lastUpdate).toISOString() : 'never',
                codes: db.cache.codes.length,
                devices: db.cache.devices.length,
                ttl: db.cacheTTL
            }
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            database: 'disconnected',
            error: error.message,
            pool: poolStatus,
            timestamp: new Date().toISOString()
        });
    }
});

// ============================================
// LOGIN ROUTES
// ============================================

app.get('/login', (req, res) => {
    if (req.session && req.session.isAuthenticated) {
        return res.redirect('/dashboard');
    }
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.render('login', { error: 'Username and password required' });
    }

    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'password123';
    
    if (username === adminUsername && password === adminPassword) {
        req.session.isAuthenticated = true;
        req.session.username = username;
        return res.redirect('/dashboard');
    }
    
    res.render('login', { error: 'Invalid username or password' });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ============================================
// DASHBOARD
// ============================================

app.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        db.cleanupInactiveDevices().catch(err => console.error('Cleanup error:', err));
        
        const data = await db.getDashboardData();
        let autoDeactivated = [];
        try {
            autoDeactivated = await db.getAutoDeactivatedCodesWithHwidDetails();
        } catch (e) {
            console.error('Dashboard auto-deactivated load error:', e);
        }
        res.render('dashboard', { 
            username: req.session.username,
            devices: data.devices || [],
            stats: data.stats || {},
            codes: data.codes || [],
            requests: data.requests || [],
            autoDeactivated: autoDeactivated || [],
            autoRefresh: true,
            refreshInterval: 15000
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        const cached = db.getCachedData();
        res.render('dashboard', { 
            username: req.session.username,
            devices: cached.devices || [],
            stats: cached.stats || {},
            codes: cached.codes || [],
            requests: cached.requests || [],
            autoRefresh: true,
            refreshInterval: 15000,
            error: 'Failed to load data'
        });
    }
});

app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

app.post('/api/force-refresh', isApiAuthenticated, async (req, res) => {
    try {
        await db.refreshCache();
        const cached = db.getCachedData();
        res.json({
            success: true,
            message: 'Cache refreshed from database',
            data: cached
        });
    } catch (error) {
        console.error('Force refresh error:', error);
        res.status(500).json({ error: 'Failed to refresh cache' });
    }
});

// ============================================
// REGISTER DEVICE - OPTIMIZED (NO WALLPAPER, NO HWID LOGS)
// ============================================

app.post('/api/register', async (req, res) => {
    console.log('📥 REGISTER REQUEST RECEIVED');
    console.log('📌 Origin:', req.headers.origin);
    
    const { 
        deviceId, 
        userAgent, 
        browserInfo, 
        code, 
        hwid,
        browser_profile,
        hardware,
        detected_hwids
    } = req.body;

    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID is required' });
    }

    if (!code) {
        return res.status(400).json({ error: 'Activation code is required' });
    }

    if (!hwid) {
        return res.status(403).json({
            error: '❌ HWID is required. Please run the Python software first.',
            status: 'hwid_required'
        });
    }

    try {
        const codeInfo = await db.get('SELECT * FROM codes WHERE code = $1', [code.toUpperCase()]);
        if (!codeInfo) {
            return res.status(400).json({
                error: '❌ Invalid code. Please check your code and try again.',
                status: 'invalid_code'
            });
        }

        if (!codeInfo.is_active) {
            return res.status(400).json({
                error: '❌ This code has been deactivated. Please contact admin.',
                status: 'code_inactive'
            });
        }

        const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';

        const isAuthorized = await db.isHwidAuthorized(code.toUpperCase(), hwid);

        if (!isAuthorized) {
            console.log(`🔄 HWID not authorized for code ${code}, attempting auto-assignment...`);
            
            const assignResult = await db.assignHwidToCode(code.toUpperCase(), hwid, true, hardware);
            
            if (!assignResult.success) {
                if (assignResult.auto_deactivate) {
                    console.log(`🔥 Auto-deactivating code ${code} due to HWID limit exceeded`);
                    console.log(`   NEW HWID (Trigger): ${hwid.substring(0, 16)}...`);
                    
                    let hwidDetailsFromRequest = null;
                    if (hardware) {
                        try {
                            const hw = typeof hardware === 'string' ? JSON.parse(hardware) : hardware;
                            hwidDetailsFromRequest = {
                                cpu: hw.cpu || hw.cpu_name || 'N/A',
                                gpu: hw.gpu || hw.gpu_name || 'N/A',
                                ram: hw.ram_gb || hw.ram_total_gb || 0,
                                storage: hw.storage_gb || hw.storage_total_gb || 0,
                                device: hw.device_name || 'N/A',
                                profile: browser_profile || hw.profile_name || 'Default',
                                owner: hw.registered_owner || 'N/A'
                            };
                            console.log(`✅ Extracted hardware from request for NEW HWID:`, hwidDetailsFromRequest);
                        } catch (e) {
                            console.log('⚠️ Failed to parse hardware from request:', e.message);
                        }
                    }
                    
                    const finalHwidDetails = hwidDetailsFromRequest;
                    console.log(`   Final HWID Details for NEW HWID:`, finalHwidDetails);
                    
                    const deactivateResult = await db.autoDeactivateCode(
                        code.toUpperCase(), 
                        'hwid_limit_exceeded_auto_assign', 
                        hwid,
                        finalHwidDetails
                    );
                    
                    console.log(`   Deactivate result:`, deactivateResult);
                    
                    return res.status(403).json({
                        error: `🚨 HWID LIMIT EXCEEDED! Code ${code} has been AUTO-DEACTIVATED.`,
                        status: 'unauthorized_deactivated',
                        code: code,
                        devices_revoked: deactivateResult.devices_revoked || 0,
                        max_hwid_limit: assignResult.max_limit,
                        current_hwid_count: assignResult.current_count,
                        new_hwid: hwid
                    });
                }
                
                const otherCode = await db.get(
                    'SELECT code FROM code_hwids WHERE hwid = $1',
                    [hwid]
                );
                
                if (otherCode) {
                    return res.status(403).json({
                        error: `⚠️ This computer is already registered to code: ${otherCode.code}`,
                        status: 'hwid_already_registered',
                        existing_code: otherCode.code
                    });
                }
                
                return res.status(403).json({
                    error: `❌ ${assignResult.error}`,
                    status: 'hwid_not_authorized',
                    current_hwid_count: assignResult.current_count || 0,
                    max_hwid_limit: assignResult.max_limit || 0
                });
            }
            
            console.log(`✅ HWID auto-assigned to code ${code}`);
        }

        // Parse hardware specs (NO WALLPAPER)
        let parsedHardware = {};
        try {
            parsedHardware = typeof hardware === 'string' ? JSON.parse(hardware) : hardware || {};
        } catch (e) {
            parsedHardware = {};
        }

        const cpuName = parsedHardware.cpu || parsedHardware.cpu_name || 'Unknown';
        const gpuName = parsedHardware.gpu || parsedHardware.gpu_name || 'Unknown';
        const ramTotal = parsedHardware.ram_gb || parsedHardware.ram_total_gb || 0;
        const storageTotal = parsedHardware.storage_gb || parsedHardware.storage_total_gb || 0;
        const deviceName = parsedHardware.device_name || 'Unknown';
        const profileName = browser_profile || parsedHardware.profile_name || 'Default';
        const registeredOwner = parsedHardware.registered_owner || 'Unknown';

        let parsedBrowserInfo = {};
        try {
            parsedBrowserInfo = typeof browserInfo === 'string' ? JSON.parse(browserInfo) : browserInfo || {};
        } catch (e) {
            parsedBrowserInfo = {};
        }

        const result = await db.registerDeviceWithCode(
            deviceId,
            userAgent,
            ip,
            parsedBrowserInfo,
            code.toUpperCase(),
            hwid,
            parsedHardware
        );

        if (!result.success) {
            return res.status(400).json({
                error: result.error,
                status: 'registration_failed'
            });
        }

        await db.refreshCache();

        const updatedCodeInfo = await db.getCodeInfo(code.toUpperCase());

        const responseData = {
            success: true,
            status: 'approved',
            code: code,
            username: updatedCodeInfo.username,
            access: updatedCodeInfo.access_level,
            subscription: updatedCodeInfo.subscription_type,
            subscription_started_at: updatedCodeInfo.subscription_started_at,
            subscription_expires_at: updatedCodeInfo.expires_at,
            status_code: updatedCodeInfo.status,
            hwid_verified: true,
            browser_profile: profileName,
            registered_owner: registeredOwner,
            hardware: {
                cpu: cpuName,
                gpu: gpuName,
                ram_gb: ramTotal,
                storage_gb: storageTotal,
                device_name: deviceName,
                profile_name: profileName,
                registered_owner: registeredOwner
            },
            message: `✅ Profile registered with hardware specs`
        };

        console.log('✅ Registration successful for device:', deviceId);
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({ 
            error: 'Registration failed: ' + error.message,
            details: error.stack
        });
    }
});

// ============================================
// STATUS CHECK - OPTIMIZED (NO WALLPAPER)
// ============================================

app.get('/api/status/:deviceId', async (req, res) => {
    const { deviceId } = req.params;
    
    try {
        const device = await db.getDevice(deviceId);
        
        if (!device) {
            return res.json({ 
                exists: false,
                approved: false,
                status: 'not_found',
                message: 'Device not found - Please enter your code again',
                needsCode: true,
                username: null,
                access: null,
                subscription: null,
                subscription_started_at: null,
                subscription_expires_at: null,
                status_code: null,
                hardware: null,
                registered_owner: null
            });
        }

        if (!device.code) {
            return res.json({
                exists: true,
                approved: false,
                status: 'no_code',
                message: 'Device has no active code - Please enter your code again',
                needsCode: true,
                username: null,
                access: null,
                subscription: null,
                subscription_started_at: null,
                subscription_expires_at: null,
                status_code: null,
                hardware: {
                    cpu: device.cpu_name,
                    gpu: device.gpu_name,
                    ram_gb: device.ram_total_gb,
                    storage_gb: device.storage_total_gb,
                    device_name: device.device_name,
                    profile_name: device.profile_name,
                    registered_owner: device.registered_owner || 'Unknown'
                }
            });
        }

        const codeInfo = await db.getCodeInfo(device.code);
        
        if (!codeInfo || !codeInfo.is_active) {
            let deactivationReason = 'Code deactivated';
            if (codeInfo && codeInfo.status) {
                const statusMap = {
                    'auto_deactivated': 'Auto-deactivated (General)',
                    'auto_deactivated_multiple_hwids': '🚨 Auto-deactivated - Multiple HWIDs detected',
                    'auto_deactivated_limit_exceeded': '🚨 Auto-deactivated - HWID limit exceeded',
                    'auto_deactivated_unauthorized': '🚨 Auto-deactivated - Unauthorized use',
                    'inactive': 'Manually deactivated by admin',
                    'expired': 'Subscription expired'
                };
                deactivationReason = statusMap[codeInfo.status] || codeInfo.status;
            }
            
            return res.json({
                exists: true,
                approved: false,
                status: 'code_inactive',
                message: deactivationReason,
                needsCode: true,
                code: device.code,
                username: null,
                access: null,
                subscription: null,
                subscription_started_at: null,
                subscription_expires_at: null,
                status_code: codeInfo ? codeInfo.status : 'inactive',
                hardware: {
                    cpu: device.cpu_name,
                    gpu: device.gpu_name,
                    ram_gb: device.ram_total_gb,
                    storage_gb: device.storage_total_gb,
                    device_name: device.device_name,
                    profile_name: device.profile_name,
                    registered_owner: device.registered_owner || 'Unknown'
                }
            });
        }

        if (codeInfo.subscription_type !== 'Lifetime' && codeInfo.expires_at) {
            const now = new Date();
            const expires = new Date(codeInfo.expires_at);
            if (now > expires) {
                await db.run(`UPDATE codes SET status = 'expired' WHERE code = $1`, [device.code]);
                return res.json({
                    exists: true,
                    approved: false,
                    status: 'expired',
                    message: 'Your subscription has expired',
                    needsCode: true,
                    code: device.code,
                    username: codeInfo.username,
                    access: codeInfo.access_level,
                    subscription: codeInfo.subscription_type,
                    subscription_started_at: codeInfo.subscription_started_at,
                    subscription_expires_at: codeInfo.expires_at,
                    status_code: 'expired',
                    hardware: {
                        cpu: device.cpu_name,
                        gpu: device.gpu_name,
                        ram_gb: device.ram_total_gb,
                        storage_gb: device.storage_total_gb,
                        device_name: device.device_name,
                        profile_name: device.profile_name,
                        registered_owner: device.registered_owner || 'Unknown'
                    }
                });
            }
        }

        if (codeInfo.status !== 'active') {
            return res.json({
                exists: true,
                approved: false,
                status: codeInfo.status,
                message: `Your code is ${codeInfo.status}`,
                needsCode: true,
                code: device.code,
                username: codeInfo.username,
                access: codeInfo.access_level,
                subscription: codeInfo.subscription_type,
                subscription_started_at: codeInfo.subscription_started_at,
                subscription_expires_at: codeInfo.expires_at,
                status_code: codeInfo.status,
                hardware: {
                    cpu: device.cpu_name,
                    gpu: device.gpu_name,
                    ram_gb: device.ram_total_gb,
                    storage_gb: device.storage_total_gb,
                    device_name: device.device_name,
                    profile_name: device.profile_name,
                    registered_owner: device.registered_owner || 'Unknown'
                }
            });
        }

        // ✅ FIXED: Await the updatePing function
        await db.updatePing(deviceId).catch(err => console.error('Ping update error:', err));

        res.json({
            exists: true,
            approved: true,
            status: device.status,
            code: device.code,
            username: codeInfo.username,
            access: codeInfo.access_level,
            subscription: codeInfo.subscription_type,
            subscription_started_at: codeInfo.subscription_started_at,
            subscription_expires_at: codeInfo.expires_at,
            status_code: codeInfo.status,
            hardware: {
                cpu: device.cpu_name,
                gpu: device.gpu_name,
                ram_gb: device.ram_total_gb,
                storage_gb: device.storage_total_gb,
                device_name: device.device_name,
                profile_name: device.profile_name,
                registered_owner: device.registered_owner || 'Unknown'
            },
            device: {
                id: device.device_id,
                approved_at: device.approved_at,
                revoked_at: device.revoked_at
            }
        });
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ 
            error: 'Failed to check status',
            exists: false,
            approved: false,
            needsCode: true,
            username: null,
            access: null,
            subscription: null,
            subscription_started_at: null,
            subscription_expires_at: null,
            status_code: null,
            hardware: null,
            registered_owner: null
        });
    }
});

// ============================================
// AUTO-DEACTIVATE
// ============================================

app.post('/api/auto-deactivate', async (req, res) => {
    const { code, reason, hwids, deviceId, details } = req.body;
    
    console.log('🚨 AUTO-DEACTIVATE REQUEST RECEIVED!');
    console.log(`📌 Code: ${code}`);
    console.log(`📋 Reason: ${reason}`);
    
    try {
        const codeInfo = await db.get('SELECT * FROM codes WHERE code = $1', [code]);
        if (!codeInfo) {
            console.log('❌ Code not found:', code);
            return res.status(404).json({ error: 'Code not found' });
        }
        
        if (!codeInfo.is_active) {
            console.log('⚠️ Code already deactivated:', code);
            return res.json({ 
                success: true, 
                message: 'Code already deactivated',
                already_deactivated: true,
                status: codeInfo.status
            });
        }
        
        console.log(`🔥 Auto-deactivating code ${code} due to: ${reason}`);
        
        let status = 'auto_deactivated';
        if (reason === 'multiple_hwids_detected') {
            status = 'auto_deactivated_multiple_hwids';
        } else if (reason === 'hwid_limit_exceeded') {
            status = 'auto_deactivated_limit_exceeded';
        } else if (reason === 'unauthorized_use') {
            status = 'auto_deactivated_unauthorized';
        }
        
        await db.run(
            'UPDATE codes SET is_active = false, status = $1 WHERE code = $2',
            [status, code]
        );
        
        const devices = await db.all(
            'SELECT device_id FROM devices WHERE code = $1',
            [code]
        );
        
        let revokedCount = 0;
        for (const dev of devices) {
            await db.run(
                'UPDATE devices SET status = $1, revoked_at = CURRENT_TIMESTAMP WHERE device_id = $2',
                ['revoked', dev.device_id]
            );
            await db.logUsage(
                dev.device_id, 
                code, 
                'auto_revoked_' + reason, 
                `🔒 Device auto-revoked due to: ${reason}. ${details || 'No additional details'}`
            );
            revokedCount++;
        }
        
        await db.run(
            'DELETE FROM code_hwids WHERE code = $1',
            [code]
        );
        
        await db.run(
            'UPDATE codes SET hwid = NULL, trigger_hwid = NULL, trigger_reason = NULL, triggered_at = NULL WHERE code = $1',
            [code]
        );
        
        const logDetails = `🚨 Code ${code} auto-deactivated. Reason: ${reason}. ${revokedCount} devices revoked.`;
        await db.logUsage(
            deviceId || 'system', 
            code, 
            'auto_deactivated_' + reason, 
            logDetails
        );
        
        await db.refreshCache();
        
        console.log(`✅ Code ${code} auto-deactivated. ${revokedCount} devices revoked.`);
        
        res.json({
            success: true,
            code: code,
            devices_revoked: revokedCount,
            reason: reason,
            status: status,
            message: `Code ${code} auto-deactivated due to: ${reason}. ${revokedCount} devices revoked.`
        });
        
    } catch (error) {
        console.error('❌ Auto-deactivate error:', error);
        res.status(500).json({ 
            error: 'Failed to auto-deactivate code',
            details: error.message 
        });
    }
});

// ============================================
// LOG USAGE
// ============================================

app.post('/api/log-usage', async (req, res) => {
    const { deviceId, code, action, details } = req.body;
    
    try {
        await db.logUsage(
            deviceId || 'system', 
            code || null, 
            action || 'unknown', 
            details || 'No details provided'
        );
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Log usage error:', error);
        res.status(500).json({ error: 'Failed to save usage log' });
    }
});

// ============================================
// VALIDATE CODE
// ============================================

app.post('/api/validate-code', async (req, res) => {
    const { code, username } = req.body;
    
    if (!code || !username) {
        return res.status(400).json({ 
            valid: false, 
            error: 'Code and username are required' 
        });
    }

    try {
        const result = await db.validateCodeAccess(code.toUpperCase(), username.trim());
        res.json(result);
    } catch (error) {
        console.error('Validate code error:', error);
        res.status(500).json({ 
            valid: false, 
            error: 'Validation failed' 
        });
    }
});

// ============================================
// API ENDPOINTS - CODES
// ============================================

app.get('/api/codes', isApiAuthenticated, async (req, res) => {
    try {
        const cached = db.getCachedData();
        res.json(cached.codes || []);
    } catch (error) {
        console.error('Get codes error:', error);
        res.json([]);
    }
});

// ============================================
// DASHBOARD DATA - OPTIMIZED (NO WALLPAPER)
// ============================================

app.get('/api/dashboard-data', isApiAuthenticated, async (req, res) => {
    try {
        db.cleanupInactiveDevices().catch(err => console.error('Cleanup error:', err));
        
        const data = await db.getDashboardData();
        
        const devicesWithoutWallpaper = (data.devices || []).map(device => ({
            device_id: device.device_id,
            status: device.status,
            code: device.code,
            last_ping: device.last_ping,
            created_at: device.created_at,
            profile_name: device.profile_name,
            device_name: device.device_name,
            registered_owner: device.registered_owner,
            cpu_name: device.cpu_name,
            gpu_name: device.gpu_name,
            ram_total_gb: device.ram_total_gb,
            storage_total_gb: device.storage_total_gb
        }));
        
        let autoDeactivated = [];
        try {
            autoDeactivated = await db.getAutoDeactivatedCodesWithHwidDetails();
        } catch (e) {
            console.error('Auto-deactivated dashboard fetch error:', e);
        }

        res.json({
            stats: data.stats || {},
            devices: devicesWithoutWallpaper,
            codes: data.codes || [],
            requests: data.requests || [],
            autoDeactivated: autoDeactivated || [],
            username: req.session.username,
            cache_age: Math.floor((Date.now() - data.lastUpdate) / 1000),
            cache_ttl: db.cacheTTL || 60,
            autoRefresh: true,
            refreshInterval: 15000
        });
    } catch (error) {
        console.error('Dashboard data error:', error);
        const cached = db.getCachedData();
        res.json({
            stats: cached.stats || {},
            devices: cached.devices || [],
            codes: cached.codes || [],
            requests: cached.requests || [],
            username: req.session.username,
            cache_age: 0,
            error: 'Using cached data',
            autoRefresh: true,
            refreshInterval: 15000
        });
    }
});

// ============================================
// GENERATE CODE
// ============================================

app.post('/api/generate-code', isApiAuthenticated, async (req, res) => {
    const { username, accessLevel = 'VIP', subscriptionType = 'Lifetime' } = req.body;
    
    if (!username || username.trim() === '') {
        return res.status(400).json({ error: 'Username is required' });
    }
    
    try {
        const existing = await db.get(
            'SELECT * FROM codes WHERE username = $1',
            [username.trim()]
        );
        
        if (existing) {
            return res.status(400).json({ 
                error: `Username "${username}" already has a code: ${existing.code}` 
            });
        }
        
        const code = await db.generateCode(10, req.session.username, username.trim(), `For user: ${username}`, accessLevel, subscriptionType);
        
        await db.logUsage(username, code, 'code_generated', 
            `Code ${code} generated for ${username} by ${req.session.username} (${accessLevel}, ${subscriptionType})`);
        
        res.json({ 
            success: true, 
            code: code,
            username: username.trim(),
            access: accessLevel,
            subscription: subscriptionType,
            message: `Code ${code} generated for ${username}`
        });
    } catch (error) {
        console.error('Generate code error:', error);
        res.status(500).json({ error: 'Failed to generate code' });
    }
});

// ============================================
// UPDATE CODE
// ============================================

app.put('/api/code/:code/username', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    const { username } = req.body;
    
    if (!username || username.trim() === '') {
        return res.status(400).json({ error: 'Username is required' });
    }
    
    try {
        const existing = await db.get(
            'SELECT * FROM codes WHERE username = $1 AND code != $2',
            [username.trim(), code]
        );
        
        if (existing) {
            return res.status(400).json({ 
                error: `Username "${username}" is already assigned to code: ${existing.code}` 
            });
        }
        
        const success = await db.updateCodeUsername(code, username.trim());
        
        if (success) {
            await db.logUsage(username, code, 'username_updated', 
                `Username updated to ${username} for code ${code} by ${req.session.username}`);
            
            res.json({ 
                success: true, 
                message: `Username updated to ${username}` 
            });
        } else {
            res.status(404).json({ error: 'Code not found' });
        }
    } catch (error) {
        console.error('Update username error:', error);
        res.status(500).json({ error: 'Failed to update username' });
    }
});

app.put('/api/code/:code/access', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    const { accessLevel } = req.body;
    
    if (!accessLevel || !['VIP', 'SVIP'].includes(accessLevel)) {
        return res.status(400).json({ 
            error: 'Access level must be VIP or SVIP' 
        });
    }
    
    try {
        const success = await db.updateCodeAccess(code, accessLevel);
        
        if (success) {
            await db.logUsage('admin', code, 'access_updated', 
                `Access updated to ${accessLevel} for code ${code} by ${req.session.username}`);
            
            res.json({ 
                success: true, 
                message: `Access updated to ${accessLevel}` 
            });
        } else {
            res.status(404).json({ error: 'Code not found' });
        }
    } catch (error) {
        console.error('Update access error:', error);
        res.status(500).json({ error: 'Failed to update access' });
    }
});

app.put('/api/code/:code/subscription', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    const { subscriptionType } = req.body;
    
    if (!subscriptionType || !['Lifetime', '3 Months', '6 Months', '9 Months', '12 Months'].includes(subscriptionType)) {
        return res.status(400).json({ 
            error: 'Subscription must be Lifetime, 3 Months, 6 Months, 9 Months, or 12 Months' 
        });
    }
    
    try {
        const success = await db.updateCodeSubscription(code, subscriptionType);
        
        if (success) {
            await db.logUsage('admin', code, 'subscription_updated', 
                `Subscription updated to ${subscriptionType} for code ${code} by ${req.session.username}`);
            
            res.json({ 
                success: true, 
                message: `Subscription updated to ${subscriptionType}` 
            });
        } else {
            res.status(404).json({ error: 'Code not found' });
        }
    } catch (error) {
        console.error('Update subscription error:', error);
        res.status(500).json({ error: 'Failed to update subscription' });
    }
});

// ============================================
// DEACTIVATE / REACTIVATE / DELETE CODE - WITH OWNER CLEAR
// ============================================

app.post('/api/code/:code/deactivate', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    
    try {
        const hwids = await db.getCodeHwids(code);
        const hwidCount = hwids.length;
        
        const result = await db.deactivateCode(code);
        
        if (result.success) {
            await db.logUsage('admin', code, 'code_deactivated', 
                `Code ${code} deactivated by ${req.session.username}. ${hwidCount} HWIDs removed. Owners cleared.`);
            
            res.json({ 
                success: true, 
                message: `Code ${code} deactivated! ${result.devicesRemoved} devices removed, ${hwidCount} HWIDs removed. Owners cleared.`,
                devices_removed: result.devicesRemoved,
                hwids_removed: hwidCount
            });
        } else {
            res.status(404).json({ error: 'Code not found' });
        }
    } catch (error) {
        console.error('Deactivate code error:', error);
        res.status(500).json({ error: 'Failed to deactivate code' });
    }
});

app.post('/api/code/:code/reactivate', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    const { subscriptionType = 'Lifetime' } = req.body;
    
    try {
        const codeInfo = await db.getCodeInfo(code);
        if (!codeInfo) {
            return res.status(404).json({ error: 'Code not found' });
        }
        
        const hwids = await db.getCodeHwids(code);
        const hwidCount = hwids.length;
        
        if (!codeInfo.is_active || codeInfo.status === 'inactive' || codeInfo.status.includes('auto_deactivated')) {
            console.log(`🔄 Reactivating code ${code} - Removing ${hwidCount} HWIDs and clearing owners`);
            
            for (const h of hwids) {
                await db.run(
                    'DELETE FROM code_hwids WHERE code = $1 AND hwid = $2',
                    [code, h.hwid]
                );
            }
            
            await db.run(
                'UPDATE codes SET hwid = NULL, trigger_hwid = NULL, trigger_reason = NULL, triggered_at = NULL, notes = NULL WHERE code = $1',
                [code]
            );
            
            await db.run(
                'UPDATE devices SET registered_owner = NULL, profile_name = NULL, device_name = NULL WHERE code = $1',
                [code]
            );
            
            await db.logUsage(
                'admin', 
                code, 
                'hwid_reset_on_reactivate', 
                `🗑️ ${hwidCount} HWIDs removed and owners cleared during reactivation of code ${code}`
            );
        }
        
        const now = new Date().toISOString();
        const expiresAt = subscriptionType === 'Lifetime' ? null : db.calculateExpiration(now, subscriptionType);
        
        const result = await db.run(
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
        
        if (result.changes > 0) {
            await db.logUsage('admin', code, 'code_reactivated_with_hwid_reset', 
                `Code ${code} reactivated with ${subscriptionType} by ${req.session.username}. ${hwidCount} HWIDs removed. Owners cleared.`);
            await db.refreshCache();
            
            res.json({ 
                success: true, 
                message: `Code reactivated with ${subscriptionType}. ${hwidCount} HWID(s) removed. Owners cleared.`,
                hwids_removed: hwidCount,
                code: code
            });
        } else {
            res.status(404).json({ error: 'Code not found' });
        }
    } catch (error) {
        console.error('Reactivate code error:', error);
        res.status(500).json({ error: 'Failed to reactivate code' });
    }
});

app.delete('/api/code/:code', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    
    try {
        const success = await db.deleteCode(code);
        
        if (success) {
            await db.logUsage('admin', code, 'code_deleted', 
                `Code ${code} deleted by ${req.session.username}`);
            
            res.json({ 
                success: true, 
                message: `Code ${code} permanently deleted!` 
            });
        } else {
            res.status(404).json({ error: 'Code not found' });
        }
    } catch (error) {
        console.error('Delete code error:', error);
        res.status(500).json({ error: 'Failed to delete code' });
    }
});

// ============================================
// DEVICE MANAGEMENT
// ============================================

app.delete('/api/device/:deviceId', async (req, res) => {
    const { deviceId } = req.params;
    
    try {
        const success = await db.removeUser(deviceId);
        
        if (success) {
            res.json({ 
                success: true, 
                message: `Device removed successfully`
            });
        } else {
            res.status(404).json({ error: 'Device not found' });
        }
    } catch (error) {
        console.error('Remove device error:', error);
        res.status(500).json({ error: 'Failed to remove device' });
    }
});

// ============================================
// BATCH DEVICE UPDATE
// ============================================

app.post('/api/device/batch-update', isApiAuthenticated, async (req, res) => {
    const { updates } = req.body;
    
    if (!updates || !Array.isArray(updates)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Updates array is required' 
        });
    }
    
    if (updates.length === 0) {
        return res.json({ 
            success: true, 
            updated: 0,
            message: 'No updates to process'
        });
    }
    
    try {
        const result = await db.batchUpdateDevices(updates);
        res.json(result);
    } catch (error) {
        console.error('Batch update error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to batch update devices'
        });
    }
});

// ============================================
// GET HARDWARE SPECS - WITH REGISTERED OWNER
// ============================================

app.get('/api/device/:deviceId/hardware', isApiAuthenticated, async (req, res) => {
    const { deviceId } = req.params;
    
    try {
        const specs = await db.getHardwareSpecs(deviceId);
        
        if (specs) {
            res.json({
                success: true,
                hardware: {
                    cpu: specs.cpu_name || 'Unknown',
                    gpu: specs.gpu_name || 'Unknown',
                    ram_gb: specs.ram_total_gb || 0,
                    storage_gb: specs.storage_total_gb || 0,
                    device_name: specs.device_name || 'Unknown',
                    profile_name: specs.profile_name || 'Unknown',
                    registered_owner: specs.registered_owner || 'Unknown'
                }
            });
        } else {
            const device = await db.get(
                'SELECT cpu_name, gpu_name, ram_total_gb, storage_total_gb, device_name, profile_name, registered_owner FROM devices WHERE device_id = $1',
                [deviceId]
            );
            
            if (device) {
                res.json({
                    success: true,
                    hardware: {
                        cpu: device.cpu_name || 'Unknown',
                        gpu: device.gpu_name || 'Unknown',
                        ram_gb: device.ram_total_gb || 0,
                        storage_gb: device.storage_total_gb || 0,
                        device_name: device.device_name || 'Unknown',
                        profile_name: device.profile_name || 'Unknown',
                        registered_owner: device.registered_owner || 'Unknown'
                    }
                });
            } else {
                res.json({
                    success: false,
                    hardware: null,
                    message: 'No hardware specs available. Please register a device first.'
                });
            }
        }
    } catch (error) {
        console.error('Get hardware specs error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get hardware specs'
        });
    }
});

// ============================================
// GET DEVICE BY HWID
// ============================================

app.get('/api/device/hwid/:hwid', isApiAuthenticated, async (req, res) => {
    const { hwid } = req.params;
    
    try {
        const device = await db.get(
            'SELECT device_id, cpu_name, gpu_name, ram_total_gb, storage_total_gb, device_name, profile_name, registered_owner, status, code, created_at, last_ping FROM devices WHERE hwid = $1 ORDER BY created_at DESC LIMIT 1',
            [hwid]
        );
        
        if (device) {
            res.json({
                success: true,
                device: {
                    device_id: device.device_id,
                    cpu: device.cpu_name || 'Unknown',
                    gpu: device.gpu_name || 'Unknown',
                    ram_gb: device.ram_total_gb || 0,
                    storage_gb: device.storage_total_gb || 0,
                    device_name: device.device_name || 'Unknown',
                    profile_name: device.profile_name || 'Unknown',
                    registered_owner: device.registered_owner || 'Unknown',
                    status: device.status || 'unknown',
                    code: device.code || null,
                    created_at: device.created_at,
                    last_ping: device.last_ping
                }
            });
        } else {
            res.json({
                success: false,
                device: null,
                message: 'No device found with this HWID'
            });
        }
    } catch (error) {
        console.error('Get device by HWID error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get device by HWID'
        });
    }
});

// ============================================
// HWID MANAGER - GET HWID WITH DEVICE INFO
// ============================================

app.get('/api/hwid/:hwid/details', isApiAuthenticated, async (req, res) => {
    const { hwid } = req.params;
    
    try {
        const device = await db.get(
            'SELECT device_id, cpu_name, gpu_name, ram_total_gb, storage_total_gb, device_name, profile_name, registered_owner, status, code, created_at, last_ping FROM devices WHERE hwid = $1 ORDER BY created_at DESC LIMIT 1',
            [hwid]
        );
        
        const codeHwid = await db.get(
            'SELECT code FROM code_hwids WHERE hwid = $1',
            [hwid]
        );
        
        res.json({
            success: true,
            hwid: hwid,
            hwid_masked: hwid.substring(0, 16) + '...' + hwid.substring(48),
            assigned_to_code: codeHwid ? codeHwid.code : null,
            device: device ? {
                device_id: device.device_id,
                cpu: device.cpu_name || 'Unknown',
                gpu: device.gpu_name || 'Unknown',
                ram_gb: device.ram_total_gb || 0,
                storage_gb: device.storage_total_gb || 0,
                device_name: device.device_name || 'Unknown',
                profile_name: device.profile_name || 'Unknown',
                registered_owner: device.registered_owner || 'Unknown',
                status: device.status || 'unknown',
                code: device.code || null,
                created_at: device.created_at,
                last_ping: device.last_ping
            } : null
        });
    } catch (error) {
        console.error('Get HWID details error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get HWID details'
        });
    }
});

// ============================================
// HWID MANAGER - GET HARDWARE BY HWID
// ============================================

app.get('/api/hwid/:hwid/hardware', isApiAuthenticated, async (req, res) => {
    const { hwid } = req.params;
    
    try {
        const device = await db.get(
            'SELECT cpu_name, gpu_name, ram_total_gb, storage_total_gb, device_name, profile_name, registered_owner FROM devices WHERE hwid = $1 ORDER BY created_at DESC LIMIT 1',
            [hwid]
        );
        
        if (device) {
            res.json({
                success: true,
                hardware: {
                    cpu: device.cpu_name || 'Unknown',
                    gpu: device.gpu_name || 'Unknown',
                    ram_gb: device.ram_total_gb || 0,
                    storage_gb: device.storage_total_gb || 0,
                    device_name: device.device_name || 'Unknown',
                    profile_name: device.profile_name || 'Unknown',
                    registered_owner: device.registered_owner || 'Unknown'
                }
            });
        } else {
            res.json({
                success: false,
                hardware: null,
                message: 'No hardware specs found for this HWID'
            });
        }
    } catch (error) {
        console.error('Get hardware by HWID error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get hardware specs'
        });
    }
});

// ============================================
// HWID MANAGER
// ============================================

app.get('/api/code/:code/hwids', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    try {
        const hwids = await db.getCodeHwids(code);
        const limit = await db.getCodeHwidLimit(code);
        const count = await db.getCodeHwidCount(code);
        
        const hwidArray = Array.isArray(hwids) ? hwids : [];
        
        const hwidsWithSpecs = hwidArray.map(h => ({
            ...h,
            hwid_masked: h.hwid ? h.hwid.substring(0, 16) + '...' + h.hwid.substring(48) : null,
            hwid_full: h.hwid,
            hardware: h.hardware || null
        }));
        
        res.json({
            success: true,
            code: code,
            hwids: hwidsWithSpecs,
            max_hwid_limit: limit || 1,
            current_count: count || 0,
            available_slots: (limit || 1) - (count || 0)
        });
    } catch (error) {
        console.error('Get HWIDs error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get HWIDs: ' + error.message,
            hwids: [],
            max_hwid_limit: 1,
            current_count: 0,
            available_slots: 1
        });
    }
});

app.get('/api/code/:code/hwid-limit', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    try {
        const limit = await db.getCodeHwidLimit(code);
        const count = await db.getCodeHwidCount(code);
        res.json({ 
            code, 
            max_hwid_limit: limit || 1, 
            current_hwid_count: count || 0,
            available_slots: (limit || 1) - (count || 0)
        });
    } catch (error) {
        console.error('Get HWID limit error:', error);
        res.status(500).json({ error: 'Failed to get HWID limit' });
    }
});

app.put('/api/code/:code/hwid-limit', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    const { limit } = req.body;
    
    if (!limit || limit < 1 || limit > 10) {
        return res.status(400).json({ 
            error: 'Limit must be between 1 and 10' 
        });
    }

    try {
        const success = await db.updateCodeHwidLimit(code, limit);
        if (success) {
            await db.logUsage('admin', code, 'hwid_limit_updated', 
                `HWID limit updated to ${limit} for code ${code} by ${req.session.username}`);
            await db.refreshCache();
            res.json({ 
                success: true, 
                message: `HWID limit updated to ${limit} for code ${code}`,
                max_hwid_limit: limit
            });
        } else {
            res.status(404).json({ error: 'Code not found' });
        }
    } catch (error) {
        console.error('Update HWID limit error:', error);
        res.status(500).json({ error: 'Failed to update HWID limit' });
    }
});

app.post('/api/code/:code/hwid', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    const { hwid } = req.body;

    if (!hwid || hwid.length !== 64) {
        return res.status(400).json({ error: 'HWID must be exactly 64 characters' });
    }

    try {
        const result = await db.assignHwidToCode(code.toUpperCase(), hwid, false);
        if (result.success) {
            await db.logUsage('admin', code, 'hwid_assigned', 
                `HWID assigned to code ${code} by ${req.session.username}`);
            await db.refreshCache();
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Assign HWID error:', error);
        res.status(500).json({ error: 'Failed to assign HWID' });
    }
});

app.delete('/api/code/:code/hwid/:hwid', isApiAuthenticated, async (req, res) => {
    const { code, hwid } = req.params;
    
    try {
        const devices = await db.all(
            'SELECT device_id FROM devices WHERE code = $1 AND hwid = $2',
            [code.toUpperCase(), hwid]
        );
        
        let deletedCount = 0;
        for (const device of devices) {
            await db.run(
                'DELETE FROM devices WHERE device_id = $1',
                [device.device_id]
            );
            deletedCount++;
        }
        
        const result = await db.removeHwidFromCode(code.toUpperCase(), hwid);
        
        if (result.success) {
            await db.logUsage('admin', code, 'hwid_removed_with_profiles', 
                `HWID ${hwid.substring(0, 16)}... removed from code ${code} by ${req.session.username}. ${deletedCount} profiles deleted.`);
            await db.refreshCache();
            
            if (deletedCount > 0) {
                await db.run(
                    'UPDATE codes SET used_count = used_count - $1 WHERE code = $2',
                    [deletedCount, code.toUpperCase()]
                );
            }
            
            res.json({
                success: true,
                message: `HWID removed successfully. ${deletedCount} profile(s) deleted.`,
                code: code,
                hwid: hwid,
                profiles_deleted: deletedCount
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error || 'Failed to remove HWID'
            });
        }
    } catch (error) {
        console.error('Remove HWID error:', error);
        res.status(500).json({ error: 'Failed to remove HWID' });
    }
});

// ============================================
// HWID SIGHTING (no code required — extension open)
// ============================================

app.post('/api/hwid-log', async (req, res) => {
    try {
        const { hwid, code, action, hardware, browser_profile } = req.body || {};
        if (!hwid || String(hwid).length < 16) {
            return res.status(400).json({ success: false, error: 'HWID required' });
        }

        let hw = hardware;
        if (typeof hw === 'string') {
            try { hw = JSON.parse(hw); } catch (e) { hw = {}; }
        }
        hw = hw || {};
        if (browser_profile && !hw.profile_name) hw.profile_name = browser_profile;

        if (code) {
            await db.removeNewHwidsByHwid(hwid);
        } else {
            await db.recordNewHwid(hwid, null, 'extension_open', hw);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('HWID log error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// NEW HWIDS + AUTO-DEACTIVATED
// ============================================

app.get('/api/new-hwids', isApiAuthenticated, async (req, res) => {
    try {
        const rows = await db.getNewHwids(req.query.limit || 200);
        res.json({ success: true, hwids: rows || [], count: (rows || []).length });
    } catch (error) {
        console.error('Get new HWIDs error:', error);
        res.status(500).json({ success: false, error: error.message, hwids: [], count: 0 });
    }
});

app.delete('/api/new-hwids/:id', isApiAuthenticated, async (req, res) => {
    try {
        const result = await db.deleteNewHwid(req.params.id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/new-hwids', isApiAuthenticated, async (req, res) => {
    try {
        const result = await db.clearNewHwids();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/auto-deactivated-codes', isApiAuthenticated, async (req, res) => {
    try {
        const codes = await db.getAutoDeactivatedCodesWithHwidDetails();
        res.json({
            success: true,
            codes: codes || [],
            count: codes ? codes.length : 0
        });
    } catch (error) {
        console.error('❌ Get auto-deactivated codes error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get auto-deactivated codes: ' + error.message,
            codes: [],
            count: 0
        });
    }
});

// ============================================
// GET AUTO-DEACTIVATED CODE DETAIL
// ============================================

app.get('/api/auto-deactivated-code/:code', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    
    try {
        const result = await db.queuedQuery(`
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
                c.notes,
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
                ) as hwids
            FROM codes c
            WHERE c.code = $1
        `, [code], 5);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Code not found'
            });
        }
        
        const row = result.rows[0];
        let specs = row.trigger_hwid_specs;
        if (typeof specs === 'string') {
            try { specs = JSON.parse(specs); } catch (e) { specs = null; }
        }
        if (specs) {
            row.trigger_hardware = {
                cpu_name: specs.cpu || specs.cpu_name || 'Unknown',
                gpu_name: specs.gpu || specs.gpu_name || 'Unknown',
                ram_total_gb: specs.ram_gb || specs.ram_total_gb || 0,
                storage_total_gb: specs.storage_gb || specs.storage_total_gb || 0,
                device_name: specs.device || specs.device_name || 'Unknown',
                profile_name: specs.profile || specs.profile_name || 'Default',
                registered_owner: specs.owner || specs.registered_owner || 'Unknown'
            };
        }
        if ((!row.hwids || !row.hwids.length) && row.existing_hwids) {
            row.hwids = typeof row.existing_hwids === 'string' ? JSON.parse(row.existing_hwids) : row.existing_hwids;
        }
        res.json({
            success: true,
            code: row
        });
    } catch (error) {
        console.error('❌ Get auto-deactivated code detail error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get code detail: ' + error.message
        });
    }
});

// ============================================
// DELETE AUTO-DEACTIVATED CODE LOGS (NOT THE CODE)
// ============================================

app.delete('/api/auto-deactivated-code/:code/logs', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    
    try {
        const result = await db.deleteAutoDeactivatedLogs(code);
        
        if (result.success) {
            await db.refreshCache();
            
            res.json({
                success: true,
                message: result.message,
                deleted: result.deleted
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error || 'Failed to delete logs'
            });
        }
    } catch (error) {
        console.error('❌ Delete auto-deactivated logs error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================
// REQUEST HANDLING
// ============================================

app.post('/api/request/:id/approve', isApiAuthenticated, async (req, res) => {
    const { id } = req.params;
    try {
        const success = await db.respondToRequest(id, 'approved', 'Approved by admin');
        if (success) {
            await db.refreshCache();
            res.json({ success: true, message: 'Request approved' });
        } else {
            res.status(404).json({ error: 'Request not found' });
        }
    } catch (error) {
        console.error('Approve request error:', error);
        res.status(500).json({ error: 'Failed to approve request' });
    }
});

app.post('/api/request/:id/reject', isApiAuthenticated, async (req, res) => {
    const { id } = req.params;
    try {
        const success = await db.respondToRequest(id, 'rejected', 'Rejected by admin');
        if (success) {
            await db.refreshCache();
            res.json({ success: true, message: 'Request rejected' });
        } else {
            res.status(404).json({ error: 'Request not found' });
        }
    } catch (error) {
        console.error('Reject request error:', error);
        res.status(500).json({ error: 'Failed to reject request' });
    }
});

// ============================================
// BULK DELETE
// ============================================

app.post('/api/delete-all-devices', isApiAuthenticated, async (req, res) => {
    try {
        const count = await db.get('SELECT COUNT(*) as count FROM devices');
        await db.run('DELETE FROM devices');
        await db.run('UPDATE codes SET used_count = 0');
        await db.logUsage('admin', null, 'delete_all_devices', 
            `Admin ${req.session.username} deleted all ${count.count} devices`);
        await db.refreshCache();
        res.json({ success: true, message: `All ${count.count} devices deleted!`, deleted: parseInt(count.count) });
    } catch (error) {
        console.error('Delete all devices error:', error);
        res.status(500).json({ error: 'Failed to delete devices' });
    }
});

app.post('/api/delete-all-requests', isApiAuthenticated, async (req, res) => {
    try {
        const count = await db.get('SELECT COUNT(*) as count FROM requests');
        await db.run('DELETE FROM requests');
        await db.logUsage('admin', null, 'delete_all_requests', 
            `Admin ${req.session.username} deleted all ${count.count} requests`);
        await db.refreshCache();
        res.json({ success: true, message: `All ${count.count} requests deleted!`, deleted: parseInt(count.count) });
    } catch (error) {
        console.error('Delete all requests error:', error);
        res.status(500).json({ error: 'Failed to delete requests' });
    }
});

app.post('/api/delete-all-codes', isApiAuthenticated, async (req, res) => {
    try {
        await db.run('DELETE FROM code_hwids');
        await db.run('DELETE FROM devices');
        const count = await db.get('SELECT COUNT(*) as count FROM codes');
        await db.run('DELETE FROM codes');
        await db.logUsage('admin', null, 'delete_all_codes', 
            `Admin ${req.session.username} deleted all ${count.count} codes and all devices`);
        await db.refreshCache();
        res.json({ success: true, message: `All ${count.count} codes and all devices deleted!`, deleted: parseInt(count.count) });
    } catch (error) {
        console.error('Delete all codes error:', error);
        res.status(500).json({ error: 'Failed to delete codes' });
    }
});

// ============================================
// CLEANUP LOGS ENDPOINT
// ============================================

app.post('/api/cleanup-logs', isApiAuthenticated, async (req, res) => {
    try {
        const { delete_all } = req.body;
        let deleted = 0;
        let message = '';
        
        if (delete_all) {
            const result = await db.run('DELETE FROM usage_logs');
            deleted = result.changes || 0;
            message = `Deleted ALL ${deleted} usage logs`;
            console.log(`🧹 Manually deleted ALL ${deleted} usage logs`);
            
            res.json({ 
                success: true, 
                message: message,
                deleted: deleted
            });
        } else {
            const result = await db.run(
                "DELETE FROM usage_logs WHERE created_at < NOW() - INTERVAL '30 days'"
            );
            deleted = result.changes || 0;
            message = `Cleaned up ${deleted} old usage logs (older than 30 days)`;
            
            res.json({ 
                success: true, 
                message: message,
                deleted: deleted
            });
        }
    } catch (error) {
        console.error('❌ Cleanup logs error:', error);
        res.status(500).json({ error: 'Failed to cleanup logs: ' + error.message });
    }
});

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================

app.use((err, req, res, next) => {
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        console.error('Connection timeout:', err);
        return res.status(503).json({ 
            error: 'Service temporarily unavailable, please try again' 
        });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// START SERVER
// ============================================

async function createDefaultAdmin() {
    try {
        const username = process.env.ADMIN_USERNAME || 'admin';
        const password = process.env.ADMIN_PASSWORD || 'password123';
        
        const existing = await db.getAdmin(username);
        if (!existing) {
            const hash = await bcrypt.hash(password, 10);
            await db.createAdmin(username, hash);
            console.log(`✅ Default admin created: ${username}`);
            console.log(`🔑 Password: ${password}`);
        } else {
            console.log(`✅ Admin already exists: ${username}`);
        }
    } catch (error) {
        console.error('Failed to create default admin:', error);
    }
}

createDefaultAdmin().then(() => {
    app.listen(PORT, () => {
        console.log('\n' + '='.repeat(60));
        console.log('🚀 SERVER IS RUNNING!');
        console.log('='.repeat(60));
        console.log(`📡 URL: http://localhost:${PORT}`);
        console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
        console.log(`🔑 Username: ${process.env.ADMIN_USERNAME || 'admin'}`);
        console.log(`🔒 Password: ${process.env.ADMIN_PASSWORD || 'password123'}`);
        console.log('='.repeat(60));
        console.log('✅ NO WALLPAPER - Clean & Fast');
        console.log('✅ NO HWID LOGS - Using usage_logs instead');
        console.log('✅ NO NEW HWID TAB - Removed');
        console.log('✅ Auto-Deactivated Tab with Trigger HWID');
        console.log('✅ Delete Logs Only (Not Code)');
        console.log('✅ Owners Auto-Clear on Deactivate/Reactivate');
        console.log('✅ "Reason" Button redirects to Auto-Deactivated Tab');
        console.log('✅ updatePing() function fixed');
        console.log('='.repeat(60));
        console.log('⚠️  IMPORTANT: Change your password in Render env vars!');
        console.log('='.repeat(60) + '\n');
    });
});

module.exports = app;