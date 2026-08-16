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

app.get('/dashboard', isAuthenticated, async (req, res) => {
  const devices = await db.getDevices();
  const stats = await db.getStats();
  const codes = await db.getActiveCodes();
  const pendingRequests = await db.getPendingRequests();
  
  res.render('dashboard', { 
    username: req.session.username,
    devices: devices,
    stats: stats,
    codes: codes,
    requests: pendingRequests
  });
});

app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

app.post('/api/register', async (req, res) => {
  const { deviceId, userAgent, browserInfo, code } = req.body;
  
  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID is required' });
  }

  if (!code) {
    return res.status(400).json({ error: 'Activation code is required' });
  }

  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  
  try {
    const result = await db.registerDeviceWithCode(deviceId, userAgent || '', ip, browserInfo || '', code.toUpperCase());
    
    if (!result.success) {
      return res.status(400).json({ 
        error: result.error,
        status: 'registration_failed',
        limitReached: result.limitReached || false
      });
    }

    res.json({
      success: true,
      status: result.status,
      code: result.code,
      message: `Device registered and auto-approved!`
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.get('/api/status/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  
  try {
    const device = await db.getDevice(deviceId);
    
    if (!device) {
      return res.json({ 
        exists: false, 
        status: 'not_found',
        message: 'Device not found - Please enter your code again',
        needsCode: true
      });
    }

    if (!device.code) {
      return res.json({
        exists: true,
        status: 'invalid',
        message: 'Device has no active code - Please enter your code again',
        needsCode: true
      });
    }

    const codeInfo = await db.getCodeInfo(device.code);
    if (!codeInfo || !codeInfo.is_active) {
      await db.run('DELETE FROM devices WHERE device_id = $1', [deviceId]);
      await db.logUsage(deviceId, device.code, 'code_inactive', 'Device removed because code was deactivated');
      
      return res.json({
        exists: false,
        status: 'code_inactive',
        message: 'Your activation code has been deactivated - Please enter a new code',
        needsCode: true
      });
    }

    await db.updatePing(deviceId);

    res.json({
      exists: true,
      status: device.status,
      code: device.code,
      approved: device.status === 'approved',
      device: {
        id: device.device_id,
        approved_at: device.approved_at,
        revoked_at: device.revoked_at
      }
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

app.get('/api/device-status/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  
  try {
    const device = await db.getDevice(deviceId);
    
    if (!device) {
      return res.json({ 
        exists: false, 
        status: 'not_found',
        message: 'Device not found' 
      });
    }
    
    res.json({
      exists: true,
      status: device.status,
      code: device.code,
      device: {
        id: device.device_id,
        approved_at: device.approved_at,
        revoked_at: device.revoked_at,
        created_at: device.created_at
      }
    });
  } catch (error) {
    console.error('Device status error:', error);
    res.status(500).json({ error: 'Failed to check device status' });
  }
});

app.post('/api/request-code', async (req, res) => {
  const { deviceId } = req.body;
  
  try {
    console.log(`📨 Code request from device: ${deviceId || 'unknown'}`);
    
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

app.post('/api/generate-code', isApiAuthenticated, async (req, res) => {
  const { username } = req.body;
  
  if (!username || username.trim() === '') {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  try {
    const code = await db.generateCode(10, req.session.username, username.trim(), `For user: ${username}`);
    
    try {
      await db.query(
        `DELETE FROM requests WHERE device_id = $1 AND code IS NULL AND status = 'pending'`,
        [username.trim()]
      );
      console.log(`🗑️ Deleted pending request(s) for ${username}`);
    } catch (deleteError) {
      console.log(`No pending request to delete for ${username}`);
    }
    
    try {
      await db.query(
        `UPDATE devices 
         SET code = $1, status = 'approved', approved_at = CURRENT_TIMESTAMP
         WHERE device_id = $2`,
        [code, username.trim()]
      );
    } catch (updateError) {
      console.log(`No existing device found for ${username}`);
    }
    
    await db.logUsage(username, code, 'code_generated', 
      `Code ${code} generated for ${username} by ${req.session.username}`);
    
    res.json({ 
      success: true, 
      code: code,
      username: username,
      message: `Code ${code} generated for ${username}`
    });
  } catch (error) {
    console.error('Generate code error:', error);
    res.status(500).json({ error: 'Failed to generate code' });
  }
});

app.get('/api/codes', isApiAuthenticated, async (req, res) => {
  try {
    const codes = await db.getActiveCodes();
    res.json(codes);
  } catch (error) {
    console.error('Get codes error:', error);
    res.status(500).json({ error: 'Failed to get codes' });
  }
});

app.get('/api/codes/all', isApiAuthenticated, async (req, res) => {
  try {
    const codes = await db.getAllCodes();
    res.json(codes);
  } catch (error) {
    console.error('Get all codes error:', error);
    res.status(500).json({ error: 'Failed to get codes' });
  }
});

app.get('/api/code/:code/usage', isApiAuthenticated, async (req, res) => {
  const { code } = req.params;
  
  try {
    const usage = await db.getCodeUsage(code);
    res.json(usage);
  } catch (error) {
    console.error('Code usage error:', error);
    res.status(500).json({ error: 'Failed to get code usage' });
  }
});

app.post('/api/code/:code/deactivate', isApiAuthenticated, async (req, res) => {
  const { code } = req.params;
  
  try {
    const result = await db.deactivateCode(code);
    
    if (result.success) {
      await db.logUsage('admin', code, 'code_deactivated', 
        `Code ${code} deactivated by ${req.session.username}, ${result.devicesRemoved} devices removed`);
      
      res.json({ 
        success: true, 
        message: `Code deactivated and ${result.devicesRemoved} devices removed`,
        devicesRemoved: result.devicesRemoved
      });
    } else {
      res.status(404).json({ error: 'Code not found' });
    }
  } catch (error) {
    console.error('Deactivate code error:', error);
    res.status(500).json({ error: 'Failed to deactivate code' });
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
        message: `Code ${code} deleted and all associated devices removed` 
      });
    } else {
      res.status(404).json({ error: 'Code not found' });
    }
  } catch (error) {
    console.error('Delete code error:', error);
    res.status(500).json({ error: 'Failed to delete code' });
  }
});

app.post('/api/code/:code/reactivate', isApiAuthenticated, async (req, res) => {
  const { code } = req.params;
  
  try {
    await db.run(
      `UPDATE codes SET is_active = true WHERE code = $1`,
      [code]
    );
    
    res.json({ 
      success: true, 
      message: `Code ${code} reactivated` 
    });
  } catch (error) {
    console.error('Reactivate code error:', error);
    res.status(500).json({ error: 'Failed to reactivate code' });
  }
});

app.post('/api/code/:code/extend', isApiAuthenticated, async (req, res) => {
  const { code } = req.params;
  const { maxDevices } = req.body;
  
  if (!maxDevices || maxDevices < 1) {
    return res.status(400).json({ error: 'maxDevices is required and must be > 0' });
  }
  
  try {
    const success = await db.extendCode(code, maxDevices);
    if (success) {
      await db.logUsage('admin', code, 'code_extended', 
        `Code ${code} extended to ${maxDevices} devices by ${req.session.username}`);
      
      res.json({ success: true, message: `Code extended to ${maxDevices} devices` });
    } else {
      res.status(404).json({ error: 'Code not found' });
    }
  } catch (error) {
    console.error('Extend code error:', error);
    res.status(500).json({ error: 'Failed to extend code' });
  }
});

app.delete('/api/device/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  
  console.log(`🗑️ DELETE request for device: ${deviceId}`);
  
  try {
    const device = await db.getDevice(deviceId);
    if (!device) {
      console.log(`❌ Device not found: ${deviceId}`);
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const code = device.code;
    console.log(`📋 Device found with code: ${code}`);
    
    const result = await db.run(
      `DELETE FROM devices WHERE device_id = $1`,
      [deviceId]
    );
    
    if (result.changes > 0) {
      if (code) {
        await db.run(
          `UPDATE codes SET used_count = used_count - 1 WHERE code = $1`,
          [code]
        );
        console.log(`✅ Updated code ${code} used_count`);
      }
      
      await db.logUsage(deviceId, code, 'remove_user', 'User removed from extension');
      
      console.log(`✅ Device ${deviceId} removed successfully`);
      
      res.json({ 
        success: true, 
        message: `User removed, slot freed. Device will need to re-enter code.`,
        deviceId: deviceId,
        code: code
      });
    } else {
      res.status(404).json({ error: 'Failed to remove device' });
    }
  } catch (error) {
    console.error('Remove user error:', error);
    res.status(500).json({ error: 'Failed to remove user' });
  }
});

app.post('/api/reactivate/:deviceId', isApiAuthenticated, async (req, res) => {
  const { deviceId } = req.params;
  
  try {
    const result = await db.reactivateDevice(deviceId);
    if (result && result.success !== false) {
      await db.logUsage(deviceId, null, 'reactivate', 
        `Device reactivated by admin ${req.session.username}`);
      res.json({ success: true, message: `Device reactivated` });
    } else if (result && result.error) {
      res.status(400).json({ error: result.error });
    } else {
      res.status(404).json({ error: 'Device not found' });
    }
  } catch (error) {
    console.error('Reactivate error:', error);
    res.status(500).json({ error: 'Failed to reactivate device' });
  }
});

app.post('/api/device/:deviceId/assign-code', isApiAuthenticated, async (req, res) => {
  const { deviceId } = req.params;
  const { code } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }
  
  try {
    const codeInfo = await db.getCodeInfo(code);
    if (!codeInfo) {
      return res.status(404).json({ error: 'Code not found' });
    }
    
    if (!codeInfo.is_active) {
      return res.status(400).json({ error: 'Code is inactive' });
    }
    
    const device = await db.getDevice(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const usage = await db.getCodeUsage(code);
    if (usage.used >= usage.max) {
      return res.status(400).json({ error: 'Code limit reached' });
    }
    
    if (device.code && device.code !== code) {
      await db.run(
        `UPDATE codes SET used_count = used_count - 1 WHERE code = $1`,
        [device.code]
      );
    }
    
    await db.run(
      `UPDATE devices 
       SET code = $1, 
           status = 'approved',
           approved_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE device_id = $2`,
      [code, deviceId]
    );
    
    await db.run(
      `UPDATE codes SET used_count = used_count + 1 WHERE code = $1`,
      [code]
    );
    
    await db.logUsage(deviceId, code, 'assign_code', 
      `Device assigned to code by admin ${req.session.username}`);
    
    res.json({ 
      success: true, 
      message: `Device assigned to code: ${code}` 
    });
  } catch (error) {
    console.error('Assign device error:', error);
    res.status(500).json({ error: 'Failed to assign device' });
  }
});

app.post('/api/request', async (req, res) => {
  const { deviceId, code, reason } = req.body;
  
  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID is required' });
  }
  
  try {
    const result = await db.createRequest(deviceId, code || null, reason || '');
    if (result.success) {
      res.json({ 
        success: true, 
        requestId: result.id,
        message: 'Request submitted successfully'
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Request error:', error);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

app.get('/api/requests', isApiAuthenticated, async (req, res) => {
  try {
    const requests = await db.getAllRequests();
    res.json(requests);
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ error: 'Failed to get requests' });
  }
});

app.get('/api/requests/pending', isApiAuthenticated, async (req, res) => {
  try {
    const requests = await db.getPendingRequests();
    res.json(requests);
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({ error: 'Failed to get pending requests' });
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

app.get('/api/stats', isApiAuthenticated, async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

app.get('/api/dashboard-data', isApiAuthenticated, async (req, res) => {
  try {
    const devices = await db.getDevices();
    const stats = await db.getStats();
    const codes = await db.getActiveCodes();
    const pendingRequests = await db.getPendingRequests();
    
    res.json({
      stats,
      devices,
      codes,
      requests: pendingRequests,
      username: req.session.username
    });
  } catch (error) {
    console.error('Dashboard data error:', error);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

app.post('/api/delete-all-devices', isApiAuthenticated, async (req, res) => {
  try {
    console.log('🗑️ Deleting all devices...');
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
    console.log('🗑️ Deleting all requests...');
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
    console.log('🗑️ Deleting all codes...');
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