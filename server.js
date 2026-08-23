// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const path = require('path');
const db = require('./database-pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  res.header('Surrogate-Control', 'no-store');
  next();
});

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.static('public'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
// HWID CODE MANAGEMENT
// ============================================

app.post('/api/admin/add-hwid-code', isApiAuthenticated, async (req, res) => {
    const { code, hwid, fingerprint, username, accessLevel, subscriptionType, maxHwidLimit } = req.body;
    
    if (!code || !hwid || !username) {
        return res.status(400).json({ 
            error: 'Code, HWID, and Username are required' 
        });
    }
    
    if (hwid.length !== 64) {
        return res.status(400).json({ 
            error: 'HWID must be exactly 64 characters' 
        });
    }
    
    try {
        const result = await db.addHwidCode(
            code.toUpperCase(),
            hwid,
            fingerprint || hwid.substring(0, 16) + '...',
            username.trim(),
            accessLevel || 'VIP',
            subscriptionType || 'Lifetime',
            req.session.username,
            maxHwidLimit || 1
        );
        
        if (result.success) {
            res.json({
                success: true,
                message: `Code ${code} added for ${username}`,
                code: result.code,
                username: result.username,
                hwid: hwid.substring(0, 16) + '...',
                access: result.access,
                subscription: result.subscription,
                max_hwid_limit: result.max_hwid_limit
            });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('Add HWID code error:', error);
        res.status(500).json({ error: 'Failed to add code' });
    }
});

app.get('/api/admin/hwid-codes', isApiAuthenticated, async (req, res) => {
    try {
        const codes = await db.getHwidCodes();
        const masked = codes.map(c => ({
            ...c,
            hwid: c.hwid ? c.hwid.substring(0, 16) + '...' : null
        }));
        res.json(masked);
    } catch (error) {
        console.error('Get HWID codes error:', error);
        res.status(500).json({ error: 'Failed to get codes' });
    }
});

app.post('/api/verify-hwid', async (req, res) => {
    const { hwid, code } = req.body;
    
    if (!hwid || !code) {
        return res.status(400).json({ error: 'HWID and code are required' });
    }
    
    try {
        const result = await db.verifyHwidCode(code.toUpperCase(), hwid);
        res.json(result);
    } catch (error) {
        console.error('Verify HWID error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// ============================================
// GET HWID LIMIT FOR CODE
// ============================================

app.get('/api/code/:code/hwid-limit', isApiAuthenticated, async (req, res) => {
  const { code } = req.params;
  try {
    const limit = await db.getCodeHwidLimit(code);
    const count = await db.getCodeHwidCount(code);
    res.json({ 
      code, 
      max_hwid_limit: limit, 
      current_hwid_count: count,
      available_slots: limit - count
    });
  } catch (error) {
    console.error('Get HWID limit error:', error);
    res.status(500).json({ error: 'Failed to get HWID limit' });
  }
});

// ============================================
// UPDATE HWID LIMIT
// ============================================

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

// ============================================
// GET ASSIGNED HWIDS FOR CODE
// ============================================

app.get('/api/code/:code/hwids', isApiAuthenticated, async (req, res) => {
  const { code } = req.params;
  try {
    const hwids = await db.getCodeHwids(code);
    const masked = hwids.map(h => ({
      ...h,
      hwid_masked: h.hwid ? h.hwid.substring(0, 16) + '...' : null
    }));
    res.json(masked);
  } catch (error) {
    console.error('Get HWIDs error:', error);
    res.status(500).json({ error: 'Failed to get HWIDs' });
  }
});

// ============================================
// ASSIGN HWID TO CODE
// ============================================

app.post('/api/code/:code/hwid', isApiAuthenticated, async (req, res) => {
  const { code } = req.params;
  const { hwid } = req.body;

  if (!hwid || hwid.length !== 64) {
    return res.status(400).json({ error: 'HWID must be exactly 64 characters' });
  }

  try {
    const result = await db.assignHwidToCode(code.toUpperCase(), hwid);
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

// ============================================
// REMOVE HWID FROM CODE
// ============================================

app.delete('/api/code/:code/hwid', isApiAuthenticated, async (req, res) => {
  const { code } = req.params;
  const { hwid } = req.body;

  if (!hwid || hwid.length !== 64) {
    return res.status(400).json({ error: 'HWID must be exactly 64 characters' });
  }

  try {
    const result = await db.removeHwidFromCode(code.toUpperCase(), hwid);
    if (result.success) {
      await db.logUsage('admin', code, 'hwid_removed', 
        `HWID removed from code ${code} by ${req.session.username}`);
      await db.refreshCache();
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Remove HWID error:', error);
    res.status(500).json({ error: 'Failed to remove HWID' });
  }
});

// ============================================
// UPDATE HWID
// ============================================

app.put('/api/code/:code/hwid', isApiAuthenticated, async (req, res) => {
    const { code } = req.params;
    const { hwid } = req.body;
    
    try {
        if (hwid) {
            const existing = await db.get(
                'SELECT * FROM code_hwids WHERE hwid = $1 AND code != $2',
                [hwid, code]
            );
            if (existing) {
                return res.status(400).json({ 
                    error: `HWID is already assigned to code: ${existing.code}` 
                });
            }
        }
        
        await db.run(
            'UPDATE codes SET hwid = $1 WHERE code = $2',
            [hwid || null, code]
        );
        
        await db.logUsage('admin', code, 'hwid_updated', 
            `HWID updated for code ${code} by ${req.session.username}`);
        
        await db.refreshCache();
        
        res.json({ 
            success: true, 
            message: `HWID updated for code ${code}` 
        });
    } catch (error) {
        console.error('Update HWID error:', error);
        res.status(500).json({ error: 'Failed to update HWID' });
    }
});

// ============================================
// REGISTER DEVICE - WITH MULTI-HWID SUPPORT
// ============================================

app.post('/api/register', async (req, res) => {
  const { deviceId, userAgent, browserInfo, code, hwid } = req.body;

  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID is required' });
  }

  if (!code) {
    return res.status(400).json({ error: 'Activation code is required' });
  }

  if (!hwid) {
    return res.status(403).json({
      error: '❌ This computer is not registered. Please run the Python software first.',
      status: 'hwid_required'
    });
  }

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

  // ============================================
  // CHECK MULTI-HWID AUTHORIZATION
  // ============================================
  const authorized = await db.isHwidAuthorized(code.toUpperCase(), hwid);
  
  if (!authorized) {
    const otherCode = await db.get(
      'SELECT code FROM code_hwids WHERE hwid = $1 AND code != $2',
      [hwid, code.toUpperCase()]
    );
    
    if (otherCode) {
      await db.logUsage(
        deviceId, 
        code, 
        'hwid_already_registered_attempt', 
        `⚠️ HWID ${hwid.substring(0, 16)}... already registered to code ${otherCode.code}`
      );
      
      return res.status(403).json({
        error: `⚠️ This computer is already registered to code: ${otherCode.code}`,
        status: 'hwid_already_registered',
        existing_code: otherCode.code
      });
    }

    const currentCount = await db.getCodeHwidCount(code.toUpperCase());
    const limit = await db.getCodeHwidLimit(code.toUpperCase());

    if (currentCount >= limit) {
      return res.status(403).json({
        error: `⚠️ This code has reached its HWID limit (${limit}). Contact admin to add more computers.`,
        status: 'hwid_limit_reached',
        max_hwid_limit: limit,
        current_hwid_count: currentCount
      });
    }

    const assignResult = await db.assignHwidToCode(code.toUpperCase(), hwid);
    if (!assignResult.success) {
      return res.status(403).json({
        error: `❌ ${assignResult.error}`,
        status: 'hwid_assignment_failed'
      });
    }

    await db.logUsage(
      deviceId, 
      code, 
      'hwid_auto_assigned', 
      `✅ New HWID auto-assigned to code ${code}`
    );
  }

  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';

  try {
    const result = await db.registerDeviceWithCode(
      deviceId, 
      userAgent || '', 
      ip, 
      browserInfo || '', 
      code.toUpperCase(), 
      hwid
    );

    if (!result.success) {
      return res.status(400).json({ 
        error: result.error,
        status: 'registration_failed'
      });
    }

    res.json({
      success: true,
      status: result.status,
      code: result.code,
      username: result.username,
      access: result.access,
      subscription: result.subscription,
      subscription_started_at: result.subscription_started_at,
      subscription_expires_at: result.subscription_expires_at,
      status_code: result.status_code,
      hwid_verified: true,
      message: `✅ Device registered and auto-approved!`
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ============================================
// STATUS CHECK - WITH FULL ACCOUNT INFO
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
        status_code: null
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
        status_code: null
      });
    }

    const codeInfo = await db.getCodeInfo(device.code);
    
    if (!codeInfo || !codeInfo.is_active) {
      return res.json({
        exists: true,
        approved: false,
        status: 'code_inactive',
        message: 'Your activation code has been deactivated - Please enter a new code',
        needsCode: true,
        code: device.code,
        username: null,
        access: null,
        subscription: null,
        subscription_started_at: null,
        subscription_expires_at: null,
        status_code: null
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
          status_code: 'expired'
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
        status_code: codeInfo.status
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
      status_code: null
    });
  }
});

// ============================================
// VALIDATE CODE WITH USERNAME
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

app.get('/api/stats', isApiAuthenticated, async (req, res) => {
  try {
    const cached = db.getCachedData();
    res.json(cached.stats || {});
  } catch (error) {
    console.error('Stats error:', error);
    res.json({});
  }
});

app.get('/api/dashboard-data', isApiAuthenticated, async (req, res) => {
  try {
    await db.cleanupInactiveDevices();
    const cached = db.getCachedData();
    res.json({
      stats: cached.stats || {},
      devices: cached.devices || [],
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
// GENERATE CODE - WITH ACCESS LEVEL AND SUBSCRIPTION
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
// UPDATE CODE USERNAME
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

// ============================================
// UPDATE CODE ACCESS LEVEL
// ============================================

app.put('/api/code/:code/access', isApiAuthenticated, async (req, res) => {
  const { code } = req.params;
  const { accessLevel } = req.body;
  
  if (!accessLevel || !['VIP', 'SVIP'].includes(accessLevel)) {
    return res.status(400).json({ error: 'Access level must be VIP or SVIP' });
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

// ============================================
// UPDATE CODE SUBSCRIPTION
// ============================================

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
// REACTIVATE CODE
// ============================================

app.post('/api/code/:code/reactivate', isApiAuthenticated, async (req, res) => {
  const { code } = req.params;
  const { subscriptionType = 'Lifetime' } = req.body;
  
  try {
    const result = await db.reactivateCode(code, subscriptionType);
    
    if (result.success) {
      await db.logUsage('admin', code, 'code_reactivated', 
        `Code ${code} reactivated with ${subscriptionType} by ${req.session.username}`);
      
      res.json({ 
        success: true, 
        message: `Code reactivated with ${subscriptionType}` 
      });
    } else {
      res.status(404).json({ error: result.error || 'Code not found' });
    }
  } catch (error) {
    console.error('Reactivate code error:', error);
    res.status(500).json({ error: 'Failed to reactivate code' });
  }
});

// ============================================
// DELETE CODE
// ============================================

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
// DEACTIVATE CODE
// ============================================

app.post('/api/code/:code/deactivate', isApiAuthenticated, async (req, res) => {
  const { code } = req.params;
  
  try {
    const result = await db.deactivateCode(code);
    
    if (result.success) {
      await db.logUsage('admin', code, 'code_deactivated', 
        `Code ${code} deactivated by ${req.session.username}`);
      
      res.json({ 
        success: true, 
        message: `Code ${code} deactivated! ${result.devicesRemoved} devices removed` 
      });
    } else {
      res.status(404).json({ error: 'Code not found' });
    }
  } catch (error) {
    console.error('Deactivate code error:', error);
    res.status(500).json({ error: 'Failed to deactivate code' });
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
// REQUEST MANAGEMENT
// ============================================

app.post('/api/request-code', async (req, res) => {
  const { deviceId } = req.body;
  
  try {
    const existing = await db.get(
      `SELECT * FROM requests WHERE device_id = $1 AND code IS NULL AND status = 'pending'`,
      [deviceId || 'unknown']
    );
    
    if (existing) {
      return res.status(400).json({ 
        error: 'You already have a pending request. Please wait for admin.' 
      });
    }
    
    await db.run(
      `INSERT INTO requests (device_id, code, reason, status)
       VALUES ($1, $2, $3, 'pending')`,
      [deviceId || 'unknown', null, 'New user requesting activation code']
    );
    
    await db.logUsage(deviceId || 'unknown', null, 'code_request', 
      `Code requested by device`);
    
    res.json({
      success: true,
      message: 'Code request submitted. Admin will review.'
    });
    
  } catch (error) {
    console.error('Code request error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

app.post('/api/request/:requestId/respond', isApiAuthenticated, async (req, res) => {
  const { requestId } = req.params;
  const { status, response } = req.body;
  
  if (!status || !['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be "approved" or "rejected"' });
  }
  
  try {
    const success = await db.respondToRequest(requestId, status, response || '');
    if (success) {
      if (status === 'rejected') {
        await db.run(`DELETE FROM requests WHERE id = $1`, [requestId]);
      }
      res.json({ success: true, message: `Request ${status}` });
    } else {
      res.status(404).json({ error: 'Request not found' });
    }
  } catch (error) {
    console.error('Respond to request error:', error);
    res.status(500).json({ error: 'Failed to respond to request' });
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
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Server is running!');
    console.log('='.repeat(50));
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🔑 Username: ${process.env.ADMIN_USERNAME || 'admin'}`);
    console.log(`🔒 Password: ${process.env.ADMIN_PASSWORD || 'password123'}`);
    console.log('='.repeat(50));
    console.log('⚠️  IMPORTANT: Change your password in Render env vars!');
    console.log('='.repeat(50) + '\n');
  });
});

module.exports = app;