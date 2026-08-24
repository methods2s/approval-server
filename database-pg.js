<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard - Dating Sites</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.8.1/font/bootstrap-icons.css" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
        .container { max-width: 1400px; margin: 0 auto; }
        
        .header { display: flex; justify-content: space-between; align-items: center; padding: 15px 20px; background: rgba(255,255,255,0.05); border-radius: 10px; margin-bottom: 20px; }
        .header h1 { font-size: 24px; color: #fff; }
        .header .user { font-size: 14px; color: #aaa; }
        .header .user strong { color: #4CAF50; }
        .header .logout-btn { padding: 8px 20px; background: #f44336; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
        .header .logout-btn:hover { background: #d32f2f; }
        
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .stat-card { background: rgba(255,255,255,0.05); padding: 20px; border-radius: 10px; text-align: center; border: 1px solid rgba(255,255,255,0.08); }
        .stat-card .number { font-size: 32px; font-weight: bold; color: #4CAF50; }
        .stat-card .label { font-size: 13px; color: #888; margin-top: 5px; }
        
        .card { background: rgba(255,255,255,0.05); padding: 20px; border-radius: 10px; margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.08); }
        .card h3 { color: #fff; margin-bottom: 15px; font-size: 18px; }
        .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px; }
        .card-header h3 { margin-bottom: 0; }
        
        .form-group { margin-bottom: 12px; }
        .form-group label { display: block; font-size: 13px; color: #aaa; margin-bottom: 4px; font-weight: bold; }
        .form-group input, .form-group select { width: 100%; padding: 10px; border: 1px solid #555; border-radius: 6px; background: #222; color: #fff; font-size: 14px; }
        .form-group input:focus, .form-group select:focus { border-color: #4CAF50; outline: none; }
        .form-row { display: flex; gap: 15px; flex-wrap: wrap; }
        .form-row .form-group { flex: 1; min-width: 150px; }
        
        .btn-primary { padding: 10px 25px; background: #4CAF50; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold; }
        .btn-primary:hover { background: #45a049; }
        .btn-warning { padding: 8px 15px; background: #FF9800; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
        .btn-warning:hover { background: #e68900; }
        .btn-danger { padding: 8px 15px; background: #f44336; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
        .btn-danger:hover { background: #d32f2f; }
        .btn-success { padding: 8px 15px; background: #4CAF50; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
        .btn-success:hover { background: #388E3C; }
        .btn-small { padding: 4px 10px; font-size: 11px; border: none; border-radius: 4px; cursor: pointer; }
        .btn-edit { background: #2196F3; color: #fff; }
        .btn-edit:hover { background: #1976D2; }
        .btn-save { background: #4CAF50; color: #fff; }
        .btn-save:hover { background: #388E3C; }
        .btn-cancel { background: #757575; color: #fff; }
        .btn-cancel:hover { background: #616161; }
        .btn-refresh { background: #2196F3; color: #fff; padding: 6px 15px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
        .btn-refresh:hover { background: #1976D2; }
        .btn-copy-one { background: linear-gradient(135deg, #00BCD4, #FF9800); color: #fff; border: none; border-radius: 4px; padding: 4px 12px; font-size: 11px; cursor: pointer; transition: all 0.2s; }
        .btn-copy-one:hover { transform: scale(1.05); opacity: 0.9; }
        .btn-remove-hwid-code { background: #f44336; color: #fff; border: none; border-radius: 4px; padding: 4px 10px; font-size: 10px; cursor: pointer; transition: all 0.2s; }
        .btn-remove-hwid-code:hover { background: #d32f2f; transform: scale(1.05); }
        
        .scroll-table { overflow-x: auto; max-height: 500px; overflow-y: auto; position: relative; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        table th { text-align: left; padding: 10px 8px; background: rgba(255,255,255,0.05); color: #aaa; border-bottom: 2px solid #333; position: sticky; top: 0; z-index: 10; }
        table td { padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: middle; }
        table tr:hover { background: rgba(255,255,255,0.03); }
        table tr.editing { background: rgba(255,152,0,0.15); }
        
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; }
        .badge.active { background: rgba(76,175,80,0.2); color: #4CAF50; }
        .badge.inactive { background: rgba(244,67,54,0.2); color: #f44336; }
        .badge.vip { background: rgba(255,152,0,0.2); color: #FF9800; }
        .badge.svip { background: rgba(76,175,80,0.2); color: #4CAF50; }
        .badge.auto-deactivated { background: rgba(244,67,54,0.2); color: #f44336; }
        
        .badge-hwid-status { padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; }
        .badge-hwid-status.has-hwid { background: rgba(76,175,80,0.2); color: #4CAF50; }
        .badge-hwid-status.no-hwid { background: rgba(244,67,54,0.2); color: #f44336; }
        .badge-hwid-status.full { background: rgba(255,152,0,0.2); color: #FF9800; }
        
        .badge-unregistered { background: rgba(255,152,0,0.2); color: #FF9800; font-size: 9px; padding: 1px 6px; border-radius: 8px; }
        .badge-approved { background: rgba(76,175,80,0.2); color: #4CAF50; font-size: 9px; padding: 1px 6px; border-radius: 8px; }
        
        .badge-new-count { background: #f44336; color: #fff; padding: 2px 10px; border-radius: 12px; font-size: 12px; }
        .badge-new-count.zero { background: #4CAF50; }
        
        .edit-input { width: 100%; padding: 6px 8px; border: 2px solid #FF9800; border-radius: 4px; background: #2a1f0a; color: #fff; font-size: 13px; min-width: 60px; }
        .edit-input:focus { outline: none; border-color: #4CAF50; }
        .edit-select { padding: 6px 8px; border: 2px solid #FF9800; border-radius: 4px; background: #2a1f0a; color: #fff; font-size: 13px; }
        .edit-select:focus { outline: none; border-color: #4CAF50; }
        
        .tab-buttons { display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap; }
        .tab-btn { padding: 8px 20px; border: 2px solid #555; border-radius: 6px; background: transparent; color: #aaa; cursor: pointer; font-size: 14px; }
        .tab-btn.active { border-color: #4CAF50; color: #4CAF50; background: rgba(76,175,80,0.1); }
        .tab-btn:hover { border-color: #888; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        
        .refresh-btn { padding: 6px 15px; background: #2196F3; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 10px; }
        .refresh-btn:hover { background: #1976D2; }
        .code-font { font-family: monospace; font-size: 13px; }
        .text-muted { color: #888; }
        .mt-10 { margin-top: 10px; }
        .action-buttons { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
        
        #result-message { position: fixed; bottom: 20px; right: 20px; padding: 12px 24px; border-radius: 8px; display: none; z-index: 9999; font-size: 14px; max-width: 400px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
        #result-message.success { display: block; color: #4CAF50; background: rgba(76,175,80,0.15); border: 1px solid #4CAF50; }
        #result-message.error { display: block; color: #f44336; background: rgba(244,67,54,0.15); border: 1px solid #f44336; }
        #result-message.loading { display: block; color: #FF9800; background: rgba(255,152,0,0.15); border: 1px solid #FF9800; }
        
        .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #fff; border-radius: 50%; border-top-color: transparent; animation: spin 0.6s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        
        .hwid-spec-item { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; margin: 2px 0; }
        .hwid-spec-item.cpu { background: rgba(76,175,80,0.15); color: #4CAF50; }
        .hwid-spec-item.gpu { background: rgba(156,39,176,0.15); color: #9C27B0; }
        .hwid-spec-item.ram { background: rgba(255,152,0,0.15); color: #FF9800; }
        .hwid-spec-item.storage { background: rgba(33,150,243,0.15); color: #2196F3; }
        .hwid-spec-item.device { background: rgba(255,87,34,0.15); color: #FF5722; }
        .hwid-spec-item.profile { background: rgba(0,188,212,0.15); color: #00BCD4; }
        .hwid-spec-item.unregistered { background: rgba(255,152,0,0.1); color: #FF9800; border: 1px dashed #FF9800; }
        
        .btn-remove-hwid { background: #f44336; color: #fff; border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 12px; font-weight: bold; transition: all 0.2s; }
        .btn-remove-hwid:hover { background: #d32f2f; transform: scale(1.05); }
        .btn-remove-hwid:disabled { background: #555; color: #888; cursor: not-allowed; transform: none; }
        
        .hwid-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 15px; }
        .hwid-stat-card { background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; text-align: center; border: 1px solid rgba(255,255,255,0.08); }
        .hwid-stat-card .number { font-size: 28px; font-weight: bold; color: #4CAF50; }
        .hwid-stat-card .label { font-size: 12px; color: #888; margin-top: 4px; }
        
        .wallpaper-preview { width: 100px; height: 70px; border-radius: 6px; object-fit: cover; border: 2px solid rgba(255,255,255,0.1); background: #111; cursor: pointer; transition: all 0.3s ease; display: block; }
        .wallpaper-preview:hover { transform: scale(1.5); z-index: 100; border-color: #FF9800; box-shadow: 0 0 20px rgba(255,152,0,0.3); }
        .wallpaper-placeholder { width: 100px; height: 70px; border-radius: 6px; background: rgba(255,255,255,0.05); border: 2px dashed #555; display: flex; align-items: center; justify-content: center; font-size: 24px; color: #666; }
        
        .wallpaper-modal { display: none; position: fixed; z-index: 10000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); }
        .wallpaper-modal.active { display: flex; align-items: center; justify-content: center; flex-direction: column; }
        .wallpaper-modal img { max-width: 90%; max-height: 85%; border-radius: 12px; box-shadow: 0 0 60px rgba(255,152,0,0.2); }
        .wallpaper-modal .close-modal { position: absolute; top: 20px; right: 40px; color: #fff; font-size: 50px; cursor: pointer; background: none; border: none; transition: transform 0.2s; }
        .wallpaper-modal .close-modal:hover { color: #f44336; transform: rotate(90deg); }
        .wallpaper-modal .wallpaper-info { color: #aaa; font-size: 14px; margin-top: 15px; text-align: center; }
        .wallpaper-modal .wallpaper-info strong { color: #FF9800; }
        
        .code-badge { background: rgba(255,152,0,0.15); color: #FF9800; padding: 2px 8px; border-radius: 4px; font-family: monospace; font-size: 11px; }
        
        .error-box { background: rgba(244,67,54,0.15); border: 1px solid #f44336; border-radius: 8px; padding: 20px; text-align: center; color: #f44336; }
        .error-box .error-icon { font-size: 30px; display: block; margin-bottom: 10px; }
        
        .loading-text { color: #FF9800; text-align: center; padding: 30px; font-size: 14px; }
        .loading-text .spinner { display: inline-block; margin-right: 10px; vertical-align: middle; }
        
        .wallpaper-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
        .wallpaper-cell .wallpaper-info-text { font-size: 10px; color: #888; line-height: 1.3; }
        .wallpaper-cell .wallpaper-info-text .name { color: #FF9800; }
        .wallpaper-cell .wallpaper-info-text .size { color: #666; }
        .wallpaper-cell .wallpaper-info-text .res { color: #555; }
        
        .search-box { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .search-box input { padding: 8px 14px; border: 1px solid #555; border-radius: 6px; background: #222; color: #fff; font-size: 13px; min-width: 200px; flex: 1; }
        .search-box input:focus { border-color: #4CAF50; outline: none; }
        .search-box .search-icon { color: #888; font-size: 14px; }
        .search-box .clear-search { background: none; border: none; color: #888; cursor: pointer; font-size: 16px; padding: 4px 8px; }
        .search-box .clear-search:hover { color: #f44336; }
        
        .hwid-status-badge { font-size: 11px; padding: 3px 12px; border-radius: 12px; display: inline-block; font-weight: bold; }
        .hwid-status-badge.has-hwid { background: rgba(76,175,80,0.2); color: #4CAF50; }
        .hwid-status-badge.no-hwid { background: rgba(244,67,54,0.2); color: #f44336; }
        .hwid-status-badge.full { background: rgba(255,152,0,0.2); color: #FF9800; }
        
        .lazy-loading { text-align: center; padding: 10px; color: #888; font-size: 12px; }
        .lazy-loading .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid #888; border-radius: 50%; border-top-color: transparent; animation: spin 0.6s linear infinite; margin-right: 8px; vertical-align: middle; }
        
        @media (max-width: 768px) { 
            .form-row { flex-direction: column; } 
            .hwid-stats-grid { grid-template-columns: repeat(2, 1fr); }
            .wallpaper-preview { width: 80px; height: 60px; }
            .wallpaper-placeholder { width: 80px; height: 60px; font-size: 20px; }
            .search-box input { min-width: 120px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- HEADER -->
        <div class="header">
            <div>
                <h1>🔐 Admin Dashboard</h1>
                <div class="user">Logged in as: <strong><%= username %></strong></div>
            </div>
            <div>
                <button class="refresh-btn" onclick="refreshData()">🔄 Refresh</button>
                <a href="/logout"><button class="logout-btn">🚪 Logout</button></a>
            </div>
        </div>

        <!-- STATS -->
        <div class="stats-grid" id="stats-grid">
            <div class="stat-card">
                <div class="number" id="stat-codes">0</div>
                <div class="label">🔑 Total Codes</div>
            </div>
            <div class="stat-card">
                <div class="number" id="stat-svip">0</div>
                <div class="label" style="color:#4CAF50;">⭐ SVIP Codes</div>
            </div>
            <div class="stat-card">
                <div class="number" id="stat-vip">0</div>
                <div class="label" style="color:#FF9800;">🔶 VIP Codes</div>
            </div>
        </div>

        <!-- TABS -->
        <div class="tab-buttons">
            <button class="tab-btn active" onclick="switchTab('codes')">🔑 All Codes</button>
            <button class="tab-btn" onclick="switchTab('svip')">⭐ SVIP</button>
            <button class="tab-btn" onclick="switchTab('vip')">🔶 VIP</button>
            <button class="tab-btn" onclick="switchTab('hwid')">🖥️ HWID Manager</button>
            <button class="tab-btn" onclick="switchTab('hwidlogs')">📋 HWID Logs</button>
            <button class="tab-btn" onclick="switchTab('newhwid')" id="new-hwid-tab">
                🆕 New HWIDs <span class="badge-new-count" id="new-hwid-badge">0</span>
            </button>
        </div>

        <!-- ============================================ -->
        <!-- TAB: ALL CODES -->
        <!-- ============================================ -->
        <div class="tab-content active" id="tab-codes">
            <div class="card">
                <h3>➕ Generate New Code</h3>
                <form id="generate-code-form">
                    <div class="form-row">
                        <div class="form-group">
                            <label>👤 Username</label>
                            <input type="text" id="gen-username" placeholder="e.g., john_doe" required>
                        </div>
                        <div class="form-group">
                            <label>🔐 Access Level</label>
                            <select id="gen-access">
                                <option value="VIP">🔶 VIP</option>
                                <option value="SVIP">⭐ SVIP</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>📅 Subscription</label>
                            <select id="gen-subscription">
                                <option value="Lifetime">♾️ Lifetime</option>
                                <option value="3 Months">3 Months</option>
                                <option value="6 Months">6 Months</option>
                                <option value="12 Months">12 Months</option>
                            </select>
                        </div>
                    </div>
                    <button type="submit" class="btn-primary">✅ Generate Code</button>
                </form>
                <div id="gen-result" class="mt-10"></div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3>📋 All Codes</h3>
                    <div class="search-box">
                        <span class="search-icon">🔍</span>
                        <input type="text" id="code-username-search" placeholder="Search username..." onkeyup="filterCodesByUsername()">
                        <button class="clear-search" onclick="document.getElementById('code-username-search').value=''; filterCodesByUsername();">✕</button>
                    </div>
                </div>
                <div class="scroll-table">
                    <table>
                        <thead>
                            <tr>
                                <th style="width:100px;">Code</th>
                                <th>Username</th>
                                <th>Access</th>
                                <th>Subscription</th>
                                <th>Expires</th>
                                <th style="width:100px;">HWID Status</th>
                                <th style="min-width:180px;">Deactivation Reason</th>
                                <th style="width:220px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="codes-body">
                            <tr><td colspan="8" style="text-align:center;color:#888;padding:30px;">
                                <div class="loading-text"><span class="spinner"></span> Loading codes...</div>
                            </td></tr>
                        </tbody>
                    </table>
                    <div id="scroll-loading" class="lazy-loading" style="display:none;">
                        <span class="spinner"></span> Loading more...
                    </div>
                </div>
            </div>
        </div>

        <!-- ============================================ -->
        <!-- TAB: SVIP -->
        <!-- ============================================ -->
        <div class="tab-content" id="tab-svip">
            <div class="card">
                <div class="card-header">
                    <h3>⭐ SVIP Codes</h3>
                    <span class="badge svip" id="svip-count">0 codes</span>
                </div>
                <div class="scroll-table">
                    <table>
                        <thead>
                            <tr>
                                <th>Code</th>
                                <th>Username</th>
                                <th>Subscription</th>
                                <th>Expires</th>
                                <th>HWID Status</th>
                                <th style="min-width:180px;">Deactivation Reason</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="svip-body">
                            <tr><td colspan="7" style="text-align:center;color:#888;padding:30px;">
                                <div class="loading-text"><span class="spinner"></span> Loading SVIP codes...</div>
                            </td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- ============================================ -->
        <!-- TAB: VIP -->
        <!-- ============================================ -->
        <div class="tab-content" id="tab-vip">
            <div class="card">
                <div class="card-header">
                    <h3>🔶 VIP Codes</h3>
                    <span class="badge vip" id="vip-count">0 codes</span>
                </div>
                <div class="scroll-table">
                    <table>
                        <thead>
                            <tr>
                                <th>Code</th>
                                <th>Username</th>
                                <th>Subscription</th>
                                <th>Expires</th>
                                <th>HWID Status</th>
                                <th style="min-width:180px;">Deactivation Reason</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="vip-body">
                            <tr><td colspan="7" style="text-align:center;color:#888;padding:30px;">
                                <div class="loading-text"><span class="spinner"></span> Loading VIP codes...</div>
                            </td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- ============================================ -->
        <!-- TAB: HWID MANAGER -->
        <!-- ============================================ -->
        <div class="tab-content" id="tab-hwid">
            <div class="card">
                <div class="card-header">
                    <h3>🖥️ HWID Management</h3>
                    <span class="text-muted">Manage which computers can use each code</span>
                </div>
                
                <div class="form-row" style="margin-bottom:15px;">
                    <div class="form-group" style="flex:2;">
                        <label>Select Code</label>
                        <select id="hwid-code-select" onchange="loadHwidDetails()">
                            <option value="">-- Select a code --</option>
                        </select>
                    </div>
                    <div class="form-group" style="flex:1;">
                        <label>HWID Limit (1-10)</label>
                        <div style="display:flex;gap:10px;">
                            <input type="number" id="hwid-limit-input" min="1" max="10" value="1">
                            <button onclick="updateHwidLimit()" class="btn-primary" style="padding:8px 15px;">Update</button>
                        </div>
                    </div>
                </div>

                <div id="hwid-info" style="display:none;">
                    <div class="hwid-stats-grid">
                        <div class="hwid-stat-card">
                            <div class="number" id="hwid-current-count">0</div>
                            <div class="label">Current HWIDs</div>
                        </div>
                        <div class="hwid-stat-card">
                            <div class="number" id="hwid-max-limit">0</div>
                            <div class="label">Max Limit</div>
                        </div>
                        <div class="hwid-stat-card">
                            <div class="number" id="hwid-available-slots">0</div>
                            <div class="label">Available Slots</div>
                        </div>
                    </div>
                    <div id="hwid-limit-status" style="text-align:center;padding:8px;border-radius:6px;margin-bottom:15px;display:none;"></div>
                </div>

                <div id="hwid-list-section" style="display:none;">
                    <h4>📋 Assigned Computers</h4>
                    <div class="scroll-table">
                        <table>
                            <thead>
                                <tr>
                                    <th style="width:40px;">#</th>
                                    <th style="min-width:180px;">HWID</th>
                                    <th style="min-width:450px;">Hardware Specs &amp; 🖼️ Wallpaper</th>
                                    <th style="width:100px;">Action</th>
                                </tr>
                            </thead>
                            <tbody id="hwid-list-body">
                                <tr><td colspan="4" style="text-align:center;color:#888;padding:20px;">Select a code to view HWIDs</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <!-- ============================================ -->
        <!-- TAB: HWID LOGS -->
        <!-- ============================================ -->
        <div class="tab-content" id="tab-hwidlogs">
            <div class="card">
                <div class="card-header">
                    <h3>📋 HWID Activity Logs</h3>
                    <div>
                        <span class="badge badge-new-count" id="new-hwid-count">0 new</span>
                        <button onclick="loadHwidLogs()" class="btn-small btn-refresh" style="margin-left:10px;">🔄 Refresh</button>
                        <button onclick="clearOldHwidLogs()" class="btn-small btn-warning" style="margin-left:5px;">🧹 Clear Old</button>
                    </div>
                </div>
                <div class="card-body">
                    <div class="scroll-table">
                        <table>
                            <thead>
                                <tr>
                                    <th style="width:40px;">#</th>
                                    <th style="min-width:150px;">🖥️ HWID</th>
                                    <th style="width:100px;">🔑 Code</th>
                                    <th style="min-width:350px;">🖥️ Hardware Specs</th>
                                    <th style="width:160px;">⏰ Time</th>
                                </tr>
                            </thead>
                            <tbody id="hwid-logs-body">
                                <tr><td colspan="5" style="text-align:center;color:#888;padding:30px;">
                                    <div class="loading-text"><span class="spinner"></span> Loading logs...</div>
                                </td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <!-- ============================================ -->
        <!-- TAB: NEW HWID -->
        <!-- ============================================ -->
        <div class="tab-content" id="tab-newhwid">
            <div class="card">
                <div class="card-header">
                    <h3>🆕 New HWID Detections</h3>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <span class="text-muted" style="font-size:12px;">HWIDs without assigned codes</span>
                        <button onclick="loadNewHwids()" class="btn-small btn-refresh">🔄 Refresh</button>
                    </div>
                </div>
                <div class="card-body">
                    <div class="scroll-table">
                        <table>
                            <thead>
                                <tr>
                                    <th style="width:40px;">#</th>
                                    <th style="min-width:180px;">🖥️ HWID</th>
                                    <th style="min-width:200px;">🔧 Hardware Specs</th>
                                    <th style="width:160px;">⏰ Detected At</th>
                                    <th style="width:160px;">🔄 Last Seen</th>
                                    <th style="width:120px;">Action</th>
                                </tr>
                            </thead>
                            <tbody id="new-hwids-body">
                                <tr><td colspan="6" style="text-align:center;color:#888;padding:30px;">
                                    <div class="loading-text"><span class="spinner"></span> Loading new HWIDs...</div>
                                </td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

    </div>

    <!-- WALLPAPER MODAL -->
    <div class="wallpaper-modal" id="wallpaper-modal">
        <button class="close-modal" onclick="closeWallpaperModal()">&times;</button>
        <img id="wallpaper-modal-img" src="" alt="Wallpaper">
        <div class="wallpaper-info" id="wallpaper-modal-info"></div>
    </div>

    <!-- Result Message -->
    <div id="result-message">
        <button class="close-msg" onclick="hideMessage()">✕</button>
        <span id="result-text"></span>
    </div>

    <script>
        // ============================================
        // MESSAGE HELPERS
        // ============================================
        function showMessage(msg, type = 'success') {
            const el = document.getElementById('result-message');
            const text = document.getElementById('result-text');
            if (!el || !text) return;
            text.innerHTML = msg;
            el.className = type;
            el.style.display = 'block';
            clearTimeout(window.msgTimeout);
            window.msgTimeout = setTimeout(() => {
                hideMessage();
            }, 4000);
        }
        
        function hideMessage() {
            const el = document.getElementById('result-message');
            if (el) {
                el.style.display = 'none';
                el.className = '';
            }
        }

        // ============================================
        // WALLPAPER MODAL
        // ============================================
        function openWallpaperModal(base64Image, fileName, size, resolution) {
            const modal = document.getElementById('wallpaper-modal');
            const img = document.getElementById('wallpaper-modal-img');
            const info = document.getElementById('wallpaper-modal-info');
            
            if (!base64Image) {
                showMessage('❌ No wallpaper image available', 'error');
                return;
            }
            
            const imageSrc = base64Image.startsWith('data:image') ? base64Image : 'data:image/jpeg;base64,' + base64Image;
            img.src = imageSrc;
            
            const sizeNum = parseFloat(size) || 0;
            const resolutionText = (resolution && resolution !== '0x0') ? resolution : '';
            
            info.innerHTML = `
                <strong>${fileName}</strong> 
                ${sizeNum > 0 ? `📦 ${sizeNum.toFixed(1)} KB` : ''} 
                ${resolutionText ? `📐 ${resolutionText}` : ''}
            `;
            
            modal.classList.add('active');
            
            modal.onclick = function(e) {
                if (e.target === modal) {
                    closeWallpaperModal();
                }
            };
        }

        function closeWallpaperModal() {
            document.getElementById('wallpaper-modal').classList.remove('active');
            document.getElementById('wallpaper-modal-img').src = '';
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeWallpaperModal();
            }
        });

        // ============================================
        // WALLPAPER HTML HELPERS
        // ============================================
        function getWallpaperHtml(wallpaper, showPreview = true) {
            if (!wallpaper) {
                return '<span style="color:#666;font-size:10px;">No wallpaper</span>';
            }
            
            let html = '';
            const name = wallpaper.name || wallpaper.file_name || 'Unknown';
            const size = parseFloat(wallpaper.size_kb) || 0;
            const width = parseInt(wallpaper.width) || 0;
            const height = parseInt(wallpaper.height) || 0;
            const base64 = wallpaper.base64 || null;
            const resolution = (width > 0 && height > 0) ? `${width}x${height}` : '';
            
            if (showPreview && base64) {
                const imageSrc = base64.startsWith('data:image') ? base64 : 'data:image/jpeg;base64,' + base64;
                html += `<div class="wallpaper-cell">`;
                html += `<img class="wallpaper-preview" src="${imageSrc}" 
                           onclick="event.stopPropagation(); openWallpaperModal('${base64}', '${name}', ${size}, '${resolution}')" 
                           title="Click to enlarge" alt="${name}"
                           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`;
                html += `<div class="wallpaper-placeholder" style="display:none;">🖼️</div>`;
                html += `<div class="wallpaper-info-text">`;
                html += `<span class="name">${name}</span>`;
                if (size > 0) {
                    html += ` <span class="size">(${size.toFixed(1)} KB)</span>`;
                }
                if (resolution) {
                    html += `<br><span class="res">📐 ${resolution}</span>`;
                }
                html += `</div>`;
                html += `</div>`;
            } else if (showPreview && !base64) {
                html += `<div class="wallpaper-cell">`;
                html += `<div class="wallpaper-placeholder">🖼️</div>`;
                html += `<div class="wallpaper-info-text">`;
                html += `<span class="name">${name}</span>`;
                if (size > 0) {
                    html += ` <span class="size">(${size.toFixed(1)} KB)</span>`;
                }
                if (resolution) {
                    html += `<br><span class="res">📐 ${resolution}</span>`;
                }
                html += `</div>`;
                html += `</div>`;
            } else {
                html = `<span style="color:#666;font-size:10px;">${name}</span>`;
            }
            
            return html;
        }

        // ============================================
        // COPY FUNCTION
        // ============================================
        function copyCodeAndUser(code, username) {
            const textToCopy = `Code: ${code}\nUsername: ${username || 'N/A'}`;
            navigator.clipboard.writeText(textToCopy).then(() => {
                showMessage(`✅ Copied!\nCode: ${code}\nUsername: ${username || 'N/A'}`, 'success');
            }).catch(() => {
                const textArea = document.createElement('textarea');
                textArea.value = textToCopy;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                showMessage(`✅ Copied!\nCode: ${code}\nUsername: ${username || 'N/A'}`, 'success');
            });
        }

        // ============================================
        // STATE
        // ============================================
        let editingCode = null;
        let allCodes = [];
        let allDevices = [];
        let codeHwidsMap = {};
        let isLoading = false;
        let loadError = false;
        let filteredCodes = [];
        let hwidDetailsCache = {};
        let visibleRows = 50;
        const ROWS_PER_PAGE = 50;

        // ============================================
        // DEACTIVATION REASON MAPPING
        // ============================================
        const deactivationReasons = {
            'auto_deactivated': '⚠️ Auto-deactivated (General)',
            'auto_deactivated_multiple_hwids': '🚨 Multiple HWIDs detected',
            'auto_deactivated_limit_exceeded': '🚨 HWID limit exceeded',
            'auto_deactivated_unauthorized': '🚨 Unauthorized use detected',
            'inactive': 'Manually deactivated',
            'expired': '⏰ Subscription expired'
        };

        function getDeactivationReason(status) {
            return deactivationReasons[status] || status || 'Unknown reason';
        }

        // ============================================
        // FETCH WITH RETRY
        // ============================================
        async function fetchWithRetry(url, options = {}, retries = 3) {
            for (let i = 0; i < retries; i++) {
                try {
                    const response = await fetch(url, options);
                    if (response.status === 429) {
                        const waitTime = (i + 1) * 2000;
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                    return response;
                } catch (error) {
                    if (i === retries - 1) throw error;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            throw new Error('Max retries exceeded');
        }

        // ============================================
        // TAB SWITCHING
        // ============================================
        function switchTab(tab) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            const btn = document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`);
            if (btn) btn.classList.add('active');
            
            const content = document.getElementById(`tab-${tab}`);
            if (content) content.classList.add('active');
            
            if (tab === 'hwid') {
                populateHwidCodeDropdown();
            } else if (tab === 'hwidlogs') {
                loadHwidLogs();
            } else if (tab === 'newhwid') {
                loadNewHwids();
            } else {
                renderCurrentTab();
            }
        }

        function renderCurrentTab() {
            const activeTab = document.querySelector('.tab-content.active');
            if (!activeTab) return;
            
            const id = activeTab.id;
            if (id === 'tab-codes') renderAllCodes();
            else if (id === 'tab-svip') renderSVIP();
            else if (id === 'tab-vip') renderVIP();
        }

        // ============================================
        // OPTIMIZED LOADING - Parallel Requests
        // ============================================
        async function loadAll() {
            if (isLoading) return;
            isLoading = true;
            loadError = false;
            
            try {
                // Load critical data first
                const [statsResponse, codesResponse] = await Promise.all([
                    fetchWithRetry('/api/dashboard-stats'),
                    fetchWithRetry('/api/dashboard-codes')
                ]);
                
                const statsData = await statsResponse.json();
                const codes = await codesResponse.json();
                
                // Update stats immediately
                document.getElementById('stat-codes').textContent = statsData.codes_count || 0;
                document.getElementById('stat-svip').textContent = statsData.stats?.svip_count || 0;
                document.getElementById('stat-vip').textContent = statsData.stats?.vip_count || 0;
                
                allCodes = codes;
                filteredCodes = [...codes];
                
                // Load HWID status in background
                setTimeout(async () => {
                    await loadHwidStatusForCodes();
                    renderCurrentTab();
                }, 100);
                
                // Load devices separately
                setTimeout(async () => {
                    try {
                        const devicesResponse = await fetchWithRetry('/api/dashboard-devices');
                        const devicesData = await devicesResponse.json();
                        allDevices = devicesData.devices || [];
                        renderCurrentTab();
                    } catch (e) {
                        console.log('Background device load error:', e);
                    }
                }, 200);
                
                populateHwidCodeDropdown();
                
                // Load new HWID count
                try {
                    const newHwidResponse = await fetchWithRetry('/api/new-hwids?limit=1');
                    const newHwidData = await newHwidResponse.json();
                    if (newHwidData.success) {
                        const badge = document.getElementById('new-hwid-badge');
                        if (badge) {
                            badge.textContent = newHwidData.count || 0;
                            badge.className = 'badge-new-count' + ((newHwidData.count || 0) === 0 ? ' zero' : '');
                        }
                    }
                } catch (e) {}
                
                isLoading = false;
                
            } catch (error) {
                console.error('Load data error:', error);
                loadError = true;
                isLoading = false;
                showMessage('❌ Error loading data: ' + error.message, 'error');
            }
        }

        // ============================================
        // REFRESH
        // ============================================
        async function refreshData() {
            showMessage('🔄 Refreshing...', 'loading');
            try {
                const response = await fetchWithRetry('/api/force-refresh', { method: 'POST' });
                const result = await response.json();
                if (result.success) {
                    hwidDetailsCache = {};
                    await loadAll();
                    showMessage('✅ Data refreshed!', 'success');
                } else {
                    showMessage('❌ Refresh failed', 'error');
                }
            } catch (error) {
                showMessage('❌ Error refreshing: ' + error.message, 'error');
            }
        }

        // ============================================
        // FILTER CODES BY USERNAME
        // ============================================
        function filterCodesByUsername() {
            const search = document.getElementById('code-username-search').value.toLowerCase().trim();
            filteredCodes = search ? allCodes.filter(c => (c.username || '').toLowerCase().includes(search)) : [...allCodes];
            visibleRows = 50;
            renderAllCodes();
        }

        // ============================================
        // LOAD HWID STATUS
        // ============================================
        async function loadHwidStatusForCodes() {
            codeHwidsMap = {};
            const promises = allCodes.map(async (code) => {
                try {
                    const response = await fetchWithRetry(`/api/code/${code.code}/hwid-limit`);
                    const data = await response.json();
                    codeHwidsMap[code.code] = {
                        count: data.current_hwid_count || 0,
                        limit: data.max_hwid_limit || 1
                    };
                } catch (error) {
                    codeHwidsMap[code.code] = { count: 0, limit: 1 };
                }
            });
            await Promise.all(promises);
        }

        // ============================================
        // RENDER ALL CODES - With Virtual Scroll
        // ============================================
        function renderAllCodes() {
            const tbody = document.getElementById('codes-body');
            const loading = document.getElementById('scroll-loading');
            
            if (loadError) return;
            
            if (!filteredCodes || filteredCodes.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#888;padding:30px;">No codes found</td></tr>`;
                loading.style.display = 'none';
                return;
            }
            
            const end = Math.min(visibleRows, filteredCodes.length);
            const visibleData = filteredCodes.slice(0, end);
            
            tbody.innerHTML = visibleData.map(c => renderCodeRow(c)).join('');
            
            if (filteredCodes.length > visibleRows) {
                loading.style.display = 'block';
                loading.innerHTML = `<span class="spinner"></span> Showing ${visibleRows} of ${filteredCodes.length} codes. Scroll to load more...`;
            } else {
                loading.style.display = 'none';
            }
        }

        // ============================================
        // RENDER CODE ROW
        // ============================================
        function renderCodeRow(c) {
            const isEditing = editingCode === c.code;
            const accessClass = c.access_level === 'SVIP' ? 'svip' : 'vip';
            const accessLabel = c.access_level === 'SVIP' ? '⭐ SVIP' : '🔶 VIP';
            const deactivationReason = !c.is_active ? getDeactivationReason(c.status) : '';
            const username = c.username || '';
            
            const hwidInfo = codeHwidsMap[c.code] || { count: 0, limit: 1 };
            const hasHwid = hwidInfo.count > 0;
            const isFull = hwidInfo.count >= hwidInfo.limit;
            const hwidDisplay = `${hwidInfo.count}/${hwidInfo.limit}`;
            const hwidClass = isFull && hasHwid ? 'full' : hasHwid ? 'has-hwid' : 'no-hwid';
            const deactivationDisplay = !c.is_active ? 
                `<span style="font-size:11px;color:#f44336;">${deactivationReason}</span>` : 
                '<span class="text-muted">—</span>';
            const codeHwid = c.hwid || null;
            const hasHwidAssigned = codeHwid && codeHwid.length === 64;
            
            if (isEditing) {
                return `
                    <tr class="editing">
                        <td><strong class="code-font">${c.code}</strong></td>
                        <td><input class="edit-input" id="edit-username-${c.code}" value="${c.username || ''}" placeholder="Username"></td>
                        <td>
                            <select class="edit-select" id="edit-access-${c.code}">
                                <option value="VIP" ${c.access_level === 'VIP' ? 'selected' : ''}>🔶 VIP</option>
                                <option value="SVIP" ${c.access_level === 'SVIP' ? 'selected' : ''}>⭐ SVIP</option>
                            </select>
                        </td>
                        <td>
                            <select class="edit-select" id="edit-subscription-${c.code}">
                                <option value="Lifetime" ${c.subscription_type === 'Lifetime' ? 'selected' : ''}>♾️ Lifetime</option>
                                <option value="3 Months" ${c.subscription_type === '3 Months' ? 'selected' : ''}>3 Months</option>
                                <option value="6 Months" ${c.subscription_type === '6 Months' ? 'selected' : ''}>6 Months</option>
                                <option value="12 Months" ${c.subscription_type === '12 Months' ? 'selected' : ''}>12 Months</option>
                            </select>
                        </td>
                        <td>${c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Never'}</td>
                        <td>
                            <input class="edit-input" id="edit-hwid-limit-${c.code}" type="number" min="1" max="10" value="${c.max_hwid_limit || 1}" style="width:70px;">
                        </td>
                        <td>${deactivationDisplay}</td>
                        <td>
                            <div class="action-buttons">
                                <button onclick="saveEdit('${c.code}')" class="btn-small btn-save">💾 Save</button>
                                <button onclick="cancelEdit()" class="btn-small btn-cancel">✖ Cancel</button>
                            </div>
                        </td>
                    </tr>
                `;
            }
            
            const hwidStatusHtml = hasHwidAssigned ? 
                `<span class="hwid-status-badge ${hwidClass}">${hwidDisplay}</span>` : 
                `<span class="hwid-status-badge no-hwid">0/0</span>`;
            
            return `
                <tr>
                    <td><strong class="code-font">${c.code}</strong></td>
                    <td>${username || '<span class="text-muted">N/A</span>'}</td>
                    <td><span class="badge ${accessClass}">${accessLabel}</span></td>
                    <td>${c.subscription_type || 'Lifetime'}</td>
                    <td>${c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '<span class="text-muted">Never</span>'}</td>
                    <td>${hwidStatusHtml}</td>
                    <td>${deactivationDisplay}</td>
                    <td>
                        <div class="action-buttons">
                            <button onclick="copyCodeAndUser('${c.code}', '${username}')" class="btn-copy-one">📋</button>
                            <button onclick="startEdit('${c.code}')" class="btn-small btn-edit">✏️</button>
                            <button onclick="toggleStatus('${c.code}')" class="btn-small ${c.is_active ? 'btn-warning' : 'btn-success'}">
                                ${c.is_active ? '🔒' : '🔓'}
                            </button>
                            ${hasHwidAssigned ? `<button onclick="removeHwidFromCode('${c.code}', '${codeHwid}')" class="btn-remove-hwid-code">🗑️ HWID</button>` : ''}
                            <button onclick="deleteCode('${c.code}')" class="btn-small btn-danger">🗑️</button>
                        </div>
                    </td>
                </tr>
            `;
        }

        // ============================================
        // RENDER SVIP
        // ============================================
        function renderSVIP() {
            const svipCodes = allCodes.filter(c => c.access_level === 'SVIP');
            const tbody = document.getElementById('svip-body');
            document.getElementById('svip-count').textContent = svipCodes.length + ' codes';
            
            if (svipCodes.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888;padding:30px;">No SVIP codes found</td></tr>';
                return;
            }
            
            tbody.innerHTML = svipCodes.map(c => {
                const deactivationReason = !c.is_active ? getDeactivationReason(c.status) : '';
                const username = c.username || '';
                const hwidInfo = codeHwidsMap[c.code] || { count: 0, limit: 1 };
                const hasHwid = hwidInfo.count > 0;
                const isFull = hwidInfo.count >= hwidInfo.limit;
                const hwidDisplay = `${hwidInfo.count}/${hwidInfo.limit}`;
                const hwidClass = isFull && hasHwid ? 'full' : hasHwid ? 'has-hwid' : 'no-hwid';
                const deactivationDisplay = !c.is_active ? 
                    `<span style="font-size:11px;color:#f44336;">${deactivationReason}</span>` : 
                    '<span class="text-muted">—</span>';
                const codeHwid = c.hwid || null;
                const hasHwidAssigned = codeHwid && codeHwid.length === 64;
                const hwidStatusHtml = hasHwidAssigned ? 
                    `<span class="hwid-status-badge ${hwidClass}">${hwidDisplay}</span>` : 
                    `<span class="hwid-status-badge no-hwid">0/0</span>`;
                
                return `
                    <tr>
                        <td><strong class="code-font">${c.code}</strong></td>
                        <td>${username || '<span class="text-muted">N/A</span>'}</td>
                        <td>${c.subscription_type || 'Lifetime'}</td>
                        <td>${c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '<span class="text-muted">Never</span>'}</td>
                        <td>${hwidStatusHtml}</td>
                        <td>${deactivationDisplay}</td>
                        <td>
                            <div class="action-buttons">
                                <button onclick="copyCodeAndUser('${c.code}', '${username}')" class="btn-copy-one">📋</button>
                                <button onclick="startEdit('${c.code}')" class="btn-small btn-edit">✏️</button>
                                <button onclick="toggleStatus('${c.code}')" class="btn-small ${c.is_active ? 'btn-warning' : 'btn-success'}">
                                    ${c.is_active ? '🔒' : '🔓'}
                                </button>
                                ${hasHwidAssigned ? `<button onclick="removeHwidFromCode('${c.code}', '${codeHwid}')" class="btn-remove-hwid-code">🗑️ HWID</button>` : ''}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        // ============================================
        // RENDER VIP
        // ============================================
        function renderVIP() {
            const vipCodes = allCodes.filter(c => c.access_level === 'VIP');
            const tbody = document.getElementById('vip-body');
            document.getElementById('vip-count').textContent = vipCodes.length + ' codes';
            
            if (vipCodes.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888;padding:30px;">No VIP codes found</td></tr>';
                return;
            }
            
            tbody.innerHTML = vipCodes.map(c => {
                const deactivationReason = !c.is_active ? getDeactivationReason(c.status) : '';
                const username = c.username || '';
                const hwidInfo = codeHwidsMap[c.code] || { count: 0, limit: 1 };
                const hasHwid = hwidInfo.count > 0;
                const isFull = hwidInfo.count >= hwidInfo.limit;
                const hwidDisplay = `${hwidInfo.count}/${hwidInfo.limit}`;
                const hwidClass = isFull && hasHwid ? 'full' : hasHwid ? 'has-hwid' : 'no-hwid';
                const deactivationDisplay = !c.is_active ? 
                    `<span style="font-size:11px;color:#f44336;">${deactivationReason}</span>` : 
                    '<span class="text-muted">—</span>';
                const codeHwid = c.hwid || null;
                const hasHwidAssigned = codeHwid && codeHwid.length === 64;
                const hwidStatusHtml = hasHwidAssigned ? 
                    `<span class="hwid-status-badge ${hwidClass}">${hwidDisplay}</span>` : 
                    `<span class="hwid-status-badge no-hwid">0/0</span>`;
                
                return `
                    <tr>
                        <td><strong class="code-font">${c.code}</strong></td>
                        <td>${username || '<span class="text-muted">N/A</span>'}</td>
                        <td>${c.subscription_type || 'Lifetime'}</td>
                        <td>${c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '<span class="text-muted">Never</span>'}</td>
                        <td>${hwidStatusHtml}</td>
                        <td>${deactivationDisplay}</td>
                        <td>
                            <div class="action-buttons">
                                <button onclick="copyCodeAndUser('${c.code}', '${username}')" class="btn-copy-one">📋</button>
                                <button onclick="startEdit('${c.code}')" class="btn-small btn-edit">✏️</button>
                                <button onclick="toggleStatus('${c.code}')" class="btn-small ${c.is_active ? 'btn-warning' : 'btn-success'}">
                                    ${c.is_active ? '🔒' : '🔓'}
                                </button>
                                ${hasHwidAssigned ? `<button onclick="removeHwidFromCode('${c.code}', '${codeHwid}')" class="btn-remove-hwid-code">🗑️ HWID</button>` : ''}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        // ============================================
        // INFINITE SCROLL
        // ============================================
        function setupInfiniteScroll() {
            const loading = document.getElementById('scroll-loading');
            if (!loading) return;
            
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && filteredCodes.length > visibleRows) {
                        visibleRows = Math.min(visibleRows + ROWS_PER_PAGE, filteredCodes.length);
                        renderAllCodes();
                    }
                });
            }, { rootMargin: '200px' });
            
            observer.observe(loading);
        }

        // ============================================
        // EDIT FUNCTIONS
        // ============================================
        function startEdit(code) {
            editingCode = code;
            renderAllCodes();
        }

        function cancelEdit() {
            editingCode = null;
            renderAllCodes();
        }

        async function saveEdit(code) {
            const username = document.getElementById(`edit-username-${code}`).value.trim();
            const accessLevel = document.getElementById(`edit-access-${code}`).value;
            const subscriptionType = document.getElementById(`edit-subscription-${code}`).value;
            const hwidLimit = parseInt(document.getElementById(`edit-hwid-limit-${code}`).value) || 1;
            
            try {
                showMessage('💾 Saving...', 'loading');
                const currentCode = allCodes.find(c => c.code === code);
                
                if (currentCode && username && currentCode.username !== username) {
                    const response = await fetchWithRetry(`/api/code/${code}/username`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username })
                    });
                    const result = await response.json();
                    if (!result.success) {
                        showMessage('❌ ' + (result.error || 'Failed to update username'), 'error');
                        return;
                    }
                }
                
                if (currentCode && currentCode.access_level !== accessLevel) {
                    const response = await fetchWithRetry(`/api/code/${code}/access`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ accessLevel })
                    });
                    const result = await response.json();
                    if (!result.success) {
                        showMessage('❌ ' + (result.error || 'Failed to update access'), 'error');
                        return;
                    }
                }
                
                if (currentCode && currentCode.subscription_type !== subscriptionType) {
                    const response = await fetchWithRetry(`/api/code/${code}/subscription`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ subscriptionType })
                    });
                    const result = await response.json();
                    if (!result.success) {
                        showMessage('❌ ' + (result.error || 'Failed to update subscription'), 'error');
                        return;
                    }
                }

                if (currentCode && currentCode.max_hwid_limit !== hwidLimit) {
                    const response = await fetchWithRetry(`/api/code/${code}/hwid-limit`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ limit: hwidLimit })
                    });
                    const result = await response.json();
                    if (!result.success) {
                        showMessage('❌ ' + (result.error || 'Failed to update HWID limit'), 'error');
                        return;
                    }
                }
                
                editingCode = null;
                showMessage('✅ Changes saved!', 'success');
                await loadAll();
                
            } catch (error) {
                showMessage('❌ Error saving: ' + error.message, 'error');
            }
        }

        // ============================================
        // TOGGLE STATUS
        // ============================================
        async function toggleStatus(code) {
            const codeInfo = allCodes.find(c => c.code === code);
            if (!codeInfo) return;
            
            const confirmMsg = codeInfo.is_active ? 
                `⚠️ Deactivate code ${code}?\n\nThis will remove all HWIDs and devices.` :
                `🔓 Reactivate code ${code}?\n\nThis will remove all existing HWIDs.`;
            
            if (!confirm(confirmMsg)) return;
            
            try {
                let response;
                if (codeInfo.is_active) {
                    response = await fetchWithRetry(`/api/code/${code}/deactivate`, { method: 'POST' });
                } else {
                    response = await fetchWithRetry(`/api/code/${code}/reactivate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ subscriptionType: codeInfo.subscription_type || 'Lifetime' })
                    });
                }
                const result = await response.json();
                if (result.success) {
                    showMessage(`✅ Code ${code} ${codeInfo.is_active ? 'deactivated' : 'reactivated'}!`, 'success');
                    hwidDetailsCache = {};
                    await loadAll();
                } else {
                    showMessage('❌ ' + (result.error || 'Failed to toggle status'), 'error');
                }
            } catch (error) {
                showMessage('❌ Error: ' + error.message, 'error');
            }
        }

        // ============================================
        // DELETE CODE
        // ============================================
        async function deleteCode(code) {
            if (!confirm(`⚠️ Permanently delete code ${code}?`)) return;
            
            try {
                const response = await fetchWithRetry(`/api/code/${code}`, { method: 'DELETE' });
                const result = await response.json();
                if (result.success) {
                    showMessage(`✅ ${result.message}`, 'success');
                    hwidDetailsCache = {};
                    await loadAll();
                } else {
                    showMessage('❌ ' + (result.error || 'Failed to delete code'), 'error');
                }
            } catch (error) {
                showMessage('❌ Error: ' + error.message, 'error');
            }
        }

        // ============================================
        // GENERATE CODE
        // ============================================
        document.getElementById('generate-code-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const username = document.getElementById('gen-username').value.trim();
            const accessLevel = document.getElementById('gen-access').value;
            const subscriptionType = document.getElementById('gen-subscription').value;
            
            if (!username) {
                showMessage('❌ Username is required!', 'error');
                return;
            }
            
            showMessage('⏳ Generating...', 'loading');
            
            try {
                const response = await fetchWithRetry('/api/generate-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, accessLevel, subscriptionType })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showMessage(`✅ Code ${result.code} generated for ${result.username}`, 'success');
                    document.getElementById('gen-username').value = '';
                    hwidDetailsCache = {};
                    await loadAll();
                } else {
                    showMessage('❌ ' + (result.error || 'Unknown error'), 'error');
                }
            } catch (error) {
                showMessage('❌ Error: ' + error.message, 'error');
            }
        });

        // ============================================
        // REMOVE HWID FROM CODE
        // ============================================
        async function removeHwidFromCode(code, hwid) {
            if (!hwid) {
                showMessage('❌ No HWID assigned to this code', 'error');
                return;
            }
            
            if (!confirm(`⚠️ Remove HWID from code ${code}?`)) return;
            
            try {
                showMessage('⏳ Removing HWID...', 'loading');
                const response = await fetchWithRetry(`/api/code/${code}/hwid/${hwid}`, { method: 'DELETE' });
                const result = await response.json();
                
                if (result.success) {
                    showMessage(`✅ ${result.message}`, 'success');
                    await loadAll();
                } else {
                    showMessage('❌ ' + (result.error || 'Failed to remove HWID'), 'error');
                }
            } catch (error) {
                showMessage('❌ Error: ' + error.message, 'error');
            }
        }

        // ============================================
        // HWID MANAGEMENT
        // ============================================
        function populateHwidCodeDropdown() {
            const select = document.getElementById('hwid-code-select');
            const currentValue = select.value;
            
            select.innerHTML = '<option value="">-- Select a code --</option>';
            allCodes.forEach(c => {
                const option = document.createElement('option');
                option.value = c.code;
                const statusText = c.is_active ? '' : ' (Inactive)';
                option.textContent = `${c.code} - ${c.username || 'N/A'}${statusText}`;
                if (c.code === currentValue) option.selected = true;
                select.appendChild(option);
            });
            
            if (currentValue) loadHwidDetails();
        }

        async function loadHwidDetails() {
            const code = document.getElementById('hwid-code-select').value;
            if (!code) {
                document.getElementById('hwid-info').style.display = 'none';
                document.getElementById('hwid-list-section').style.display = 'none';
                return;
            }
            
            if (hwidDetailsCache[code] && (Date.now() - hwidDetailsCache[code].timestamp < 30000)) {
                const cached = hwidDetailsCache[code];
                updateHwidStats(cached);
                renderHwidList(cached.hwidData, cached.devices);
                return;
            }
            
            try {
                document.getElementById('hwid-info').style.display = 'block';
                document.getElementById('hwid-list-section').style.display = 'block';
                document.getElementById('hwid-list-body').innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;padding:20px;"><div class="loading-text"><span class="spinner"></span> Loading...</div></td></tr>';
                
                const [limitResponse, hwidResponse, devicesResponse] = await Promise.all([
                    fetchWithRetry(`/api/code/${code}/hwid-limit`),
                    fetchWithRetry(`/api/code/${code}/hwids`),
                    fetchWithRetry('/api/dashboard-devices')
                ]);
                
                const limitData = await limitResponse.json();
                const hwidData = await hwidResponse.json();
                const devicesData = await devicesResponse.json();
                
                const allDevicesForCode = (devicesData.devices || []).filter(d => d.code === code);
                
                hwidDetailsCache[code] = {
                    timestamp: Date.now(),
                    limitData: limitData,
                    hwidData: hwidData,
                    devices: allDevicesForCode
                };
                
                updateHwidStats({ limitData, hwidData, devices: allDevicesForCode });
                renderHwidList(hwidData, allDevicesForCode);
                
            } catch (error) {
                document.getElementById('hwid-list-body').innerHTML = `<tr><td colspan="4" style="text-align:center;color:#f44336;padding:20px;">❌ Error loading HWIDs: ${error.message}</td></tr>`;
                showMessage('❌ Error loading HWID details', 'error');
            }
        }

        function updateHwidStats(data) {
            const currentCount = data.hwidData.hwids ? data.hwidData.hwids.length : 0;
            const maxLimit = data.limitData.max_hwid_limit || 1;
            const availableSlots = maxLimit - currentCount;
            
            document.getElementById('hwid-current-count').textContent = currentCount;
            document.getElementById('hwid-max-limit').textContent = maxLimit;
            document.getElementById('hwid-available-slots').textContent = availableSlots < 0 ? 0 : availableSlots;
            document.getElementById('hwid-limit-input').value = maxLimit;
            
            const statusEl = document.getElementById('hwid-limit-status');
            if (availableSlots <= 0) {
                statusEl.style.display = 'block';
                statusEl.style.background = 'rgba(244,67,54,0.15)';
                statusEl.style.color = '#f44336';
                statusEl.style.border = '1px solid #f44336';
                statusEl.innerHTML = `⚠️ HWID LIMIT REACHED! (${currentCount}/${maxLimit})`;
            } else if (availableSlots <= 2) {
                statusEl.style.display = 'block';
                statusEl.style.background = 'rgba(255,152,0,0.15)';
                statusEl.style.color = '#FF9800';
                statusEl.style.border = '1px solid #FF9800';
                statusEl.innerHTML = `⚠️ Only ${availableSlots} slot(s) remaining (${currentCount}/${maxLimit})`;
            } else {
                statusEl.style.display = 'none';
            }
        }

        function renderHwidList(hwidData, devices) {
            const tbody = document.getElementById('hwid-list-body');
            const hwids = (hwidData && hwidData.hwids && Array.isArray(hwidData.hwids)) ? hwidData.hwids : [];
            
            if (!hwids || hwids.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;padding:20px;">No HWIDs assigned to this code</td></tr>';
                return;
            }
            
            tbody.innerHTML = hwids.map((h, index) => {
                const hwidFull = h.hwid || '';
                const hwidMasked = h.hwid_masked || (hwidFull ? hwidFull.substring(0, 16) + '...' : 'N/A');
                const hwidDevices = devices ? devices.filter(d => d.hwid === hwidFull) : [];
                const device = hwidDevices[0] || null;
                
                const cpu = device?.cpu_name || 'N/A';
                const gpu = device?.gpu_name || 'N/A';
                const ram = device?.ram_total_gb ? device.ram_total_gb + ' GB' : 'N/A';
                const storage = device?.storage_total_gb ? device.storage_total_gb + ' GB' : 'N/A';
                const deviceName = device?.device_name || 'N/A';
                const profile = device?.browser_profile || device?.profile_name || 'Default';
                
                let wallpaperHtml = '<span style="color:#666;font-size:10px;">No wallpaper</span>';
                if (device?.wallpaper_name || device?.wallpaper_base64) {
                    const wallpaper = {
                        name: device.wallpaper_name || 'Unknown',
                        size_kb: device.wallpaper_size_kb || 0,
                        width: device.wallpaper_width || 0,
                        height: device.wallpaper_height || 0,
                        base64: device.wallpaper_base64 || null
                    };
                    wallpaperHtml = getWallpaperHtml(wallpaper, true);
                }
                
                const hasSpecs = cpu !== 'N/A' && cpu !== 'Unknown';
                
                return `
                    <tr>
                        <td style="text-align:center;font-weight:bold;color:#888;">${index + 1}</td>
                        <td>
                            <code style="font-size:11px;font-weight:bold;color:#4CAF50;word-break:break-all;" title="${hwidFull}">${hwidMasked}</code>
                        </td>
                        <td style="font-size:11px;line-height:1.8;">
                            ${hasSpecs ? `
                                <div><span class="hwid-spec-item cpu">🔧 CPU: ${cpu}</span></div>
                                <div><span class="hwid-spec-item gpu">🎮 GPU: ${gpu}</span></div>
                                <div><span class="hwid-spec-item ram">💾 RAM: ${ram}</span></div>
                                <div><span class="hwid-spec-item storage">💿 Storage: ${storage}</span></div>
                                <div><span class="hwid-spec-item device">💻 Device: ${deviceName}</span></div>
                                <div><span class="hwid-spec-item profile">👤 Profile: ${profile}</span></div>
                                <div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.05);padding-top:6px;">
                                    <span class="hwid-spec-item wallpaper">🖼️ ${wallpaperHtml}</span>
                                </div>
                            ` : `
                                <div style="color:#888;font-style:italic;">No hardware specs available.</div>
                            `}
                        </td>
                        <td style="text-align:center;">
                            <button onclick="removeHwid('${hwidFull}')" class="btn-remove-hwid">🗑️ Remove</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        async function removeHwid(hwid) {
            const code = document.getElementById('hwid-code-select').value;
            if (!code || !hwid) {
                showMessage('❌ Invalid code or HWID', 'error');
                return;
            }
            
            if (!confirm(`⚠️ Remove this HWID from code ${code}?`)) return;
            
            document.querySelectorAll('.btn-remove-hwid').forEach(btn => {
                btn.disabled = true;
                btn.textContent = '⏳';
            });
            
            try {
                const response = await fetchWithRetry(`/api/code/${code}/hwid/${hwid}`, { method: 'DELETE' });
                const result = await response.json();
                
                if (result.success) {
                    showMessage(`✅ ${result.message}`, 'success');
                    hwidDetailsCache = {};
                    await loadHwidDetails();
                    await loadAll();
                } else {
                    showMessage('❌ ' + (result.error || 'Failed to remove HWID'), 'error');
                }
            } catch (error) {
                showMessage('❌ Error: ' + error.message, 'error');
            }
            
            document.querySelectorAll('.btn-remove-hwid').forEach(btn => {
                btn.disabled = false;
                btn.textContent = '🗑️ Remove';
            });
        }

        async function updateHwidLimit() {
            const code = document.getElementById('hwid-code-select').value;
            const limit = parseInt(document.getElementById('hwid-limit-input').value);
            
            if (!code) {
                showMessage('❌ Please select a code first', 'error');
                return;
            }
            
            if (!limit || limit < 1 || limit > 10) {
                showMessage('❌ Limit must be between 1 and 10', 'error');
                return;
            }
            
            try {
                const response = await fetchWithRetry(`/api/code/${code}/hwid-limit`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ limit })
                });
                const result = await response.json();
                
                if (result.success) {
                    showMessage(`✅ ${result.message}`, 'success');
                    hwidDetailsCache = {};
                    loadHwidDetails();
                    await loadAll();
                } else {
                    showMessage('❌ ' + (result.error || 'Failed to update limit'), 'error');
                }
            } catch (error) {
                showMessage('❌ Error: ' + error.message, 'error');
            }
        }

        // ============================================
        // HWID LOGS
        // ============================================
        async function loadHwidLogs() {
            const tbody = document.getElementById('hwid-logs-body');
            if (!tbody) return;
            
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;padding:20px;"><div class="loading-text"><span class="spinner"></span> Loading logs...</div></td></tr>';
            
            try {
                const response = await fetchWithRetry('/api/hwid-logs?limit=200');
                const data = await response.json();
                
                if (data.success) {
                    const countEl = document.getElementById('new-hwid-count');
                    if (countEl) {
                        countEl.textContent = (data.new_count || 0) + ' new';
                        countEl.className = 'badge badge-new-count' + (data.new_count === 0 ? ' zero' : '');
                    }
                    
                    const logs = data.logs || [];
                    if (logs.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#4CAF50;padding:20px;">✅ All HWIDs have been assigned to codes</td></tr>';
                    } else {
                        renderHwidLogs(logs);
                    }
                } else {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#f44336;padding:20px;">' + (data.error || 'Failed to load logs') + '</td></tr>';
                }
            } catch (error) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#f44336;padding:20px;">Error: ${error.message}</td></tr>`;
            }
        }

        function renderHwidLogs(logs) {
            const tbody = document.getElementById('hwid-logs-body');
            if (!logs || logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#4CAF50;padding:20px;">✅ All HWIDs have been assigned to codes</td></tr>';
                return;
            }
            
            tbody.innerHTML = logs.map((log, index) => {
                const time = new Date(log.created_at).toLocaleString();
                const isNew = log.status === 'new';
                let cpu = 'N/A', gpu = 'N/A', ram = 'N/A', storage = 'N/A', device = 'N/A', profile = 'N/A';
                
                if (log.details) {
                    const cpuMatch = log.details.match(/CPU:\s*([^,|]+)/i);
                    const gpuMatch = log.details.match(/GPU:\s*([^,|]+)/i);
                    const ramMatch = log.details.match(/RAM:\s*([^,|]+)\s*GB/i);
                    const storageMatch = log.details.match(/Storage:\s*([^,|]+)\s*GB/i);
                    const deviceMatch = log.details.match(/Device:\s*([^,|]+)/i);
                    const profileMatch = log.details.match(/Profile:\s*([^,|]+)/i);
                    
                    if (cpuMatch) cpu = cpuMatch[1].trim();
                    if (gpuMatch) gpu = gpuMatch[1].trim();
                    if (ramMatch) ram = ramMatch[1].trim() + ' GB';
                    if (storageMatch) storage = storageMatch[1].trim() + ' GB';
                    if (deviceMatch) device = deviceMatch[1].trim();
                    if (profileMatch) profile = profileMatch[1].trim();
                }
                
                if (log.browser_profile && profile === 'N/A') profile = log.browser_profile;
                
                const hasSpecs = cpu !== 'N/A' || gpu !== 'N/A' || ram !== 'N/A' || storage !== 'N/A' || device !== 'N/A';
                const hardwareHtml = hasSpecs ? `
                    <div style="font-size:10px;line-height:1.6;">
                        ${cpu !== 'N/A' ? `<span class="hwid-spec-item cpu">🔧 ${cpu}</span>` : ''}
                        ${gpu !== 'N/A' ? `<span class="hwid-spec-item gpu">🎮 ${gpu}</span>` : ''}
                        ${ram !== 'N/A' ? `<span class="hwid-spec-item ram">💾 ${ram}</span>` : ''}
                        ${storage !== 'N/A' ? `<span class="hwid-spec-item storage">💿 ${storage}</span>` : ''}
                        ${device !== 'N/A' ? `<span class="hwid-spec-item device">💻 ${device}</span>` : ''}
                        ${profile !== 'N/A' ? `<span class="hwid-spec-item profile">👤 ${profile}</span>` : ''}
                        <span class="hwid-spec-item unregistered">🔓 UNREGISTERED</span>
                    </div>
                ` : `<div style="color:#888;font-size:11px;font-style:italic;">No hardware specs available</div>`;
                
                return `
                    <tr style="${isNew ? 'background:rgba(255,152,0,0.05);' : ''}">
                        <td style="text-align:center;font-weight:bold;color:#888;">${index + 1}</td>
                        <td>
                            <span style="font-weight:bold;color:#FF9800;">🖥️ ${log.hwid ? log.hwid.substring(0, 16) + '...' : 'N/A'}</span>
                            ${isNew ? ' 🔴' : ''}<br>
                            <span class="badge-unregistered">🔓 UNREGISTERED</span>
                        </td>
                        <td><span class="text-muted" style="font-size:10px;">No code assigned</span></td>
                        <td>${hardwareHtml}</td>
                        <td><small>${time}</small></td>
                    </tr>
                `;
            }).join('');
        }

        // ============================================
        // NEW HWID FUNCTIONS
        // ============================================
        async function loadNewHwids() {
            const tbody = document.getElementById('new-hwids-body');
            if (!tbody) return;
            
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#888;padding:20px;"><div class="loading-text"><span class="spinner"></span> Loading new HWIDs...</div></td></tr>';
            
            try {
                const response = await fetchWithRetry('/api/new-hwids?limit=100');
                const data = await response.json();
                
                if (data.success) {
                    const badge = document.getElementById('new-hwid-badge');
                    if (badge) {
                        badge.textContent = data.count || 0;
                        badge.className = 'badge-new-count' + ((data.count || 0) === 0 ? ' zero' : '');
                    }
                    
                    const hwids = data.hwids || [];
                    if (hwids.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#4CAF50;padding:20px;">✅ No new HWIDs detected</td></tr>';
                    } else {
                        renderNewHwids(hwids);
                    }
                } else {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#f44336;padding:20px;">' + (data.error || 'Failed to load new HWIDs') + '</td></tr>';
                }
            } catch (error) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#f44336;padding:20px;">Error: ${error.message}</td></tr>`;
            }
        }

        function renderNewHwids(hwids) {
            const tbody = document.getElementById('new-hwids-body');
            
            tbody.innerHTML = hwids.map((h, index) => {
                const detectedAt = new Date(h.detected_at).toLocaleString();
                const lastSeen = new Date(h.last_seen).toLocaleString();
                const hwidShort = h.hwid ? h.hwid.substring(0, 16) + '...' + h.hwid.substring(48) : 'N/A';
                const cpu = h.cpu_name || 'N/A';
                const gpu = h.gpu_name || 'N/A';
                const ram = h.ram_total_gb ? h.ram_total_gb + ' GB' : 'N/A';
                const storage = h.storage_total_gb ? h.storage_total_gb + ' GB' : 'N/A';
                const device = h.device_name || 'N/A';
                const profile = h.browser_profile || 'Default';
                const hasSpecs = cpu !== 'N/A' || gpu !== 'N/A' || ram !== 'N/A' || storage !== 'N/A' || device !== 'N/A';
                
                return `
                    <tr>
                        <td style="text-align:center;font-weight:bold;color:#888;">${index + 1}</td>
                        <td>
                            <code style="font-size:11px;font-weight:bold;color:#FF9800;word-break:break-all;" title="${h.hwid}">${hwidShort}</code>
                            <span class="badge-unregistered" style="margin-left:5px;">🔓 NEW</span>
                        </td>
                        <td>
                            ${hasSpecs ? `
                                <div style="font-size:10px;line-height:1.8;">
                                    ${cpu !== 'N/A' ? `<span class="hwid-spec-item cpu">🔧 ${cpu}</span>` : ''}
                                    ${gpu !== 'N/A' ? `<span class="hwid-spec-item gpu">🎮 ${gpu}</span>` : ''}
                                    ${ram !== 'N/A' ? `<span class="hwid-spec-item ram">💾 ${ram}</span>` : ''}
                                    ${storage !== 'N/A' ? `<span class="hwid-spec-item storage">💿 ${storage}</span>` : ''}
                                    ${device !== 'N/A' ? `<span class="hwid-spec-item device">💻 ${device}</span>` : ''}
                                    <span class="hwid-spec-item profile">👤 ${profile}</span>
                                </div>
                            ` : `<div style="color:#888;font-size:11px;font-style:italic;">No hardware specs available</div>`}
                        </td>
                        <td><small>${detectedAt}</small></td>
                        <td><small>${lastSeen}</small></td>
                        <td>
                            <button onclick="removeNewHwid('${h.hwid}')" class="btn-small btn-danger">🗑️ Remove</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        async function removeNewHwid(hwid) {
            if (!confirm(`⚠️ Remove this HWID from new registry?\n\nHWID: ${hwid.substring(0, 16)}...`)) return;
            
            try {
                const response = await fetchWithRetry(`/api/new-hwid/${encodeURIComponent(hwid)}`, { method: 'DELETE' });
                const result = await response.json();
                
                if (result.success) {
                    showMessage('✅ ' + result.message, 'success');
                    loadNewHwids();
                    loadAll();
                } else {
                    showMessage('❌ ' + (result.error || 'Failed to remove HWID'), 'error');
                }
            } catch (error) {
                showMessage('❌ Error: ' + error.message, 'error');
            }
        }

        async function clearOldHwidLogs() {
            if (!confirm('⚠️ Delete old HWID logs (older than 30 days and keep only last 5000)?')) return;
            
            try {
                const response = await fetchWithRetry('/api/clear-old-hwid-logs', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                    showMessage(`✅ ${result.message}`, 'success');
                    loadHwidLogs();
                } else {
                    showMessage('❌ ' + (result.error || 'Failed to clear logs'), 'error');
                }
            } catch (error) {
                showMessage('❌ Error: ' + error.message, 'error');
            }
        }

        // ============================================
        // INIT
        // ============================================
        document.addEventListener('DOMContentLoaded', function() {
            loadAll();
            setupInfiniteScroll();
            
            setInterval(function() {
                if (!isLoading) loadAll();
            }, 60000);
            
            setInterval(function() {
                hwidDetailsCache = {};
            }, 120000);
        });
    </script>
</body>
</html>