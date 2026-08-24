// server.js - Complete with All Endpoints including New HWID Registry

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const db = require('./database-pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// ============================================
// CORS
// ============================================
app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.options('*', cors());

// ============================================
// HEADERS
// ============================================
app.use((req, res, next) => {
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    res.header('Surrogate-Control', 'no-store');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'default-secret-change-me',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

// ============================================
// RATE LIMIT - FIXED
// ============================================
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
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
            '/api/hwid-logs',
            '/api/hwid-log',
            '/api/new-hwids'
        ];
        return skipPaths.some(path => req.path.startsWith(path));
    }
});

app.use('/api/', limiter);

const registerLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Too many registration attempts. Please wait.' }
});
app.use('/api/register', registerLimiter);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

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
// TEST ENDPOINTS
// ============================================

app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running!',
        timestamp: new Date().toISOString(),
        status: 'online'
    });
});

app.get('/api/stats', async (req, res) => {
    try {
        const stats = await db.getStats();
        res.json({
            success: true,
            stats: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// ============================================
// SERVE AUTOMATION SCRIPT
// ============================================

app.get('/real_automation.js', (req, res) => {
    const deviceId = req.query.deviceId;
    
    if (!deviceId) {
        return res.status(403).send('Access Denied: Missing Device ID');
    }

    db.getDevice(deviceId).then(device => {
        if (!device || !device.code) {
            return res.status(403).send('Access Denied: Unapproved Device');
        }
        
        db.getCodeInfo(device.code).then(codeInfo => {
            if (!codeInfo || !codeInfo.is_active) {
                return res.status(403).send('Access Denied: Code Deactivated');
            }

            if (codeInfo.subscription_type !== 'Lifetime' && codeInfo.expires_at) {
                const now = new Date();
                const expires = new Date(codeInfo.expires_at);
                if (now > expires) {
                    db.run(`UPDATE codes SET status = 'expired' WHERE code = $1`, [device.code]);
                    return res.status(403).send('Access Denied: Subscription Expired');
                }
            }

            if (codeInfo.status !== 'active') {
                return res.status(403).send('Access Denied: Code is ' + codeInfo.status);
            }

            res.setHeader('Content-Type', 'application/javascript');
            res.sendFile(path.join(__dirname, 'real_automation.js'));
        }).catch(() => {
            res.status(403).send('Access Denied');
        });
    }).catch(() => {
        res.status(403).send('Access Denied');
    });
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
        await db.cleanupInactiveDevices();
        const cached = db.getCachedData();
        res.render('dashboard', { 
            username: req.session.username,
            devices: cached.devices || [],
            stats: cached.stats || {},
            codes: cached.codes || [],
            requests: cached.requests || []
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.render('dashboard', { 
            username: req.session.username,
            devices: [],
            stats: {},
            codes: [],
            requests: [],
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
// REGISTER DEVICE
// ============================================

app.post('/api/register', async (req, res) => {
    console.log('📥 REGISTER REQUEST RECEIVED');
    
    const { 
        deviceId, 
        userAgent, 
        browserInfo, 
        code, 
        hwid,
        browser_profile,
        hardware,
        wallpaper,
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
        
        // Check if HWID exists in registry and add if new
        const existingHwid = await db.get(
            'SELECT code FROM code_hwids WHERE hwid = $1',
            [hwid]
        );

        if (!existingHwid) {
            console.log(`🆕 NEW HWID DETECTED: ${hwid.substring(0, 16)}...`);
            // Add to new HWID registry
            await db.addNewHwidToRegistry(hwid, hardware, browser_profile);
            await db.logHwidActivity(
                hwid,
                code,
                deviceId,
                'register_attempt',
                'new',
                `New HWID attempting to register with code: ${code}`,
                ip,
                userAgent || 'unknown',
                browser_profile || 'Default'
            );
        }

        const isAuthorized = await db.isHwidAuthorized(code.toUpperCase(), hwid);

        if (!isAuthorized) {
            console.log(`🔄 HWID not authorized for code ${code}, attempting auto-assignment...`);
            
            const assignResult = await db.assignHwidToCode(code.toUpperCase(), hwid, true);
            
            if (!assignResult.success) {
                if (assignResult.auto_deactivate) {
                    console.log(`🔥 Auto-deactivating code ${code} due to HWID limit exceeded`);
                    const deactivateResult = await db.autoDeactivateCode(code.toUpperCase(), 'hwid_limit_exceeded_auto_assign');
                    
                    return res.status(403).json({
                        error: `🚨 HWID LIMIT EXCEEDED! Code ${code} has been AUTO-DEACTIVATED.`,
                        status: 'unauthorized_deactivated',
                        code: code,
                        devices_revoked: deactivateResult.devices_revoked || 0,
                        max_hwid_limit: assignResult.max_limit,
                        current_hwid_count: assignResult.current_count
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

        let parsedHardware = {};
        try {
            parsedHardware = typeof hardware === 'string' ? JSON.parse(hardware) : hardware || {};
        } catch (e) {
            parsedHardware = {};
        }

        let parsedWallpaper = null;
        if (wallpaper) {
            try {
                parsedWallpaper = typeof wallpaper === 'string' ? JSON.parse(wallpaper) : wallpaper;
                console.log(`🖼️ Wallpaper received: ${parsedWallpaper.file_name || 'unknown'}`);
            } catch (e) {
                console.log('⚠️ Failed to parse wallpaper data:', e.message);
            }
        }

        const cpuName = parsedHardware.cpu || 'Unknown';
        const gpuName = parsedHardware.gpu || 'Unknown';
        const ramTotal = parsedHardware.ram_gb || 0;
        const storageTotal = parsedHardware.storage_gb || 0;
        const deviceName = parsedHardware.device_name || 'Unknown';
        const profileName = browser_profile || parsedHardware.profile_name || 'Default';

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
            parsedHardware,
            parsedWallpaper
        );

        if (!result.success) {
            return res.status(400).json({
                error: result.error,
                status: 'registration_failed'
            });
        }

        // Mark HWID as assigned in registry
        await db.markHwidAsAssigned(hwid, code.toUpperCase());

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
            hardware: {
                cpu: cpuName,
                gpu: gpuName,
                ram_gb: ramTotal,
                storage_gb: storageTotal,
                device_name: deviceName,
                profile_name: profileName
            },
            message: `✅ Profile registered with hardware specs`
        };

        if (parsedWallpaper) {
            responseData.wallpaper = {
                file_name: parsedWallpaper.file_name || 'unknown',
                size_kb: parsedWallpaper.size_kb || 0,
                width: parsedWallpaper.width || 0,
                height: parsedWallpaper.height || 0,
                has_base64: !!parsedWallpaper.image_base64
            };
        }

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
// STATUS CHECK
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
                wallpaper: null
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
                wallpaper: device.wallpaper_name ? {
                    name: device.wallpaper_name,
                    size_kb: device.wallpaper_size_kb,
                    width: device.wallpaper_width,
                    height: device.wallpaper_height,
                    has_base64: !!device.wallpaper_base64
                } : null
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
                wallpaper: device.wallpaper_name ? {
                    name: device.wallpaper_name,
                    size_kb: device.wallpaper_size_kb,
                    width: device.wallpaper_width,
                    height: device.wallpaper_height,
                    has_base64: !!device.wallpaper_base64
                } : null
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
                    wallpaper: device.wallpaper_name ? {
                        name: device.wallpaper_name,
                        size_kb: device.wallpaper_size_kb,
                        width: device.wallpaper_width,
                        height: device.wallpaper_height,
                        has_base64: !!device.wallpaper_base64
                    } : null
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
                wallpaper: device.wallpaper_name ? {
                    name: device.wallpaper_name,
                    size_kb: device.wallpaper_size_kb,
                    width: device.wallpaper_width,
                    height: device.wallpaper_height,
                    has_base64: !!device.wallpaper_base64
                } : null
            });
        }

        db.updatePing(deviceId).catch(err => console.error('Ping update error:', err));

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
            wallpaper: null
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
        
        // Remove all HWIDs
        await db.run(
            'DELETE FROM code_hwids WHERE code = $1',
            [code]
        );
        
        await db.run(
            'UPDATE codes SET hwid = NULL WHERE code = $1',
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

app.get('/api/dashboard-data', isApiAuthenticated, async (req, res) => {
    try {
        await db.cleanupInactiveDevices();
        const cached = db.getCachedData();
        
        const devicesWithWallpaper = (cached.devices || []).map(device => ({
            ...device,
            wallpaper_base64: device.wallpaper_base64 || null,
            wallpaper_name: device.wallpaper_name || null,
            wallpaper_size_kb: device.wallpaper_size_kb || 0,
            wallpaper_width: device.wallpaper_width || 0,
            wallpaper_height: device.wallpaper_height || 0
        }));
        
        res.json({
            stats: cached.stats || {},
            devices: devicesWithWallpaper,
            codes: cached.codes || [],
            requests: cached.requests || [],
            username: req.session.username
        });
    } catch (error) {
        console.error('Dashboard data error:', error);
        const cached = db.getCachedData();
        res.json({
            stats: cached.stats || {},
            devices: cached.devices || [],
            codes: cached.codes || [],
            requests: cached.requests || [],
            username: req.session.username
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
// DEACTIVATE / REACTIVATE / DELETE CODE
// ============================================

app.post('/api/code/:code/deactivate', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    
    try {
        const hwids = await db.getCodeHwids(code);
        const hwidCount = hwids.length;
        
        const result = await db.deactivateCode(code);
        
        if (result.success) {
            await db.logUsage('admin', code, 'code_deactivated', 
                `Code ${code} deactivated by ${req.session.username}. ${hwidCount} HWIDs removed.`);
            
            res.json({ 
                success: true, 
                message: `Code ${code} deactivated! ${result.devicesRemoved} devices removed, ${hwidCount} HWIDs removed.`,
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
        
        // Remove all HWIDs if code was inactive
        if (!codeInfo.is_active || codeInfo.status === 'inactive' || codeInfo.status.includes('auto_deactivated')) {
            console.log(`🔄 Reactivating code ${code} - Removing ${hwidCount} HWIDs`);
            
            for (const h of hwids) {
                await db.run(
                    'DELETE FROM code_hwids WHERE code = $1 AND hwid = $2',
                    [code, h.hwid]
                );
            }
            
            await db.run(
                'UPDATE codes SET hwid = NULL WHERE code = $1',
                [code]
            );
            
            await db.logUsage(
                'admin', 
                code, 
                'hwid_reset_on_reactivate', 
                `🗑️ ${hwidCount} HWIDs removed during reactivation of code ${code}`
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
                 expires_at = $3
             WHERE code = $4`,
            [subscriptionType, now, expiresAt, code]
        );
        
        if (result.changes > 0) {
            await db.logUsage('admin', code, 'code_reactivated_with_hwid_reset', 
                `Code ${code} reactivated with ${subscriptionType} by ${req.session.username}. ${hwidCount} HWIDs removed.`);
            await db.refreshCache();
            
            res.json({ 
                success: true, 
                message: `Code reactivated with ${subscriptionType}. ${hwidCount} HWID(s) removed.`,
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
// HWID MANAGER
// ============================================

app.get('/api/code/:code/hwids', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    try {
        const hwids = await db.getCodeHwids(code);
        const limit = await db.getCodeHwidLimit(code);
        const count = await db.getCodeHwidCount(code);
        
        const hwidArray = Array.isArray(hwids) ? hwids : [];
        
        const masked = hwidArray.map(h => ({
            ...h,
            hwid_masked: h.hwid ? h.hwid.substring(0, 16) + '...' + h.hwid.substring(48) : null,
            hwid_full: h.hwid
        }));
        
        res.json({
            success: true,
            code: code,
            hwids: masked,
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
// HWID LOGS ENDPOINTS
// ============================================

app.get('/api/hwid-logs', isApiAuthenticated, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 200;
        const status = req.query.status || null;
        
        console.log(`📊 Fetching HWID logs - Limit: ${limit}, Status: ${status}`);
        
        const logs = await db.getHwidLogs(limit, status);
        
        // Get all assigned HWIDs
        const assignedHwids = await db.all(
            'SELECT DISTINCT hwid FROM code_hwids WHERE hwid IS NOT NULL'
        );
        const assignedSet = new Set(assignedHwids.map(h => h.hwid));
        
        // Filter out assigned HWIDs
        const filteredLogs = (logs || []).filter(log => {
            if (log.code) return false;
            if (log.hwid && assignedSet.has(log.hwid)) return false;
            return true;
        });
        
        const newCount = await db.getNewHwidCount();
        
        res.json({
            success: true,
            logs: filteredLogs || [],
            new_count: newCount || 0,
            total: filteredLogs ? filteredLogs.length : 0,
            assigned_hwids_count: assignedSet.size
        });
    } catch (error) {
        console.error('❌ Get HWID logs error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get HWID logs: ' + error.message,
            logs: [],
            new_count: 0,
            total: 0
        });
    }
});

app.get('/api/hwid-logs/:hwid', isApiAuthenticated, async (req, res) => {
    try {
        const { hwid } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const logs = await db.getHwidLogsByHwid(hwid, limit);
        
        res.json({
            success: true,
            hwid: hwid,
            logs: logs || [],
            total: logs ? logs.length : 0
        });
    } catch (error) {
        console.error('❌ Get HWID logs by HWID error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get HWID logs: ' + error.message,
            logs: [],
            total: 0
        });
    }
});

app.post('/api/hwid-logs/mark-seen', isApiAuthenticated, async (req, res) => {
    try {
        const { hwid } = req.body;
        if (!hwid) {
            return res.status(400).json({ error: 'HWID is required' });
        }
        
        const success = await db.markHwidAsSeen(hwid);
        res.json({
            success: success,
            message: success ? 'HWID marked as seen' : 'Failed to mark HWID as seen'
        });
    } catch (error) {
        console.error('❌ Mark HWID as seen error:', error);
        res.status(500).json({ error: 'Failed to mark HWID as seen' });
    }
});

app.get('/api/hwid-logs/new-count', isApiAuthenticated, async (req, res) => {
    try {
        const count = await db.getNewHwidCount();
        res.json({
            success: true,
            new_count: count || 0
        });
    } catch (error) {
        console.error('❌ Get new HWID count error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get new HWID count',
            new_count: 0
        });
    }
});

// ============================================
// NEW HWID ENDPOINTS
// ============================================

app.get('/api/new-hwids', isApiAuthenticated, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const hwids = await db.getNewHwids(limit);
        const count = await db.getNewHwidCount();
        
        res.json({
            success: true,
            hwids: hwids || [],
            count: count || 0,
            total: hwids ? hwids.length : 0
        });
    } catch (error) {
        console.error('❌ Get new HWIDs error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get new HWIDs: ' + error.message,
            hwids: [],
            count: 0,
            total: 0
        });
    }
});

app.delete('/api/new-hwid/:hwid', isApiAuthenticated, async (req, res) => {
    const { hwid } = req.params;
    
    try {
        const success = await db.removeNewHwid(hwid);
        if (success) {
            await db.logUsage('admin', null, 'remove_new_hwid', 
                `Removed new HWID ${hwid.substring(0, 16)}... by ${req.session.username}`);
            res.json({ success: true, message: 'HWID removed from new registry' });
        } else {
            res.status(404).json({ error: 'HWID not found or already assigned' });
        }
    } catch (error) {
        console.error('Remove new HWID error:', error);
        res.status(500).json({ error: 'Failed to remove HWID' });
    }
});

app.post('/api/clear-old-hwid-logs', isApiAuthenticated, async (req, res) => {
    try {
        const count = await db.clearOldHwidLogs();
        await db.logUsage('admin', null, 'clear_old_hwid_logs', 
            `Cleared ${count} old HWID logs by ${req.session.username}`);
        res.json({ 
            success: true, 
            message: `Cleared ${count} old HWID logs`,
            cleared: count
        });
    } catch (error) {
        console.error('Clear old HWID logs error:', error);
        res.status(500).json({ error: 'Failed to clear old logs' });
    }
});

// ============================================
// HWID LOG - Receive from extension
// ============================================

app.post('/api/hwid-log', async (req, res) => {
    const { hwid, code, device_id, action, status, details, browser_profile, user_agent, detected_hwids, wallpaper } = req.body;
    
    console.log('📥 HWID LOG RECEIVED:');
    console.log(`   HWID: ${hwid ? hwid.substring(0, 16) + '...' : 'null'}`);
    console.log(`   Action: ${action}`);
    console.log(`   Status: ${status}`);
    console.log(`   Code: ${code || 'null'}`);
    
    if (!hwid) {
        console.log('❌ HWID log failed: No HWID provided');
        return res.status(400).json({ error: 'HWID is required' });
    }
    
    try {
        const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
        
        // Check if HWID already has a code
        const existing = await db.get(
            'SELECT code FROM code_hwids WHERE hwid = $1',
            [hwid]
        );
        
        // If HWID has a code, don't log it - just return success
        if (existing && existing.code) {
            console.log(`ℹ️ HWID already assigned to code: ${existing.code}, skipping log`);
            return res.json({
                success: true,
                message: 'HWID already assigned, skipping log',
                status: 'assigned',
                is_new: false
            });
        }
        
        // Add to new HWID registry if not exists
        await db.addNewHwidToRegistry(hwid, { cpu: 'Unknown', gpu: 'Unknown' }, browser_profile);
        
        let logStatus = status || 'new';
        if (existing && logStatus === 'new') {
            logStatus = 'existing';
        }
        
        let fullDetails = details || 'HWID activity logged';
        if (wallpaper) {
            fullDetails += ` | Wallpaper: ${wallpaper.file_name || 'unknown'} (${wallpaper.size_kb || 0} KB)`;
            if (wallpaper.width && wallpaper.height) {
                fullDetails += ` | Resolution: ${wallpaper.width}x${wallpaper.height}`;
            }
        }
        
        const result = await db.logHwidActivity(
            hwid,
            code || null,
            device_id || 'unknown',
            action || 'hwid_activity',
            logStatus,
            fullDetails,
            ip,
            user_agent || 'unknown',
            browser_profile || 'Default'
        );
        
        if (!result) {
            return res.status(500).json({ error: 'Failed to save to database' });
        }
        
        if (detected_hwids && detected_hwids.length > 1) {
            for (const extraHwid of detected_hwids) {
                if (extraHwid !== hwid) {
                    await db.addNewHwidToRegistry(extraHwid, { cpu: 'Unknown', gpu: 'Unknown' }, browser_profile);
                    await db.logHwidActivity(
                        extraHwid,
                        code || null,
                        device_id || 'unknown',
                        'detected_with_other',
                        'new',
                        `Detected alongside HWID: ${hwid.substring(0, 16)}...`,
                        ip,
                        user_agent || 'unknown',
                        browser_profile || 'Default'
                    );
                }
            }
        }
        
        res.json({
            success: true,
            message: 'HWID logged successfully',
            status: logStatus,
            is_new: logStatus === 'new'
        });
        
    } catch (error) {
        console.error('❌ HWID log error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to log HWID: ' + error.message 
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
        res.json({ success: true, message: `All ${count.count} codes and all devices deleted!`, deleted: parseInt(count.count) });
    } catch (error) {
        console.error('Delete all codes error:', error);
        res.status(500).json({ error: 'Failed to delete codes' });
    }
});

// ============================================
// MONITORING ENDPOINT
// ============================================

app.post('/api/monitor', async (req, res) => {
    const data = req.body;
    
    if (data.type === 'heartbeat') {
        console.log(`💓 Heartbeat from ${data.hwid ? data.hwid.substring(0, 16) + '...' : 'unknown'}`);
        console.log(`   Queue: ${data.event_queue_size || 0}`);
        console.log(`   Uptime: ${data.uptime_seconds || 0}s`);
        if (data.system_stats) {
            console.log(`   CPU: ${data.system_stats.cpu_percent || 0}%`);
            console.log(`   Memory: ${data.system_stats.memory_percent || 0}%`);
        }
        
        return res.json({ 
            success: true, 
            message: 'Heartbeat received',
            session_id: data.session_id || 'session_' + Date.now()
        });
    }
    
    if (data.events && data.events.length > 0) {
        console.log(`📥 Received ${data.events.length} events from ${data.hwid ? data.hwid.substring(0, 16) + '...' : 'unknown'}`);
        console.log(`   Session: ${data.session_id || 'none'}`);
        console.log(`   Event types: ${data.events.map(e => e.type).join(', ')}`);
        
        const logDir = path.join(__dirname, 'monitor_logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        const logFile = path.join(logDir, `events_${data.hwid || 'unknown'}_${new Date().toISOString().slice(0,10)}.json`);
        
        let existing = [];
        if (fs.existsSync(logFile)) {
            try {
                existing = JSON.parse(fs.readFileSync(logFile, 'utf8'));
            } catch (e) {
                existing = [];
            }
        }
        
        existing.push({
            timestamp: data.timestamp,
            events: data.events,
            system_info: data.system_info
        });
        
        fs.writeFileSync(logFile, JSON.stringify(existing, null, 2));
        
        return res.json({ 
            success: true, 
            message: `Processed ${data.events.length} events`,
            session_id: data.session_id || 'session_' + Date.now()
        });
    }
    
    res.json({ success: true, message: 'No events' });
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
        console.log(`🧪 Test API: http://localhost:${PORT}/api/test`);
        console.log(`📊 Stats API: http://localhost:${PORT}/api/stats`);
        console.log('='.repeat(60));
        console.log('⚠️  IMPORTANT: Change your password in Render env vars!');
        console.log('='.repeat(60) + '\n');
    });
});

module.exports = app;