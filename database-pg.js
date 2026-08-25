// background.js - Complete with CORS Handling and Proper Error Management

(function() {
    'use strict';

    const SERVER_URL = 'https://wantmatures-approval-server.onrender.com';
    const CHECK_INTERVAL = 60000;
    const RETRY_INTERVAL = 30000;
    const MAX_FAILURES = 10;
    const RATE_LIMIT_WAIT = 120000;

    let approvalStatus = null;
    let deviceId = null;
    let isApproved = false;
    let checkInterval = null;
    let isRegistered = false;
    let activationCode = null;
    let serverUsername = null;
    let serverAccess = null;
    let serverSubscription = null;
    let serverSubscriptionStarted = null;
    let serverSubscriptionExpires = null;
    let serverStatusCode = null;
    let isLimitReached = false;
    let isRemoving = false;
    let isManuallyRemoved = false;
    let isExtensionActive = false;
    let lastCheckTime = 0;
    let checkInProgress = false;
    let consecutiveFailures = 0;
    let lastKnownGoodStatus = null;
    let isRateLimited = false;
    let rateLimitResetTime = 0;
    let backoffDelay = 5000;
    let hwid = null;
    let fingerprint = null;
    let isAutoDeactivated = false;
    let detectedHwids = [];
    let hwidCheckInProgress = false;
    let browserProfileName = 'Default';
    let hardwareSpecs = null;
    let hwidLogged = false;
    let wallpaperData = null;

    const SUPPORTED_SITES = [
        'wantmatures.com', 'm.wantmatures.com',
        'iamnaughty.com', 'm.iamnaughty.com',
        'spicydesires.com', 'm.spicydesires.com',
        'couples4sex.com', 'm.couples4sex.com',
        'luvcougar.com', 'm.luvcougar.com',
        'iwantucougar.com', 'm.iwantucougar.com',
        'flirt.com', 'm.flirt.com',
        'upforit.com', 'm.upforit.com',
        'getnaughty.com', 'm.getnaughty.com',
        'cheekylovers.com', 'm.cheekylovers.com',
        'upair.com', 'm.upair.com',
        'milfberry.com', 'm.milfberry.com',
        'bemymilf.com', 'm.bemymilf.com',
        'saucysingles.com', 'm.saucysingles.com',
        'yolovers.com', 'm.yolovers.com',
        'cougarpourmoi.com', 'm.cougarpourmoi.com',
        'together2night.com', 'm.together2night.com',
        'vittubuddie.com', 'm.vittubuddie.com',
        'wilddate4sex.com', 'm.wilddate4sex.com',
        'flirtymilfs.com', 'm.flirtymilfs.com',
        'tendermeets.com', 'm.tendermeets.com',
        'hottymatures.com', 'm.hottymatures.com',
        'seekanaffair.com', 'm.seekanaffair.com',
        'hottyfinder.com', 'm.hottyfinder.com',
        'hottynaughty.com', 'm.hottynaughty.com',
        'flirtymature.com', 'm.flirtymature.com',
        'sugardaddy4dating.com', 'm.sugardaddy4dating.com',
        'fetmania.com', 'm.fetmania.com',
        'sexintouch.com', 'm.sexintouch.com',
        'wantubad.com', 'm.wantubad.com',
        'pololeando.co', 'm.pololeando.co',
        'goldenflirts.com', 'm.goldenflirts.com'
    ];

    console.log('🔷 Background script started!');
    console.log('📡 Server URL:', SERVER_URL);

    // ============================================
    // FETCH WITH CORS HANDLING
    // ============================================

    async function fetchWithCors(url, options = {}) {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Origin': chrome.runtime.getURL('')
            },
            credentials: 'include'
        };

        const mergedOptions = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...(options.headers || {})
            }
        };

        try {
            const response = await fetch(url, mergedOptions);
            return response;
        } catch (error) {
            console.error('❌ Fetch error:', error.message);
            throw error;
        }
    }

    // ============================================
    // READ HARDWARE SPECS FROM FILE
    // ============================================

    function readHardwareSpecs() {
        return new Promise((resolve) => {
            try {
                fetch(chrome.runtime.getURL('hardware_specs.json'))
                    .then(response => {
                        if (!response.ok) {
                            throw new Error('File not found (status: ' + response.status + ')');
                        }
                        return response.json();
                    })
                    .then(data => {
                        console.log('✅ Hardware specs loaded from file');
                        console.log('   🔧 CPU:', data.cpu || 'Unknown');
                        console.log('   🎮 GPU:', data.gpu || 'Unknown');
                        console.log('   💾 RAM:', data.ram_gb || 0, 'GB');
                        console.log('   💿 Storage:', data.storage_gb || 0, 'GB');
                        console.log('   👤 Profile:', data.profile_name || 'Unknown');
                        console.log('   💻 Device:', data.device_name || 'Unknown');
                        
                        if (data.wallpaper) {
                            console.log('   🖼️ Wallpaper:', data.wallpaper.file_name || 'unknown', '(' + (data.wallpaper.size_kb || 0) + ' KB)');
                            if (data.wallpaper.width && data.wallpaper.height) {
                                console.log('   📐 Resolution:', data.wallpaper.width + 'x' + data.wallpaper.height);
                            }
                            if (data.wallpaper.base64) {
                                console.log('   📸 Base64 length:', data.wallpaper.base64.length, 'chars');
                            }
                            wallpaperData = data.wallpaper;
                            chrome.storage.local.set({ 'wallpaperData': wallpaperData });
                        }
                        
                        hardwareSpecs = data;
                        
                        chrome.storage.local.set({ 'hardwareSpecs': data }, function() {
                            console.log('💾 Hardware specs saved to storage');
                        });
                        
                        if (data.profile_name) {
                            browserProfileName = data.profile_name;
                            chrome.storage.local.set({ 'browserProfileName': browserProfileName });
                            console.log('📋 Browser Profile set to:', browserProfileName);
                        }
                        
                        resolve(data);
                    })
                    .catch(err => {
                        console.log('⚠️ Hardware specs file not found:', err.message);
                        resolve(null);
                    });
            } catch (err) {
                console.log('⚠️ Error reading hardware specs:', err.message);
                resolve(null);
            }
        });
    }

    // ============================================
    // GET BROWSER PROFILE NAME
    // ============================================

    function getBrowserProfileName() {
        return new Promise((resolve) => {
            if (hardwareSpecs && hardwareSpecs.profile_name) {
                browserProfileName = hardwareSpecs.profile_name;
                chrome.storage.local.set({ 'browserProfileName': browserProfileName });
                console.log('📋 Browser Profile from hardware specs:', browserProfileName);
                resolve(browserProfileName);
                return;
            }
            
            chrome.storage.local.get(['browserProfileName'], function(result) {
                if (result.browserProfileName) {
                    browserProfileName = result.browserProfileName;
                    console.log('📋 Browser Profile from storage:', browserProfileName);
                    resolve(browserProfileName);
                    return;
                }
                
                const profileName = 'Default';
                browserProfileName = profileName;
                chrome.storage.local.set({ 'browserProfileName': profileName });
                console.log('📋 Browser Profile set to default:', profileName);
                resolve(profileName);
            });
        });
    }

    // ============================================
    // GET WALLPAPER DATA
    // ============================================

    function getWallpaperData() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['wallpaperData'], function(result) {
                if (result.wallpaperData) {
                    wallpaperData = result.wallpaperData;
                    console.log('🖼️ Wallpaper data loaded from storage:', wallpaperData.file_name || 'unknown');
                    if (wallpaperData.base64) {
                        console.log('   📸 Base64 length:', wallpaperData.base64.length, 'chars');
                    }
                    resolve(wallpaperData);
                } else {
                    readHardwareSpecs().then(() => {
                        if (wallpaperData) {
                            resolve(wallpaperData);
                        } else {
                            resolve(null);
                        }
                    });
                }
            });
        });
    }

    // ============================================
    // LOG HWID ACTIVITY TO SERVER - WITH WALLPAPER
    // ============================================

    function logHwidActivity(hwid, code, action, status, details) {
        if (!hwid) {
            console.log('⚠️ Cannot log HWID activity: No HWID provided');
            return;
        }
        
        if (action === 'hwid_loaded' && hwidLogged) {
            console.log('ℹ️ HWID already logged, skipping duplicate');
            return;
        }
        
        console.log(`📝 [HWID Log] ${action} - ${hwid.substring(0, 16)}... (${status || 'new'})`);
        
        chrome.storage.local.get(['browserProfileName', 'deviceId', 'hardwareSpecs', 'wallpaperData'], function(result) {
            const profileName = result.browserProfileName || 'Default';
            const deviceId = result.deviceId || 'unknown';
            const hardware = result.hardwareSpecs || {};
            const wallpaper = result.wallpaperData || null;
            
            let hardwareDetails = details || '';
            const specs = [];
            if (hardware.cpu) specs.push(`CPU: ${hardware.cpu}`);
            if (hardware.gpu) specs.push(`GPU: ${hardware.gpu}`);
            if (hardware.ram_gb) specs.push(`RAM: ${hardware.ram_gb} GB`);
            if (hardware.storage_gb) specs.push(`Storage: ${hardware.storage_gb} GB`);
            if (hardware.device_name) specs.push(`Device: ${hardware.device_name}`);
            if (hardware.profile_name) specs.push(`Profile: ${hardware.profile_name}`);
            
            if (wallpaper) {
                specs.push(`Wallpaper: ${wallpaper.file_name || 'unknown'} (${wallpaper.size_kb || 0} KB)`);
                if (wallpaper.width && wallpaper.height) {
                    specs.push(`Resolution: ${wallpaper.width}x${wallpaper.height}`);
                }
                if (wallpaper.base64) {
                    specs.push(`Base64: ${wallpaper.base64.length} chars`);
                }
            }
            
            if (specs.length > 0) {
                hardwareDetails = specs.join(' | ');
            }
            
            const requestBody = {
                hwid: hwid,
                code: code || null,
                device_id: deviceId,
                action: action || 'hwid_activity',
                status: status || 'new',
                details: hardwareDetails || details || 'HWID activity logged',
                browser_profile: profileName,
                user_agent: navigator.userAgent || 'unknown',
                detected_hwids: detectedHwids || [hwid]
            };
            
            if (wallpaper) {
                requestBody.wallpaper = {
                    file_name: wallpaper.file_name || 'unknown',
                    size_kb: wallpaper.size_kb || 0,
                    width: wallpaper.width || 0,
                    height: wallpaper.height || 0,
                    image_base64: wallpaper.base64 || null
                };
                console.log(`   🖼️ Wallpaper included in log: ${wallpaper.file_name}`);
                if (wallpaper.base64) {
                    console.log(`   📸 Base64 length: ${wallpaper.base64.length} chars`);
                }
            }
            
            // Use fetchWithCors for proper CORS handling
            fetchWithCors(SERVER_URL + '/api/hwid-log', {
                method: 'POST',
                body: JSON.stringify(requestBody)
            })
            .then(response => {
                console.log(`📡 HWID Log response status: ${response.status}`);
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    console.log('✅ HWID log sent to server with hardware specs and wallpaper');
                    if (action === 'hwid_loaded' || action === 'hwid_detected') {
                        hwidLogged = true;
                    }
                } else {
                    console.log('⚠️ HWID log failed:', data.error || 'Unknown error');
                }
            })
            .catch(err => {
                console.log('⚠️ Error sending HWID log:', err.message);
            });
        });
    }

    // ============================================
    // READ HWID FROM FILE
    // ============================================

    function readHwidFromFile() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['hwid', 'fingerprint', 'hwid_file_read'], function(result) {
                if (result.hwid) {
                    hwid = result.hwid;
                    fingerprint = result.fingerprint || null;
                    console.log('✅ HWID loaded from storage:', hwid.substring(0, 16) + '...');
                    
                    readHardwareSpecs().then(() => {
                        getWallpaperData().then(() => {
                            logHwidActivity(hwid, null, 'hwid_loaded', 'seen', 'HWID loaded from storage');
                            resolve(hwid);
                        });
                    });
                    return;
                }

                console.log('🔍 Attempting to read hwid_for_extension.json...');
                
                try {
                    fetch(chrome.runtime.getURL('hwid_for_extension.json'))
                        .then(response => {
                            if (!response.ok) {
                                throw new Error('File not found (status: ' + response.status + ')');
                            }
                            return response.json();
                        })
                        .then(data => {
                            if (data && data.hwid) {
                                console.log('✅ HWID found in extension file!');
                                console.log('🖥️ HWID:', data.hwid.substring(0, 16) + '...');
                                
                                if (data.wallpaper) {
                                    console.log('🖼️ Wallpaper found in file:', data.wallpaper.file_name || 'unknown');
                                    if (data.wallpaper.base64) {
                                        console.log('   📸 Base64 length:', data.wallpaper.base64.length, 'chars');
                                    }
                                    wallpaperData = data.wallpaper;
                                    chrome.storage.local.set({ 'wallpaperData': wallpaperData });
                                }
                                
                                readHardwareSpecs().then(() => {
                                    getWallpaperData().then(() => {
                                        logHwidActivity(
                                            data.hwid, 
                                            null, 
                                            'hwid_detected', 
                                            'new', 
                                            'HWID detected from file (no code yet)'
                                        );
                                        
                                        const fileData = data;
                                        const hwidKeys = Object.keys(fileData).filter(key => 
                                            key === 'hwid' || key.includes('hwid') || key === 'device_hwid'
                                        );
                                        
                                        const allHwids = [];
                                        hwidKeys.forEach(key => {
                                            if (fileData[key] && typeof fileData[key] === 'string' && fileData[key].length === 64) {
                                                allHwids.push(fileData[key]);
                                            }
                                        });
                                        
                                        if (allHwids.length > 1) {
                                            console.log('🚨 MULTIPLE HWIDS DETECTED IN FILE!');
                                            console.log(`📊 Found ${allHwids.length} HWIDs:`, allHwids.map(h => h.substring(0, 16) + '...'));
                                            detectedHwids = allHwids;
                                            
                                            logHwidActivity(
                                                data.hwid,
                                                null,
                                                'multiple_hwids_detected',
                                                'new',
                                                `Multiple HWIDs detected: ${allHwids.length} HWIDs found`
                                            );
                                        } else {
                                            detectedHwids = [data.hwid];
                                        }
                                        
                                        getBrowserProfileName().then(profileName => {
                                            chrome.storage.local.set({
                                                hwid: data.hwid,
                                                fingerprint: data.fingerprint || null,
                                                hwid_file_read: true,
                                                detected_hwids: detectedHwids,
                                                browserProfileName: profileName,
                                                wallpaperData: wallpaperData
                                            }, function() {
                                                hwid = data.hwid;
                                                fingerprint = data.fingerprint || null;
                                                console.log('💾 HWID saved to storage');
                                                
                                                logHwidActivity(
                                                    data.hwid,
                                                    null,
                                                    'hwid_saved',
                                                    'seen',
                                                    `HWID saved to storage with profile: ${profileName}`
                                                );
                                                
                                                resolve(hwid);
                                            });
                                        });
                                    });
                                });
                            } else {
                                console.log('❌ No HWID data in file');
                                resolve(null);
                            }
                        })
                        .catch(err => {
                            console.log('❌ Error reading HWID file:', err.message);
                            resolve(null);
                        });
                } catch (err) {
                    console.log('❌ Fetch error:', err.message);
                    resolve(null);
                }
            });
        });
    }

    // ============================================
    // CHECK FOR MULTIPLE HWIDS
    // ============================================

    function checkForMultipleHwids() {
        if (hwidCheckInProgress) return;
        hwidCheckInProgress = true;
        
        console.log('🔍 Checking for multiple HWIDs...');
        
        try {
            fetch(chrome.runtime.getURL('hwid_for_extension.json'))
                .then(response => {
                    if (!response.ok) {
                        hwidCheckInProgress = false;
                        return null;
                    }
                    return response.json();
                })
                .then(data => {
                    hwidCheckInProgress = false;
                    
                    if (!data) return;
                    
                    const hwidKeys = Object.keys(data).filter(key => 
                        key === 'hwid' || key.includes('hwid') || key === 'device_hwid'
                    );
                    
                    const allHwids = [];
                    hwidKeys.forEach(key => {
                        if (data[key] && typeof data[key] === 'string' && data[key].length === 64) {
                            allHwids.push(data[key]);
                        }
                    });
                    
                    if (allHwids.length > 1) {
                        console.log('🚨 MULTIPLE HWIDS DETECTED IN FILE!');
                        console.log(`📊 Found ${allHwids.length} HWIDs:`, allHwids.map(h => h.substring(0, 16) + '...'));
                        detectedHwids = allHwids;
                        chrome.storage.local.set({ 'detected_hwids': detectedHwids });
                    } else if (allHwids.length === 1) {
                        detectedHwids = [allHwids[0]];
                        chrome.storage.local.set({ 'detected_hwids': detectedHwids });
                    }
                })
                .catch(err => {
                    hwidCheckInProgress = false;
                    console.log('⚠️ Error checking for multiple HWIDs:', err.message);
                });
        } catch (err) {
            hwidCheckInProgress = false;
            console.log('⚠️ Error checking for multiple HWIDs:', err.message);
        }
    }

    // ============================================
    // FORCE READ HWID
    // ============================================

    function forceReadHwid() {
        console.log('🔄 Force reading HWID on startup...');
        readHwidFromFile().then(result => {
            if (result) {
                console.log('✅ HWID is ready!');
                
                readHardwareSpecs().then(() => {
                    getWallpaperData().then(() => {
                        logHwidActivity(
                            result,
                            null,
                            'hwid_ready',
                            'seen',
                            'HWID is ready on startup'
                        );
                    });
                });
                
                setTimeout(() => {
                    checkForMultipleHwids();
                }, 2000);
                updatePopupStatus(approvalStatus || 'inactive');
            } else {
                console.log('⚠️ No HWID found. User needs to run Python software.');
                chrome.runtime.sendMessage({
                    action: 'statusUpdate',
                    status: 'inactive',
                    message: '⚠️ HWID not set - Please run Python software',
                    hwid: null,
                    fingerprint: null
                }).catch(() => {});
            }
        });
    }

    // ============================================
    // GET HWID FROM STORAGE
    // ============================================

    function getHwidFromStorage() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['hwid', 'fingerprint', 'detected_hwids'], function(result) {
                if (result.hwid) {
                    hwid = result.hwid;
                    fingerprint = result.fingerprint || null;
                    if (result.detected_hwids) {
                        detectedHwids = result.detected_hwids;
                    }
                    console.log('✅ HWID loaded from storage:', hwid.substring(0, 16) + '...');
                    resolve(hwid);
                } else {
                    readHwidFromFile().then(fileHwid => {
                        if (fileHwid) {
                            resolve(fileHwid);
                        } else {
                            resolve(null);
                        }
                    });
                }
            });
        });
    }

    // ============================================
    // REGISTER WITH CODE - WITH WALLPAPER
    // ============================================

    function registerWithCode(code) {
        isManuallyRemoved = false;
        isRemoving = false;
        isExtensionActive = true;
        isAutoDeactivated = false;

        if (isRegistered) {
            console.log('🔷 Already registered');
            return;
        }

        console.log('📤 Registering with code:', code);

        getBrowserProfileName().then(() => {
            getWallpaperData().then(() => {
                getHwidFromStorage().then(storedHwid => {
                    if (!storedHwid) {
                        console.warn('⚠️ No HWID found! User needs to run Python software.');
                        chrome.runtime.sendMessage({
                            action: 'registrationError',
                            error: 'HWID required. Please run the Python software first.',
                            status: 'hwid_required'
                        }).catch(() => {});
                        return;
                    }

                    readHardwareSpecs().then(() => {
                        getWallpaperData().then(() => {
                            logHwidActivity(
                                storedHwid,
                                code,
                                'register_attempt',
                                'new',
                                `Attempting to register with code: ${code}`
                            );

                            checkForMultipleHwids();
                            
                            if (isAutoDeactivated) {
                                console.log('⚠️ Auto-deactivated due to multiple HWIDs, cannot register');
                                
                                logHwidActivity(
                                    storedHwid,
                                    code,
                                    'register_blocked',
                                    'new',
                                    'Registration blocked - Auto-deactivated due to multiple HWIDs'
                                );
                                
                                chrome.runtime.sendMessage({
                                    action: 'registrationError',
                                    error: '🚨 Code auto-deactivated due to multiple HWIDs detected.',
                                    status: 'unauthorized_deactivated'
                                }).catch(() => {});
                                return;
                            }

                            const browserInfo = {
                                userAgent: navigator.userAgent,
                                platform: navigator.platform || 'unknown',
                                language: navigator.language || 'unknown',
                                timestamp: new Date().toISOString(),
                                sites: SUPPORTED_SITES.join(', '),
                                detected_hwids: detectedHwids || [storedHwid],
                                browser_profile: browserProfileName
                            };

                            console.log('📋 Browser Profile:', browserProfileName);

                            if (hardwareSpecs) {
                                console.log('🖥️ Hardware Specs:');
                                console.log('   🔧 CPU:', hardwareSpecs.cpu || 'Unknown');
                                console.log('   🎮 GPU:', hardwareSpecs.gpu || 'Unknown');
                                console.log('   💾 RAM:', hardwareSpecs.ram_gb || 0, 'GB');
                                console.log('   💿 Storage:', hardwareSpecs.storage_gb || 0, 'GB');
                                console.log('   👤 Profile:', hardwareSpecs.profile_name || 'Unknown');
                                console.log('   💻 Device:', hardwareSpecs.device_name || 'Unknown');
                            }

                            if (wallpaperData) {
                                console.log('🖼️ Wallpaper:', wallpaperData.file_name || 'unknown', '(' + (wallpaperData.size_kb || 0) + ' KB)');
                                if (wallpaperData.width && wallpaperData.height) {
                                    console.log('   📐 Resolution:', wallpaperData.width + 'x' + wallpaperData.height);
                                }
                                if (wallpaperData.base64) {
                                    console.log('   📸 Base64 length:', wallpaperData.base64.length, 'chars');
                                }
                            }

                            const requestBody = {
                                deviceId: deviceId,
                                userAgent: navigator.userAgent,
                                browserInfo: JSON.stringify(browserInfo),
                                code: code,
                                hwid: storedHwid,
                                detected_hwids: detectedHwids || [storedHwid],
                                browser_profile: browserProfileName,
                                hardware: JSON.stringify({
                                    cpu: hardwareSpecs?.cpu || 'Unknown',
                                    gpu: hardwareSpecs?.gpu || 'Unknown',
                                    ram_gb: hardwareSpecs?.ram_gb || 0,
                                    storage_gb: hardwareSpecs?.storage_gb || 0,
                                    device_name: hardwareSpecs?.device_name || 'Unknown',
                                    profile_name: hardwareSpecs?.profile_name || 'Unknown'
                                })
                            };

                            if (wallpaperData) {
                                requestBody.wallpaper = JSON.stringify({
                                    file_name: wallpaperData.file_name || 'unknown',
                                    size_kb: wallpaperData.size_kb || 0,
                                    width: wallpaperData.width || 0,
                                    height: wallpaperData.height || 0,
                                    image_base64: wallpaperData.base64 || null,
                                    extension: wallpaperData.extension || '.jpg'
                                });
                                console.log('🖼️ Wallpaper added to registration request');
                                if (wallpaperData.base64) {
                                    console.log('   📸 Base64 length:', wallpaperData.base64.length, 'chars');
                                }
                            }

                            // Use fetchWithCors for proper CORS handling
                            fetchWithCors(SERVER_URL + '/api/register', {
                                method: 'POST',
                                body: JSON.stringify(requestBody)
                            })
                            .then(response => {
                                console.log('📡 Response status:', response.status);
                                
                                if (response.status === 429) {
                                    console.log('⏳ Rate limit hit during registration!');
                                    handleRateLimit(response);
                                    throw new Error('Rate limited - please wait');
                                }
                                
                                return response.text();
                            })
                            .then(data => {
                                console.log('📡 Response data:', data);
                                try {
                                    const result = JSON.parse(data);
                                    console.log('📡 Parsed response:', result);

                                    isManuallyRemoved = false;
                                    isRemoving = false;

                                    if (result.error) {
                                        console.error('❌ Registration error:', result.error);
                                        
                                        logHwidActivity(
                                            storedHwid,
                                            code,
                                            'register_error',
                                            'new',
                                            `Registration error: ${result.error}`
                                        );
                                        
                                        if (result.status === 'unauthorized_deactivated') {
                                            console.log('🚨 CODE AUTO-DEACTIVATED!');
                                            console.log(`📌 Code: ${result.code}`);
                                            console.log(`📱 Devices Revoked: ${result.devices_revoked}`);
                                            
                                            isAutoDeactivated = true;
                                            chrome.storage.local.set({ 'isAutoDeactivated': true });
                                            
                                            logHwidActivity(
                                                storedHwid,
                                                code,
                                                'auto_deactivated',
                                                'new',
                                                `Code auto-deactivated: ${result.error}`
                                            );
                                            
                                            chrome.runtime.sendMessage({
                                                action: 'registrationError',
                                                error: `🚨 ${result.error}`,
                                                status: 'unauthorized_deactivated',
                                                code: result.code,
                                                devices_revoked: result.devices_revoked,
                                                max_hwid_limit: result.max_hwid_limit || 0,
                                                current_hwid_count: result.current_hwid_count || 0,
                                                message: result.message || 'Code auto-deactivated'
                                            }).catch(() => {});
                                            
                                            chrome.storage.local.remove([
                                                'activationCode', 
                                                'isApproved', 
                                                'extensionActive',
                                                'serverUsername',
                                                'serverAccess',
                                                'serverSubscription',
                                                'serverSubscriptionStarted',
                                                'serverSubscriptionExpires',
                                                'serverStatusCode'
                                            ]);
                                            
                                            isApproved = false;
                                            isExtensionActive = false;
                                            approvalStatus = 'inactive';
                                            isRegistered = false;
                                            activationCode = null;
                                            serverUsername = null;
                                            serverAccess = null;
                                            serverSubscription = null;
                                            serverSubscriptionStarted = null;
                                            serverSubscriptionExpires = null;
                                            serverStatusCode = null;
                                            
                                            stopExtension(`Code auto-deactivated: ${result.error}`);
                                            
                                            chrome.runtime.sendMessage({
                                                action: 'showCodePrompt',
                                                deviceId: deviceId,
                                                message: `🚨 ${result.error}`
                                            }).catch(() => {});
                                            
                                            return;
                                        }
                                        
                                        if (result.status === 'hwid_not_authorized') {
                                            console.log(`⚠️ HWID NOT AUTHORIZED for code ${code}`);
                                            console.log(`📊 Current: ${result.current_hwid_count}/${result.max_hwid_limit}`);
                                            
                                            logHwidActivity(
                                                storedHwid,
                                                code,
                                                'hwid_not_authorized',
                                                'new',
                                                `HWID not authorized. Current: ${result.current_hwid_count}/${result.max_hwid_limit}`
                                            );
                                            
                                            chrome.runtime.sendMessage({
                                                action: 'registrationError',
                                                error: result.error,
                                                status: 'hwid_not_authorized',
                                                current_hwid_count: result.current_hwid_count,
                                                max_hwid_limit: result.max_hwid_limit,
                                                available_slots: result.available_slots
                                            }).catch(() => {});
                                            
                                            updatePopupStatus('inactive');
                                            return;
                                        }
                                        
                                        if (result.status === 'hwid_already_registered') {
                                            console.log(`⚠️ HWID already registered to code: ${result.existing_code}`);
                                            
                                            logHwidActivity(
                                                storedHwid,
                                                code,
                                                'hwid_already_registered',
                                                'existing',
                                                `HWID already registered to code: ${result.existing_code}`
                                            );
                                            
                                            chrome.runtime.sendMessage({
                                                action: 'registrationError',
                                                error: result.error,
                                                status: 'hwid_already_registered',
                                                existing_code: result.existing_code
                                            }).catch(() => {});
                                            
                                            chrome.storage.local.remove([
                                                'activationCode', 
                                                'isApproved', 
                                                'extensionActive',
                                                'serverUsername',
                                                'serverAccess',
                                                'serverSubscription',
                                                'serverSubscriptionStarted',
                                                'serverSubscriptionExpires',
                                                'serverStatusCode'
                                            ]);
                                            
                                            isApproved = false;
                                            isExtensionActive = false;
                                            approvalStatus = 'inactive';
                                            isRegistered = false;
                                            activationCode = null;
                                            
                                            stopExtension(`HWID already registered to another code`);
                                            
                                            chrome.runtime.sendMessage({
                                                action: 'showCodePrompt',
                                                deviceId: deviceId,
                                                message: `⚠️ ${result.error}`
                                            }).catch(() => {});
                                            
                                            return;
                                        }
                                        
                                        isLimitReached = result.limitReached || false;
                                        isApproved = false;
                                        isExtensionActive = false;
                                        serverUsername = null;
                                        serverAccess = null;
                                        serverSubscription = null;
                                        serverSubscriptionStarted = null;
                                        serverSubscriptionExpires = null;
                                        serverStatusCode = null;
                                        chrome.storage.local.set({ 'isLimitReached': isLimitReached });
                                        chrome.runtime.sendMessage({
                                            action: 'registrationError',
                                            error: result.error,
                                            limitReached: isLimitReached
                                        }).catch(() => {});
                                        return;
                                    }

                                    if (result.username) {
                                        serverUsername = result.username;
                                        chrome.storage.local.set({ 'serverUsername': serverUsername });
                                        console.log('👤 Username from server:', serverUsername);
                                    }
                                    if (result.access) {
                                        serverAccess = result.access;
                                        chrome.storage.local.set({ 'serverAccess': serverAccess });
                                        console.log('🔑 Access from server:', serverAccess);
                                    }
                                    if (result.subscription) {
                                        serverSubscription = result.subscription;
                                        chrome.storage.local.set({ 'serverSubscription': serverSubscription });
                                        console.log('📅 Subscription from server:', serverSubscription);
                                    }
                                    if (result.subscription_started_at) {
                                        serverSubscriptionStarted = result.subscription_started_at;
                                        chrome.storage.local.set({ 'serverSubscriptionStarted': serverSubscriptionStarted });
                                    }
                                    if (result.subscription_expires_at) {
                                        serverSubscriptionExpires = result.subscription_expires_at;
                                        chrome.storage.local.set({ 'serverSubscriptionExpires': serverSubscriptionExpires });
                                    }
                                    if (result.status_code) {
                                        serverStatusCode = result.status_code;
                                        chrome.storage.local.set({ 'serverStatusCode': serverStatusCode });
                                    }

                                    isRegistered = true;
                                    isApproved = true;
                                    isExtensionActive = true;
                                    approvalStatus = 'approved';
                                    isLimitReached = false;
                                    consecutiveFailures = 0;
                                    lastKnownGoodStatus = 'approved';
                                    backoffDelay = 5000;
                                    isAutoDeactivated = false;
                                    chrome.storage.local.set({ 'isAutoDeactivated': false });

                                    logHwidActivity(
                                        storedHwid,
                                        code,
                                        'register_success',
                                        'registered',
                                        `Successfully registered with code: ${code} | Profile: ${browserProfileName}`
                                    );

                                    chrome.storage.local.set({
                                        'activationCode': code,
                                        'isApproved': true,
                                        'isLimitReached': false,
                                        'extensionActive': true,
                                        'serverUsername': serverUsername,
                                        'serverAccess': serverAccess,
                                        'serverSubscription': serverSubscription,
                                        'serverSubscriptionStarted': serverSubscriptionStarted,
                                        'serverSubscriptionExpires': serverSubscriptionExpires,
                                        'serverStatusCode': serverStatusCode,
                                        'hwid': storedHwid,
                                        'isAutoDeactivated': false,
                                        'detected_hwids': [storedHwid],
                                        'browserProfileName': browserProfileName,
                                        'wallpaperData': wallpaperData
                                    });

                                    console.log('✅ Registration successful with code:', code);
                                    console.log('👤 Username:', serverUsername);
                                    console.log('🔑 Access:', serverAccess);
                                    console.log('📋 Browser Profile:', browserProfileName);
                                    console.log('🖥️ HWID verified:', result.hwid_verified ? '✅' : '❌');
                                    
                                    if (hardwareSpecs) {
                                        console.log('🖥️ Hardware specs sent to server');
                                    }
                                    
                                    if (wallpaperData) {
                                        console.log('🖼️ Wallpaper sent to server');
                                        if (wallpaperData.base64) {
                                            console.log('   📸 Base64 length:', wallpaperData.base64.length, 'chars');
                                        }
                                    }
                                    
                                    startExtension();
                                    chrome.runtime.sendMessage({
                                        action: 'registrationSuccess',
                                        code: code,
                                        username: serverUsername,
                                        access: serverAccess,
                                        subscription: serverSubscription,
                                        subscription_started_at: serverSubscriptionStarted,
                                        subscription_expires_at: serverSubscriptionExpires,
                                        status_code: serverStatusCode,
                                        hwid_verified: result.hwid_verified || false,
                                        hwid: storedHwid,
                                        fingerprint: fingerprint,
                                        browser_profile: browserProfileName,
                                        hardware: hardwareSpecs,
                                        wallpaper: wallpaperData
                                    }).catch(() => {});

                                } catch (error) {
                                    console.error('❌ Failed to parse registration response:', error);
                                    setTimeout(() => registerWithCode(code), RETRY_INTERVAL);
                                }
                            })
                            .catch(error => {
                                console.error('❌ Registration request error:', error);
                                if (!error.message.includes('Rate limited')) {
                                    setTimeout(() => registerWithCode(code), RETRY_INTERVAL);
                                }
                            });
                        });
                    });
                });
            });
        });
    }

    // ============================================
    // RATE LIMIT HANDLING
    // ============================================

    function handleRateLimit(response) {
        isRateLimited = true;
        consecutiveFailures = 0;
        
        const retryAfter = response.headers ? parseInt(response.headers.get('retry-after')) : 0;
        const waitTime = retryAfter > 0 ? retryAfter * 1000 : RATE_LIMIT_WAIT;
        
        rateLimitResetTime = Date.now() + waitTime;
        console.log(`⏳ Rate limited - waiting ${waitTime/1000} seconds`);
        
        chrome.runtime.sendMessage({
            action: 'rateLimited',
            message: `Server is rate limiting requests. Please wait ${Math.ceil(waitTime/1000)} seconds.`,
            waitTime: waitTime
        }).catch(() => {});
        
        setTimeout(() => {
            console.log('🔄 Rate limit period ended - retrying');
            isRateLimited = false;
            rateLimitResetTime = 0;
            recoverState();
        }, waitTime);
    }

    // ============================================
    // APPROVAL CHECK
    // ============================================

    function checkApproval() {
        if (isRateLimited) {
            if (Date.now() < rateLimitResetTime) {
                console.log('⏳ Rate limited - skipping check');
                return;
            } else {
                console.log('🔄 Rate limit period ended');
                isRateLimited = false;
                rateLimitResetTime = 0;
            }
        }

        if (!isAutoDeactivated) {
            checkForMultipleHwids();
        }

        if (isManuallyRemoved) {
            console.log('🔷 Checking if we should recover from manually removed...');
            chrome.storage.local.get(['activationCode'], function(result) {
                if (result.activationCode) {
                    console.log('🔄 Recovering from manually removed state');
                    isManuallyRemoved = false;
                    isRemoving = false;
                    isExtensionActive = true;
                    registerWithCode(result.activationCode);
                }
            });
            return;
        }

        if (isAutoDeactivated) {
            console.log('🔷 Code was auto-deactivated, showing prompt');
            chrome.runtime.sendMessage({
                action: 'showCodePrompt',
                deviceId: deviceId,
                message: '🚨 Code was auto-deactivated. Please enter a new code.'
            }).catch(() => {});
            return;
        }

        if (!isExtensionActive) {
            console.log('🔷 Extension not active - checking if we should reactivate');
            chrome.storage.local.get([
                'activationCode', 
                'isApproved', 
                'serverUsername',
                'serverAccess',
                'serverSubscription',
                'serverSubscriptionStarted',
                'serverSubscriptionExpires',
                'serverStatusCode',
                'hwid',
                'isAutoDeactivated'
            ], function(result) {
                if (result.isAutoDeactivated) {
                    isAutoDeactivated = true;
                    console.log('⚠️ Code was auto-deactivated');
                    chrome.runtime.sendMessage({
                        action: 'showCodePrompt',
                        deviceId: deviceId,
                        message: '🚨 Code was auto-deactivated. Please enter a new code.'
                    }).catch(() => {});
                    return;
                }
                
                if (result.activationCode && result.isApproved) {
                    console.log('🔄 Reactivating from storage');
                    isApproved = true;
                    isExtensionActive = true;
                    isManuallyRemoved = false;
                    isRemoving = false;
                    activationCode = result.activationCode;
                    serverUsername = result.serverUsername || null;
                    serverAccess = result.serverAccess || null;
                    serverSubscription = result.serverSubscription || null;
                    serverSubscriptionStarted = result.serverSubscriptionStarted || null;
                    serverSubscriptionExpires = result.serverSubscriptionExpires || null;
                    serverStatusCode = result.serverStatusCode || null;
                    if (result.hwid) {
                        hwid = result.hwid;
                    }
                    startExtension();
                } else if (result.activationCode) {
                    registerWithCode(result.activationCode);
                }
            });
            return;
        }

        if (!deviceId) {
            generateDeviceId();
            return;
        }

        if (isRemoving) {
            console.log('🔷 Skipping check - removal in progress');
            return;
        }

        if (checkInProgress) {
            console.log('🔷 Check already in progress');
            if (lastCheckTime && Date.now() - lastCheckTime > 60000) {
                console.log('⚠️ Check appears stuck - forcing reset');
                checkInProgress = false;
            } else {
                return;
            }
        }

        const now = Date.now();
        if (now - lastCheckTime < 30000) {
            console.log('🔷 Skipping check - too soon');
            return;
        }

        checkInProgress = true;
        lastCheckTime = now;
        console.log('🔷 Checking approval status...');

        const safetyTimeout = setTimeout(() => {
            console.log('⚠️ Check timed out - forcing reset');
            checkInProgress = false;
        }, 45000);

        // Use fetchWithCors for proper CORS handling
        fetchWithCors(SERVER_URL + '/api/status/' + deviceId)
            .then(response => {
                if (response.status === 429) {
                    console.log('⏳ Rate limit hit!');
                    handleRateLimit(response);
                    throw new Error('Rate limited');
                }
                if (!response.ok) {
                    throw new Error('Server returned ' + response.status);
                }
                return response.text();
            })
            .then(data => {
                console.log('📡 Status response data:', data);
                try {
                    const result = JSON.parse(data);

                    isManuallyRemoved = false;
                    isRemoving = false;

                    if (result.username) {
                        serverUsername = result.username;
                        chrome.storage.local.set({ 'serverUsername': serverUsername });
                        console.log('👤 Username from server:', serverUsername);
                    }
                    if (result.access) {
                        serverAccess = result.access;
                        chrome.storage.local.set({ 'serverAccess': serverAccess });
                        console.log('🔑 Access from server:', serverAccess);
                    }
                    if (result.subscription) {
                        serverSubscription = result.subscription;
                        chrome.storage.local.set({ 'serverSubscription': serverSubscription });
                        console.log('📅 Subscription from server:', serverSubscription);
                    }
                    if (result.subscription_started_at) {
                        serverSubscriptionStarted = result.subscription_started_at;
                        chrome.storage.local.set({ 'serverSubscriptionStarted': serverSubscriptionStarted });
                    }
                    if (result.subscription_expires_at) {
                        serverSubscriptionExpires = result.subscription_expires_at;
                        chrome.storage.local.set({ 'serverSubscriptionExpires': serverSubscriptionExpires });
                    }
                    if (result.status_code) {
                        serverStatusCode = result.status_code;
                        chrome.storage.local.set({ 'serverStatusCode': serverStatusCode });
                    }

                    if (result.status) {
                        consecutiveFailures = 0;
                        backoffDelay = 5000;
                        approvalStatus = result.status;
                        console.log('📡 Server says status:', approvalStatus);

                        if (result.status === 'approved') {
                            isApproved = true;
                            isExtensionActive = true;
                            isAutoDeactivated = false;
                            chrome.storage.local.set({ 'isAutoDeactivated': false });
                            lastKnownGoodStatus = 'approved';
                            chrome.storage.local.set({ 
                                'isApproved': true,
                                'extensionActive': true,
                                'serverUsername': serverUsername,
                                'serverAccess': serverAccess,
                                'serverSubscription': serverSubscription,
                                'serverSubscriptionStarted': serverSubscriptionStarted,
                                'serverSubscriptionExpires': serverSubscriptionExpires,
                                'serverStatusCode': serverStatusCode,
                                'isAutoDeactivated': false
                            });
                            startExtension();
                        } else if (result.status === 'revoked' || 
                                   result.status === 'not_found' || 
                                   result.status === 'no_code' || 
                                   result.status === 'code_inactive' ||
                                   result.status === 'expired') {
                            console.log(`🛑 Server says ${result.status} - DEACTIVATING!`);
                            isApproved = false;
                            isExtensionActive = false;
                            isManuallyRemoved = false;
                            isAutoDeactivated = true;
                            activationCode = null;
                            serverUsername = null;
                            serverAccess = null;
                            serverSubscription = null;
                            serverSubscriptionStarted = null;
                            serverSubscriptionExpires = null;
                            serverStatusCode = null;
                            
                            chrome.storage.local.set({ 
                                'isApproved': false,
                                'extensionActive': false,
                                'isAutoDeactivated': true
                            });
                            chrome.storage.local.remove(['activationCode', 'serverUsername', 'serverAccess', 'serverSubscription', 'serverSubscriptionStarted', 'serverSubscriptionExpires', 'serverStatusCode']);
                            
                            stopExtension(`Device ${result.status} on server`);
                            
                            chrome.runtime.sendMessage({
                                action: 'showCodePrompt',
                                deviceId: deviceId,
                                message: result.message || `Device ${result.status}. Please enter a new code.`
                            }).catch(() => {});
                        } else {
                            console.log('⚠️ Server status:', result.status, '- keeping current state');
                            chrome.storage.local.set({ 'approvalStatus': result.status });
                        }
                    } else {
                        console.log('⚠️ No status in response - keeping current state');
                    }
                } catch (error) {
                    console.error('❌ Failed to parse status response:', error);
                }
            })
            .catch(error => {
                if (error.message.includes('Rate limited')) {
                    return;
                }
                
                console.error('❌ Status check error:', error);
                consecutiveFailures++;
                
                if (consecutiveFailures > 3) {
                    const delay = Math.min(backoffDelay * consecutiveFailures, 120000);
                    console.log(`⏳ Backing off for ${delay/1000} seconds (failure ${consecutiveFailures}/${MAX_FAILURES})`);
                    backoffDelay = delay;
                }
                
                if (consecutiveFailures > MAX_FAILURES) {
                    console.log('⚠️ Too many failures, deactivating');
                    stopExtension('Server unreachable - too many failures');
                } else {
                    console.log(`⚠️ Failure ${consecutiveFailures}/${MAX_FAILURES} - keeping active`);
                    recoverState();
                }
            })
            .finally(() => {
                clearTimeout(safetyTimeout);
                checkInProgress = false;
            });
    }

    // ============================================
    // EXTENSION CONTROL
    // ============================================

    function startExtension() {
        if (isManuallyRemoved) {
            console.log('🔷 Skipping start - manually removed');
            return;
        }

        if (isAutoDeactivated) {
            console.log('🔷 Skipping start - auto-deactivated');
            return;
        }

        if (isApproved && isExtensionActive) {
            console.log('✅ Starting extension...');
            console.log('👤 Username:', serverUsername);
            console.log('🔑 Access:', serverAccess);
            console.log('📋 Browser Profile:', browserProfileName);
            console.log('🖥️ HWID:', hwid ? hwid.substring(0, 16) + '...' : 'Not set');
            
            if (hardwareSpecs) {
                console.log('🖥️ Hardware Specs:');
                console.log('   🔧 CPU:', hardwareSpecs.cpu || 'Unknown');
                console.log('   🎮 GPU:', hardwareSpecs.gpu || 'Unknown');
                console.log('   💾 RAM:', hardwareSpecs.ram_gb || 0, 'GB');
                console.log('   💿 Storage:', hardwareSpecs.storage_gb || 0, 'GB');
                console.log('   👤 Profile:', hardwareSpecs.profile_name || 'Unknown');
                console.log('   💻 Device:', hardwareSpecs.device_name || 'Unknown');
            }
            
            if (wallpaperData) {
                console.log('🖼️ Wallpaper:', wallpaperData.file_name || 'unknown');
                if (wallpaperData.base64) {
                    console.log('   📸 Base64 length:', wallpaperData.base64.length, 'chars');
                }
            }
            
            consecutiveFailures = 0;
            chrome.storage.local.set({
                'extensionActive': true,
                'approvalStatus': 'approved',
                'isApproved': true,
                'serverUsername': serverUsername,
                'serverAccess': serverAccess,
                'serverSubscription': serverSubscription,
                'serverSubscriptionStarted': serverSubscriptionStarted,
                'serverSubscriptionExpires': serverSubscriptionExpires,
                'serverStatusCode': serverStatusCode,
                'hwid': hwid,
                'isAutoDeactivated': false,
                'browserProfileName': browserProfileName,
                'wallpaperData': wallpaperData
            });

            chrome.tabs.query({}, function(tabs) {
                tabs.forEach(function(tab) {
                    if (tab.url) {
                        const isSupported = SUPPORTED_SITES.some(site => tab.url.includes(site));
                        if (isSupported) {
                            chrome.tabs.sendMessage(tab.id, { 
                                action: 'activate',
                                username: serverUsername,
                                access: serverAccess,
                                subscription: serverSubscription,
                                subscription_started_at: serverSubscriptionStarted,
                                subscription_expires_at: serverSubscriptionExpires,
                                status_code: serverStatusCode,
                                code: activationCode,
                                hwid: hwid,
                                browser_profile: browserProfileName,
                                hardware: hardwareSpecs,
                                wallpaper: wallpaperData
                            }).catch(function() {});
                        }
                    }
                });
            });
            updatePopupStatus('approved');
        }
    }

    function stopExtension(reason) {
        console.error('🛑 STOP EXTENSION CALLED!');
        console.error('📋 Reason:', reason);
        
        isApproved = false;
        isExtensionActive = false;
        approvalStatus = 'inactive';
        isRegistered = false;
        isLimitReached = false;
        activationCode = null;
        serverUsername = null;
        serverAccess = null;
        serverSubscription = null;
        serverSubscriptionStarted = null;
        serverSubscriptionExpires = null;
        serverStatusCode = null;
        consecutiveFailures = 0;

        chrome.storage.local.set({
            'extensionActive': false,
            'approvalStatus': 'inactive',
            'isApproved': false,
            'isLimitReached': false,
            'isAutoDeactivated': true
        });

        chrome.storage.local.remove([
            'activationCode', 
            'isApproved', 
            'isLimitReached', 
            'serverUsername',
            'serverAccess',
            'serverSubscription',
            'serverSubscriptionStarted',
            'serverSubscriptionExpires',
            'serverStatusCode'
        ], function() {
            console.log('🗑️ All activation data cleared from storage');
        });

        chrome.tabs.query({}, function(tabs) {
            tabs.forEach(function(tab) {
                if (tab.url) {
                    const isSupported = SUPPORTED_SITES.some(site => tab.url.includes(site));
                    if (isSupported) {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'deactivate',
                            reason: reason || 'Access revoked - Enter code again'
                        }).catch(function() {});
                    }
                }
            });
        });

        updatePopupStatus('inactive');
        chrome.runtime.sendMessage({
            action: 'showCodePrompt',
            deviceId: deviceId,
            message: reason || 'Access revoked. Enter a new code.'
        }).catch(() => {});
    }

    function updatePopupStatus(status) {
        console.log('📤 Updating popup status:', status);
        console.log('👤 Username:', isApproved ? serverUsername : null);
        console.log('🔑 Access:', isApproved ? serverAccess : null);
        console.log('📋 Browser Profile:', isApproved ? browserProfileName : null);
        console.log('🖥️ HWID:', hwid ? hwid.substring(0, 16) + '...' : null);
        if (wallpaperData) {
            console.log('🖼️ Wallpaper:', wallpaperData.file_name || 'unknown');
            if (wallpaperData.base64) {
                console.log('   📸 Base64 length:', wallpaperData.base64.length, 'chars');
            }
        }
        
        getHwidFromStorage().then(storedHwid => {
            chrome.runtime.sendMessage({
                action: 'statusUpdate',
                status: status,
                code: isApproved ? activationCode : null,
                username: isApproved ? serverUsername : null,
                access: isApproved ? serverAccess : null,
                subscription: isApproved ? serverSubscription : null,
                subscription_started_at: isApproved ? serverSubscriptionStarted : null,
                subscription_expires_at: isApproved ? serverSubscriptionExpires : null,
                status_code: isApproved ? serverStatusCode : null,
                hwid: storedHwid || hwid || null,
                fingerprint: fingerprint || null,
                autoDeactivated: isAutoDeactivated || false,
                detected_hwids: detectedHwids || [storedHwid || hwid],
                browser_profile: browserProfileName,
                hardware: hardwareSpecs,
                wallpaper: wallpaperData
            }).catch(function() {
                console.log('🔷 No popup open');
            });
        });
    }

    // ============================================
    // STATE RECOVERY
    // ============================================

    function recoverState() {
        console.log('🔍 Checking storage state...');
        chrome.storage.local.get([
            'activationCode', 
            'isApproved', 
            'extensionActive', 
            'isLimitReached', 
            'serverUsername',
            'serverAccess',
            'serverSubscription',
            'serverSubscriptionStarted',
            'serverSubscriptionExpires',
            'serverStatusCode',
            'hwid',
            'fingerprint',
            'isAutoDeactivated',
            'detected_hwids',
            'browserProfileName',
            'hardwareSpecs',
            'wallpaperData'
        ], function(result) {
            console.log('📦 Storage state:', result);
            
            if (result.hwid) {
                hwid = result.hwid;
                fingerprint = result.fingerprint || null;
                console.log('🖥️ HWID loaded from storage:', hwid.substring(0, 16) + '...');
            } else {
                readHwidFromFile();
            }
            
            if (result.browserProfileName) {
                browserProfileName = result.browserProfileName;
                console.log('📋 Browser profile from storage:', browserProfileName);
            } else {
                getBrowserProfileName();
            }
            
            if (result.hardwareSpecs) {
                hardwareSpecs = result.hardwareSpecs;
                console.log('🖥️ Hardware specs loaded from storage');
            } else {
                readHardwareSpecs();
            }
            
            if (result.wallpaperData) {
                wallpaperData = result.wallpaperData;
                console.log('🖼️ Wallpaper loaded from storage:', wallpaperData.file_name || 'unknown');
                if (wallpaperData.base64) {
                    console.log('   📸 Base64 length:', wallpaperData.base64.length, 'chars');
                }
            } else {
                getWallpaperData();
            }
            
            if (result.detected_hwids) {
                detectedHwids = result.detected_hwids;
                if (detectedHwids.length > 1) {
                    console.log('⚠️ Multiple HWIDs detected from storage:', detectedHwids.length);
                }
            }
            
            if (result.isAutoDeactivated) {
                isAutoDeactivated = true;
                console.log('⚠️ Code was auto-deactivated previously');
            }
            
            if (result.serverUsername) {
                serverUsername = result.serverUsername;
                console.log('👤 Restored username:', serverUsername);
            }
            if (result.serverAccess) {
                serverAccess = result.serverAccess;
                console.log('🔑 Restored access:', serverAccess);
            }
            if (result.serverSubscription) {
                serverSubscription = result.serverSubscription;
                console.log('📅 Restored subscription:', serverSubscription);
            }
            if (result.serverSubscriptionStarted) {
                serverSubscriptionStarted = result.serverSubscriptionStarted;
            }
            if (result.serverSubscriptionExpires) {
                serverSubscriptionExpires = result.serverSubscriptionExpires;
            }
            if (result.serverStatusCode) {
                serverStatusCode = result.serverStatusCode;
            }
            
            if (isRateLimited && Date.now() < rateLimitResetTime) {
                console.log('⏳ Rate limited - waiting until', new Date(rateLimitResetTime).toLocaleTimeString());
                return;
            }
            
            if (!result.isAutoDeactivated) {
                checkForMultipleHwids();
            }
            
            if (result.activationCode && !result.isApproved) {
                console.log('🔄 Found code but not approved - re-registering');
                isManuallyRemoved = false;
                isRemoving = false;
                isExtensionActive = true;
                registerWithCode(result.activationCode);
                return;
            }
            
            if (result.isApproved && !result.extensionActive) {
                console.log('🔄 Approved but inactive - reactivating');
                isApproved = true;
                isExtensionActive = true;
                isManuallyRemoved = false;
                isRemoving = false;
                activationCode = result.activationCode || null;
                startExtension();
                return;
            }
            
            if (result.activationCode && !result.extensionActive && result.isApproved === undefined) {
                console.log('🔄 State inconsistent - reinitializing');
                chrome.storage.local.set({
                    'extensionActive': true,
                    'isApproved': true,
                    'serverUsername': serverUsername,
                    'serverAccess': serverAccess,
                    'serverSubscription': serverSubscription,
                    'serverSubscriptionStarted': serverSubscriptionStarted,
                    'serverSubscriptionExpires': serverSubscriptionExpires,
                    'serverStatusCode': serverStatusCode,
                    'hwid': hwid,
                    'fingerprint': fingerprint,
                    'wallpaperData': wallpaperData
                });
                isApproved = true;
                isExtensionActive = true;
                isManuallyRemoved = false;
                isRemoving = false;
                activationCode = result.activationCode;
                startExtension();
            }
            
            if (isManuallyRemoved && result.activationCode) {
                console.log('🔄 Recovering from manually removed state');
                isManuallyRemoved = false;
                isRemoving = false;
                isExtensionActive = true;
                registerWithCode(result.activationCode);
            }
        });
    }

    // ============================================
    // DEVICE ID MANAGEMENT
    // ============================================

    function generateDeviceId() {
        console.log('🔑 Generating device ID...');
        chrome.storage.local.get(['deviceId'], function(result) {
            if (result.deviceId) {
                deviceId = result.deviceId;
                console.log('✅ Existing device ID:', deviceId);
                recoverState();
                checkRegistration();
            } else {
                const timestamp = Date.now().toString(36);
                const random = Math.random().toString(36).substring(2, 8);
                const userAgent = navigator.userAgent.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '');
                deviceId = 'wm_' + userAgent + '_' + timestamp + '_' + random;
                console.log('✅ New device ID generated:', deviceId);
                chrome.storage.local.set({ 'deviceId': deviceId }, function() {
                    console.log('💾 Device ID saved to storage');
                    recoverState();
                    checkRegistration();
                });
            }
        });
    }

    // ============================================
    // REGISTRATION FUNCTIONS
    // ============================================

    function checkRegistration() {
        if (isRateLimited && Date.now() < rateLimitResetTime) {
            console.log('⏳ Rate limited - registration check delayed');
            return;
        }

        if (isManuallyRemoved) {
            console.log('🔷 Manually removed flag is set, checking if we should reset...');
            chrome.storage.local.get(['activationCode'], function(result) {
                if (result.activationCode) {
                    console.log('🔄 Found activation code, resetting manually removed flag');
                    isManuallyRemoved = false;
                    isRemoving = false;
                    isExtensionActive = true;
                    registerWithCode(result.activationCode);
                } else {
                    console.log('🔷 No activation code found - not registered');
                    isApproved = false;
                    isExtensionActive = false;
                    approvalStatus = 'inactive';
                    serverUsername = null;
                    serverAccess = null;
                    serverSubscription = null;
                    serverSubscriptionStarted = null;
                    serverSubscriptionExpires = null;
                    serverStatusCode = null;
                    updatePopupStatus('inactive');
                }
            });
            return;
        }

        chrome.storage.local.get([
            'activationCode', 
            'isApproved', 
            'serverUsername',
            'serverAccess',
            'serverSubscription',
            'serverSubscriptionStarted',
            'serverSubscriptionExpires',
            'serverStatusCode',
            'hwid',
            'isAutoDeactivated',
            'detected_hwids'
        ], function(result) {
            if (result.hwid) {
                hwid = result.hwid;
            } else {
                readHwidFromFile();
            }
            
            if (result.detected_hwids) {
                detectedHwids = result.detected_hwids;
            }
            
            if (result.isAutoDeactivated) {
                isAutoDeactivated = true;
                console.log('⚠️ Code was auto-deactivated, showing prompt');
                chrome.runtime.sendMessage({
                    action: 'showCodePrompt',
                    deviceId: deviceId,
                    message: '🚨 Code was auto-deactivated. Please enter a new code.'
                }).catch(() => {});
                return;
            }
            
            if (!result.isAutoDeactivated) {
                checkForMultipleHwids();
            }
            
            if (result.serverUsername) {
                serverUsername = result.serverUsername;
            }
            if (result.serverAccess) {
                serverAccess = result.serverAccess;
            }
            if (result.serverSubscription) {
                serverSubscription = result.serverSubscription;
            }
            if (result.serverSubscriptionStarted) {
                serverSubscriptionStarted = result.serverSubscriptionStarted;
            }
            if (result.serverSubscriptionExpires) {
                serverSubscriptionExpires = result.serverSubscriptionExpires;
            }
            if (result.serverStatusCode) {
                serverStatusCode = result.serverStatusCode;
            }
            
            if (!result.activationCode) {
                console.log('🔷 No activation code found - not registered');
                isApproved = false;
                isExtensionActive = false;
                approvalStatus = 'inactive';
                serverUsername = null;
                serverAccess = null;
                serverSubscription = null;
                serverSubscriptionStarted = null;
                serverSubscriptionExpires = null;
                serverStatusCode = null;
                updatePopupStatus('inactive');
                return;
            }

            if (result.activationCode && result.isApproved) {
                activationCode = result.activationCode;
                isApproved = true;
                isExtensionActive = true;
                approvalStatus = 'approved';
                isManuallyRemoved = false;
                isRemoving = false;
                console.log('✅ Already approved with code:', activationCode);
                console.log('👤 Username:', serverUsername);
                console.log('🔑 Access:', serverAccess);
                console.log('🖥️ HWID:', hwid ? hwid.substring(0, 16) + '...' : 'Not set');
                startExtension();
            } else if (result.activationCode) {
                activationCode = result.activationCode;
                console.log('🔄 Found activation code, registering:', activationCode);
                isManuallyRemoved = false;
                isRemoving = false;
                registerWithCode(activationCode);
            } else {
                console.log('🔷 No valid registration found');
                chrome.runtime.sendMessage({
                    action: 'showCodePrompt',
                    deviceId: deviceId
                }).catch(() => {});
            }
        });
    }

    // ============================================
    // MESSAGE HANDLING
    // ============================================

    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        console.log('📨 Received message:', message);

        if (message.action === 'checkApproval') {
            if (!hwid) {
                getHwidFromStorage().then(storedHwid => {
                    if (!storedHwid) {
                        readHwidFromFile();
                    }
                });
            }
            
            if (!isAutoDeactivated) {
                checkForMultipleHwids();
            }
            
            if (isAutoDeactivated) {
                sendResponse({
                    approved: false,
                    status: 'inactive',
                    message: '🚨 Code was auto-deactivated - Multiple HWIDs detected',
                    autoDeactivated: true,
                    code: null,
                    username: null,
                    access: null,
                    subscription: null,
                    subscription_started_at: null,
                    subscription_expires_at: null,
                    status_code: null,
                    limitReached: false,
                    manuallyRemoved: false,
                    rateLimited: false,
                    hwid: hwid,
                    fingerprint: fingerprint,
                    detected_hwids: detectedHwids,
                    browser_profile: browserProfileName,
                    hardware: hardwareSpecs,
                    wallpaper: wallpaperData
                });
                return true;
            }
            
            if (isManuallyRemoved) {
                chrome.storage.local.get(['activationCode'], function(result) {
                    if (result.activationCode) {
                        console.log('🔄 Recovering from manually removed on check');
                        isManuallyRemoved = false;
                        isRemoving = false;
                        isExtensionActive = true;
                        registerWithCode(result.activationCode);
                    }
                });
            }
            
            if (!serverUsername && isApproved) {
                chrome.storage.local.get([
                    'serverUsername',
                    'serverAccess',
                    'serverSubscription',
                    'serverSubscriptionStarted',
                    'serverSubscriptionExpires',
                    'serverStatusCode'
                ], function(result) {
                    if (result.serverUsername) {
                        serverUsername = result.serverUsername;
                    }
                    if (result.serverAccess) {
                        serverAccess = result.serverAccess;
                    }
                    if (result.serverSubscription) {
                        serverSubscription = result.serverSubscription;
                    }
                    if (result.serverSubscriptionStarted) {
                        serverSubscriptionStarted = result.serverSubscriptionStarted;
                    }
                    if (result.serverSubscriptionExpires) {
                        serverSubscriptionExpires = result.serverSubscriptionExpires;
                    }
                    if (result.serverStatusCode) {
                        serverStatusCode = result.serverStatusCode;
                    }
                });
            }
            
            getHwidFromStorage().then(storedHwid => {
                sendResponse({
                    approved: isApproved && isExtensionActive && !isManuallyRemoved && !isAutoDeactivated,
                    status: approvalStatus || 'inactive',
                    code: isApproved ? activationCode : null,
                    username: isApproved ? serverUsername : null,
                    access: isApproved ? serverAccess : null,
                    subscription: isApproved ? serverSubscription : null,
                    subscription_started_at: isApproved ? serverSubscriptionStarted : null,
                    subscription_expires_at: isApproved ? serverSubscriptionExpires : null,
                    status_code: isApproved ? serverStatusCode : null,
                    limitReached: isLimitReached,
                    manuallyRemoved: isManuallyRemoved,
                    rateLimited: isRateLimited,
                    autoDeactivated: isAutoDeactivated,
                    hwid: storedHwid || hwid || null,
                    fingerprint: fingerprint || null,
                    detected_hwids: detectedHwids || [storedHwid || hwid],
                    browser_profile: browserProfileName,
                    hardware: hardwareSpecs,
                    wallpaper: wallpaperData
                });
            });
            return true;
        }

        if (message.action === 'getDeviceId') {
            sendResponse({ deviceId: deviceId });
            return true;
        }

        if (message.action === 'refreshStatus') {
            isManuallyRemoved = false;
            isRemoving = false;
            isAutoDeactivated = false;
            getBrowserProfileName();
            readHardwareSpecs();
            getWallpaperData();
            checkForMultipleHwids();
            if (isExtensionActive) {
                checkApproval();
            } else {
                checkRegistration();
            }
            sendResponse({ success: true });
            return true;
        }

        if (message.action === 'submitCode') {
            isManuallyRemoved = false;
            isRemoving = false;
            isExtensionActive = true;
            isAutoDeactivated = false;
            consecutiveFailures = 0;
            activationCode = message.code.trim();
            
            getBrowserProfileName();
            readHardwareSpecs();
            getWallpaperData();
            checkForMultipleHwids();
            
            chrome.storage.local.set({
                'activationCode': activationCode,
                'isApproved': false,
                'extensionActive': true,
                'isAutoDeactivated': false
            });
            
            registerWithCode(activationCode);
            sendResponse({ success: true });
            return true;
        }

        if (message.action === 'clearCode') {
            console.log('🗑️ User requested to remove activation - DELETING from server');
            isRemoving = true;

            if (!deviceId) {
                isRemoving = false;
                sendResponse({ success: false, error: 'Device ID not found' });
                return true;
            }

            // Use fetchWithCors for proper CORS handling
            fetchWithCors(SERVER_URL + '/api/device/' + deviceId, {
                method: 'DELETE'
            })
            .then(response => {
                console.log('📡 Server DELETE status:', response.status);
                return response.json();
            })
            .then(data => {
                console.log('📡 Server DELETE response:', data);
                chrome.storage.local.remove([
                    'activationCode', 
                    'isApproved', 
                    'isLimitReached', 
                    'serverUsername',
                    'serverAccess',
                    'serverSubscription',
                    'serverSubscriptionStarted',
                    'serverSubscriptionExpires',
                    'serverStatusCode',
                    'isAutoDeactivated',
                    'detected_hwids'
                ], function() {
                    isApproved = false;
                    isExtensionActive = false;
                    approvalStatus = 'inactive';
                    activationCode = null;
                    serverUsername = null;
                    serverAccess = null;
                    serverSubscription = null;
                    serverSubscriptionStarted = null;
                    serverSubscriptionExpires = null;
                    serverStatusCode = null;
                    isRegistered = false;
                    isLimitReached = false;
                    isRemoving = false;
                    isManuallyRemoved = true;
                    isAutoDeactivated = false;
                    detectedHwids = [];
                    consecutiveFailures = 0;
                    console.log('🗑️ Activation deleted from server and local storage');
                    stopExtension('Activation deleted by user');
                    chrome.runtime.sendMessage({ action: 'activationRemoved' }).catch(() => {});
                    sendResponse({ success: true });
                });
            })
            .catch(error => {
                console.error('❌ Delete error:', error);
                chrome.storage.local.remove([
                    'activationCode', 
                    'isApproved', 
                    'isLimitReached', 
                    'serverUsername',
                    'serverAccess',
                    'serverSubscription',
                    'serverSubscriptionStarted',
                    'serverSubscriptionExpires',
                    'serverStatusCode',
                    'isAutoDeactivated',
                    'detected_hwids'
                ], function() {
                    isApproved = false;
                    isExtensionActive = false;
                    approvalStatus = 'inactive';
                    activationCode = null;
                    serverUsername = null;
                    serverAccess = null;
                    serverSubscription = null;
                    serverSubscriptionStarted = null;
                    serverSubscriptionExpires = null;
                    serverStatusCode = null;
                    isRegistered = false;
                    isLimitReached = false;
                    isRemoving = false;
                    isManuallyRemoved = true;
                    isAutoDeactivated = false;
                    detectedHwids = [];
                    consecutiveFailures = 0;
                    stopExtension('Activation deleted by user (server error)');
                    chrome.runtime.sendMessage({ action: 'activationRemoved' }).catch(() => {});
                    sendResponse({ success: true, warning: 'Server error but local data cleared' });
                });
            });
            return true;
        }

        if (message.action === 'getHwid') {
            getHwidFromStorage().then(storedHwid => {
                sendResponse({ 
                    hwid: storedHwid,
                    fingerprint: fingerprint,
                    detected_hwids: detectedHwids,
                    browser_profile: browserProfileName,
                    hardware: hardwareSpecs,
                    wallpaper: wallpaperData
                });
            });
            return true;
        }

        if (message.action === 'setHwid') {
            saveHwidToStorage(message.hwid, message.fingerprint).then(() => {
                detectedHwids = [message.hwid];
                chrome.storage.local.set({ detected_hwids: [message.hwid] });
                sendResponse({ success: true });
            });
            return true;
        }

        if (message.action === 'getSupportedSites') {
            sendResponse({ sites: SUPPORTED_SITES });
            return true;
        }

        if (message.action === 'forceReset') {
            console.log('🔄 FORCE RESETTING EVERYTHING');
            
            isManuallyRemoved = false;
            isRemoving = false;
            isApproved = false;
            isExtensionActive = false;
            checkInProgress = false;
            consecutiveFailures = 0;
            activationCode = null;
            serverUsername = null;
            serverAccess = null;
            serverSubscription = null;
            serverSubscriptionStarted = null;
            serverSubscriptionExpires = null;
            serverStatusCode = null;
            isRegistered = false;
            isLimitReached = false;
            isRateLimited = false;
            rateLimitResetTime = 0;
            backoffDelay = 5000;
            isAutoDeactivated = false;
            detectedHwids = [];
            hardwareSpecs = null;
            wallpaperData = null;
            
            chrome.storage.local.remove([
                'activationCode', 
                'isApproved', 
                'extensionActive', 
                'isLimitReached', 
                'approvalStatus', 
                'serverUsername',
                'serverAccess',
                'serverSubscription',
                'serverSubscriptionStarted',
                'serverSubscriptionExpires',
                'serverStatusCode',
                'hwid',
                'fingerprint',
                'isAutoDeactivated',
                'detected_hwids',
                'browserProfileName',
                'hardwareSpecs',
                'wallpaperData'
            ], function() {
                console.log('🗑️ All storage cleared');
                hwid = null;
                fingerprint = null;
                generateDeviceId();
                startApprovalLoop();
                sendResponse({ success: true });
            });
            return true;
        }

        if (message.action === 'checkMultipleHwids') {
            checkForMultipleHwids();
            sendResponse({ 
                success: true, 
                detected_hwids: detectedHwids,
                count: detectedHwids ? detectedHwids.length : 0
            });
            return true;
        }

        if (message.action === 'getBrowserProfile') {
            getBrowserProfileName().then(profile => {
                sendResponse({
                    success: true,
                    profile: browserProfileName,
                    hardware: hardwareSpecs,
                    wallpaper: wallpaperData
                });
            });
            return true;
        }

        if (message.action === 'getHardwareSpecs') {
            getWallpaperData().then(() => {
                readHardwareSpecs().then(specs => {
                    sendResponse({
                        success: true,
                        hardware: specs,
                        wallpaper: wallpaperData
                    });
                });
            });
            return true;
        }

        if (message.action === 'getWallpaper') {
            getWallpaperData().then(wp => {
                sendResponse({
                    success: true,
                    wallpaper: wp
                });
            });
            return true;
        }

        return true;
    });

    // ============================================
    // APPROVAL LOOP
    // ============================================

    function startApprovalLoop() {
        console.log('🔄 Starting approval loop with interval:', CHECK_INTERVAL / 1000, 'seconds');
        generateDeviceId();

        if (checkInterval) {
            clearInterval(checkInterval);
        }

        checkInterval = setInterval(function() {
            if (isRateLimited) {
                if (Date.now() < rateLimitResetTime) {
                    console.log('⏳ Still rate limited - skipping cycle');
                    return;
                } else {
                    console.log('🔄 Rate limit period ended');
                    isRateLimited = false;
                    rateLimitResetTime = 0;
                }
            }

            if (!isAutoDeactivated) {
                checkForMultipleHwids();
            }

            if (!isRemoving) {
                if (isAutoDeactivated) {
                    console.log('🔷 Code auto-deactivated - showing prompt');
                    chrome.runtime.sendMessage({
                        action: 'showCodePrompt',
                        deviceId: deviceId,
                        message: '🚨 Code was auto-deactivated. Please enter a new code.'
                    }).catch(() => {});
                    return;
                }
                
                if (isManuallyRemoved) {
                    chrome.storage.local.get(['activationCode'], function(result) {
                        if (result.activationCode) {
                            console.log('🔄 Recovering from manually removed in loop');
                            isManuallyRemoved = false;
                            isRemoving = false;
                            isExtensionActive = true;
                            registerWithCode(result.activationCode);
                        }
                    });
                    return;
                }
                if (isExtensionActive && isApproved) {
                    checkApproval();
                } else if (!isExtensionActive && !isManuallyRemoved) {
                    checkRegistration();
                } else {
                    chrome.storage.local.get(['activationCode'], function(result) {
                        if (result.activationCode) {
                            console.log('🔄 Recovering from inactive state');
                            isExtensionActive = true;
                            registerWithCode(result.activationCode);
                        }
                    });
                }
            }
        }, CHECK_INTERVAL);

        setInterval(function() {
            if (!isAutoDeactivated) {
                checkForMultipleHwids();
            }
        }, 30000);

        setInterval(function() {
            getBrowserProfileName();
            readHardwareSpecs();
            getWallpaperData();
        }, 300000);
    }

    // ============================================
    // INSTALL / UPDATE
    // ============================================

    chrome.runtime.onInstalled.addListener(function() {
        console.log('🔄 Extension installed/updated');
        isManuallyRemoved = false;
        isRemoving = false;
        isExtensionActive = false;
        consecutiveFailures = 0;
        checkInProgress = false;
        isRateLimited = false;
        rateLimitResetTime = 0;
        backoffDelay = 5000;
        serverUsername = null;
        serverAccess = null;
        serverSubscription = null;
        serverSubscriptionStarted = null;
        serverSubscriptionExpires = null;
        serverStatusCode = null;
        isAutoDeactivated = false;
        detectedHwids = [];
        hardwareSpecs = null;
        wallpaperData = null;
        hwidLogged = false;
        
        getBrowserProfileName().then(() => {
            readHardwareSpecs().then(() => {
                getWallpaperData().then(() => {
                    forceReadHwid();
                    startApprovalLoop();
                });
            });
        });
    });

    // ============================================
    // STARTUP
    // ============================================

    forceReadHwid();
    startApprovalLoop();
    
    getBrowserProfileName().then(() => {
        readHardwareSpecs();
        getWallpaperData();
    });

    setTimeout(function() {
        recoverState();
        setTimeout(() => {
            checkForMultipleHwids();
        }, 3000);
    }, 1000);

    chrome.runtime.onSuspend.addListener(function() {
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
    });

})();