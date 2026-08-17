// content.js - Enhanced automation (Fixed Form Scanner Loop)
// Chrome Extension version with approval system

(function() {
    'use strict';

    // ============================================
    // DETECT SITE
    // ============================================

    const hostname = window.location.hostname;
    const isWantmatures = hostname.includes('wantmatures.com');
    const isIamnaughty = hostname.includes('iamnaughty.com');
    const isSpicydesires = hostname.includes('spicydesires.com');
    const isCouples4sex = hostname.includes('couples4sex.com');
    const isLuvcougar = hostname.includes('luvcougar.com');
    const isIwantucougar = hostname.includes('iwantucougar.com');
    const isFlirt = hostname.includes('flirt.com');
    const isUpforit = hostname.includes('upforit.com');
    const isGetnaughty = hostname.includes('getnaughty.com');
    const isCheekylovers = hostname.includes('cheekylovers.com');
    const isUpair = hostname.includes('upair.com');
    const isBemymilf = hostname.includes('bemymilf.com');

    let siteName = 'Wantmatures';
    let siteKey = 'wantmatures';
    if (isIamnaughty) { siteName = 'Iamnaughty'; siteKey = 'iamnaughty'; }
    else if (isSpicydesires) { siteName = 'SpicyDesires'; siteKey = 'spicydesires'; }
    else if (isCouples4sex) { siteName = 'Couples4Sex'; siteKey = 'couples4sex'; }
    else if (isLuvcougar) { siteName = 'LuvCougar'; siteKey = 'luvcougar'; }
    else if (isIwantucougar) { siteName = 'IWantUCougar'; siteKey = 'iwantucougar'; }
    else if (isFlirt) { siteName = 'Flirt'; siteKey = 'flirt'; }
    else if (isUpforit) { siteName = 'UpForIt'; siteKey = 'upforit'; }
    else if (isGetnaughty) { siteName = 'GetNaughty'; siteKey = 'getnaughty'; }
    else if (isCheekylovers) { siteName = 'CheekyLovers'; siteKey = 'cheekylovers'; }
    else if (isUpair) { siteName = 'UpAir'; siteKey = 'upair'; }
    else if (isBemymilf) { siteName = 'BeMyMilf'; siteKey = 'bemymilf'; }

    const isSupportedSite = isWantmatures || isIamnaughty || isSpicydesires || isCouples4sex || isLuvcougar || isIwantucougar || isFlirt || isUpforit || isGetnaughty || isCheekylovers || isUpair || isBemymilf;

    if (!isSupportedSite) {
        console.log('❌ Unsupported site:', hostname);
        return;
    }

    // ============================================
    // DETECT MOBILE
    // ============================================

    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                     window.location.hostname.includes('m.') ||
                     window.innerWidth <= 768;

    console.log(`📱 Mobile mode: ${isMobile ? 'YES' : 'NO'}`);
    console.log(`🌐 Site: ${siteName} (${siteKey})`);

    // ============================================
    // CHECK APPROVAL STATUS FROM BACKGROUND
    // ============================================

    let isApproved = false;
    let approvalChecked = false;
    let isDeactivated = false;

    function checkApprovalStatus() {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.log('🔷 Approval check timeout - assuming not approved');
                isApproved = false;
                approvalChecked = true;
                resolve(false);
            }, 3000);
            
            chrome.runtime.sendMessage({ action: 'checkApproval' }, function(response) {
                clearTimeout(timeout);
                
                if (response) {
                    isApproved = response.approved || false;
                    if (response.manuallyRemoved) {
                        isApproved = false;
                        isDeactivated = true;
                    }
                    approvalChecked = true;
                    console.log(`🔷 Approval status: ${isApproved ? '✅ APPROVED' : '❌ NOT APPROVED'}`);
                    resolve(isApproved);
                } else {
                    console.log('🔷 No response from background, assuming not approved');
                    isApproved = false;
                    approvalChecked = true;
                    resolve(false);
                }
            });
        });
    }

    // Listen for activation/deactivation messages
    chrome.runtime.onMessage.addListener(function(message) {
        if (message.action === 'activate') {
            console.log('🔷 Received activate message - Extension approved!');
            isApproved = true;
            isDeactivated = false;
            approvalChecked = true;
            const notification = document.getElementById('auto-clicker-notification');
            if (notification) {
                notification.remove();
            }
            checkApprovalStatus().then(approved => {
                if (approved) {
                    const existingGUI = document.getElementById('auto-clicker-gui');
                    if (!existingGUI) {
                        createGUI();
                    }
                }
            });
        }
        
        if (message.action === 'deactivate') {
            console.log('🔷 Received deactivate message - Extension deactivated!');
            isApproved = false;
            isDeactivated = true;
            approvalChecked = true;
            const gui = document.getElementById('auto-clicker-gui');
            if (gui) {
                gui.remove();
            }
            showDeactivationNotification(message.reason || 'Extension deactivated');
        }
    });

    function showDeactivationNotification(reason) {
        const existing = document.getElementById('auto-clicker-notification');
        if (existing) {
            existing.remove();
        }
        
        const notification = document.createElement('div');
        notification.id = 'auto-clicker-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 20px;
            z-index: 999999;
            background: rgba(0, 0, 0, 0.9);
            padding: 15px 20px;
            border-radius: 12px;
            border: 2px solid #ff6b6b;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.9);
            font-family: Arial, sans-serif;
            color: #ff6b6b;
            font-size: 14px;
            max-width: 350px;
            text-align: center;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
        `;
        notification.innerHTML = `
            <div style="font-size: 24px; margin-bottom: 8px;">🔐</div>
            <div style="font-weight: bold; margin-bottom: 4px;">Extension Deactivated</div>
            <div style="color: #aaa; font-size: 12px;">${reason || 'Please reactivate through the popup.'}</div>
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = '0';
                notification.style.transition = 'opacity 1s';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 1000);
            }
        }, 10000);
    }

    // ============================================
    // ALL COUNTRY CITY LISTS
    // ============================================

    const cityLists = {
        'UK': [
            'London', 'Birmingham', 'Manchester', 'Glasgow', 'Liverpool',
            'Leeds', 'Sheffield', 'Edinburgh', 'Bristol', 'Nottingham',
            'Leicester', 'Newcastle upon Tyne', 'Cardiff', 'Belfast', 'Brighton',
            'Oxford', 'Cambridge', 'York', 'Bath', 'Chester',
            'Aberdeen', 'Dundee', 'Swansea', 'Portsmouth', 'Southampton',
            'Plymouth', 'Wolverhampton', 'Derby', 'Stoke-on-Trent', 'Coventry'
        ],
        'US': [
            'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix',
            'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose',
            'Austin', 'Jacksonville', 'Fort Worth', 'Columbus', 'Charlotte',
            'San Francisco', 'Indianapolis', 'Seattle', 'Denver', 'Washington DC',
            'Boston', 'Memphis', 'Nashville', 'Portland', 'Oklahoma City',
            'Las Vegas', 'Detroit', 'Baltimore', 'Milwaukee', 'Albuquerque'
        ],
        'AU': [
            'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide',
            'Gold Coast', 'Newcastle', 'Canberra', 'Wollongong', 'Hobart',
            'Townsville', 'Cairns', 'Geelong', 'Darwin', 'Launceston',
            'Toowoomba', 'Ballarat', 'Bendigo', 'Rockhampton', 'Mackay'
        ],
        'CA': [
            'Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Edmonton',
            'Ottawa', 'Mississauga', 'Winnipeg', 'Quebec City', 'Hamilton',
            'Surrey', 'Brampton', 'Halifax', 'Laval', 'London',
            'Markham', 'Vaughan', 'Gatineau', 'Longueuil', 'Richmond'
        ],
        'FR': [
            'Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice',
            'Nantes', 'Strasbourg', 'Montpellier', 'Bordeaux', 'Lille',
            'Rennes', 'Reims', 'Saint-Étienne', 'Toulon', 'Grenoble',
            'Dijon', 'Angers', 'Nîmes', 'Villeurbanne', 'Le Havre'
        ],
        'DE': [
            'Berlin', 'Hamburg', 'Munich', 'Cologne', 'Frankfurt',
            'Stuttgart', 'Düsseldorf', 'Dortmund', 'Essen', 'Leipzig',
            'Bremen', 'Dresden', 'Hanover', 'Nuremberg', 'Duisburg',
            'Bochum', 'Wuppertal', 'Bielefeld', 'Bonn', 'Münster',
            'Karlsruhe', 'Mannheim', 'Augsburg', 'Wiesbaden', 'Gelsenkirchen',
            'Mönchengladbach', 'Braunschweig', 'Chemnitz', 'Kiel', 'Aachen'
        ],
        'NL': [
            'Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven',
            'Tilburg', 'Groningen', 'Almere', 'Breda', 'Nijmegen',
            'Enschede', 'Haarlem', 'Arnhem', 'Zaanstad', 'Amersfoort',
            'Apeldoorn', 'Hoofddorp', 'Maastricht', 'Leiden', 'Dordrecht',
            'Zoetermeer', 'Zwolle', 'Deventer', 'Alkmaar', 'Heerlen',
            'Venlo', 'Leeuwarden', 'Hilversum', 'Amstelveen', 'Roosendaal'
        ],
        'BE': [
            'Brussels', 'Antwerp', 'Ghent', 'Charleroi', 'Liège',
            'Bruges', 'Namur', 'Leuven', 'Mons', 'Mechelen',
            'Aalst', 'Kortrijk', 'Hasselt', 'Ostend', 'Sint-Niklaas',
            'Tournai', 'Genk', 'Seraing', 'Roeselare', 'Verviers',
            'Mouscron', 'La Louvière', 'Dendermonde', 'Wavre', 'Binche',
            'Lokeren', 'Knokke-Heist', 'Nivelles', 'Ath', 'Geraardsbergen'
        ],
        'IT': [
            'Rome', 'Milan', 'Naples', 'Turin', 'Palermo',
            'Genoa', 'Bologna', 'Florence', 'Bari', 'Catania',
            'Venice', 'Verona', 'Messina', 'Padua', 'Trieste',
            'Brescia', 'Taranto', 'Prato', 'Modena', 'Reggio Calabria',
            'Parma', 'Perugia', 'Livorno', 'Cagliari', 'Foggia',
            'Ravenna', 'Salerno', 'Rimini', 'Ferrara', 'Monza'
        ]
    };

    // ============================================
    // GIRL NAMES FOR EMAIL GENERATION
    // ============================================

    const girlNames = [
        'Emma', 'Olivia', 'Ava', 'Isabella', 'Sophia', 'Mia', 'Charlotte', 'Amelia',
        'Harper', 'Evelyn', 'Abigail', 'Emily', 'Elizabeth', 'Mila', 'Ella', 'Avery',
        'Sofia', 'Camila', 'Aria', 'Scarlett', 'Victoria', 'Madison', 'Luna', 'Grace',
        'Chloe', 'Penelope', 'Layla', 'Riley', 'Zoey', 'Nora', 'Lily', 'Eleanor',
        'Hannah', 'Lillian', 'Addison', 'Aubrey', 'Ellie', 'Stella', 'Natalie', 'Zoe',
        'Leah', 'Hazel', 'Violet', 'Aurora', 'Savannah', 'Audrey', 'Brooklyn', 'Bella',
        'Claire', 'Skylar', 'Lucy', 'Paisley', 'Everly', 'Anna', 'Caroline', 'Nova',
        'Genesis', 'Emilia', 'Kennedy', 'Samantha', 'Maya', 'Willow', 'Kinsley', 'Naomi',
        'Sarah', 'Allison', 'Gabriella', 'Alice', 'Madelyn', 'Cora', 'Ruby', 'Eva',
        'Serenity', 'Autumn', 'Adeline', 'Hailey', 'Gianna', 'Valentina', 'Isla', 'Eliana',
        'Quinn', 'Nevaeh', 'Ivy', 'Sadie', 'Piper', 'Lydia', 'Alexa', 'Josephine',
        'Emery', 'Julia', 'Delilah', 'Arianna', 'Vivian', 'Kaylee', 'Sophie', 'Brielle',
        'Madeline', 'Peyton', 'Rylee', 'Clara', 'Hadley', 'Melanie', 'Mackenzie', 'Reagan',
        'Adalynn', 'Liliana', 'Aubree', 'Jade', 'Katherine', 'Isabel', 'Charlie', 'Summer'
    ];

    // ============================================
    // EMAIL DOMAINS
    // ============================================

    const emailDomains = [
        'hushmail.com',
        'tutanota.com',
        'optonline.net',
        'digitalocean.com'
    ];

    // ============================================
    // SETTINGS (SITE-SPECIFIC KEYS)
    // ============================================

    let settings = {
        country: 'US',
        timerMinutes: 5,
        stopOnGetExtra: true, // DEFAULT ON
        // New editable settings
        userAge: 28,
        userPassword: '12341234'
    };

    let isRunning = false;
    let isLoggingOut = false;
    let currentEmail = '';
    let registrationEmail = '';
    let isEmailLoaded = false;
    let isWaitingForGetExtra = false;
    let waitTimerInterval = null;
    let getExtraDetected = false;
    let getExclusiveDetected = false;
    let registrationComplete = false;
    let timerStarted = false;
    let waitStartTime = 0;
    let totalWaitTime = 5 * 60;
    let refreshInterval = 60;
    let refreshCount = 0;
    let lastRefreshTime = 0;
    let isRefreshing = false;
    let refreshTriggered = false;
    let exclusiveDetectedTime = 0;
    let logoutInProgress = false;
    let waitLoopActive = false;
    let statusElement = null;
    let startButtonElement = null;
    let emailDisplayElement = null;
    let forceLogoutTriggered = false;
    let locationHelperDone = false;
    let locationHelperAttempts = 0;
    let locationHelperRunning = false;
    let shouldAutoRestart = false;
    let stopRequested = false;
    let getExtraEmailSaved = false;
    let registrationFailed = false;
    let isStoppedByGetExtra = false; 
    let justRegistered = false; // NEW: Blocks form scanner after successful registration

    let stopReason = '';
    let stopReasonDetails = '';

    let getExtraDetectedTime = 0;
    let getExtraDetectedElapsed = 0;

    let registrationFormDetected = false;
    let registrationAttempted = false;
    let formDetectionInterval = null;
    let isFormDetectionActive = false;
    let formScannerRetries = 0;
    let maxFormScannerRetries = 10;

    let locationHelperCheckDone = false;
    let locationHelperCheckStartTime = 0;
    let locationHelperCheckTriggered = false;

    let autoRestartTimer = null;
    let autoRestartCountdown = 0;
    let isWaitingForRestart = false;

    let regButtonClicked = false;

    // Avatar scanner variables
    let avatarScannerInterval = null;
    let avatarScannerActive = false;
    let restartStuckDetected = false;
    let forceLogoutTriggeredByScanner = false;

    // Yes Continue scanner
    let yesContinueScannerInterval = null;
    let yesContinueScannerActive = false;
    let yesContinueDetected = false;

    // ============================================
    // GET EXTRA DATA STORAGE WITH METADATA
    // ============================================

    function getGetExtraDataKey() { return `${siteKey}_getextra_data`; }

    function loadGetExtraData() {
        return new Promise((resolve) => {
            chrome.storage.local.get([getGetExtraDataKey()], function(result) {
                try {
                    const saved = result[getGetExtraDataKey()] || '[]';
                    const data = JSON.parse(saved);
                    // Handle old format (plain emails)
                    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'string') {
                        // Convert old format to new format
                        const converted = data.map(email => ({
                            email: email,
                            timestamp: Date.now(),
                            waitTime: 0,
                            date: getFormattedDate(),
                            site: getSiteUrl(),
                            country: settings.country
                        }));
                        saveGetExtraData(converted);
                        resolve(converted);
                        return;
                    }
                    resolve(Array.isArray(data) ? data : []);
                } catch (error) {
                    console.error(`❌ [${siteName}] Failed to load Get Extra data:`, error);
                    resolve([]);
                }
            });
        });
    }

    function saveGetExtraData(data) {
        return new Promise((resolve) => {
            try {
                const obj = {};
                obj[getGetExtraDataKey()] = JSON.stringify(data);
                chrome.storage.local.set(obj, function() {
                    resolve(true);
                });
            } catch (error) {
                console.error(`❌ [${siteName}] Failed to save Get Extra data:`, error);
                resolve(false);
            }
        });
    }

    // Legacy function for compatibility
    function loadGetExtraEmailsSync() {
        return new Promise((resolve) => {
            chrome.storage.local.get([getGetExtraDataKey()], function(result) {
                try {
                    const saved = result[getGetExtraDataKey()] || '[]';
                    const data = JSON.parse(saved);
                    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'string') {
                        resolve(data);
                        return;
                    }
                    resolve(Array.isArray(data) ? data.map(item => item.email) : []);
                } catch (error) {
                    resolve([]);
                }
            });
        });
    }

    function getFormattedDate(timestamp) {
        const date = timestamp ? new Date(timestamp) : new Date();
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = days[date.getDay()];
        const month = months[date.getMonth()];
        const dayNum = date.getDate();
        return `${day} ${month} ${dayNum}`;
    }

    function addToGetExtraList(email, waitTime = 0) {
        if (!email) {
            console.error('❌ Cannot add empty email');
            return false;
        }

        email = email.trim();

        // Load existing emails with their data
        loadGetExtraData().then(getExtraData => {
            // Check if email already exists
            if (getExtraData.some(item => item.email === email)) {
                console.log(`ℹ️ [${siteName}] Email already in Get Extra list: ${email}`);
                return true;
            }

            // Add new entry with timestamp and wait time
            getExtraData.push({
                email: email,
                timestamp: Date.now(),
                waitTime: waitTime || 0,
                date: getFormattedDate(),
                site: getSiteUrl(),
                country: settings.country
            });

            saveGetExtraData(getExtraData).then(success => {
                if (success) {
                    console.log(`✅ [${siteName}] Added to Get Extra list: ${email} (wait time: ${formatTime(waitTime)})`);
                    console.log(`📊 [${siteName}] Total Get Extra emails: ${getExtraData.length}`);
                    updateGetExtraDisplay();
                }
            });
        });

        return true;
    }

    function updateGetExtraDisplay() {
        loadGetExtraData().then(data => {
            const display = document.getElementById('get-extra-count');
            if (display) {
                display.textContent = `📋 ${data.length}`;
                display.style.color = '#FF9800';
            }
        });
    }

    function formatEmailsForCopy() {
        return new Promise((resolve) => {
            loadGetExtraData().then(data => {
                const siteUrl = getSiteUrl();
                const country = settings.country;

                if (data.length === 0) {
                    resolve('No emails saved');
                    return;
                }

                // If data has metadata, use it
                if (data.length > 0 && data[0].waitTime !== undefined) {
                    resolve(data.map(item => {
                        const waitTime = formatTime(item.waitTime || 0);
                        const date = item.date || getFormattedDate(item.timestamp);
                        const site = item.site || siteUrl;
                        const countryVal = item.country || country;
                        return `${item.email}\t${site}\t${countryVal}\t${date}\t${waitTime}`;
                    }).join('\n'));
                } else {
                    // Fallback to old format
                    resolve(data.map(item => {
                        return `${item.email}\t${siteUrl}\t${country}\t${getFormattedDate()}\t0s`;
                    }).join('\n'));
                }
            });
        });
    }

    function copyGetExtraEmails() {
        loadGetExtraData().then(data => {
            if (data.length === 0) {
                const status = document.querySelector('#auto-clicker-gui .gui-status');
                if (status) {
                    status.textContent = '⚠️ No emails';
                    status.style.color = '#ffa500';
                    setTimeout(() => {
                        status.textContent = 'Ready';
                        status.style.color = '#aaa';
                    }, 2000);
                }
                return;
            }

            formatEmailsForCopy().then(formattedText => {
                navigator.clipboard.writeText(formattedText).then(() => {
                    const status = document.querySelector('#auto-clicker-gui .gui-status');
                    if (status) {
                        status.textContent = `✅ Copied ${data.length}`;
                        status.style.color = '#4CAF50';
                        setTimeout(() => {
                            status.textContent = 'Ready';
                            status.style.color = '#aaa';
                        }, 3000);
                    }
                }).catch(() => {
                    const textarea = document.createElement('textarea');
                    textarea.value = formattedText;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    const status = document.querySelector('#auto-clicker-gui .gui-status');
                    if (status) {
                        status.textContent = `✅ Copied ${data.length}`;
                        status.style.color = '#4CAF50';
                        setTimeout(() => {
                            status.textContent = 'Ready';
                            status.style.color = '#aaa';
                        }, 3000);
                    }
                });
            });
        });
    }

    function clearGetExtraEmails() {
        return new Promise((resolve) => {
            const obj = {};
            obj[getGetExtraDataKey()] = '[]';
            chrome.storage.local.set(obj, function() {
                console.log(`🗑️ [${siteName}] Get Extra emails cleared`);
                updateGetExtraDisplay();
                resolve(true);
            });
        });
    }

    // ============================================
    // COOKIE DELETION FUNCTION
    // ============================================

    function deleteSiteCookies() {
        console.log(`🍪 [${siteName}] Deleting all cookies for ${hostname}...`);

        try {
            const cookies = document.cookie.split(';');
            let deletedCount = 0;

            for (let cookie of cookies) {
                const name = cookie.split('=')[0].trim();
                if (name) {
                    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${hostname}`;
                    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${hostname}`;
                    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
                    deletedCount++;
                }
            }

            console.log(`🍪 [${siteName}] Deleted ${deletedCount} cookies from ${hostname}`);
            return true;
        } catch (error) {
            console.error(`❌ [${siteName}] Failed to delete cookies:`, error);
            return false;
        }
    }

    // ============================================
    // SITE-SPECIFIC STORAGE KEYS
    // ============================================

    function getStorageKey(baseKey) {
        return `${siteKey}_${baseKey}`;
    }

    function chromeSetValue(key, value) {
        return new Promise((resolve) => {
            const obj = {};
            obj[key] = value;
            chrome.storage.local.set(obj, function() {
                resolve();
            });
        });
    }

    function chromeGetValue(key, defaultValue) {
        return new Promise((resolve) => {
            chrome.storage.local.get([key], function(result) {
                resolve(result[key] !== undefined ? result[key] : defaultValue);
            });
        });
    }

    function chromeDeleteValue(key) {
        return new Promise((resolve) => {
            chrome.storage.local.remove([key], function() {
                resolve();
            });
        });
    }

    // Load settings
    async function loadSettings() {
        settings.country = await chromeGetValue(getStorageKey('country'), 'US');
        settings.timerMinutes = parseInt(await chromeGetValue(getStorageKey('timerMinutes'), 5)) || 5;
        if (settings.timerMinutes < 1) settings.timerMinutes = 1;
        totalWaitTime = settings.timerMinutes * 60;
        settings.stopOnGetExtra = await chromeGetValue(getStorageKey('stopOnGetExtra'), true); // DEFAULT ON
        // Load age and password settings
        settings.userAge = parseInt(await chromeGetValue(getStorageKey('userAge'), 28)) || 28;
        settings.userPassword = await chromeGetValue(getStorageKey('userPassword'), '12341234');
        console.log('✅ Settings loaded:', settings);
    }

    function getTimerStateKey() { return getStorageKey('timer_state'); }
    function getAutoRestartKey() { return getStorageKey('auto_restart'); }
    function getEmailKey() { return getStorageKey('email'); }

    // ============================================
    // DUAL COUNTRY TARGETS
    // ============================================

    const TARGET_COUNTRIES_GROUP1 = [
        { name: 'United States', code: 'USA' },
        { name: 'UK', code: 'GBR' },
        { name: 'Australia', code: 'AUS' },
        { name: 'Canada', code: 'CAN' },
        { name: 'France', code: 'FRA' }
    ];

    const TARGET_COUNTRIES_GROUP2 = [
        { name: 'Poland', code: 'POL' },
        { name: 'Spain', code: 'ESP' },
        { name: 'Italy', code: 'ITA' },
        { name: 'Germany', code: 'DEU' },
        { name: 'Switzerland', code: 'CHE' },
        { name: 'Belgium', code: 'BEL' },
        { name: 'Netherlands', code: 'NLD' },
        { name: 'Austria', code: 'AUT' },
        { name: 'Sweden', code: 'SWE' },
        { name: 'Norway', code: 'NOR' },
        { name: 'Denmark', code: 'DNK' },
        { name: 'Finland', code: 'FIN' },
        { name: 'Czech Republic', code: 'CZE' },
        { name: 'Portugal', code: 'PRT' },
        { name: 'Romania', code: 'ROU' },
        { name: 'Hungary', code: 'HUN' },
        { name: 'Greece', code: 'GRC' }
    ];

    function getTargetCountries() {
        const group1Countries = ['US', 'UK', 'AU', 'CA', 'FR'];
        if (group1Countries.includes(settings.country)) {
            return TARGET_COUNTRIES_GROUP1;
        } else {
            return TARGET_COUNTRIES_GROUP2;
        }
    }

    function getTargetCount() {
        return getTargetCountries().length;
    }

    function getCountryGroupLabel() {
        const group1Countries = ['US', 'UK', 'AU', 'CA', 'FR'];
        if (group1Countries.includes(settings.country)) {
            return '5 Countries';
        } else {
            return '17 European Countries';
        }
    }

    function getCities() {
        return cityLists[settings.country] || cityLists['US'];
    }

    // ============================================
    // EMAIL GENERATION
    // ============================================

    function generateEmail() {
        let randomDigits = '';
        for (let i = 0; i < 20; i++) {
            randomDigits += Math.floor(Math.random() * 10).toString();
        }
        const name = girlNames[Math.floor(Math.random() * girlNames.length)];
        const domain = emailDomains[Math.floor(Math.random() * emailDomains.length)];
        const email = `${randomDigits}${name}@${domain}`;
        console.log(`📧 Generated email: ${email}`);
        return email;
    }

    function saveEmailToStorage(email) {
        currentEmail = email;
        registrationEmail = email;
        chromeSetValue(getEmailKey(), email);
        return email;
    }

    function getCurrentEmail() {
        return currentEmail;
    }

    function getRegistrationEmail() {
        return registrationEmail || currentEmail;
    }

    function refreshEmail() {
        const newEmail = generateEmail();
        saveEmailToStorage(newEmail);
        console.log(`📧 Refreshed email: ${newEmail}`);
        return newEmail;
    }

    function updateEmailDisplay() {
        const emailDisplay = document.getElementById('email-display');
        const emailInput = document.getElementById('email-input');
        const displayEmail = registrationEmail || currentEmail;
        if (emailDisplay && displayEmail) {
            emailDisplay.textContent = `📧 ${displayEmail}`;
            emailDisplay.style.color = '#4CAF50';
        }
        if (emailInput && displayEmail) {
            emailInput.value = displayEmail;
        }
    }

    function setStopReason(reason, details = '') {
        stopReason = reason;
        stopReasonDetails = details;
        console.log(`🛑 STOP REASON: ${reason}${details ? ' - ' + details : ''}`);
        updateStopReasonDisplay();
    }

    function getStopReasonDisplay() {
        if (!stopReason) return 'No stop reason';
        let display = stopReason;
        if (stopReasonDetails) {
            display += `: ${stopReasonDetails}`;
        }
        return display;
    }

    function updateStopReasonDisplay() {
        const display = document.getElementById('stop-reason-display');
        if (display) {
            if (stopReason) {
                display.textContent = `🛑 ${getStopReasonDisplay()}`;
                display.style.color = '#ff6b6b';
                display.style.display = 'block';
                display.style.fontWeight = 'bold';
            } else {
                display.textContent = '✅ Running';
                display.style.color = '#4CAF50';
                display.style.display = 'block';
                display.style.fontWeight = 'normal';
            }
        }
    }

    function getSiteUrl() {
        return window.location.hostname;
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}m${secs}s`;
    }

    // ============================================
    // FIND GET EXTRA / GET EXCLUSIVE BUTTONS
    // ============================================

    function findGetExtraButton() {
        const elements = document.querySelectorAll('.Rq.hjE');
        for (let el of elements) {
            const text = el.textContent ? el.textContent.trim() : '';
            if (text === 'Get extra!' || text === 'Get extra') {
                const parent = el.closest('button') || el.closest('a');
                if (parent) {
                    console.log('🎯 Found Get Extra button via .Rq.hjE class');
                    return parent;
                }
                return el;
            }
        }

        const buttons = document.querySelectorAll('button, a, div[role="button"]');
        for (let element of buttons) {
            const text = element.textContent ? element.textContent.trim() : '';
            if (text === 'Get extra!' || text === 'Get extra' || text === 'Get Extra!' || text === 'Get Extra') {
                console.log('🎯 Found Get Extra button by text');
                return element;
            }
        }

        return null;
    }

    function findGetExclusiveButton() {
        const elements = document.querySelectorAll('.Rq.hjE');
        for (let el of elements) {
            const text = el.textContent ? el.textContent.trim() : '';
            if (text === 'Get exclusive' || text === 'Get Exclusive') {
                const parent = el.closest('button') || el.closest('a');
                if (parent) {
                    console.log('🎯 Found Get Exclusive button via .Rq.hjE class');
                    return parent;
                }
                return el;
            }
        }

        const buttons = document.querySelectorAll('button, a, div[role="button"]');
        for (let element of buttons) {
            const text = element.textContent ? element.textContent.trim() : '';
            if (text === 'Get exclusive' || text === 'Get Exclusive') {
                console.log('🎯 Found Get Exclusive button by text');
                return element;
            }
        }

        return null;
    }

    function checkForButtons() {
        const getExtra = findGetExtraButton();
        const getExclusive = findGetExclusiveButton();

        return {
            hasGetExtra: getExtra !== null,
            hasGetExclusive: getExclusive !== null,
            getExtraElement: getExtra,
            getExclusiveElement: getExclusive
        };
    }

    // ============================================
    // YES CONTINUE SCANNER
    // ============================================

    function startYesContinueScanner(status, emailDisplay) {
        if (yesContinueScannerActive) return;
        if (stopRequested) return;
        if (isRunning) return;
        if (isStoppedByGetExtra) return; // BLOCKED BY STOP FLAG

        yesContinueScannerActive = true;
        yesContinueDetected = false;
        console.log('✅ [Yes Continue Scanner] Starting - monitoring for "Yes Continue"...');

        if (yesContinueScannerInterval) {
            clearInterval(yesContinueScannerInterval);
            yesContinueScannerInterval = null;
        }

        // Check immediately
        checkForYesContinue(status, emailDisplay);

        yesContinueScannerInterval = setInterval(() => {
            if (stopRequested) {
                stopYesContinueScanner();
                return;
            }
            if (isRunning) {
                stopYesContinueScanner();
                return;
            }
            if (isLoggingOut || logoutInProgress) {
                return;
            }
            if (isStoppedByGetExtra) {
                stopYesContinueScanner();
                return;
            }

            checkForYesContinue(status, emailDisplay);
        }, 2000);
    }

    function stopYesContinueScanner() {
        if (yesContinueScannerInterval) {
            clearInterval(yesContinueScannerInterval);
            yesContinueScannerInterval = null;
        }
        yesContinueScannerActive = false;
        console.log('✅ [Yes Continue Scanner] Stopped');
    }

    function checkForYesContinue(status, emailDisplay) {
        // Only check when not in wait state
        if (isWaitingForGetExtra) return;
        if (registrationComplete) return;
        if (timerStarted) return;
        if (isRunning) return;
        if (isLoggingOut || logoutInProgress) return;

        // Look for "Yes Continue" button or text
        const allElements = document.querySelectorAll('button, a, div[role="button"], input[type="button"], input[type="submit"], .btn, .button');
        let yesContinueFound = false;
        let yesContinueElement = null;

        for (let el of allElements) {
            const text = el.textContent ? el.textContent.trim() : '';
            const value = el.value || '';
            const combined = text + ' ' + value;

            if (combined.includes('Yes Continue') ||
                combined.includes('Yes, Continue') ||
                (combined.includes('Continue') && !combined.includes('No'))) {
                // Check if visible
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    yesContinueFound = true;
                    yesContinueElement = el;
                    console.log(`✅ [Yes Continue Scanner] Found "Yes Continue" on element: "${text || value}"`);
                    break;
                }
            }
        }

        // Also check for any element with exact "Yes Continue" text
        if (!yesContinueFound) {
            const allElements2 = document.querySelectorAll('*');
            for (let el of allElements2) {
                const text = el.textContent ? el.textContent.trim() : '';
                if (text === 'Yes Continue' || text === 'Yes, Continue' || text === 'Continue') {
                    // Check if it's a clickable element
                    const isClickable = el.tagName === 'BUTTON' || el.tagName === 'A' ||
                                       el.closest('button') || el.closest('a') ||
                                       el.getAttribute('role') === 'button';
                    if (isClickable) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            yesContinueFound = true;
                            yesContinueElement = el.closest('button') || el.closest('a') || el;
                            console.log(`✅ [Yes Continue Scanner] Found "Yes Continue" via text: "${text}"`);
                            break;
                        }
                    }
                }
            }
        }

        if (yesContinueFound && !yesContinueDetected) {
            console.log('🎯 [Yes Continue Scanner] YES CONTINUE DETECTED!');
            yesContinueDetected = true;

            if (status) {
                status.textContent = '✅ Yes Continue - Restarting...';
                status.style.color = '#4CAF50';
                status.style.fontWeight = 'bold';
            }

            setStopReason('✅ Yes Continue detected');

            // Stop the scanner
            stopYesContinueScanner();

            // Click the button
            if (yesContinueElement) {
                console.log('🖱️ [Yes Continue Scanner] Clicking "Yes Continue"...');
                yesContinueElement.click();
            }

            // Wait and then trigger restart
            setTimeout(() => {
                if (!stopRequested) {
                    console.log('🔄 [Yes Continue Scanner] Triggering restart after "Yes Continue"...');

                    // Generate new email
                    const newEmail = refreshEmail();
                    if (emailDisplay) {
                        emailDisplay.textContent = `📧 ${newEmail}`;
                        emailDisplay.style.color = '#4CAF50';
                    }
                    const emailInput = document.getElementById('email-input');
                    if (emailInput) {
                        emailInput.value = newEmail;
                    }

                    // Reset state
                    registrationComplete = false;
                    timerStarted = false;
                    getExtraDetected = false;
                    getExclusiveDetected = false;
                    waitLoopActive = false;
                    isRunning = false;
                    getExtraEmailSaved = false;
                    registrationAttempted = false;
                    registrationFormDetected = false;
                    regButtonClicked = false;
                    clearTimerState();

                    // Reload page
                    chromeSetValue(getAutoRestartKey(), 'true');
                    window._autoRestarting = true;
                    window.location.href = getHomepageUrl();
                }
            }, 1500);
        }
    }

    // ============================================
    // CLICK COOKIE ACCEPT
    // ============================================

    function clickCookieAccept() {
        const cookieButton = document.querySelector('button.cookie-btn__accept');
        if (cookieButton) {
            cookieButton.click();
            console.log('✅ Clicked cookie accept');
            return true;
        }

        const allButtons = document.querySelectorAll('button');
        for (let button of allButtons) {
            const text = button.textContent ? button.textContent.trim() : '';
            if (text === 'Yes, Continue' || text === 'Yes' || text === 'Accept' || text === 'I agree') {
                button.click();
                console.log(`✅ Clicked cookie accept: "${text}"`);
                return true;
            }
        }

        return false;
    }

    // ============================================
    // CLICK REGISTRATION BUTTON
    // ============================================

    function clickRegistrationButton() {
        if (regButtonClicked) return false;

        console.log('🔍 Looking for registration button...');

        const newButton = document.querySelector('button.open-regform-btn');
        if (newButton) {
            newButton.click();
            regButtonClicked = true;
            console.log('✅ Clicked "I\'m new" button');
            return true;
        }

        const letsGoButtons = document.querySelectorAll('div.open-regform-btn');
        for (let btn of letsGoButtons) {
            const text = btn.textContent ? btn.textContent.trim() : '';
            if (text === "Let's go!" || text === "Let's go" || text.includes("Let's go")) {
                btn.click();
                regButtonClicked = true;
                console.log('✅ Clicked "Let\'s go!" button');
                return true;
            }
        }

        const buttonTexts = ["I'm new", "Let's go!", "Sign Up", "Register", "Join Now", "Create Account"];
        const allButtons = document.querySelectorAll('button, a, div[role="button"]');
        for (let btn of allButtons) {
            const text = btn.textContent ? btn.textContent.trim() : '';
            for (let searchText of buttonTexts) {
                if (text === searchText || text.includes(searchText)) {
                    btn.click();
                    regButtonClicked = true;
                    console.log(`✅ Clicked registration button: "${text}"`);
                    return true;
                }
            }
        }

        console.log('⚠️ No registration button found');
        return false;
    }

    // ============================================
    // REGISTRATION FORM DETECTION
    // ============================================

    function detectRegistrationForm() {
        const formSelectors = [
            'input[name="UserForm[email]"]',
            'input[name="email"]',
            'input[type="email"]',
            'input[name="UserForm[password]"]',
            'input[type="password"]',
            'form[action*="register"]',
            'form[action*="signup"]',
            'form[class*="register"]',
            'form[class*="signup"]',
            'div[class*="registration"]',
            'div[class*="signup"]',
            'div[data-form-item="email"]',
            'div[data-form-item="password"]',
            'input[placeholder*="Email"]',
            'input[placeholder*="email"]',
            'div[class*="step"] input[type="email"]',
            'div[class*="step"] input[type="password"]',
            'input[name="UserForm[location]"]',
            'select[name="UserForm[age]"]',
            'select[name="UserForm[sexual_orientation]"]'
        ];

        for (let selector of formSelectors) {
            const elements = document.querySelectorAll(selector);
            for (let el of elements) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    console.log(`📝 Registration form detected via selector: ${selector}`);
                    return true;
                }
            }
        }

        const emailInputs = document.querySelectorAll('input[type="email"], input[name*="email"], input[placeholder*="email"]');
        for (let input of emailInputs) {
            if (input.offsetParent !== null && input.type !== 'hidden') {
                const form = input.closest('form');
                if (form) {
                    const hasPassword = form.querySelector('input[type="password"]');
                    const hasSubmit = form.querySelector('button[type="submit"], input[type="submit"]');
                    if (hasPassword && hasSubmit) {
                        console.log('📝 Registration form detected via email + password + submit');
                        return true;
                    }
                }
                const nearbyPassword = document.querySelector('input[type="password"]');
                if (nearbyPassword) {
                    console.log('📝 Registration form detected via email + nearby password');
                    return true;
                }
            }
        }

        const steps = document.querySelectorAll('div[class*="step"], div[class*="Step"]');
        if (steps.length > 0) {
            for (let step of steps) {
                const inputs = step.querySelectorAll('input');
                if (inputs.length >= 2) {
                    console.log('📝 Registration form detected via step-based layout');
                    return true;
                }
            }
        }

        const regButton = document.querySelector('button.open-regform-btn, div.open-regform-btn');
        if (regButton && regButton.offsetParent !== null) {
            console.log('🔍 Registration button visible, form not open yet');
            return false;
        }

        return false;
    }

    // ============================================
    // AUTO FORM SCANNER WITH FALLBACK LOGOUT
    // ============================================

    function startFormScanner() {
        if (isFormDetectionActive) return;
        if (stopRequested) return;
        if (isRunning) return;
        if (logoutInProgress) return;
        if (isLoggingOut) return;
        if (isStoppedByGetExtra) return; // BLOCKED BY STOP FLAG

        isFormDetectionActive = true;
        formScannerRetries = 0;
        regButtonClicked = false;
        console.log('🔍 [Form Scanner] Starting...');

        if (formDetectionInterval) {
            clearInterval(formDetectionInterval);
            formDetectionInterval = null;
        }

        checkForRegistrationForm();

        formDetectionInterval = setInterval(() => {
            if (stopRequested) {
                stopFormScanner();
                return;
            }
            if (isRunning) {
                stopFormScanner();
                return;
            }
            if (logoutInProgress || isLoggingOut) {
                return;
            }
            if (isStoppedByGetExtra) {
                stopFormScanner();
                return;
            }

            const isPostRegPage = window.location.pathname.includes('/funnel/') ||
                                 window.location.pathname.includes('/photoUpload') ||
                                 window.location.pathname.includes('/profile');
            if (isPostRegPage && !isRunning) {
                stopFormScanner();
                return;
            }

            checkForRegistrationForm();
            formScannerRetries++;

            // If no form detected after 10 retries (20 seconds), force logout
            if (formScannerRetries >= 10 && !stopRequested && !isRunning && !isLoggingOut && !logoutInProgress) {
                console.log(`🔄 [Form Scanner] No form detected after ${formScannerRetries} attempts - forcing logout...`);
                const status = document.querySelector('#auto-clicker-gui .gui-status');
                const emailDisplay = document.getElementById('email-display');

                if (status) {
                    status.textContent = '❌ No form - Logging out...';
                    status.style.color = '#ff6b6b';
                }

                setStopReason('❌ No form detected');
                stopFormScanner();

                // Force logout to restart the process
                setTimeout(() => {
                    if (!stopRequested) {
                        performLogout(status, emailDisplay);
                    }
                }, 1000);
            }
        }, 2000);
    }

    function stopFormScanner() {
        if (formDetectionInterval) {
            clearInterval(formDetectionInterval);
            formDetectionInterval = null;
        }
        isFormDetectionActive = false;
        console.log('🔍 [Form Scanner] Stopped');
    }

    function checkForRegistrationForm() {
        if (stopRequested) return;
        if (isRunning) {
            stopFormScanner();
            return;
        }
        if (logoutInProgress || isLoggingOut) return;
        if (isWaitingForGetExtra) return;
        if (justRegistered) {
            console.log('🛡️ [Form Scanner] Blocked because we just registered successfully.');
            return;
        }

        if (!regButtonClicked) {
            const regButton = document.querySelector('button.open-regform-btn, div.open-regform-btn');
            if (regButton && regButton.offsetParent !== null) {
                console.log('🔍 Registration button found, clicking it...');
                clickRegistrationButton();
                setTimeout(() => {
                    if (!stopRequested) {
                        checkForRegistrationForm();
                    }
                }, 1000);
                return;
            }
        }

        const formDetected = detectRegistrationForm();

        if (formDetected && !registrationAttempted && !isRunning) {
            console.log('🎯 [Form Scanner] Registration form detected! Auto-starting...');
            registrationFormDetected = true;
            registrationAttempted = true;

            stopFormScanner();

            const status = document.querySelector('#auto-clicker-gui .gui-status');
            const startButton = document.querySelector('#auto-clicker-gui .start-btn');
            const emailDisplay = document.getElementById('email-display');

            if (status && startButton && emailDisplay) {
                const existingEmail = getCurrentEmail();
                if (existingEmail) {
                    emailDisplay.textContent = `📧 ${existingEmail}`;
                    emailDisplay.style.color = '#4CAF50';
                    const emailInput = document.getElementById('email-input');
                    if (emailInput) {
                        emailInput.value = existingEmail;
                    }

                    status.textContent = '🔄 Starting...';
                    status.style.color = '#4CAF50';

                    setStopReason('');
                    updateStopReasonDisplay();

                    setTimeout(() => {
                        if (!stopRequested) {
                            runAutomation(existingEmail, status, startButton, emailDisplay);
                        }
                    }, 1500);
                } else {
                    console.warn('⚠️ [Form Scanner] No existing email found!');
                    status.textContent = '⚠️ No email - Click Start';
                    status.style.color = '#ff6b6b';
                }
            } else {
                console.warn('⚠️ [Form Scanner] GUI elements not found, retrying...');
                setTimeout(() => {
                    if (!stopRequested) {
                        checkForRegistrationForm();
                    }
                }, 3000);
            }
        }
    }

    // ============================================
    // AVATAR SCANNER - UNIVERSAL DETECTION
    // ============================================

    function startAvatarScanner(status, emailDisplay) {
        if (avatarScannerActive) return;
        if (stopRequested) return;
        if (isRunning) return;
        if (isLoggingOut) return;
        if (logoutInProgress) return;
        if (isStoppedByGetExtra) return; // BLOCKED BY STOP FLAG

        avatarScannerActive = true;
        restartStuckDetected = false;
        forceLogoutTriggeredByScanner = false;
        console.log('👤 [Avatar Scanner] Starting - monitoring for stuck restart...');

        if (avatarScannerInterval) {
            clearInterval(avatarScannerInterval);
            avatarScannerInterval = null;
        }

        // Check immediately
        checkForAvatar(status, emailDisplay);

        avatarScannerInterval = setInterval(() => {
            if (stopRequested) {
                stopAvatarScanner();
                return;
            }
            if (isRunning) {
                stopAvatarScanner();
                return;
            }
            if (isLoggingOut || logoutInProgress) {
                return;
            }
            if (isStoppedByGetExtra) {
                stopAvatarScanner();
                return;
            }

            checkForAvatar(status, emailDisplay);
        }, 3000);
    }

    function stopAvatarScanner() {
        if (avatarScannerInterval) {
            clearInterval(avatarScannerInterval);
            avatarScannerInterval = null;
        }
        avatarScannerActive = false;
        console.log('👤 [Avatar Scanner] Stopped');
    }

    function checkForAvatar(status, emailDisplay) {
        // Only check if not in registration form and not in waiting state
        if (isWaitingForGetExtra) return;
        if (registrationComplete) return;
        if (timerStarted) return;
        if (isRunning) return;
        if (isLoggingOut || logoutInProgress) return;

        // Check if we're on the homepage or main page
        const isHomepage = window.location.pathname === '/' ||
                          window.location.pathname === '' ||
                          window.location.pathname.includes('/home');

        if (!isHomepage) return;

        let avatarFound = false;
        let avatarElement = null;

        // METHOD 1: Check for avatar/profile images
        const imageSelectors = [
            'img[class*="avatar"]', 'img[class*="profile"]',
            'img[alt*="avatar"]', 'img[alt*="profile"]',
            'img[src*="avatar"]', 'img[src*="profile"]',
            '.avatar img', '.profile-pic img', '.user-avatar img'
        ];

        for (let selector of imageSelectors) {
            const elements = document.querySelectorAll(selector);
            for (let el of elements) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    avatarFound = true;
                    avatarElement = el;
                    console.log(`👤 [Avatar Scanner] Found avatar image via: ${selector}`);
                    break;
                }
            }
            if (avatarFound) break;
        }

        // METHOD 2: Check for avatar divs with common classes
        if (!avatarFound) {
            const divSelectors = [
                '.avatar', '.profile-pic', '.user-avatar',
                '.user-icon', '.account-icon', '.user-menu',
                '[class*="avatar"]', '[class*="profile"]',
                '.X_X', '.X_h', '.Xhq', '.XDU', '.YB', '.Yr'
            ];

            for (let selector of divSelectors) {
                const elements = document.querySelectorAll(selector);
                for (let el of elements) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        // Check if it contains an image or has content
                        const hasImage = el.querySelector('img');
                        const hasText = el.textContent && el.textContent.trim().length > 0;
                        if (hasImage || hasText) {
                            avatarFound = true;
                            avatarElement = el;
                            console.log(`👤 [Avatar Scanner] Found avatar div via: ${selector}`);
                            break;
                        }
                    }
                }
                if (avatarFound) break;
            }
        }

        // METHOD 3: Check for user menu/dropdown triggers
        if (!avatarFound) {
            const menuSelectors = [
                '.user-menu-trigger', '.dropdown-toggle',
                '.user-dropdown', '.account-menu',
                '[data-toggle="dropdown"]', '[aria-haspopup="true"]'
            ];

            for (let selector of menuSelectors) {
                const elements = document.querySelectorAll(selector);
                for (let el of elements) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        const text = el.textContent ? el.textContent.trim() : '';
                        if (text.length > 0 && text.length < 30) {
                            avatarFound = true;
                            avatarElement = el;
                            console.log(`👤 [Avatar Scanner] Found user menu via: ${selector} - text: "${text}"`);
                            break;
                        }
                    }
                }
                if (avatarFound) break;
            }
        }

        // METHOD 4: Check for logout button (best indicator of being logged in)
        if (!avatarFound) {
            const logoutSelectors = [
                '.logout', '.sign-out', '.log-out',
                '[role="menuitem"]', '.nav-logout',
                'a[href*="logout"]', 'button[data-action="logout"]'
            ];

            for (let selector of logoutSelectors) {
                const elements = document.querySelectorAll(selector);
                for (let el of elements) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        const text = el.textContent ? el.textContent.trim() : '';
                        if (text === 'Log Out' || text === 'Logout' ||
                            text.includes('Log Out') || text.includes('Logout') ||
                            text.includes('Sign Out')) {
                            avatarFound = true;
                            avatarElement = el;
                            console.log(`👤 [Avatar Scanner] Found logout button via: ${selector} - text: "${text}"`);
                            break;
                        }
                    }
                }
                if (avatarFound) break;
            }
        }

        // METHOD 5: Check for any element containing username
        if (!avatarFound) {
            const allElements = document.querySelectorAll('*');
            for (let el of allElements) {
                // Only check elements that might contain username
                if (el.tagName === 'SPAN' || el.tagName === 'DIV' || el.tagName === 'A') {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        const className = el.className || '';
                        const text = el.textContent ? el.textContent.trim() : '';
                        // Look for elements that look like usernames
                        if (text && text.length > 0 && text.length < 30 &&
                            !text.includes(' ') &&
                            (className.includes('user') || className.includes('name') ||
                             className.includes('profile') || className.includes('account'))) {
                            avatarFound = true;
                            avatarElement = el;
                            console.log(`👤 [Avatar Scanner] Found username element: "${text}"`);
                            break;
                        }
                    }
                }
            }
        }

        if (avatarFound) {
            // Avatar detected - user is logged in, restart is stuck!
            if (!forceLogoutTriggeredByScanner) {
                console.log('👤 [Avatar Scanner] AVATAR DETECTED - Restart is stuck!');
                forceLogoutTriggeredByScanner = true;
                restartStuckDetected = true;

                if (status) {
                    status.textContent = '👤 Avatar detected - Forcing logout!';
                    status.style.color = '#ff6b6b';
                    status.style.fontWeight = 'bold';
                }

                setStopReason('👤 Avatar detected - Stuck restart');

                // Stop the scanner to prevent multiple triggers
                stopAvatarScanner();

                // FORCE LOGOUT - reset flags to ensure it runs
                isLoggingOut = false;
                logoutInProgress = false;

                // Force logout to restart properly
                console.log('🔄 [Avatar Scanner] Forcing logout to fix stuck restart...');

                // Wait a moment then perform logout
                setTimeout(() => {
                    if (!stopRequested) {
                        performLogout(status, emailDisplay);
                    }
                }, 1500);
            }
        } else {
            // No avatar - user is logged out, good
            if (restartStuckDetected) {
                restartStuckDetected = false;
                forceLogoutTriggeredByScanner = false;
                console.log('👤 [Avatar Scanner] Avatar cleared - restart proceeding');
                if (status) {
                    status.textContent = '✅ Ready';
                    status.style.color = '#4CAF50';
                    status.style.fontWeight = 'normal';
                    setTimeout(() => {
                        if (status && !status.textContent.includes('⏱️')) {
                            status.textContent = 'Ready';
                            status.style.color = '#aaa';
                        }
                    }, 2000);
                }
            }
        }
    }

    // ============================================
    // LOCATION HELPER FUNCTIONS
    // ============================================

    function findLocationCountries() {
        const foundCountries = [];
        const foundCountryCodes = [];
        const targetCountries = getTargetCountries();

        const countryItems = document.querySelectorAll('.nj[role="menuitem"]');

        for (let item of countryItems) {
            const countryAttr = item.getAttribute('vcmowvqwrwyfysdp-country') ||
                               item.getAttribute('data-country') ||
                               item.getAttribute('country');

            if (countryAttr) {
                const countryCode = countryAttr.toUpperCase();
                for (let target of targetCountries) {
                    if (target.code === countryCode) {
                        const text = item.textContent ? item.textContent.trim() : '';
                        if (text && !foundCountryCodes.includes(countryCode)) {
                            foundCountryCodes.push(countryCode);
                            foundCountries.push({
                                code: countryCode,
                                name: text || target.name
                            });
                            console.log(`📍 Found country: ${text} (${countryCode})`);
                        }
                        break;
                    }
                }
            } else {
                const text = item.textContent ? item.textContent.trim() : '';
                for (let target of targetCountries) {
                    if (text === target.name || text === target.code || text.includes(target.name)) {
                        if (!foundCountryCodes.includes(target.code)) {
                            foundCountryCodes.push(target.code);
                            foundCountries.push({
                                code: target.code,
                                name: text
                            });
                            console.log(`📍 Found country by text: ${text} (${target.code})`);
                        }
                        break;
                    }
                }
            }
        }

        return foundCountries;
    }

    async function waitForCountries(timeout = 15000) {
        const startTime = Date.now();
        let lastFoundCount = 0;
        let stableCount = 0;
        const targetCount = getTargetCount();

        while (Date.now() - startTime < timeout) {
            if (stopRequested) {
                console.log('🛑 Stop requested - exiting waitForCountries');
                return [];
            }

            const countries = findLocationCountries();
            const currentCount = countries.length;

            console.log(`📍 Checking countries: ${currentCount}/${targetCount}`);

            if (currentCount === 1) {
                console.log('📍 Only 1 country found - returning immediately');
                return countries;
            }

            if (currentCount >= targetCount) {
                return countries;
            }

            if (currentCount === lastFoundCount && currentCount > 0) {
                stableCount++;
                if (stableCount >= 3) {
                    return countries;
                }
            } else {
                if (currentCount > 0) {
                    stableCount = 0;
                }
                lastFoundCount = currentCount;
            }

            await sleep(800);
        }

        return findLocationCountries();
    }

    async function waitForPageFullyLoaded() {
        console.log('⏳ Waiting for page to load...');

        if (document.readyState !== 'complete') {
            await new Promise((resolve) => {
                const checkReady = () => {
                    if (document.readyState === 'complete') {
                        resolve();
                    } else {
                        setTimeout(checkReady, 500);
                    }
                };
                checkReady();
            });
        }

        const maxWait = 30000;
        const startTime = Date.now();
        let locationFound = false;

        while (Date.now() - startTime < maxWait) {
            if (stopRequested) {
                console.log('🛑 Stop requested - exiting');
                return false;
            }

            const locationDisplay = document.querySelector('.XyU.XyL');
            if (locationDisplay) {
                locationFound = true;
                break;
            }
            await sleep(500);
        }

        if (locationFound) {
            console.log('✅ Page loaded, location found');
        } else {
            console.log('⚠️ Location not found, continuing');
        }

        await sleep(3000);
        console.log('✅ Page ready');
        return true;
    }

    async function performLocationHelper(status) {
        if (locationHelperRunning) return false;
        if (locationHelperDone) {
            console.log('📍 Location helper already done');
            return true;
        }

        locationHelperRunning = true;

        const targetCount = getTargetCount();
        const groupLabel = getCountryGroupLabel();

        console.log(`📍 Running location helper... (${groupLabel})`);
        console.log(`📊 Target: ${targetCount} countries`);

        try {
            const loaded = await waitForPageFullyLoaded();
            if (!loaded || stopRequested) {
                locationHelperRunning = false;
                return false;
            }

            const locationDisplay = document.querySelector('.XyU.XyL');
            if (!locationDisplay) {
                console.log('❌ Location display not found');
                locationHelperRunning = false;
                return false;
            }

            let clickable = locationDisplay.closest('.ZZ');
            if (!clickable) clickable = locationDisplay.closest('.Xyb');
            if (!clickable) clickable = locationDisplay.closest('.Xjz');

            if (!clickable) {
                console.log('❌ Location clickable not found');
                locationHelperRunning = false;
                return false;
            }

            clickable.click();
            console.log('✅ Step 1: Clicked location');
            await sleep(1500);

            if (stopRequested) {
                locationHelperRunning = false;
                return false;
            }

            let allStatesClicked = false;
            const allStatesButtons = document.querySelectorAll('button .Rq.hjE');
            for (let el of allStatesButtons) {
                const text = el.textContent ? el.textContent.trim() : '';
                if (text === 'All states' || text === 'All states ') {
                    const btn = el.closest('button');
                    if (btn) {
                        btn.click();
                        allStatesClicked = true;
                        console.log('✅ Step 2: Clicked "All states"');
                        break;
                    }
                }
            }

            if (!allStatesClicked) {
                const allButtons = document.querySelectorAll('button');
                for (let btn of allButtons) {
                    const text = btn.textContent ? btn.textContent.trim() : '';
                    if (text === 'All states' || text.includes('All states')) {
                        btn.click();
                        allStatesClicked = true;
                        console.log('✅ Step 2: Clicked "All states" (alt)');
                        break;
                    }
                }
            }

            if (!allStatesClicked) {
                console.log('⚠️ Could not find "All states"');
            }

            await sleep(1500);

            if (stopRequested) {
                locationHelperRunning = false;
                return false;
            }

            let countriesClicked = false;
            const countriesButtons = document.querySelectorAll('button .Rq.hjE');
            for (let el of countriesButtons) {
                const text = el.textContent ? el.textContent.trim() : '';
                if (text === 'Countries' || text === 'Countries ') {
                    const btn = el.closest('button');
                    if (btn) {
                        btn.click();
                        countriesClicked = true;
                        console.log('✅ Step 3: Clicked "Countries"');
                        break;
                    }
                }
            }

            if (!countriesClicked) {
                console.log('🔍 Looking for "All countries"...');
                const allCountriesButtons = document.querySelectorAll('button .Rq.hjE, div.Rq.hjE');
                for (let el of allCountriesButtons) {
                    const text = el.textContent ? el.textContent.trim() : '';
                    if (text === 'All countries' || text === 'All countries ') {
                        const btn = el.closest('button') || el;
                        btn.click();
                        countriesClicked = true;
                        console.log('✅ Step 3: Clicked "All countries"');
                        break;
                    }
                }
            }

            if (!countriesClicked) {
                const allButtons = document.querySelectorAll('button, div[role="button"]');
                for (let btn of allButtons) {
                    const text = btn.textContent ? btn.textContent.trim() : '';
                    if (text === 'Countries' || text.includes('Countries') || text === 'All countries' || text.includes('All countries')) {
                        btn.click();
                        countriesClicked = true;
                        console.log(`✅ Step 3: Clicked "${text}"`);
                        break;
                    }
                }
            }

            if (!countriesClicked) {
                console.log('⚠️ Could not find "Countries" or "All countries"');
                locationHelperRunning = false;
                return false;
            }

            await sleep(2000);

            if (stopRequested) {
                locationHelperRunning = false;
                return false;
            }

            console.log(`📍 Waiting for ${targetCount} countries...`);
            const foundCountries = await waitForCountries(15000);
            console.log(`📍 Found: ${foundCountries.map(c => c.name).join(', ')}`);

            const foundCount = foundCountries.length;

            try {
                const closeBtn = document.querySelector('[data-close-popper="true"] button, button:contains("Select")');
                if (closeBtn) {
                    const btn = closeBtn.closest('button') || closeBtn;
                    btn.click();
                    console.log('✅ Closed dropdown');
                }
            } catch(e) {}

            if (status) {
                if (foundCount === 1) {
                    status.textContent = `📍 ${foundCount}/${targetCount} - Logging out!`;
                    status.style.color = '#ff6b6b';
                    locationHelperDone = false;
                    console.log(`❌ Only ${foundCount} country - IMMEDIATE LOGOUT!`);
                    locationHelperRunning = false;
                    return false;
                }

                if (foundCount >= targetCount) {
                    status.textContent = `📍 ${foundCount}/${targetCount} ✅`;
                    status.style.color = '#4CAF50';
                    locationHelperDone = true;
                    locationHelperAttempts = 0;
                    console.log(`✅ All ${targetCount} countries found!`);
                    locationHelperRunning = false;
                    return true;
                } else {
                    status.textContent = `📍 ${foundCount}/${targetCount}`;
                    status.style.color = '#ffa500';
                    console.log(`⚠️ Found ${foundCount}/${targetCount} countries`);

                    if (foundCount >= 2) {
                        console.log(`✅ ${foundCount} countries - Continuing`);
                        locationHelperDone = true;
                        locationHelperRunning = false;
                        return true;
                    }

                    locationHelperDone = false;
                    locationHelperRunning = false;
                    return false;
                }
            }

            locationHelperRunning = false;
            return foundCount >= targetCount;

        } catch (error) {
            console.error('❌ Location helper error:', error);
            locationHelperAttempts++;
            locationHelperRunning = false;
            return false;
        }
    }

    async function checkLocationHelperAfter15Seconds(status, startButton, emailDisplay) {
        if (locationHelperCheckTriggered || locationHelperCheckDone || stopRequested) return;

        const isPostRegistrationPage = window.location.pathname.includes('/funnel/') ||
                                       window.location.pathname.includes('/photoUpload') ||
                                       window.location.pathname.includes('/profile');

        if (!isPostRegistrationPage) return;

        locationHelperCheckTriggered = true;

        console.log('📍 Running 15-second location check...');
        if (status) {
            status.textContent = '📍 Location check...';
            status.style.color = '#ffa500';
        }

        const locationResult = await performLocationHelper(status);

        if (locationResult) {
            console.log('✅ Location check PASSED!');
            locationHelperCheckDone = true;
            if (status) {
                status.textContent = '✅ Location OK';
                status.style.color = '#4CAF50';
                setTimeout(() => {
                    if (status && !stopRequested) {
                        const elapsed = Math.floor((Date.now() - waitStartTime) / 1000);
                        const displayElapsed = Math.min(elapsed, totalWaitTime);
                        const minutes = Math.floor(displayElapsed / 60);
                        const seconds = displayElapsed % 60;
                        const totalMinutes = Math.floor(totalWaitTime / 60);
                        const totalSeconds = totalWaitTime % 60;
                        let statusText = `⏱️ ${minutes}:${seconds.toString().padStart(2, '0')} / ${totalMinutes}:${totalSeconds.toString().padStart(2, '0')}`;
                        if (getExclusiveDetected) statusText += ' 🔒';
                        if (settings.stopOnGetExtra) statusText += ' 🛑';
                        else statusText += ' ➡️';
                        status.textContent = statusText;
                        status.style.color = '#4CAF50';
                    }
                }, 2000);
            }
        } else {
            console.log('❌ Location check FAILED!');
            locationHelperCheckDone = false;
            if (status) {
                status.textContent = '❌ Location failed - Logout!';
                status.style.color = '#ff6b6b';
            }

            setStopReason('📍 Location Check Failed');

            isWaitingForGetExtra = false;
            waitLoopActive = false;
            forceLogoutTriggered = true;
            clearTimerState();

            if (waitTimerInterval) {
                clearInterval(waitTimerInterval);
                waitTimerInterval = null;
            }

            await sleep(1000);
            await performLogout(status, emailDisplay);
        }
    }

    // ============================================
    // TIMER STATE MANAGEMENT
    // ============================================

    function saveTimerState(email, elapsedSeconds, refreshCount, startTime) {
        try {
            const state = {
                email: email,
                registrationEmail: registrationEmail || email,
                elapsedSeconds: elapsedSeconds,
                refreshCount: refreshCount,
                startTime: startTime,
                totalWaitTime: totalWaitTime,
                refreshInterval: refreshInterval,
                timestamp: Date.now(),
                registrationComplete: true,
                timerStarted: true,
                lastRefreshTime: elapsedSeconds,
                getExclusiveDetected: getExclusiveDetected,
                locationHelperDone: locationHelperDone,
                locationHelperAttempts: locationHelperAttempts,
                locationHelperCheckDone: locationHelperCheckDone,
                locationHelperCheckTriggered: locationHelperCheckTriggered,
                siteKey: siteKey
            };
            chromeSetValue(getTimerStateKey(), JSON.stringify(state));
            return true;
        } catch (error) {
            console.error('❌ Failed to save timer state:', error);
            return false;
        }
    }

    function loadTimerStateAsync() {
        return new Promise((resolve) => {
            chrome.storage.local.get([getTimerStateKey()], function(result) {
                const saved = result[getTimerStateKey()];
                if (saved) {
                    try {
                        const state = JSON.parse(saved);
                        if (state.siteKey && state.siteKey !== siteKey) {
                            console.log(`⚠️ Timer state is for ${state.siteKey}, not ${siteKey} - ignoring`);
                            resolve(null);
                        } else {
                            if (state.registrationEmail) {
                                registrationEmail = state.registrationEmail;
                            }
                            resolve(state);
                        }
                    } catch (e) {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });
        });
    }

    function clearTimerState() {
        try {
            chromeDeleteValue(getTimerStateKey());
            console.log(`🗑️ [${siteName}] Timer state cleared`);
            return true;
        } catch (error) {
            console.error('❌ Failed to clear timer state:', error);
            return false;
        }
    }

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================

    function sleep(ms) {
        return new Promise(resolve => {
            const interval = 100;
            let elapsed = 0;
            const checkStop = setInterval(() => {
                elapsed += interval;
                if (stopRequested) {
                    clearInterval(checkStop);
                    resolve();
                } else if (elapsed >= ms) {
                    clearInterval(checkStop);
                    resolve();
                }
            }, interval);
        });
    }

    function fillFieldFast(field, value, fieldName) {
        return new Promise((resolve) => {
            if (!field) {
                console.warn(`❌ ${fieldName} field is null`);
                resolve({ success: false, value: '' });
                return;
            }

            field.click();
            field.focus();
            field.select();

            field.value = value;

            const events = ['input', 'change', 'blur'];
            events.forEach(eventType => {
                const event = new Event(eventType, { bubbles: true, cancelable: true });
                field.dispatchEvent(event);
            });

            const inputEvent = new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                data: value
            });
            field.dispatchEvent(inputEvent);

            const tracker = field._valueTracker;
            if (tracker) {
                tracker.setValue(value);
            }

            const keyEvents = ['keydown', 'keypress', 'keyup'];
            keyEvents.forEach(eventType => {
                const event = new KeyboardEvent(eventType, {
                    bubbles: true,
                    cancelable: true,
                    key: value,
                    code: 'KeyA'
                });
                field.dispatchEvent(event);
            });

            console.log(`✅ Entered "${value}" in ${fieldName} field`);
            resolve({ success: true, value: value });
        });
    }

    function fillField(field, value, fieldName) {
        return fillFieldFast(field, value, fieldName);
    }

    function clickWithEvents(element, elementName) {
        if (!element) return false;

        element.click();
        const span = element.querySelector('span');
        if (span) span.click();

        const events = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];
        events.forEach(eventType => {
            const event = new Event(eventType, { bubbles: true, cancelable: true });
            element.dispatchEvent(event);
        });

        console.log(`✅ Clicked ${elementName}`);
        return true;
    }

    // ============================================
    // AUTO RESTART - GENERATES NEW EMAIL
    // ============================================

    function triggerAutoRestart(status, emailDisplay) {
        console.log(`🔄 [${siteName}] Triggering immediate auto-restart...`);

        registrationComplete = false;
        timerStarted = false;
        getExtraDetected = false;
        getExclusiveDetected = false;
        waitLoopActive = false;
        forceLogoutTriggered = false;
        locationHelperDone = false;
        isRunning = false;
        getExtraEmailSaved = false;
        registrationAttempted = false;
        registrationFormDetected = false;
        regButtonClicked = false;
        clearTimerState();

        const newEmail = refreshEmail();
        console.log(`📧 [${siteName}] New email: ${newEmail}`);

        if (emailDisplay) {
            emailDisplay.textContent = `📧 ${newEmail}`;
            emailDisplay.style.color = '#4CAF50';
        }
        const emailInput = document.getElementById('email-input');
        if (emailInput) {
            emailInput.value = newEmail;
        }

        if (status) {
            status.textContent = `🔄 Restarting...`;
            status.style.color = '#4CAF50';
        }

        // Stop scanners before reload
        stopAvatarScanner();
        stopYesContinueScanner();

        chromeSetValue(getAutoRestartKey(), 'true');
        window._autoRestarting = true;
        window.location.href = getHomepageUrl();
    }

    // ============================================
    // LOGOUT FUNCTION - GENERATES NEW EMAIL
    // ============================================

    function getHomepageUrl() {
        if (isIamnaughty) return isMobile ? 'https://m.iamnaughty.com/' : 'https://www.iamnaughty.com/';
        if (isSpicydesires) return isMobile ? 'https://m.spicydesires.com/' : 'https://www.spicydesires.com/';
        if (isCouples4sex) return isMobile ? 'https://m.couples4sex.com/' : 'https://www.couples4sex.com/';
        if (isLuvcougar) return isMobile ? 'https://m.luvcougar.com/' : 'https://www.luvcougar.com/';
        if (isIwantucougar) return isMobile ? 'https://m.iwantucougar.com/' : 'https://www.iwantucougar.com/';
        if (isFlirt) return isMobile ? 'https://m.flirt.com/' : 'https://www.flirt.com/';
        if (isUpforit) return isMobile ? 'https://m.upforit.com/' : 'https://www.upforit.com/';
        if (isGetnaughty) return isMobile ? 'https://m.getnaughty.com/' : 'https://www.getnaughty.com/';
        if (isCheekylovers) return isMobile ? 'https://m.cheekylovers.com/' : 'https://www.cheekylovers.com/';
        if (isUpair) return isMobile ? 'https://m.upair.com/' : 'https://www.upair.com/';
        if (isBemymilf) return isMobile ? 'https://m.bemymilf.com/' : 'https://www.bemymilf.com/';
        return isMobile ? 'https://m.wantmatures.com/' : 'https://www.wantmatures.com/';
    }

    async function attemptLogoutStep(stepName, findFunction, clickFunction) {
        console.log(`🔍 [${stepName}] Attempting...`);

        for (let attempt = 1; attempt <= 3; attempt++) {
            if (stopRequested) return false;

            console.log(`  Attempt ${attempt}/3...`);
            const element = findFunction();

            if (element) {
                if (clickFunction) {
                    clickFunction(element);
                }
                console.log(`✅ [${stepName}] Success`);
                return true;
            }

            await sleep(1500);
        }

        console.log(`❌ [${stepName}] Failed`);
        return false;
    }

    async function performLogout(status, emailDisplay) {
        // Reset flags to ensure logout runs
        if (isLoggingOut || logoutInProgress) {
            console.log('⚠️ Logout already in progress, resetting flags...');
            isLoggingOut = false;
            logoutInProgress = false;
        }

        if (stopRequested) return false;

        if (formDetectionInterval) {
            clearInterval(formDetectionInterval);
            formDetectionInterval = null;
        }
        isFormDetectionActive = false;
        registrationAttempted = false;
        registrationFormDetected = false;
        regButtonClicked = false;

        // Stop scanners during logout
        stopAvatarScanner();
        stopYesContinueScanner();

        logoutInProgress = true;
        isLoggingOut = true;
        forceLogoutTriggered = true;
        shouldAutoRestart = true;

        console.log(`🚪 [${siteName}] Logging out...`);
        if (status) {
            status.textContent = '🚪 Logging out...';
            status.style.color = '#ffa500';
        }

        try {
            // Step 1: Delete cookies first
            deleteSiteCookies();
            await sleep(500);

            // Step 2: Look for avatar using universal detection
            console.log('🔍 Step 1: Looking for avatar...');

            const avatarSelectors = [
                '.avatar', '.profile-pic', '.user-avatar',
                '.user-icon', '.account-icon', '.user-menu',
                '[class*="avatar"]', '[class*="profile"]',
                '.X_X', '.X_h', '.Xhq', '.XDU', '.YB', '.Yr',
                'img[class*="avatar"]', 'img[class*="profile"]',
                '.user-menu-trigger', '.dropdown-toggle'
            ];

            let avatarClicked = false;
            let avatarAttempts = 0;
            const maxAvatarAttempts = 3;

            while (!avatarClicked && avatarAttempts < maxAvatarAttempts && !stopRequested) {
                avatarAttempts++;
                console.log(`  Avatar attempt ${avatarAttempts}/${maxAvatarAttempts}...`);

                for (let selector of avatarSelectors) {
                    if (stopRequested) break;
                    const elements = document.querySelectorAll(selector);
                    for (let el of elements) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            const clickable = el.closest('button') || el.closest('a') || el;
                            clickable.click();
                            avatarClicked = true;
                            console.log(`✅ Clicked avatar via selector: ${selector}`);
                            break;
                        }
                    }
                    if (avatarClicked) break;
                }

                if (!avatarClicked && avatarAttempts < maxAvatarAttempts) {
                    console.log(`  Avatar not found, retrying...`);
                    await sleep(2000);
                }
            }

            if (!avatarClicked && !stopRequested) {
                console.log('⚠️ Avatar not found, trying direct logout...');
                const logoutItems = document.querySelectorAll('.nj, [role="menuitem"], .logout, .sign-out, .log-out');
                for (let item of logoutItems) {
                    if (stopRequested) break;
                    const text = item.textContent ? item.textContent.trim() : '';
                    if (text === 'Log Out' || text === 'Logout' || text.includes('Log Out') || text.includes('Logout')) {
                        const rect = item.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            item.click();
                            avatarClicked = true;
                            console.log('✅ Clicked Logout directly');
                            break;
                        }
                    }
                }
            }

            if (!avatarClicked || stopRequested) {
                console.log('❌ Could not find avatar - Restarting');
                if (!stopRequested) {
                    await sleep(2000);
                    triggerAutoRestart(status, emailDisplay);
                }
                logoutInProgress = false;
                isLoggingOut = false;
                return false;
            }

            await sleep(800);
            if (stopRequested) {
                logoutInProgress = false;
                isLoggingOut = false;
                return false;
            }

            // Step 3: Look for Logout menu
            console.log('🔍 Step 2: Looking for Logout menu...');

            const logoutSelectors = [
                '.nj[role="menuitem"] .X_i .icon__logout', '.nj', '[role="menuitem"]',
                '.logout', '.sign-out', '.log-out', '.dropdown-item'
            ];

            let logoutClicked = false;
            let logoutAttempts = 0;
            const maxLogoutAttempts = 3;

            while (!logoutClicked && logoutAttempts < maxLogoutAttempts && !stopRequested) {
                logoutAttempts++;
                console.log(`  Logout menu attempt ${logoutAttempts}/${maxLogoutAttempts}...`);

                for (let selector of logoutSelectors) {
                    if (stopRequested) break;
                    const elements = document.querySelectorAll(selector);
                    for (let el of elements) {
                        const text = el.textContent ? el.textContent.trim() : '';
                        if (text === 'Log Out' || text === 'Logout' || text.includes('Log Out') || text.includes('Logout')) {
                            const rect = el.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                el.click();
                                logoutClicked = true;
                                console.log(`✅ Clicked Logout via selector: ${selector}`);
                                break;
                            }
                        }
                    }
                    if (logoutClicked) break;
                }

                if (!logoutClicked && logoutAttempts < maxLogoutAttempts) {
                    console.log(`  Logout menu not found, retrying...`);
                    await sleep(2000);
                }
            }

            if (!logoutClicked && !stopRequested) {
                console.log('  Trying to find Logout by text...');
                const allElements = document.querySelectorAll('*');
                for (let el of allElements) {
                    if (stopRequested) break;
                    const text = el.textContent ? el.textContent.trim() : '';
                    if ((text === 'Log Out' || text === 'Logout' || text.includes('Log Out') || text.includes('Logout')) &&
                        (el.tagName === 'BUTTON' || el.tagName === 'A' || el.closest('button') || el.closest('a'))) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            const clickable = el.closest('button') || el.closest('a') || el;
                            clickable.click();
                            logoutClicked = true;
                            console.log('✅ Clicked Logout by text');
                            break;
                        }
                    }
                }
            }

            if (!logoutClicked || stopRequested) {
                console.log('❌ Logout menu not found - Restarting');
                if (status && !stopRequested) {
                    status.textContent = '❌ Logout menu not found - Restarting...';
                    status.style.color = '#ff6b6b';
                }
                if (!stopRequested) {
                    await sleep(2000);
                    triggerAutoRestart(status, emailDisplay);
                }
                logoutInProgress = false;
                isLoggingOut = false;
                return false;
            }

            await sleep(800);
            if (stopRequested) {
                logoutInProgress = false;
                isLoggingOut = false;
                return false;
            }

            // Step 4: Look for confirmation
            console.log('🔍 Step 3: Looking for confirmation...');

            const confirmSelectors = [
                '.aQ.at.ah button.Rb.hjR.Rd.R_.hjr.Rj.h_i.RC.Rg.Rk.hjN',
                '.modal button', '.dialog button', '.confirmation button',
                '.modal-footer button', '.dialog-footer button'
            ];

            let confirmClicked = false;
            let confirmAttempts = 0;
            const maxConfirmAttempts = 3;

            while (!confirmClicked && confirmAttempts < maxConfirmAttempts && !stopRequested) {
                confirmAttempts++;
                console.log(`  Confirmation attempt ${confirmAttempts}/${maxConfirmAttempts}...`);

                for (let selector of confirmSelectors) {
                    if (stopRequested) break;
                    const elements = document.querySelectorAll(selector);
                    for (let el of elements) {
                        const text = el.textContent ? el.textContent.trim() : '';
                        if (text === 'Log out' || text === 'Logout' || text === 'Yes' || text === 'Confirm' ||
                            text.includes('Log out') || text.includes('Logout')) {
                            const rect = el.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                el.click();
                                confirmClicked = true;
                                console.log(`✅ Clicked confirmation via selector: ${selector}`);
                                break;
                            }
                        }
                    }
                    if (confirmClicked) break;
                }

                if (!confirmClicked && confirmAttempts < maxConfirmAttempts) {
                    console.log(`  Confirmation not found, retrying...`);
                    await sleep(2000);
                }
            }

            if (!confirmClicked && !stopRequested) {
                console.log('  Trying to find confirmation by text...');
                const allButtons = document.querySelectorAll('button');
                for (let btn of allButtons) {
                    if (stopRequested) break;
                    const text = btn.textContent ? btn.textContent.trim() : '';
                    if (text === 'Log out' || text === 'Logout' || text === 'Yes' || text === 'Confirm' ||
                        text.includes('Log out') || text.includes('Logout')) {
                        const rect = btn.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            btn.click();
                            confirmClicked = true;
                            console.log('✅ Clicked confirmation by text');
                            break;
                        }
                    }
                }
            }

            if (!confirmClicked || stopRequested) {
                console.log('❌ Confirmation not found - Restarting');
                if (status && !stopRequested) {
                    status.textContent = '❌ Confirmation not found - Restarting...';
                    status.style.color = '#ff6b6b';
                }
                if (!stopRequested) {
                    await sleep(2000);
                    triggerAutoRestart(status, emailDisplay);
                }
                logoutInProgress = false;
                isLoggingOut = false;
                return false;
            }

            // Step 5: Wait for logout to complete
            await sleep(2000);
            if (stopRequested) {
                logoutInProgress = false;
                isLoggingOut = false;
                return false;
            }

            // Step 6: Delete cookies again (cleanup)
            deleteSiteCookies();

            // Step 7: Generate new email
            const newEmail = refreshEmail();
            console.log(`📧 [${siteName}] New email: ${newEmail}`);

            if (emailDisplay) {
                emailDisplay.textContent = `📧 ${newEmail}`;
                emailDisplay.style.color = '#4CAF50';
            }
            const emailInput = document.getElementById('email-input');
            if (emailInput) {
                emailInput.value = newEmail;
            }

            if (status) {
                status.textContent = `✅ Logout successful! New email`;
                status.style.color = '#4CAF50';
            }

            // Step 8: Reset all state
            registrationComplete = false;
            timerStarted = false;
            getExtraDetected = false;
            getExclusiveDetected = false;
            waitLoopActive = false;
            forceLogoutTriggered = false;
            locationHelperDone = false;
            locationHelperAttempts = 0;
            locationHelperRunning = false;
            isRunning = false;
            getExtraEmailSaved = false;
            locationHelperCheckDone = false;
            locationHelperCheckTriggered = false;
            registrationFailed = false;
            registrationAttempted = false;
            registrationFormDetected = false;
            regButtonClicked = false;
            formScannerRetries = 0;
            clearTimerState();

            logoutInProgress = false;
            isLoggingOut = false;

            // Step 9: IMPORTANT - Wait before reloading to ensure logout completes
            console.log('⏳ Waiting 3 seconds for logout to complete...');
            await sleep(3000);

            // Step 10: Now reload
            if (!stopRequested) {
                console.log(`🔄 [${siteName}] Logout complete! Reloading...`);
                chromeSetValue(getAutoRestartKey(), 'true');
                window._autoRestarting = true;
                window.location.href = getHomepageUrl();
            }

            return true;

        } catch (error) {
            console.error(`❌ [${siteName}] Error during logout:`, error);
            if (status && !stopRequested) {
                status.textContent = '❌ Logout error - Restarting...';
                status.style.color = '#ff6b6b';
            }
            if (!stopRequested) {
                await sleep(2000);
                triggerAutoRestart(status, emailDisplay);
            }
            logoutInProgress = false;
            isLoggingOut = false;
            return false;
        }
    }

    // ============================================
    // WAIT WITH AUTO-REFRESH
    // ============================================

    async function waitWithAutoRefresh(status, startButton, emailDisplay, isRestored = false) {
        if (!registrationComplete || !timerStarted) {
            console.log('⏳ Registration not complete. Timer not started.');
            return {
                success: false,
                found: false,
                message: 'Registration not complete'
            };
        }

        console.log(`⏱️ [${siteName}] Starting ${settings.timerMinutes}-minute wait...`);
        console.log(`🎯 Target: ${getCountryGroupLabel()} (${getTargetCount()} countries)`);
        console.log(`🔄 Get Extra: ${settings.stopOnGetExtra ? '🛑 STOP' : '➡️ CONTINUE'}`);
        console.log(`📧 Registration email: ${registrationEmail || currentEmail}`);

        // Stop scanners during wait
        stopAvatarScanner();
        stopYesContinueScanner();

        isWaitingForGetExtra = true;
        getExtraDetected = false;
        getExclusiveDetected = false;
        isRefreshing = false;
        refreshTriggered = false;
        exclusiveDetectedTime = 0;
        waitLoopActive = true;
        forceLogoutTriggered = false;
        locationHelperDone = false;
        locationHelperAttempts = 0;
        locationHelperRunning = false;
        getExtraEmailSaved = false;
        locationHelperCheckDone = false;
        locationHelperCheckTriggered = false;
        locationHelperCheckStartTime = Date.now();

        statusElement = status;
        startButtonElement = startButton;
        emailDisplayElement = emailDisplay;

        if (!isRestored) {
            waitStartTime = Date.now();
            refreshCount = 0;
            lastRefreshTime = 0;
        } else {
            const savedState = await loadTimerStateAsync();
            if (savedState) {
                waitStartTime = savedState.startTime || Date.now();
                refreshCount = savedState.refreshCount || 0;
                lastRefreshTime = savedState.lastRefreshTime || 0;
                getExclusiveDetected = savedState.getExclusiveDetected || false;
                locationHelperDone = savedState.locationHelperDone || false;
                locationHelperAttempts = savedState.locationHelperAttempts || 0;
                locationHelperCheckDone = savedState.locationHelperCheckDone || false;
                locationHelperCheckTriggered = savedState.locationHelperCheckTriggered || false;
                if (savedState.registrationEmail) {
                    registrationEmail = savedState.registrationEmail;
                }
                console.log(`📂 [${siteName}] Restored timer: ${refreshCount} refreshes`);
            } else {
                waitStartTime = Date.now();
                refreshCount = 0;
                lastRefreshTime = 0;
            }
        }

        if (status) {
            const elapsed = Math.floor((Date.now() - waitStartTime) / 1000);
            const displayElapsed = Math.min(elapsed, totalWaitTime);
            const minutes = Math.floor(displayElapsed / 60);
            const seconds = displayElapsed % 60;
            const totalMinutes = Math.floor(totalWaitTime / 60);
            const totalSeconds = totalWaitTime % 60;
            let statusText = `⏱️ ${minutes}:${seconds.toString().padStart(2, '0')} / ${totalMinutes}:${totalSeconds.toString().padStart(2, '0')}`;
            if (getExclusiveDetected) statusText += ' 🔒';
            if (settings.stopOnGetExtra) statusText += ' 🛑';
            else statusText += ' ➡️';
            status.textContent = statusText;
            status.style.color = '#4CAF50';
        }

        if (waitTimerInterval) {
            clearInterval(waitTimerInterval);
            waitTimerInterval = null;
        }

        waitTimerInterval = setInterval(() => {
            if (!isWaitingForGetExtra || !waitLoopActive || stopRequested) {
                clearInterval(waitTimerInterval);
                waitTimerInterval = null;
                return;
            }

            const elapsed = Math.floor((Date.now() - waitStartTime) / 1000);
            const displayElapsed = Math.min(elapsed, totalWaitTime);
            const minutes = Math.floor(displayElapsed / 60);
            const seconds = displayElapsed % 60;
            const totalMinutes = Math.floor(totalWaitTime / 60);
            const totalSeconds = totalWaitTime % 60;

            if (status && !getExtraDetected && !isRefreshing) {
                let statusText = `⏱️ ${minutes}:${seconds.toString().padStart(2, '0')} / ${totalMinutes}:${totalSeconds.toString().padStart(2, '0')}`;
                if (getExclusiveDetected) statusText += ' 🔒';
                if (settings.stopOnGetExtra) statusText += ' 🛑';
                else statusText += ' ➡️';
                status.textContent = statusText;
            }

            if (!getExtraDetected && !forceLogoutTriggered && !isLoggingOut && !logoutInProgress && !stopRequested) {
                if (elapsed >= totalWaitTime + 2) {
                    console.log(`⏰ [${siteName}] FORCE LOGOUT: ${elapsed}s elapsed`);
                    forceLogoutTriggered = true;
                    isWaitingForGetExtra = false;
                    waitLoopActive = false;
                    setStopReason('⏰ Timeout');
                    clearTimerState();
                    if (status) {
                        status.textContent = '⏰ Timeout - Logout!';
                        status.style.color = '#ffa500';
                    }
                    performLogout(status, emailDisplay);
                }
            }
        }, 1000);

        while (isWaitingForGetExtra && !getExtraDetected && waitLoopActive && !stopRequested) {
            const currentTime = Date.now();
            const elapsed = Math.floor((currentTime - waitStartTime) / 1000);

            if (!document.body) {
                console.log('⚠️ Page unloaded, stopping wait');
                break;
            }

            if (elapsed >= 15 && !locationHelperCheckTriggered && !locationHelperCheckDone && !stopRequested) {
                console.log('⏰ 15 seconds elapsed - Running location check...');
                checkLocationHelperAfter15Seconds(status, startButton, emailDisplay);
            }

            const timeSinceLastRefresh = elapsed - lastRefreshTime;
            if (timeSinceLastRefresh >= refreshInterval && !getExtraDetected && !isRefreshing && !refreshTriggered && !stopRequested) {
                refreshTriggered = true;
                isRefreshing = true;
                refreshCount++;
                console.log(`🔄 [${siteName}] REFRESH #${refreshCount}`);

                if (status) {
                    status.textContent = `🔄 Refresh #${refreshCount}...`;
                    status.style.color = '#ff6b6b';
                }

                locationHelperDone = false;
                locationHelperAttempts = 0;
                locationHelperRunning = false;
                locationHelperCheckDone = false;
                locationHelperCheckTriggered = false;

                saveTimerState(currentEmail, elapsed, refreshCount, waitStartTime);

                await sleep(500);
                if (!stopRequested) {
                    console.log(`🔄 [${siteName}] Executing refresh #${refreshCount}...`);
                    location.reload(true);
                }

                return {
                    success: true,
                    found: false,
                    refreshing: true,
                    message: 'Page refreshed'
                };
            }

            const buttons = checkForButtons();

            if (buttons.hasGetExtra && !getExtraEmailSaved) {
                console.log(`🎯 [${siteName}] Get Extra detected!`);
                getExtraDetected = true;
                getExtraEmailSaved = true;

                getExtraDetectedTime = Date.now();
                getExtraDetectedElapsed = elapsed;
                console.log(`⏱️ Get Extra at: ${getExtraDetectedElapsed}s (${formatTime(getExtraDetectedElapsed)})`);

                const emailToSave = registrationEmail || currentEmail;
                if (emailToSave) {
                    // Store email with wait time
                    addToGetExtraList(emailToSave, getExtraDetectedElapsed);
                    console.log(`✅ [${siteName}] Added ${emailToSave} to Get Extra list!`);
                    console.log(`⏱️ Wait time: ${formatTime(getExtraDetectedElapsed)}`);
                }

                if (status) {
                    status.textContent = `🎉 GET EXTRA at ${formatTime(getExtraDetectedElapsed)}!`;
                    status.style.color = '#FF9800';
                    status.style.fontWeight = 'bold';
                }

                if (startButton) {
                    startButton.style.background = '#FF9800';
                    startButton.textContent = '✅ Saved!';
                }

                updateGetExtraDisplay();

                // ================= FINAL HARD STOP (Kills Scanners) =================
                if (settings.stopOnGetExtra) {
                    console.log(`🛑 [${siteName}] STOP MODE: Get Extra found! FORCE STOPPING!`);
                    setStopReason('🎯 Get Extra Found!');
                    
                    if (status) {
                        status.textContent = `🛑 GET EXTRA at ${formatTime(getExtraDetectedElapsed)}! - STOPPED`;
                        status.style.color = '#ff6b6b';
                        status.style.fontWeight = 'bold';
                    }

                    // 1. Kill all loops
                    isWaitingForGetExtra = false;
                    waitLoopActive = false;
                    isRunning = false;
                    forceLogoutTriggered = false; 
                    clearTimerState();

                    // 2. Kill the wait timer
                    if (waitTimerInterval) {
                        clearInterval(waitTimerInterval);
                        waitTimerInterval = null;
                    }

                    // 3. CRUCIAL: Kill all background scanners so they don't restart the script
                    stopFormScanner();
                    stopAvatarScanner();
                    stopYesContinueScanner();

                    // 4. Set the STOP flag so scanners cannot restart
                    isStoppedByGetExtra = true;

                    // 5. Update UI
                    if (startButton) {
                        startButton.style.background = '#FF9800';
                        startButton.textContent = '✅ Get Extra!';
                    }

                    updateStopReasonDisplay();

                    return {
                        success: true,
                        found: true,
                        type: 'get_extra_stopped',
                        email: emailToSave,
                        waitTime: getExtraDetectedElapsed,
                        message: `Get Extra at ${formatTime(getExtraDetectedElapsed)}! Stopped.`
                    };
                } else {
                    console.log(`➡️ [${siteName}] CONTINUE MODE: Get Extra saved - Logging out...`);
                    if (status) {
                        status.textContent = `🚪 Saved - Logging out...`;
                        status.style.color = '#ffa500';
                    }

                    isWaitingForGetExtra = false;
                    waitLoopActive = false;
                    forceLogoutTriggered = true;
                    clearTimerState();

                    await sleep(500);
                    await performLogout(status, emailDisplay);

                    return {
                        success: true,
                        found: true,
                        type: 'get_extra_saved',
                        email: emailToSave,
                        waitTime: getExtraDetectedElapsed,
                        message: `Get Extra at ${formatTime(getExtraDetectedElapsed)}! Continuing...`
                    };
                }
            }

            if (buttons.hasGetExclusive && !getExclusiveDetected) {
                getExclusiveDetected = true;
                exclusiveDetectedTime = elapsed;
                console.log(`🔒 [${siteName}] Get Exclusive detected - Continuing`);
                if (status) {
                    const minutes = Math.floor(elapsed / 60);
                    const seconds = elapsed % 60;
                    status.textContent = `🔒 Get Exclusive! (${minutes}:${seconds.toString().padStart(2, '0')})`;
                    status.style.color = '#4CAF50';
                }
            }

            if (refreshCount > 0 && !locationHelperDone && !locationHelperRunning && !isRefreshing && !stopRequested) {
                console.log(`📍 [${siteName}] Running location helper after refresh...`);
                const result = await performLocationHelper(status);
                if (result) {
                    locationHelperDone = true;
                    console.log(`✅ [${siteName}] Location helper completed!`);
                } else {
                    console.log(`❌ [${siteName}] Location helper failed - Logging out!`);
                    setStopReason('📍 Location Helper Failed');
                    isWaitingForGetExtra = false;
                    waitLoopActive = false;
                    forceLogoutTriggered = true;
                    clearTimerState();
                    if (status) {
                        status.textContent = '📍 Location failed - Logout!';
                        status.style.color = '#ff6b6b';
                    }
                    await sleep(500);
                    await performLogout(status, emailDisplay);
                    return {
                        success: false,
                        found: false,
                        type: 'location_failed_immediate',
                        message: 'Location helper failed'
                    };
                }
            }

            if (elapsed >= totalWaitTime && !forceLogoutTriggered && !stopRequested) {
                console.log(`⏰ [${siteName}] ${settings.timerMinutes}-minute wait completed - No Get Extra`);
                isWaitingForGetExtra = false;
                waitLoopActive = false;
                forceLogoutTriggered = true;
                setStopReason('⏰ Timeout');

                if (waitTimerInterval) {
                    clearInterval(waitTimerInterval);
                    waitTimerInterval = null;
                }

                if (status) {
                    status.textContent = '⏰ No Get Extra - Logout!';
                    status.style.color = '#ffa500';
                }

                clearTimerState();
                await sleep(500);
                await performLogout(status, emailDisplay);

                return {
                    success: true,
                    found: false,
                    type: 'timeout',
                    message: `No Get Extra after ${settings.timerMinutes} minutes`
                };
            }

            if (elapsed % 10 === 0 && elapsed > 0 && !stopRequested) {
                saveTimerState(currentEmail, elapsed, refreshCount, waitStartTime);
            }

            await sleep(1000);
        }

        if (!getExtraDetected) {
            return {
                success: false,
                found: false,
                message: 'Wait loop interrupted'
            };
        }

        return {
            success: true,
            found: getExtraDetected,
            message: getExtraDetected ? 'Get Extra found!' : 'No Get Extra found'
        };
    }

    // ============================================
    // REGISTRATION FUNCTIONS
    // ============================================

    function selectAge28() {
        const ageSelect = document.querySelector('select[name="UserForm[age]"]');
        if (ageSelect) {
            // Use the user setting instead of hardcoded 28
            const targetAge = settings.userAge.toString();
            for (let option of ageSelect.options) {
                if (option.value === targetAge) {
                    ageSelect.value = targetAge;
                    const events = ['change', 'input', 'click'];
                    events.forEach(eventType => {
                        const event = new Event(eventType, { bubbles: true });
                        ageSelect.dispatchEvent(event);
                    });
                    console.log(`✅ Selected age ${targetAge} (from settings)`);
                    return true;
                }
            }
        }
        return false;
    }

    function selectWomanLookingForMan() {
        const genderSelect = document.querySelector('select[name="UserForm[sexual_orientation]"]');
        if (genderSelect) {
            for (let i = 0; i < genderSelect.options.length; i++) {
                const option = genderSelect.options[i];
                const text = option.textContent.trim();

                if (text === 'a woman looking for a man' || text === 'a woman looking for a man ') {
                    genderSelect.selectedIndex = i;
                    const events = ['change', 'input', 'click'];
                    events.forEach(eventType => {
                        const event = new Event(eventType, { bubbles: true });
                        genderSelect.dispatchEvent(event);
                    });
                    console.log('✅ Selected woman looking for man');
                    return true;
                }
            }

            for (let i = 0; i < genderSelect.options.length; i++) {
                const option = genderSelect.options[i];
                if (option.getAttribute('data-gender-value') === 'female' && option.value === 'hetero') {
                    genderSelect.selectedIndex = i;
                    const events = ['change', 'input', 'click'];
                    events.forEach(eventType => {
                        const event = new Event(eventType, { bubbles: true });
                        genderSelect.dispatchEvent(event);
                    });
                    console.log('✅ Selected woman looking for man (by data attribute)');
                    return true;
                }
            }
        }
        return false;
    }

    function enterEmailUniversal(email) {
        return new Promise((resolve) => {
            let emailInput = null;

            const selectors = [
                'input[name="email"]',
                'input[type="email"]',
                'input[placeholder*="email"]',
                'input[autocomplete="email"]',
                'div[data-form-item="email"] input',
                'input[name="UserForm[email]"]'
            ];

            for (let selector of selectors) {
                const element = document.querySelector(selector);
                if (element && (element.type === 'email' || element.type === 'text')) {
                    emailInput = element;
                    break;
                }
            }

            if (emailInput) {
                fillField(emailInput, email, 'Email').then(result => {
                    resolve(result);
                });
            } else {
                console.warn('❌ No email input found');
                resolve({ success: false, value: '' });
            }
        });
    }

    function enterLocationUniversal() {
        return new Promise((resolve) => {
            let locationInput = null;

            const selectors = [
                'input[name="UserForm[location]"]',
                'input[placeholder*="city"]',
                'input[placeholder*="postal"]',
                'input[placeholder*="Enter city"]',
                'input[data-name*="location"]',
                'div[data-form-item="location"] input'
            ];

            for (let selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.type === 'text') {
                    locationInput = element;
                    break;
                }
            }

            if (locationInput) {
                const cities = getCities();
                const randomCity = cities[Math.floor(Math.random() * cities.length)];
                fillField(locationInput, randomCity, 'Location').then(result => {
                    resolve(result);
                });
            } else {
                console.warn('❌ No location input found');
                resolve({ success: false, value: '' });
            }
        });
    }

    function enterPasswordUniversal() {
        return new Promise((resolve) => {
            let passwordInput = null;

            const selectors = [
                'input[name="UserForm[password]"]',
                'input[type="password"]',
                'input[placeholder*="password"]',
                'div[data-form-item="password"] input'
            ];

            for (let selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.type === 'password') {
                    passwordInput = element;
                    break;
                }
            }

            if (passwordInput) {
                // Use the user setting instead of hardcoded 12341234
                const password = settings.userPassword;
                fillField(passwordInput, password, 'Password').then(result => {
                    resolve(result);
                });
            } else {
                console.warn('❌ No password input found');
                resolve({ success: false, value: '' });
            }
        });
    }

    function checkTermsUniversal() {
        let success = false;

        const termsDiv = document.querySelector('div.form-terms');
        if (termsDiv) {
            const checkboxes = termsDiv.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach((checkbox) => {
                if (!checkbox.checked) {
                    checkbox.checked = true;
                    const events = ['change', 'click', 'input'];
                    events.forEach(eventType => {
                        const event = new Event(eventType, { bubbles: true });
                        checkbox.dispatchEvent(event);
                    });
                }
                success = true;
            });
        } else {
            const policyCheckbox = document.querySelector('input[name="UserForm[policyConsent]"]');
            const termsCheckbox = document.querySelector('input[name="UserForm[termsConsent]"]');

            if (policyCheckbox) {
                if (!policyCheckbox.checked) {
                    policyCheckbox.checked = true;
                    policyCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
                success = true;
            }

            if (termsCheckbox) {
                if (!termsCheckbox.checked) {
                    termsCheckbox.checked = true;
                    termsCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
                success = true;
            }
        }

        return success;
    }

    function clickNextButtonUniversal() {
        const nextButton = document.querySelector('div.next-btn');
        if (nextButton) {
            nextButton.click();
            console.log('✅ Clicked Next');
            return true;
        }
        return false;
    }

    function clickSubmitButtonUniversal() {
        const submitDiv = document.querySelector('div.submit-btn');
        if (submitDiv) {
            submitDiv.click();
            const span = submitDiv.querySelector('span');
            if (span) span.click();

            const events = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];
            events.forEach(eventType => {
                const event = new Event(eventType, { bubbles: true, cancelable: true });
                submitDiv.dispatchEvent(event);
            });
            console.log('✅ Clicked Start NOW!');

            registrationEmail = currentEmail;
            console.log(`📧 Registration email locked: ${registrationEmail}`);

            registrationComplete = true;
            timerStarted = true;
            waitStartTime = Date.now();
            getExtraDetected = false;
            getExclusiveDetected = false;
            refreshCount = 0;
            lastRefreshTime = 0;
            refreshTriggered = false;
            waitLoopActive = true;
            forceLogoutTriggered = false;
            locationHelperDone = false;
            locationHelperAttempts = 0;
            locationHelperRunning = false;
            getExtraEmailSaved = false;
            locationHelperCheckDone = false;
            locationHelperCheckTriggered = false;
            registrationFailed = false;
            getExtraDetectedTime = 0;
            getExtraDetectedElapsed = 0;

            setStopReason('');

            console.log(`⏱️ [${siteName}] Timer started (${settings.timerMinutes} minutes)`);
            console.log(`📧 Registration email locked: ${registrationEmail}`);

            saveTimerState(currentEmail, 0, 0, waitStartTime);

            return true;
        }
        return false;
    }

    // ============================================
    // MAIN AUTOMATION FUNCTION
    // ============================================

    async function runAutomation(email, status, startButton, emailDisplay) {
        if (isRunning) return;
        if (stopRequested) return;

        // Reset the global stop flag so the scanners can run again on a fresh start
        isStoppedByGetExtra = false;
        justRegistered = false; // Reset form scanner block

        stopFormScanner();
        stopAvatarScanner();
        stopYesContinueScanner();

        isRunning = true;
        forceLogoutTriggered = false;
        stopRequested = false;
        registrationFailed = false;

        setStopReason('');

        const existingEmail = email || getCurrentEmail();

        if (emailDisplay) {
            emailDisplay.textContent = `📧 ${existingEmail}`;
            emailDisplay.style.color = '#4CAF50';
        }
        const emailInput = document.getElementById('email-input');
        if (emailInput) {
            emailInput.value = existingEmail;
        }

        console.log(`📧 [${siteName}] Using email: ${existingEmail}`);

        const isPostRegistrationPage = window.location.pathname.includes('/funnel/') ||
                                       window.location.pathname.includes('/photoUpload') ||
                                       window.location.pathname.includes('/profile');

        if (isPostRegistrationPage) {
            const savedState = await loadTimerStateAsync();
            if (savedState && savedState.timerStarted) {
                console.log(`🔄 [${siteName}] Post-registration page detected. Restoring timer...`);
                registrationComplete = true;
                timerStarted = true;
                if (savedState.registrationEmail) {
                    registrationEmail = savedState.registrationEmail;
                    currentEmail = registrationEmail;
                    console.log(`📧 Restored registration email: ${registrationEmail}`);
                }
                waitStartTime = savedState.startTime || Date.now();
                refreshCount = savedState.refreshCount || 0;
                lastRefreshTime = savedState.lastRefreshTime || 0;
                getExtraDetected = false;
                getExclusiveDetected = savedState.getExclusiveDetected || false;
                refreshTriggered = false;
                waitLoopActive = true;
                forceLogoutTriggered = false;
                locationHelperDone = savedState.locationHelperDone || false;
                locationHelperAttempts = savedState.locationHelperAttempts || 0;
                locationHelperRunning = false;
                getExtraEmailSaved = false;
                locationHelperCheckDone = savedState.locationHelperCheckDone || false;
                locationHelperCheckTriggered = savedState.locationHelperCheckTriggered || false;
                registrationFailed = false;
                getExtraDetectedTime = 0;
                getExtraDetectedElapsed = 0;

                setStopReason('');

                status.textContent = '⏱️ Restoring timer...';
                status.style.color = '#ffa500';

                if (emailDisplay) {
                    emailDisplay.textContent = `📧 ${registrationEmail}`;
                }
                if (emailInput) {
                    emailInput.value = registrationEmail;
                }

                const waitResult = await waitWithAutoRefresh(status, startButton, emailDisplay, true);

                if (waitResult && waitResult.refreshing) {
                    isRunning = false;
                    return;
                }

                if (waitResult && waitResult.found) {
                    isRunning = false;
                    return;
                } else if (waitResult && waitResult.success && !waitResult.found) {
                    isRunning = false;
                    return;
                }
            }
        }

        status.textContent = '⏳ Running registration...';
        status.style.color = '#ffa500';

        let steps = {};
        let enteredCity = '', enteredPassword = '';

        try {
            console.log(`💕 [${siteName}] Running automation...`);
            console.log(`📧 Using email: ${existingEmail}`);
            console.log(`⏱️ Timer: ${settings.timerMinutes} minutes`);
            console.log(`🎯 Target: ${getCountryGroupLabel()} (${getTargetCount()} countries)`);
            console.log(`🔄 Get Extra: ${settings.stopOnGetExtra ? '🛑 STOP' : '➡️ CONTINUE'}`);

            steps.step1 = clickCookieAccept();
            await sleep(200);
            if (stopRequested) { isRunning = false; return; }

            if (!regButtonClicked) {
                const regButton = document.querySelector('button.open-regform-btn, div.open-regform-btn');
                if (regButton && regButton.offsetParent !== null) {
                    clickRegistrationButton();
                    await sleep(1000);
                }
            }

            steps.step2 = selectAge28();
            steps.step3 = clickNextButtonUniversal();
            await sleep(150);
            if (stopRequested) { isRunning = false; return; }

            steps.step4 = selectWomanLookingForMan();
            steps.step5 = clickNextButtonUniversal();
            await sleep(150);
            if (stopRequested) { isRunning = false; return; }

            const locationResult = await enterLocationUniversal();
            steps.step6 = locationResult.success;
            enteredCity = locationResult.value;
            steps.step7 = clickNextButtonUniversal();
            await sleep(150);
            if (stopRequested) { isRunning = false; return; }

            const passwordResult = await enterPasswordUniversal();
            steps.step8 = passwordResult.success;
            enteredPassword = passwordResult.value;
            steps.step9 = clickNextButtonUniversal();
            await sleep(150);
            if (stopRequested) { isRunning = false; return; }

            const emailResult = await enterEmailUniversal(existingEmail);
            steps.step10 = emailResult.success;
            await sleep(150);
            if (stopRequested) { isRunning = false; return; }

            steps.step11 = checkTermsUniversal();
            await sleep(150);
            if (stopRequested) { isRunning = false; return; }

            steps.step12 = clickSubmitButtonUniversal();

            await sleep(2000);
            if (stopRequested) { isRunning = false; return; }

            const totalSuccess = Object.values(steps).filter(Boolean).length;
            const totalSteps = Object.keys(steps).length;

            const step1To9Failed = !steps.step1 && !steps.step2 && !steps.step3 && !steps.step4 &&
                                   !steps.step5 && !steps.step6 && !steps.step7 && !steps.step8 && !steps.step9;
            const step12Failed = !steps.step12;

            if (step1To9Failed || step12Failed) {
                console.log(`❌ [${siteName}] Registration failed! Logging out...`);
                registrationFailed = true;
                setStopReason('❌ Registration Failed');

                if (status) {
                    status.textContent = '❌ Registration failed - Logout!';
                    status.style.color = '#ff6b6b';
                }

                isWaitingForGetExtra = false;
                waitLoopActive = false;
                forceLogoutTriggered = true;
                clearTimerState();

                if (waitTimerInterval) {
                    clearInterval(waitTimerInterval);
                    waitTimerInterval = null;
                }

                await sleep(1000);
                await performLogout(status, emailDisplay);
                isRunning = false;
                return;
            }

            if (totalSuccess === totalSteps) {
                // 1. Block the form scanner immediately
                justRegistered = true;
                registrationComplete = true;
                timerStarted = true;
                waitStartTime = Date.now();
                getExtraDetected = false;
                getExclusiveDetected = false;
                refreshCount = 0;
                lastRefreshTime = 0;
                refreshTriggered = false;
                waitLoopActive = true;
                forceLogoutTriggered = false;
                locationHelperDone = false;
                locationHelperAttempts = 0;
                locationHelperRunning = false;
                getExtraEmailSaved = false;
                locationHelperCheckDone = false;
                locationHelperCheckTriggered = false;
                registrationFailed = false;
                getExtraDetectedTime = 0;
                getExtraDetectedElapsed = 0;

                setStopReason('');

                console.log(`🎉 [${siteName}] Registration successful! Starting wait...`);
                console.log(`📧 Registration email: ${registrationEmail}`);

                // Start Yes Continue scanner after registration
                startYesContinueScanner(status, emailDisplay);

                status.textContent = `✅ Registration complete! Waiting ${settings.timerMinutes}min...`;
                status.style.color = '#4CAF50';

                await sleep(3000);
                if (stopRequested) { isRunning = false; return; }

                const waitResult = await waitWithAutoRefresh(status, startButton, emailDisplay, false);

                if (waitResult && waitResult.refreshing) {
                    isRunning = false;
                    return;
                }

                if (waitResult && waitResult.found) {
                    if (settings.stopOnGetExtra) {
                        console.log(`🛑 [${siteName}] Get Extra found - Stopped`);
                    } else {
                        console.log(`🔄 [${siteName}] Get Extra saved, continuing...`);
                    }
                    isRunning = false;
                    return;
                } else if (waitResult && waitResult.success && !waitResult.found) {
                    console.log(`🔄 [${siteName}] Logout completed, auto-loop restarting...`);
                    isRunning = false;
                    return;
                } else {
                    status.textContent = '⚠️ Wait interrupted';
                    status.style.color = '#ffa500';
                    isRunning = false;
                    return;
                }
            } else {
                console.log(`❌ [${siteName}] Registration mostly failed - Logging out!`);
                registrationFailed = true;
                setStopReason('❌ Registration Failed');

                if (status) {
                    status.textContent = '❌ Registration failed - Logout!';
                    status.style.color = '#ff6b6b';
                }

                isWaitingForGetExtra = false;
                waitLoopActive = false;
                forceLogoutTriggered = true;
                clearTimerState();

                if (waitTimerInterval) {
                    clearInterval(waitTimerInterval);
                    waitTimerInterval = null;
                }

                await sleep(1000);
                await performLogout(status, emailDisplay);
                isRunning = false;
                return;
            }

        } catch (error) {
            console.error(`❌ [${siteName}] Error during automation:`, error);
            status.textContent = '❌ Error - Logging out...';
            status.style.color = '#ff6b6b';
            startButton.style.background = '#f44336';
            startButton.textContent = '❌ Error';
            setStopReason('⚠️ Script Error');

            registrationFailed = true;
            isWaitingForGetExtra = false;
            waitLoopActive = false;
            forceLogoutTriggered = true;
            clearTimerState();

            if (waitTimerInterval) {
                clearInterval(waitTimerInterval);
                waitTimerInterval = null;
            }

            await sleep(1000);
            await performLogout(status, emailDisplay);
            isRunning = false;
            return;
        }

        setTimeout(() => {
            if (startButton.textContent !== '✅ Get Extra!') {
                startButton.style.background = '#4CAF50';
                startButton.textContent = 'Start';
            }
            if (status.textContent !== '✅ GET EXTRA FOUND!') {
                status.textContent = 'Ready';
                status.style.color = '#aaa';
            }
            isRunning = false;
        }, 3000);
    }

    // ============================================
    // ORIGINAL LOCATION HELPER (for manual use)
    // ============================================

    function fillLocationHelper(status) {
        console.log('📍 Flag button clicked!');
        status.textContent = '📍 Opening location...';
        status.style.color = '#ffa500';

        const locationDisplay = document.querySelector('.XyU.XyL');
        if (locationDisplay) {
            let clickable = locationDisplay.closest('.ZZ');
            if (!clickable) clickable = locationDisplay.closest('.Xyb');
            if (!clickable) clickable = locationDisplay.closest('.Xjz');

            if (clickable) {
                clickable.click();
                status.textContent = '✅ Step 1: Opened!';
                status.style.color = '#4CAF50';
                console.log('✅ Step 1: Clicked location');

                setTimeout(() => {
                    const allStatesOptions = document.querySelectorAll('.Rq, .Rr, .Rs, .Rt, .Ru');
                    let found = false;
                    for (let el of allStatesOptions) {
                        const text = el.textContent.trim();
                        if (text === 'All states' || text === 'All cities' || text === 'Any city') {
                            el.click();
                            found = true;
                            status.textContent = '✅ Step 2: Selected "All states"!';
                            status.style.color = '#4CAF50';
                            console.log('✅ Step 2: Selected "All states"');
                            break;
                        }
                    }

                    if (!found) {
                        const allItems = document.querySelectorAll('.Rq, .Rr, .Rs, .Rt, .Ru, .Rw, .Rx, .Ry, .Rz');
                        for (let el of allItems) {
                            const text = el.textContent.trim();
                            if (text.length > 0 && !text.includes('Select')) {
                                el.click();
                                found = true;
                                status.textContent = `✅ Step 2: Selected "${text}"!`;
                                status.style.color = '#4CAF50';
                                console.log(`✅ Step 2: Selected "${text}"`);
                                break;
                            }
                        }
                    }

                    if (!found) {
                        console.log('⚠️ No "All states" option found');
                        status.textContent = '⚠️ Could not find "All states"';
                        status.style.color = '#ffa500';
                    }

                    setTimeout(() => {
                        console.log('🔍 Looking for "Countries" or "All countries"...');

                        const countryOptions = document.querySelectorAll('.Rq, .Rr, .Rs, .Rt, .Ru, .Rw, .Rx, .Ry, .Rz, div[class*="item"]');
                        let countryFound = false;

                        for (let el of countryOptions) {
                            const text = el.textContent.trim();
                            if (text === 'Countries' || text === 'Countries ' || text.includes('Countries')) {
                                el.click();
                                countryFound = true;
                                status.textContent = '✅ Step 3: Selected "Countries"!';
                                status.style.color = '#4CAF50';
                                console.log('✅ Step 3: Selected "Countries"');
                                break;
                            }
                        }

                        if (!countryFound) {
                            console.log('🔍 "Countries" not found, looking for "All countries"...');
                            for (let el of countryOptions) {
                                const text = el.textContent.trim();
                                if (text === 'All countries' || text === 'All countries ' || text.includes('All countries')) {
                                    el.click();
                                    countryFound = true;
                                    status.textContent = '✅ Step 3: Selected "All countries"!';
                                    status.style.color = '#4CAF50';
                                    console.log('✅ Step 3: Selected "All countries"');
                                    break;
                                }
                            }
                        }

                        if (!countryFound) {
                            for (let el of countryOptions) {
                                const text = el.textContent.trim();
                                if (text.length > 0 && !text.includes('Select') && !text.includes('Choose')) {
                                    if (text.length <= 30 && !text.includes(' ')) {
                                        el.click();
                                        countryFound = true;
                                        status.textContent = `✅ Step 3: Selected "${text}"!`;
                                        status.style.color = '#4CAF50';
                                        console.log(`✅ Step 3: Selected "${text}"`);
                                        break;
                                    }
                                }
                            }
                        }

                        if (!countryFound) {
                            console.log('⚠️ No "Countries" or "All countries" option found');
                            status.textContent = '⚠️ Could not find "Countries" or "All countries"';
                            status.style.color = '#ffa500';
                        }

                        console.log('✅ Location helper complete!');
                        setTimeout(() => {
                            status.textContent = '✅ Location helper complete!';
                            status.style.color = '#4CAF50';
                            setTimeout(() => {
                                status.textContent = 'Ready';
                                status.style.color = '#aaa';
                            }, 2000);
                        }, 500);

                    }, 400);

                }, 300);

                return true;
            }
        }

        const locationInput = document.querySelector('input[name="UserForm[location]"]');
        if (locationInput) {
            const cities = getCities();
            const randomCity = cities[Math.floor(Math.random() * cities.length)];
            fillField(locationInput, randomCity, 'Location').then(() => {
                status.textContent = `✅ Location: ${randomCity}`;
                status.style.color = '#4CAF50';
                setTimeout(() => {
                    status.textContent = 'Ready';
                    status.style.color = '#aaa';
                }, 2000);
            });
            return true;
        }

        status.textContent = '❌ Location not found';
        status.style.color = '#ff6b6b';
        setTimeout(() => {
            status.textContent = 'Ready';
            status.style.color = '#aaa';
        }, 2000);
        return false;
    }

    // ============================================
    // TOGGLE SWITCH
    // ============================================

    function createToggleSwitch() {
        const toggleContainer = document.createElement('div');
        toggleContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 10px;
            justify-content: center;
        `;

        const toggleLabel = document.createElement('span');
        toggleLabel.textContent = 'Stop on Get Extra:';
        toggleLabel.style.cssText = `
            color: #aaa;
            font-size: 14px;
            font-weight: bold;
        `;
        toggleContainer.appendChild(toggleLabel);

        const switchContainer = document.createElement('div');
        switchContainer.style.cssText = `
            position: relative;
            width: 50px;
            height: 28px;
            background: ${settings.stopOnGetExtra ? '#4CAF50' : '#555'};
            border-radius: 14px;
            cursor: pointer;
            transition: background 0.3s ease;
            flex-shrink: 0;
        `;
        toggleContainer.appendChild(switchContainer);

        const switchKnob = document.createElement('div');
        switchKnob.style.cssText = `
            position: absolute;
            top: 2px;
            left: ${settings.stopOnGetExtra ? '24px' : '2px'};
            width: 24px;
            height: 24px;
            background: white;
            border-radius: 50%;
            transition: left 0.3s ease;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        `;
        switchContainer.appendChild(switchKnob);

        const toggleStatus = document.createElement('span');
        toggleStatus.textContent = settings.stopOnGetExtra ? '🛑' : '➡️';
        toggleStatus.style.cssText = `
            color: ${settings.stopOnGetExtra ? '#ff6b6b' : '#4CAF50'};
            font-size: 16px;
            font-weight: bold;
            min-width: 30px;
        `;
        toggleContainer.appendChild(toggleStatus);

        switchContainer.addEventListener('click', function() {
            settings.stopOnGetExtra = !settings.stopOnGetExtra;
            chromeSetValue(getStorageKey('stopOnGetExtra'), settings.stopOnGetExtra);

            switchContainer.style.background = settings.stopOnGetExtra ? '#4CAF50' : '#555';
            switchKnob.style.left = settings.stopOnGetExtra ? '24px' : '2px';
            toggleStatus.textContent = settings.stopOnGetExtra ? '🛑' : '➡️';
            toggleStatus.style.color = settings.stopOnGetExtra ? '#ff6b6b' : '#4CAF50';

            console.log(`🔄 [${siteName}] Get Extra behavior: ${settings.stopOnGetExtra ? '🛑 STOP' : '➡️ CONTINUE'}`);

            const status = document.querySelector('#auto-clicker-gui .gui-status');
            if (status) {
                status.textContent = settings.stopOnGetExtra ? '🛑 Mode: Stop' : '➡️ Mode: Continue';
                status.style.color = '#4CAF50';
                setTimeout(() => {
                    if (!status.textContent.includes('⏱️') && !status.textContent.includes('✅') && !status.textContent.includes('🔄')) {
                        status.textContent = 'Ready';
                        status.style.color = '#aaa';
                    }
                }, 2000);
            }
        });

        return toggleContainer;
    }

    // ============================================
    // AUTO LOOP RESTART - GENERATES NEW EMAIL
    // ============================================

    function checkAndAutoRestart() {
        chromeGetValue(getAutoRestartKey(), 'false').then(needRestart => {
            if (needRestart === 'true' && !stopRequested) {
                console.log(`🔄 [${siteName}] Auto-restart flag detected...`);
                chromeSetValue(getAutoRestartKey(), 'false');

                window._autoRestarting = false;

                const status = document.querySelector('#auto-clicker-gui .gui-status');
                const startButton = document.querySelector('#auto-clicker-gui .start-btn');
                const emailDisplay = document.getElementById('email-display');

                const newEmail = refreshEmail();
                console.log(`📧 [${siteName}] New email: ${newEmail}`);

                if (status && startButton && emailDisplay) {
                    console.log(`🔄 [${siteName}] Auto-starting with NEW email: ${newEmail}`);

                    if (newEmail) {
                        emailDisplay.textContent = `📧 ${newEmail}`;
                        emailDisplay.style.color = '#4CAF50';
                        const emailInput = document.getElementById('email-input');
                        if (emailInput) {
                            emailInput.value = newEmail;
                        }
                    }

                    status.textContent = '🔄 Restarting...';
                    status.style.color = '#4CAF50';

                    setStopReason('');
                    updateStopReasonDisplay();

                    isRunning = false;
                    registrationAttempted = false;
                    registrationFormDetected = false;
                    regButtonClicked = false;
                    formScannerRetries = 0;

                    // Start scanners
                    setTimeout(() => {
                        startAvatarScanner(status, emailDisplay);
                        startYesContinueScanner(status, emailDisplay);
                    }, 3000);

                    setTimeout(() => {
                        startFormScanner();
                    }, 1000);

                    setTimeout(() => {
                        if (!stopRequested && !isRunning) {
                            console.log(`🔄 [${siteName}] Starting automation after restart...`);
                            const formDetected = detectRegistrationForm();
                            if (formDetected) {
                                stopAvatarScanner();
                                stopYesContinueScanner();
                                runAutomation(newEmail, status, startButton, emailDisplay);
                            } else {
                                console.log(`🔄 [${siteName}] No form detected, waiting for scanner...`);
                                if (!isFormDetectionActive) {
                                    startFormScanner();
                                }
                                setTimeout(() => {
                                    if (!stopRequested && !isRunning) {
                                        const formDetected2 = detectRegistrationForm();
                                        if (formDetected2) {
                                            stopAvatarScanner();
                                            stopYesContinueScanner();
                                            runAutomation(newEmail, status, startButton, emailDisplay);
                                        } else {
                                            console.log(`🔄 [${siteName}] No form detected, will retry...`);
                                            if (!isFormDetectionActive) {
                                                startFormScanner();
                                            }
                                        }
                                    }
                                }, 5000);
                            }
                        }
                    }, 3000);
                } else {
                    console.log(`⚠️ [${siteName}] Auto-restart: GUI not found, retrying...`);
                    setTimeout(() => {
                        if (!stopRequested) {
                            checkAndAutoRestart();
                        }
                    }, 3000);
                }
            } else if (needRestart === 'true' && stopRequested) {
                console.log(`🛑 [${siteName}] Auto-restart cancelled - stop requested`);
                chromeSetValue(getAutoRestartKey(), 'false');
                window._autoRestarting = false;
                stopAvatarScanner();
                stopYesContinueScanner();
            }
        });
    }

    // ============================================
    // GUI CREATION
    // ============================================

    async function createGUI() {
        // First check if approved
        const approved = await checkApprovalStatus();
        
        if (!approved || isDeactivated) {
            console.log('🔷 Extension not approved - GUI will not be shown');
            showDeactivationNotification('Extension is not activated');
            return;
        }

        console.log('✅ Extension approved - Creating GUI...');

        const existingGUI = document.getElementById('auto-clicker-gui');
        if (existingGUI) {
            existingGUI.remove();
        }

        const gui = document.createElement('div');
        gui.id = 'auto-clicker-gui';

        gui.style.cssText = `
            position: fixed;
            top: 20px;
            left: 20px;
            z-index: 999999;
            background: rgba(0, 0, 0, 0.92);
            padding: 24px 28px;
            border-radius: 16px;
            border: 3px solid #666;
            box-shadow: 0 8px 40px rgba(0, 0, 0, 0.95);
            font-family: Arial, sans-serif;
            width: 420px;
            max-width: 420px;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            touch-action: manipulation;
            min-width: 420px;
            transform: scale(1.25);
            transform-origin: top left;
        `;

        // Title
        const title = document.createElement('div');
        title.className = 'gui-title';
        const flagMap = {
            'UK': '🇬🇧',
            'US': '🇺🇸',
            'CA': '🇨🇦',
            'AU': '🇦🇺',
            'FR': '🇫🇷',
            'DE': '🇩🇪',
            'NL': '🇳🇱',
            'BE': '🇧🇪',
            'IT': '🇮🇹'
        };
        const flag = flagMap[settings.country] || '🌍';
        
        // =========== UPDATED POWERED BY TEXT (BIGGER & RED) ===========
        title.innerHTML = `
            ${flag} ${siteName} Auto<br>
            <span style="font-size:15px; color:#ff4444; font-weight:bold;">Powered by SamePerson @METHOWDS</span>
        `;
        // ============================================================
        
        title.style.cssText = `
            color: white;
            font-size: 22px;
            text-align: center;
            margin-bottom: 14px;
            opacity: 0.95;
            font-weight: bold;
            line-height: 1.4;
        `;
        gui.appendChild(title);

        // Stop Reason Display
        const stopReasonDisplay = document.createElement('div');
        stopReasonDisplay.id = 'stop-reason-display';
        stopReasonDisplay.textContent = '✅ Running';
        stopReasonDisplay.style.cssText = `
            color: #4CAF50;
            font-size: 18px;
            text-align: center;
            margin-bottom: 14px;
            padding: 8px 14px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            border: 1px solid rgba(76, 175, 80, 0.2);
            font-weight: bold;
            min-height: 32px;
            display: block;
            word-break: break-all;
        `;
        gui.appendChild(stopReasonDisplay);

        // Row: Timer + Country
        const topRow = document.createElement('div');
        topRow.style.cssText = `
            display: flex;
            gap: 12px;
            margin-bottom: 14px;
        `;

        // Timer
        const timerGroup = document.createElement('div');
        timerGroup.style.cssText = `
            flex: 1;
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        const timerLabel = document.createElement('span');
        timerLabel.textContent = '⏱️';
        timerLabel.style.cssText = `color: #aaa; font-size: 20px;`;
        timerGroup.appendChild(timerLabel);

        const timerInput = document.createElement('input');
        timerInput.type = 'number';
        timerInput.id = 'timer-input';
        timerInput.min = '1';
        timerInput.max = '999';
        timerInput.value = settings.timerMinutes;
        timerInput.style.cssText = `
            width: 55px;
            padding: 6px 8px;
            border: 1px solid #555;
            border-radius: 6px;
            background: #333;
            color: white;
            font-size: 18px;
            text-align: center;
            box-sizing: border-box;
            min-height: 38px;
        `;
        timerGroup.appendChild(timerInput);

        const timerUnit = document.createElement('span');
        timerUnit.textContent = 'min';
        timerUnit.style.cssText = `color: #aaa; font-size: 16px;`;
        timerGroup.appendChild(timerUnit);

        topRow.appendChild(timerGroup);

        // Country Select
        const countrySelect = document.createElement('select');
        countrySelect.id = 'country-select';
        countrySelect.style.cssText = `
            flex: 1.2;
            padding: 6px 8px;
            border: 1px solid #555;
            border-radius: 6px;
            background: #333;
            color: white;
            font-size: 17px;
            box-sizing: border-box;
            min-height: 38px;
        `;
        const countryOptions = [
            { value: 'UK', label: '🇬🇧 UK' },
            { value: 'US', label: '🇺🇸 USA' },
            { value: 'CA', label: '🇨🇦 Canada' },
            { value: 'AU', label: '🇦🇺 Australia' },
            { value: 'FR', label: '🇫🇷 France' },
            { value: 'DE', label: '🇩🇪 Germany' },
            { value: 'NL', label: '🇳🇱 Netherlands' },
            { value: 'BE', label: '🇧🇪 Belgium' },
            { value: 'IT', label: '🇮🇹 Italy' }
        ];
        countryOptions.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.value === settings.country) option.selected = true;
            countrySelect.appendChild(option);
        });
        topRow.appendChild(countrySelect);

        gui.appendChild(topRow);

        // =========== ADD AGE AND PASSWORD INPUTS ===========
        const settingsRow = document.createElement('div');
        settingsRow.style.cssText = `
            display: flex;
            gap: 12px;
            margin-bottom: 14px;
        `;

        // Age Input
        const ageGroup = document.createElement('div');
        ageGroup.style.cssText = `
            flex: 1;
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        const ageLabel = document.createElement('span');
        ageLabel.textContent = '🎂';
        ageLabel.style.cssText = `color: #aaa; font-size: 18px;`;
        ageGroup.appendChild(ageLabel);

        const ageInput = document.createElement('input');
        ageInput.type = 'number';
        ageInput.id = 'age-input';
        ageInput.min = '18';
        ageInput.max = '99';
        ageInput.value = settings.userAge;
        ageInput.style.cssText = `
            width: 50px;
            padding: 6px 8px;
            border: 1px solid #555;
            border-radius: 6px;
            background: #333;
            color: white;
            font-size: 18px;
            text-align: center;
            box-sizing: border-box;
            min-height: 38px;
        `;
        ageGroup.appendChild(ageInput);
        settingsRow.appendChild(ageGroup);

        // Password Input (Masked with **** + Eye Toggle Icon INSIDE the box)
        const passWrapper = document.createElement('div');
        passWrapper.style.cssText = `
            flex: 2;
            display: flex;
            align-items: center;
            position: relative;
        `;

        const passLabel = document.createElement('span');
        passLabel.textContent = '🔑';
        passLabel.style.cssText = `color: #aaa; font-size: 18px; margin-right: 8px;`;
        passWrapper.appendChild(passLabel);

        const passInput = document.createElement('input');
        passInput.type = 'password';
        passInput.id = 'pass-input';
        passInput.value = settings.userPassword;
        passInput.style.cssText = `
            flex: 1;
            padding: 6px 30px 6px 8px; /* Extra right padding for the icon */
            border: 1px solid #555;
            border-radius: 6px;
            background: #333;
            color: white;
            font-size: 16px;
            text-align: left;
            box-sizing: border-box;
            min-height: 38px;
            width: 100%;
        `;
        passWrapper.appendChild(passInput);

        // Eye Icon INSIDE the input box (Absolute positioning)
        const eyeBtn = document.createElement('span');
        eyeBtn.textContent = '👁️';
        eyeBtn.style.cssText = `
            position: absolute;
            right: 10px;
            top: 50%;
            transform: translateY(-50%);
            cursor: pointer;
            font-size: 18px;
            color: #aaa;
            user-select: none;
            z-index: 2;
            background: transparent;
            border: none;
            padding: 0;
            line-height: 1;
        `;
        eyeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (passInput.type === 'password') {
                passInput.type = 'text';
                this.textContent = '🙈';
            } else {
                passInput.type = 'password';
                this.textContent = '👁️';
            }
        });
        passWrapper.appendChild(eyeBtn);

        settingsRow.appendChild(passWrapper);
        gui.appendChild(settingsRow);

        // Event listeners for Age and Password
        ageInput.addEventListener('change', function() {
            let val = parseInt(this.value);
            if (isNaN(val) || val < 18) val = 18;
            if (val > 99) val = 99;
            settings.userAge = val;
            chromeSetValue(getStorageKey('userAge'), settings.userAge);
            console.log(`🎂 Age set to ${settings.userAge}`);
        });

        passInput.addEventListener('change', function() {
            const val = this.value.trim();
            if (val.length >= 4) {
                settings.userPassword = val;
                chromeSetValue(getStorageKey('userPassword'), settings.userPassword);
                console.log(`🔑 Password updated`);
            } else {
                this.value = settings.userPassword;
                console.warn('⚠️ Password must be at least 4 characters');
            }
        });
        // ====================================================

        // Toggle Switch
        const toggleSwitch = createToggleSwitch();
        gui.appendChild(toggleSwitch);

        // Email Display
        const emailDisplay = document.createElement('div');
        emailDisplay.id = 'email-display';
        const displayEmail = registrationEmail || currentEmail || 'No email';
        emailDisplay.textContent = `📧 ${displayEmail}`;
        emailDisplay.style.cssText = `
            color: #4CAF50;
            font-size: 18px;
            text-align: center;
            margin-bottom: 10px;
            padding: 8px 14px;
            background: rgba(76, 175, 80, 0.1);
            border-radius: 8px;
            border: 1px solid rgba(76, 175, 80, 0.2);
            font-family: 'Courier New', monospace;
            word-break: break-all;
            font-weight: bold;
            min-height: 34px;
        `;
        gui.appendChild(emailDisplay);

        // Get Extra Count
        loadGetExtraData().then(data => {
            const getExtraDisplay = document.createElement('div');
            getExtraDisplay.id = 'get-extra-count';
            getExtraDisplay.textContent = `📋 ${data.length}`;
            getExtraDisplay.style.cssText = `
                color: #FF9800;
                font-size: 17px;
                text-align: center;
                margin-bottom: 10px;
                padding: 6px 14px;
                background: rgba(255, 152, 0, 0.1);
                border-radius: 8px;
                border: 1px solid rgba(255, 152, 0, 0.2);
                font-weight: bold;
                min-height: 32px;
            `;
            gui.appendChild(getExtraDisplay);
        });

        // Buttons Row 1
        const buttonRow1 = document.createElement('div');
        buttonRow1.style.cssText = `
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
        `;

        const startButton = document.createElement('button');
        startButton.className = 'start-btn';
        startButton.textContent = '▶ Start';
        startButton.style.cssText = `
            flex: 1;
            padding: 10px 16px;
            font-size: 18px;
            font-weight: bold;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.3s ease;
            touch-action: manipulation;
            min-height: 44px;
        `;
        startButtonElement = startButton;

        const stopButton = document.createElement('button');
        stopButton.textContent = '⏹';
        stopButton.style.cssText = `
            padding: 10px 16px;
            font-size: 20px;
            font-weight: bold;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.3s ease;
            touch-action: manipulation;
            min-height: 44px;
            min-width: 50px;
        `;

        const flagButton = document.createElement('button');
        flagButton.textContent = '📍';
        flagButton.style.cssText = `
            padding: 10px 14px;
            font-size: 22px;
            font-weight: bold;
            background: #FF9800;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.3s ease;
            touch-action: manipulation;
            min-height: 44px;
            min-width: 50px;
        `;

        const refreshButton = document.createElement('button');
        refreshButton.textContent = '🔄';
        refreshButton.style.cssText = `
            padding: 10px 14px;
            font-size: 22px;
            font-weight: bold;
            background: #2196F3;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.3s ease;
            touch-action: manipulation;
            min-height: 44px;
            min-width: 50px;
        `;

        buttonRow1.appendChild(startButton);
        buttonRow1.appendChild(stopButton);
        buttonRow1.appendChild(flagButton);
        buttonRow1.appendChild(refreshButton);
        gui.appendChild(buttonRow1);

        // Buttons Row 2
        const buttonRow2 = document.createElement('div');
        buttonRow2.style.cssText = `
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
        `;

        const logoutButton = document.createElement('button');
        logoutButton.textContent = '🚪 Logout';
        logoutButton.style.cssText = `
            flex: 1;
            padding: 10px 16px;
            font-size: 17px;
            font-weight: bold;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.3s ease;
            touch-action: manipulation;
            min-height: 44px;
        `;

        const copyButton = document.createElement('button');
        copyButton.textContent = '📋';
        copyButton.style.cssText = `
            padding: 10px 16px;
            font-size: 22px;
            font-weight: bold;
            background: #00BCD4;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.3s ease;
            touch-action: manipulation;
            min-height: 44px;
            min-width: 50px;
        `;

        const clearButton = document.createElement('button');
        clearButton.textContent = '🗑️';
        clearButton.style.cssText = `
            padding: 10px 14px;
            font-size: 22px;
            font-weight: bold;
            background: #607D8B;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.3s ease;
            touch-action: manipulation;
            min-height: 44px;
            min-width: 50px;
        `;

        buttonRow2.appendChild(logoutButton);
        buttonRow2.appendChild(copyButton);
        buttonRow2.appendChild(clearButton);
        gui.appendChild(buttonRow2);

        // Status
        const status = document.createElement('div');
        status.className = 'gui-status';
        status.textContent = 'Ready';
        status.style.cssText = `
            color: #aaa;
            font-size: 17px;
            text-align: center;
            margin-top: 8px;
            min-height: 28px;
            font-weight: normal;
            line-height: 1.4;
        `;
        gui.appendChild(status);

        document.body.appendChild(gui);

        // ============================================
        // EVENT LISTENERS
        // ============================================

        updateStopReasonDisplay();

        // Timer change
        timerInput.addEventListener('change', function() {
            let val = parseInt(this.value);
            if (isNaN(val) || val < 1) val = 1;
            if (val > 999) val = 999;
            settings.timerMinutes = val;
            totalWaitTime = settings.timerMinutes * 60;
            chromeSetValue(getStorageKey('timerMinutes'), settings.timerMinutes);
            console.log(`⏱️ Timer set to ${settings.timerMinutes} minutes`);
            status.textContent = `⏱️ Timer: ${settings.timerMinutes}min`;
            status.style.color = '#4CAF50';
            setTimeout(() => {
                if (!status.textContent.includes('⏱️') && !status.textContent.includes('✅') && !status.textContent.includes('🔄')) {
                    status.textContent = 'Ready';
                    status.style.color = '#aaa';
                }
            }, 2000);
        });

        // Country change
        countrySelect.addEventListener('change', function() {
            settings.country = this.value;
            chromeSetValue(getStorageKey('country'), this.value);
            locationHelperDone = false;
            locationHelperCheckDone = false;
            locationHelperCheckTriggered = false;
            console.log(`🌍 Country: ${settings.country}`);
            status.textContent = `🌍 ${settings.country}`;
            status.style.color = '#4CAF50';
            setTimeout(() => {
                if (!status.textContent.includes('⏱️') && !status.textContent.includes('✅') && !status.textContent.includes('🔄')) {
                    status.textContent = 'Ready';
                    status.style.color = '#aaa';
                }
            }, 2000);
        });

        // Start button
        startButton.addEventListener('click', function(e) {
            e.preventDefault();
            if (stopRequested) {
                stopRequested = false;
                stopButton.textContent = '⏹';
                stopButton.style.background = '#f44336';
                startButton.textContent = '▶ Start';
                startButton.style.background = '#4CAF50';
                setStopReason('');
                updateStopReasonDisplay();
            }
            const freshEmail = generateEmail();
            saveEmailToStorage(freshEmail);
            currentEmail = freshEmail;
            registrationEmail = freshEmail;
            emailDisplay.textContent = `📧 ${freshEmail}`;
            emailDisplay.style.color = '#4CAF50';
            console.log(`📧 [${siteName}] NEW email: ${freshEmail}`);
            stopAvatarScanner();
            stopYesContinueScanner();
            runAutomation(freshEmail, status, startButton, emailDisplay);
        });

        // Stop button
        stopButton.addEventListener('click', function() {
            setStopReason('🛑 User Stopped');
            stopEverything(status);
            stopButton.textContent = '⏹';
            stopButton.style.background = '#757575';
            updateStopReasonDisplay();
            stopAvatarScanner();
            stopYesContinueScanner();
            setTimeout(() => {
                if (stopButton.textContent === '⏹') {
                    stopButton.textContent = '⏹';
                    stopButton.style.background = '#f44336';
                }
            }, 3000);
        });

        // Flag button
        flagButton.addEventListener('click', function() {
            if (stopRequested) {
                stopRequested = false;
                stopButton.textContent = '⏹';
                stopButton.style.background = '#f44336';
                startButton.textContent = '▶ Start';
                startButton.style.background = '#4CAF50';
                setStopReason('');
                updateStopReasonDisplay();
            }
            stopAvatarScanner();
            stopYesContinueScanner();
            fillLocationHelper(status);
        });

        // Refresh button
        refreshButton.addEventListener('click', function() {
            if (stopRequested) {
                stopRequested = false;
                stopButton.textContent = '⏹';
                stopButton.style.background = '#f44336';
                startButton.textContent = '▶ Start';
                startButton.style.background = '#4CAF50';
                setStopReason('');
                updateStopReasonDisplay();
            }
            status.textContent = '🔄 Refreshing...';
            status.style.color = '#ffa500';
            stopAvatarScanner();
            stopYesContinueScanner();
            location.reload();
        });

        // Logout button
        logoutButton.addEventListener('click', function() {
            if (stopRequested) {
                stopRequested = false;
                stopButton.textContent = '⏹';
                stopButton.style.background = '#f44336';
                startButton.textContent = '▶ Start';
                startButton.style.background = '#4CAF50';
                setStopReason('');
                updateStopReasonDisplay();
            }
            stopAvatarScanner();
            stopYesContinueScanner();
            performLogout(status, emailDisplay);
        });

        // Copy button
        copyButton.addEventListener('click', function() {
            copyGetExtraEmails();
        });

        // Clear button
        clearButton.addEventListener('click', function() {
            if (confirm('Clear all Get Extra emails?')) {
                clearGetExtraEmails().then(() => {
                    status.textContent = '🗑️ Cleared';
                    status.style.color = '#ffa500';
                    setTimeout(() => {
                        status.textContent = 'Ready';
                        status.style.color = '#aaa';
                    }, 2000);
                });
            }
        });

        // Restore timer state
        const savedState = await loadTimerStateAsync();
        if (savedState && savedState.timerStarted) {
            console.log(`🔄 [${siteName}] Found saved timer state - restoring...`);
            registrationComplete = true;
            timerStarted = true;
            if (savedState.registrationEmail) {
                registrationEmail = savedState.registrationEmail;
                currentEmail = registrationEmail;
                console.log(`📧 Restored registration email: ${registrationEmail}`);
            }
            waitStartTime = savedState.startTime || Date.now();
            refreshCount = savedState.refreshCount || 0;
            lastRefreshTime = savedState.lastRefreshTime || 0;
            getExclusiveDetected = savedState.getExclusiveDetected || false;
            locationHelperDone = savedState.locationHelperDone || false;
            locationHelperAttempts = savedState.locationHelperAttempts || 0;
            locationHelperCheckDone = savedState.locationHelperCheckDone || false;
            locationHelperCheckTriggered = savedState.locationHelperCheckTriggered || false;

            status.textContent = `⏱️ Restoring... (${refreshCount})`;
            status.style.color = '#ffa500';

            const displayEmail = registrationEmail || currentEmail;
            emailDisplay.textContent = `📧 ${displayEmail}`;

            stopAvatarScanner();
            stopYesContinueScanner();

            setTimeout(() => {
                waitWithAutoRefresh(status, startButton, emailDisplay, true);
            }, 2000);
        }

        console.log(`🟢 [${siteName}] GUI loaded`);
        console.log(`📧 Email: ${registrationEmail || currentEmail}`);
        const data = await loadGetExtraData();
        console.log(`📋 Get Extra: ${data.length}`);
        console.log(`⏱️ Timer: ${settings.timerMinutes}min`);
        console.log(`🎯 Target: ${getCountryGroupLabel()} (${getTargetCount()} countries)`);
        console.log(`🔄 Mode: ${settings.stopOnGetExtra ? '🛑 STOP' : '➡️ CONTINUE'}`);
        console.log(`🎂 Age: ${settings.userAge}`);
        console.log(`🔑 Password: ${settings.userPassword}`);
    }

    // ============================================
    // STOP EVERYTHING
    // ============================================

    function stopEverything(status) {
        stopRequested = true;
        isRunning = false;
        stopFormScanner();
        stopAvatarScanner();
        stopYesContinueScanner();
        registrationAttempted = false;
        registrationFormDetected = false;
        regButtonClicked = false;

        if (waitTimerInterval) {
            clearInterval(waitTimerInterval);
            waitTimerInterval = null;
        }

        if (autoRestartTimer) {
            clearInterval(autoRestartTimer);
            autoRestartTimer = null;
        }

        isWaitingForGetExtra = false;
        waitLoopActive = false;
        forceLogoutTriggered = true;

        clearTimerState();
        chromeSetValue(getAutoRestartKey(), 'false');

        if (status) {
            status.textContent = '🛑 Stopped';
            status.style.color = '#ff6b6b';
        }

        console.log('🛑 [STOP] Everything stopped');
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    async function init() {
        if (!isSupportedSite) return;

        // Check if already deactivated
        if (isDeactivated) {
            console.log('🔷 Extension is deactivated - not showing GUI');
            showDeactivationNotification('Extension is deactivated');
            return;
        }

        // Load settings first
        await loadSettings();

        // Check if approved before showing GUI
        const approved = await checkApprovalStatus();
        
        if (approved && !isDeactivated) {
            console.log('✅ Extension approved - Initializing GUI...');
            const initialEmail = generateEmail();
            saveEmailToStorage(initialEmail);
            currentEmail = initialEmail;
            registrationEmail = initialEmail;
            console.log(`📧 [${siteName}] Initial email: ${initialEmail}`);

            const isRestarting = window._autoRestarting === true;
            if (isRestarting) {
                console.log(`🔄 [${siteName}] Page loaded as part of auto-restart`);
                window._autoRestarting = false;
            }

            const createGUIAndInit = async () => {
                await createGUI();
                setTimeout(() => {
                    checkAndAutoRestart();
                    setTimeout(startFormScanner, 2000);

                    // Start scanners to detect stuck restart and Yes Continue
                    setTimeout(() => {
                        const status = document.querySelector('#auto-clicker-gui .gui-status');
                        const emailDisplay = document.getElementById('email-display');
                        startAvatarScanner(status, emailDisplay);
                        startYesContinueScanner(status, emailDisplay);
                    }, 5000);

                    if (isRestarting) {
                        setTimeout(() => {
                            if (!stopRequested && !isRunning) {
                                const status = document.querySelector('#auto-clicker-gui .gui-status');
                                const startButton = document.querySelector('#auto-clicker-gui .start-btn');
                                const emailDisplay = document.getElementById('email-display');
                                const existingEmail = getCurrentEmail();

                                if (status && startButton && emailDisplay && existingEmail) {
                                    const formDetected = detectRegistrationForm();
                                    if (formDetected) {
                                        console.log(`🔄 [${siteName}] Auto-restart: Form detected, starting...`);
                                        stopAvatarScanner();
                                        stopYesContinueScanner();
                                        runAutomation(existingEmail, status, startButton, emailDisplay);
                                    } else {
                                        console.log(`🔄 [${siteName}] Auto-restart: No form, waiting for scanner...`);
                                        if (!isFormDetectionActive) {
                                            startFormScanner();
                                        }
                                    }
                                }
                            }
                        }, 3000);
                    }
                }, 3000);
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', createGUIAndInit);
            } else {
                createGUIAndInit();
            }
        } else {
            console.log('🔷 Extension not approved - Waiting for activation...');
            showDeactivationNotification('Extension is not activated');
        }
    }

    // Set up periodic auto-restart check
    setInterval(() => {
        if (!stopRequested && !isRunning && !isLoggingOut && !logoutInProgress) {
            chromeGetValue(getAutoRestartKey(), 'false').then(needRestart => {
                if (needRestart === 'true') {
                    console.log(`🔄 [${siteName}] Auto-restart check triggered by interval`);
                    checkAndAutoRestart();
                }
            });
        }
    }, 10000);

    // Start initialization
    init();

})();