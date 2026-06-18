        // ---------- Global state ----------
        const DEFAULT_CATEGORIES = [
            'Housing', 'Utilities', 'Groceries', 'Transport', 'Healthcare', 'Debt',
            'Savings', 'Subscriptions', 'Entertainment', 'Shopping', 'Eating out',
            'Education', 'Personal care', 'Gifts', 'Pets', 'Other'
        ];
        const PERIOD_LABELS = {
            weekly: 'Weekly',
            biweekly: 'Bi-weekly',
            fourweekly: 'Every 4 weeks',
            monthly: 'Monthly'
        };
        const RECURRENCE_LABELS = { none: 'One-off', ...PERIOD_LABELS };
        const VALID_PERIODS = new Set(Object.keys(PERIOD_LABELS));
        const VALID_RECURRENCES = new Set(['none', ...Object.keys(PERIOD_LABELS)]);
        const CURRENT_APP_VERSION = '2.1.3';
        const TAB_KEYS = ['home', 'add', 'import', 'plan', 'activity', 'reports', 'security', 'settings'];
        const DEFAULT_APP_META = { version: CURRENT_APP_VERSION, publishedAt: '2026-06-18', notes: [
            'Security hardening for the optional online endpoints. Your data, budgets and password all keep working — encryption is unchanged.',
            'Rate limiting added to the key server and the AI-import endpoint, so they can\'t be hammered. This is what makes online high-security mode\'s "every guess must come through your server" protection real.',
            'The import endpoints now reject requests with no website origin when an allowed website is set, closing a curl bypass; shared-secret checks are constant-time; uploads are verified to be real PDFs.',
            'Stronger spreadsheet-injection protection on CSV export.',
            'Full details of the security testing and fixes are in SECURITY.md and SECURITY-REVIEW-v2.1.3.md.'
        ] };


        let appData = { budgets: [], activeBudgetId: null };
        let currentPassword = null;
        let sortState = { field: 'date', order: 'asc' };
        let currentFilterMonth = null;
        let searchTerm = '';
        let yearlyChart = null;
        let saveQueue = Promise.resolve();
        let deferredInstallPrompt = null;
        let sessionPIN = null;
        let currentPinInput = '';
        let pinAttempts = 0;
        let idleTimer = null;
        let lockTimeoutMinutes = Number(localStorage.getItem('lockTimeoutMinutes') || 5);
        let lockOnBackground = localStorage.getItem('lockOnBackground') !== '0';
        let notificationsEnabled = localStorage.getItem('notificationsEnabled') === '1';
        let hideNotificationAmounts = localStorage.getItem('hideNotificationAmounts') !== '0';
        let backgroundLockPending = false;
        let onboardingCompleted = localStorage.getItem('onboardingCompleted') === '1';
        let swRegistrationRef = null;
        let swWaitingRef = null;
        let appMeta = cloneData(DEFAULT_APP_META);
        let remoteMeta = null;
        let activeTab = localStorage.getItem('activeAppTab') || 'home';
        let pendingStatementImport = [];
        let pendingStatementImportMeta = null;
        let importSort = { field: 'confidence', order: 'asc' };
        let viewRangeMode = localStorage.getItem('viewRangeMode') || 'cycle';
        let activityFilter = localStorage.getItem('activityFilter') || 'all';
        let activityLimit = localStorage.getItem('activityLimit') || '50';


        function cloneData(data) {
            if (typeof structuredClone === 'function') return structuredClone(data);
            return JSON.parse(JSON.stringify(data));
        }

        function escapeHTML(value) {
            return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
        }

        function evaluatePasswordStrength(password) {
            const value = String(password || '');
            const lowered = value.toLowerCase();
            const words = value.trim().split(/[\s\-_.]+/).filter(w => w.length >= 3);
            const isPassphrase = words.length >= 4;

            // Estimated entropy from the character pool used.
            let pool = 0;
            if (/[a-z]/.test(value)) pool += 26;
            if (/[A-Z]/.test(value)) pool += 26;
            if (/\d/.test(value)) pool += 10;
            if (/[^A-Za-z0-9]/.test(value)) pool += 33;
            let bits = value.length * Math.log2(Math.max(2, pool));

            // Structural weaknesses that make offline guessing far cheaper than the
            // raw character count suggests. These reduce the *effective* entropy.
            const COMMON = /(password|passw0rd|qwerty|asdfgh|zxcvbn|letmein|welcome|iloveyou|admin|login|dragon|monkey|sunshine|princess|football|baseball|superman|batman|trustno|master|shadow|google|samsung|liverpool|arsenal|chelsea|whatever|starwars|hello|secret|summer|winter|spring|autumn|january|february)/i;
            const wordPlusSuffix = /^[A-Za-z]+(?:[0-9][0-9!@#$%^&*._-]*|[!@#$%^&*._-]+)$/.test(value) && !isPassphrase;
            const sequential = /(0123|1234|2345|3456|4567|5678|6789|9876|8765|4321|abcd|bcde|qwer|asdf)/i.test(value);

            let penalty = 0;
            if (COMMON.test(lowered)) penalty += 22;       // contains a very common word
            if (wordPlusSuffix) penalty += 18;             // e.g. "Football2019", "Sunshine!"
            if (sequential) penalty += 12;                 // keyboard / numeric runs
            if (/^(.)\1+$/.test(value)) penalty += 40;     // all one character
            if (/(.)\1{3,}/.test(value)) penalty += 10;    // long repeats
            if (/^\d+$/.test(value)) penalty += 18;        // digits only

            // A 4+ word passphrase is credited at ~12.9 bits/word (diceware-style).
            if (isPassphrase) bits = Math.max(bits, words.length * 12.9);

            const effective = Math.max(0, bits - penalty);

            let score;
            if (effective >= 90) score = 5;
            else if (effective >= 75) score = 4;
            else if (effective >= 60) score = 3;
            else if (effective >= 40) score = 2;
            else if (effective >= 25) score = 1;
            else score = 0;

            // Valid only when offline brute-force is infeasible: ~70+ effective bits
            // and a sane minimum length. Passphrases of 4 random words clear this easily.
            const valid = effective >= 70 && value.length >= 12;

            let label, message;
            if (score >= 5) { label = 'Strong'; message = 'Strong. Long unique passphrases are ideal.'; }
            else if (score >= 4) { label = 'Good'; message = 'Good. A little longer or more random is even safer.'; }
            else if (score >= 3) { label = 'Fair'; message = 'Borderline — prefer 4+ random words or 16+ random characters.'; }
            else if (score >= 1) { label = 'Weak'; message = 'Easy to crack offline if your encrypted file is taken. Use 4+ random words.'; }
            else { label = 'Very weak'; message = 'Far too guessable. Use 4+ random words or 16+ random characters.'; }
            return { score, label, message, valid, bits: Math.round(effective) };
        }

        function updateStrengthMeter(inputId, fillId, textId, wrapId) {
            const input = document.getElementById(inputId);
            const fill = document.getElementById(fillId);
            const text = document.getElementById(textId);
            const wrap = document.getElementById(wrapId);
            if (!input || !fill || !text || !wrap) return;
            const meta = evaluatePasswordStrength(input.value);
            wrap.classList.remove('hidden');
            fill.style.width = `${Math.max(10, meta.score * 20)}%`;
            fill.style.background = meta.score >= 4 ? 'var(--green)' : meta.score >= 3 ? 'var(--primary)' : meta.score >= 2 ? 'var(--amber)' : 'var(--red)';
            text.textContent = `${meta.label} · ~${meta.bits} bits: ${meta.message}`;
            text.classList.toggle('warning-copy', meta.score < 3);
            return meta;
        }

        function clearSensitiveFields(...ids) {
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
        }


        function compareVersions(a, b) {
            const pa = String(a || '').split('.').map(v => Number(v) || 0);
            const pb = String(b || '').split('.').map(v => Number(v) || 0);
            const len = Math.max(pa.length, pb.length);
            for (let i = 0; i < len; i++) {
                const diff = (pa[i] || 0) - (pb[i] || 0);
                if (diff !== 0) return diff;
            }
            return 0;
        }

        function renderListInto(elementId, items) {
            const el = document.getElementById(elementId);
            if (!el) return;
            const rows = Array.isArray(items) && items.length ? items : ['No release notes available yet.'];
            el.innerHTML = rows.map(item => `<li>${escapeHTML(item)}</li>`).join('');
        }

        function applyMetaToUI(meta) {
            const info = meta || DEFAULT_APP_META;
            appMeta = { ...DEFAULT_APP_META, ...info };
            const version = appMeta.version || CURRENT_APP_VERSION;
            const published = appMeta.publishedAt || DEFAULT_APP_META.publishedAt;
            const versionChip = document.getElementById('versionChip');
            const currentVersionText = document.getElementById('currentVersionText');
            const publishedChip = document.getElementById('publishedChip');
            const whatsNewTitle = document.getElementById('whatsNewTitle');
            const whatsNewIntro = document.getElementById('whatsNewIntro');
            if (versionChip) versionChip.textContent = `v${version}`;
            if (currentVersionText) currentVersionText.textContent = `v${CURRENT_APP_VERSION}`;
            if (publishedChip) publishedChip.textContent = `Published ${published}`;
            if (whatsNewTitle) whatsNewTitle.textContent = `What's new in v${version}`;
            if (whatsNewIntro) whatsNewIntro.textContent = `Published ${published}. You can reopen this any time from the top of the app.`;
            renderListInto('whatsNewList', appMeta.notes);
            renderListInto('changelogPreviewList', appMeta.notes);
        }

        async function fetchPublishedMeta() {
            try {
                const response = await fetch(`./app-meta.json?t=${Date.now()}`, { cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                remoteMeta = data;
                applyMetaToUI(data);
                const remoteVersionText = document.getElementById('remoteVersionText');
                if (remoteVersionText) remoteVersionText.textContent = `v${data.version || CURRENT_APP_VERSION}`;
                const updateBannerText = document.getElementById('updateBannerText');
                if (compareVersions(String(data.version || CURRENT_APP_VERSION), CURRENT_APP_VERSION) > 0) {
                    if (updateBannerText) updateBannerText.textContent = `Version ${data.version} has been published. Refresh to load the latest files and release notes.`;
                    document.getElementById('updateBanner')?.classList.remove('hidden');
                }
                return data;
            } catch (error) {
                console.warn('Published metadata check failed:', error);
                const remoteVersionText = document.getElementById('remoteVersionText');
                if (remoteVersionText) remoteVersionText.textContent = 'Unavailable offline';
                applyMetaToUI(appMeta);
                return null;
            }
        }



        function activateTab(tabKey, options = {}) {
            const nextTab = TAB_KEYS.includes(tabKey) ? tabKey : 'home';
            activeTab = nextTab;
            localStorage.setItem('activeAppTab', nextTab);
            document.querySelectorAll('[data-tab-panel]').forEach(panel => {
                panel.classList.toggle('tab-hidden', panel.dataset.tabPanel !== nextTab);
            });
            document.querySelectorAll('[data-tab-trigger]').forEach(trigger => {
                const isActive = trigger.dataset.tabTrigger === nextTab;
                trigger.classList.toggle('is-active', isActive);
                trigger.setAttribute('aria-selected', String(isActive));
            });
            if (nextTab === 'reports' || nextTab === 'home' || nextTab === 'activity') {
                requestAnimationFrame(() => {
                    const budget = getActiveBudget?.();
                    if (budget && !document.getElementById('appContent')?.classList.contains('hidden')) {
                        if (nextTab === 'reports') { updateCharts(budget); renderReportsLab(budget); runCustomReport(false); }
                        if (nextTab === 'activity') renderReviewQueue(budget);
                        if (nextTab === 'home') { renderDashboard(budget); renderSmartInsights(budget); }
                    }
                });
            }
            if (options.scroll) {
                const anchor = options.anchorId ? document.getElementById(options.anchorId) : document.querySelector(`[data-tab-panel="${nextTab}"]`);
                anchor?.scrollIntoView({ behavior: options.instant ? 'auto' : 'smooth', block: 'start' });
            }
        }

        function initSectionTabs() {
            document.querySelectorAll('[data-tab-trigger]').forEach(trigger => {
                trigger.addEventListener('click', event => {
                    event.preventDefault();
                    const isMobileNav = trigger.closest('.bottom-nav');
                    activateTab(trigger.dataset.tabTrigger, { scroll: !!isMobileNav });
                });
            });
            activateTab(activeTab, { scroll: false, instant: true });
        }

        function openGuideModal() { document.getElementById('guideModal')?.classList.remove('hidden'); }
        function closeGuideModal() { document.getElementById('guideModal')?.classList.add('hidden'); }
        function openWhatsNewModal() { document.getElementById('whatsNewModal')?.classList.remove('hidden'); }
        function closeWhatsNewModal(markSeen = true) {
            document.getElementById('whatsNewModal')?.classList.add('hidden');
            if (markSeen) localStorage.setItem('seenAppVersion', String(appMeta.version || CURRENT_APP_VERSION));
        }
        function maybeShowWhatsNew(force = false) {
            applyMetaToUI(remoteMeta || appMeta || DEFAULT_APP_META);
            const seen = localStorage.getItem('seenAppVersion');
            const version = String((remoteMeta || appMeta || DEFAULT_APP_META).version || CURRENT_APP_VERSION);
            if (force || seen !== version) openWhatsNewModal();
        }


        function parseLocalDate(value) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
            const [y, m, d] = String(value).split('-').map(Number);
            const date = new Date(y, m - 1, d);
            if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
            return date;
        }

        function formatDateLocal(date) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        function formatShortDate(date) {
            return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        }

        function formatPeriodLabel(period) {
            const endInclusive = addDays(period.end, -1);
            if (period.type === 'monthly') return period.start.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
            return `${formatShortDate(period.start)}–${formatShortDate(endInclusive)}`;
        }

        function addDays(date, days) {
            const next = new Date(date);
            next.setDate(next.getDate() + days);
            return next;
        }

        function addMonthsClamped(date, months) {
            const day = date.getDate();
            const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
            const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
            target.setDate(Math.min(day, lastDay));
            return target;
        }

        function addPeriod(date, type) {
            if (type === 'weekly') return addDays(date, 7);
            if (type === 'biweekly') return addDays(date, 14);
            if (type === 'fourweekly') return addDays(date, 28);
            return addMonthsClamped(date, 1);
        }

        function subtractPeriod(date, type) {
            if (type === 'weekly') return addDays(date, -7);
            if (type === 'biweekly') return addDays(date, -14);
            if (type === 'fourweekly') return addDays(date, -28);
            return addMonthsClamped(date, -1);
        }

        function daysBetween(start, end) {
            const ms = new Date(end.getFullYear(), end.getMonth(), end.getDate()) - new Date(start.getFullYear(), start.getMonth(), start.getDate());
            return Math.round(ms / 86400000);
        }

        function setSaveStatus(text) {
            const status = document.getElementById('saveStatus');
            if (!status) return;
            status.textContent = text || '';
            status.dataset.state = text?.toLowerCase().includes('saving') ? 'saving' : text?.toLowerCase().includes('failed') ? 'error' : text ? 'saved' : '';
        }

        // ---------- Session PIN screen lock ----------
        function buildPinPad() {
            const pad = document.getElementById('pinPad');
            if (!pad || pad.childElementCount) return;
            [1,2,3,4,5,6,7,8,9,'⌫',0,'✓'].forEach(value => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = value;
                btn.addEventListener('click', () => {
                    if (value === '⌫') {
                        currentPinInput = currentPinInput.slice(0, -1);
                        updatePinDots();
                    } else if (value === '✓') {
                        checkPinInput(true);
                    } else {
                        pinDigit(String(value));
                    }
                });
                pad.appendChild(btn);
            });
        }

        function updatePinDots() {
            const dots = document.getElementById('pinDots');
            if (dots) dots.textContent = '●'.repeat(currentPinInput.length);
        }

        function updatePinUI() {
            document.getElementById('lockTimeoutSelect')?.value && (document.getElementById('lockTimeoutSelect').value = String(lockTimeoutMinutes));
            document.getElementById('setPinBtn')?.classList.toggle('hidden', Boolean(sessionPIN));
            document.getElementById('lockNowBtn')?.classList.toggle('hidden', !sessionPIN);
            document.getElementById('clearPinBtn')?.toggleAttribute('disabled', !sessionPIN);
            const chip = document.getElementById('pinStatusChip');
            if (chip) {
                chip.textContent = sessionPIN ? `Locks after ${lockTimeoutMinutes} min` : 'Screen lock off';
                chip.classList.toggle('chip-on', Boolean(sessionPIN));
            }
            const bgToggle = document.getElementById('lockOnBackgroundCheckbox');
            if (bgToggle) bgToggle.checked = lockOnBackground;
            const notifyToggle = document.getElementById('enableNotificationsCheckbox');
            if (notifyToggle) notifyToggle.checked = notificationsEnabled;
            const amountToggle = document.getElementById('hideNotificationAmountsCheckbox');
            if (amountToggle) amountToggle.checked = hideNotificationAmounts;
        }

        function setSessionPIN(pin) {
            sessionPIN = pin;
            currentPinInput = '';
            pinAttempts = 0;
            backgroundLockPending = false;
            updatePinUI();
            resetIdleTimer();
            alert(`PIN set. The open app will lock after ${lockTimeoutMinutes} minute${lockTimeoutMinutes === 1 ? '' : 's'} of inactivity${lockOnBackground ? ', and also when the app is backgrounded' : ''}.`);
        }

        function promptForSessionPIN() {
            const pin = document.getElementById('pinInput')?.value || '';
            const confirm = document.getElementById('pinConfirmInput')?.value || '';
            if (!/^\d{4,}$/.test(pin)) {
                alert('PIN must be at least 4 digits, numbers only.');
                return;
            }
            if (pin !== confirm) {
                alert('PIN entries do not match.');
                return;
            }
            setSessionPIN(pin);
            clearSensitiveFields('pinInput', 'pinConfirmInput');
        }

        function clearSessionPIN(showAlert = true) {
            sessionPIN = null;
            currentPinInput = '';
            pinAttempts = 0;
            backgroundLockPending = false;
            clearTimeout(idleTimer);
            document.getElementById('pinOverlay')?.classList.add('hidden');
            clearSensitiveFields('pinInput', 'pinConfirmInput');
            updatePinUI();
            if (showAlert) alert('Screen PIN removed for this session.');
        }

        function showPINOverlay() {
            if (!sessionPIN) return;
            buildPinPad();
            currentPinInput = '';
            pinAttempts = 0;
            updatePinDots();
            document.getElementById('pinOverlay')?.classList.remove('hidden');
            clearTimeout(idleTimer);
        }

        function hidePINOverlay() {
            document.getElementById('pinOverlay')?.classList.add('hidden');
            currentPinInput = '';
            pinAttempts = 0;
            updatePinDots();
            resetIdleTimer();
        }

        function pinDigit(digit) {
            if (!sessionPIN) return;
            if (currentPinInput.length >= sessionPIN.length) currentPinInput = '';
            currentPinInput += digit;
            updatePinDots();
            if (currentPinInput.length >= sessionPIN.length) checkPinInput(false);
        }

        function checkPinInput(fromEnterButton) {
            if (!sessionPIN || (!fromEnterButton && currentPinInput.length < sessionPIN.length)) return;
            if (currentPinInput === sessionPIN) {
                hidePINOverlay();
                return;
            }
            pinAttempts++;
            currentPinInput = '';
            updatePinDots();
            if (pinAttempts >= 5) {
                alert('Too many wrong PIN attempts. Re-enter your password to unlock.');
                lockToPassword();
            }
        }

        function lockToPassword() {
            clearSessionPIN(false);
            currentPassword = null;
            currentKey = null;
            currentSalt = null;
            document.getElementById('appContent')?.classList.add('hidden');
            showUnlockPrompt();
        }

        function resetIdleTimer() {
            clearTimeout(idleTimer);
            if (!sessionPIN) return;
            const overlayVisible = !document.getElementById('pinOverlay')?.classList.contains('hidden');
            if (overlayVisible) return;
            idleTimer = setTimeout(showPINOverlay, Math.max(1, lockTimeoutMinutes) * 60 * 1000);
        }

        function initScreenLock() {
            buildPinPad();
            document.getElementById('setPinBtn')?.addEventListener('click', () => {
                activateTab('security');
                requestAnimationFrame(() => {
                    const input = document.getElementById('pinInput');
                    input?.closest('.panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    input?.focus();
                });
            });
            document.getElementById('setPinPanelBtn')?.addEventListener('click', promptForSessionPIN);
            document.getElementById('lockNowBtn')?.addEventListener('click', () => {
                if (!sessionPIN) {
                    alert('Set a session PIN first.');
                    return;
                }
                showPINOverlay();
            });
            document.getElementById('clearPinBtn')?.addEventListener('click', () => clearSessionPIN(true));
            document.getElementById('pinClear')?.addEventListener('click', () => { currentPinInput = ''; updatePinDots(); });
            document.getElementById('pinPasswordLogout')?.addEventListener('click', lockToPassword);
            document.getElementById('saveLockSettings')?.addEventListener('click', () => {
                const next = Number(document.getElementById('lockTimeoutSelect')?.value || 5);
                lockTimeoutMinutes = Number.isFinite(next) && next > 0 ? next : 5;
                lockOnBackground = Boolean(document.getElementById('lockOnBackgroundCheckbox')?.checked);
                localStorage.setItem('lockTimeoutMinutes', String(lockTimeoutMinutes));
                localStorage.setItem('lockOnBackground', lockOnBackground ? '1' : '0');
                updatePinUI();
                resetIdleTimer();
                alert(`Auto-lock saved for ${lockTimeoutMinutes} minute${lockTimeoutMinutes === 1 ? '' : 's'}${lockOnBackground ? ' with background locking on' : ''}.`);
            });
            ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(evt => {
                document.addEventListener(evt, () => {
                    const locked = !document.getElementById('pinOverlay')?.classList.contains('hidden');
                    if (!locked) resetIdleTimer();
                }, { passive: true });
            });
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    if (sessionPIN && lockOnBackground) backgroundLockPending = true;
                    return;
                }
                if (backgroundLockPending && sessionPIN) {
                    backgroundLockPending = false;
                    showPINOverlay();
                    return;
                }
                resetIdleTimer();
            });
            updatePinUI();
        }

        // ---------- Data model / migration ----------
        function uniqueClean(values) {
            const out = [];
            const seen = new Set();
            for (const value of values || []) {
                const text = String(value || '').trim();
                if (!text) continue;
                const key = text.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(text);
            }
            return out;
        }

        
        function normaliseDateRange(raw) {
            const from = String(raw?.from || '').trim();
            const to = String(raw?.to || '').trim();
            if (!parseLocalDate(from) || !parseLocalDate(to)) return null;
            return { from, to };
        }

function createDefaultBudget(name = 'Main', id = '1') {
            return {
                id,
                name,
                wages: [],
                expenses: [],
                budgetGoal: 0,
                savingsGoal: 0,
                savingsBalance: 0,
                periodType: 'monthly',
                periodStart: formatDateLocal(new Date()),
                categories: [...DEFAULT_CATEGORIES],
                categoryBudgets: {},
                rolloverEnabled: false,
                importRules: [],
                lastImportRange: null,
                plannedIncome: 0
            };
        }

        function normaliseRecurrence(item) {
            if (VALID_RECURRENCES.has(item?.recurrence)) return item.recurrence;
            return item?.recurring ? 'monthly' : 'none';
        }

        function normaliseTransaction(item, type) {
            const recurrence = normaliseRecurrence(item);
            const base = {
                date: parseLocalDate(item?.date) ? item.date : formatDateLocal(new Date()),
                amount: Number.isFinite(Number(item?.amount)) && Number(item?.amount) >= 0 ? Number(item.amount) : 0,
                recurrence,
                recurring: recurrence !== 'none',
                reviewed: Boolean(item?.reviewed)
            };
            if (type === 'wage') return { ...base, source: String(item?.source || '').trim() };
            return {
                ...base,
                category: String(item?.category || 'Other').trim() || 'Other',
                description: String(item?.description || '').trim()
            };
        }


        function normaliseImportRules(rawRules) {
            const rules = [];
            const seen = new Set();
            if (!Array.isArray(rawRules)) return rules;
            rawRules.forEach(rule => {
                const keyword = String(rule?.keyword || '').trim().slice(0, 64);
                const category = String(rule?.category || '').trim().slice(0, 64);
                if (!keyword || !category) return;
                const key = `${keyword.toLowerCase()}::${category.toLowerCase()}`;
                if (seen.has(key)) return;
                seen.add(key);
                rules.push({ keyword, category, uses: Math.max(1, Number(rule?.uses || 1)), updatedAt: String(rule?.updatedAt || new Date().toISOString()) });
            });
            return rules.slice(0, 150);
        }

        function normaliseBudget(raw, index = 0) {
            const fallback = createDefaultBudget(index === 0 ? 'Main' : `Budget ${index + 1}`, String(Date.now() + index));
            const wages = Array.isArray(raw?.wages) ? raw.wages.map(w => normaliseTransaction(w, 'wage')) : [];
            const expenses = Array.isArray(raw?.expenses) ? raw.expenses.map(e => normaliseTransaction(e, 'expense')) : [];
            const categories = uniqueClean([
                ...DEFAULT_CATEGORIES,
                ...(Array.isArray(raw?.categories) ? raw.categories : []),
                ...expenses.map(e => e.category)
            ]);
            const categoryBudgets = {};
            if (raw?.categoryBudgets && typeof raw.categoryBudgets === 'object' && !Array.isArray(raw.categoryBudgets)) {
                Object.entries(raw.categoryBudgets).forEach(([key, value]) => {
                    const cat = String(key || '').trim();
                    const amount = Number(value);
                    if (cat && Number.isFinite(amount) && amount >= 0) categoryBudgets[cat] = amount;
                });
            }
            return {
                id: String(raw?.id || fallback.id),
                name: String(raw?.name || fallback.name).trim() || fallback.name,
                wages,
                expenses,
                budgetGoal: Number.isFinite(Number(raw?.budgetGoal)) && Number(raw.budgetGoal) >= 0 ? Number(raw.budgetGoal) : 0,
                savingsGoal: Number.isFinite(Number(raw?.savingsGoal)) && Number(raw.savingsGoal) >= 0 ? Number(raw.savingsGoal) : 0,
                savingsBalance: Number.isFinite(Number(raw?.savingsBalance ?? raw?.savingsTotal ?? raw?.startingSavings)) && Number(raw?.savingsBalance ?? raw?.savingsTotal ?? raw?.startingSavings) >= 0 ? Number(raw?.savingsBalance ?? raw?.savingsTotal ?? raw?.startingSavings) : 0,
                periodType: VALID_PERIODS.has(raw?.periodType) ? raw.periodType : 'monthly',
                periodStart: parseLocalDate(raw?.periodStart) ? raw.periodStart : formatDateLocal(new Date()),
                categories: categories.length ? categories : [...DEFAULT_CATEGORIES],
                categoryBudgets,
                rolloverEnabled: Boolean(raw?.rolloverEnabled),
                importRules: normaliseImportRules(raw?.importRules),
                lastImportRange: normaliseDateRange(raw?.lastImportRange),
                plannedIncome: Number.isFinite(Number(raw?.plannedIncome)) && Number(raw.plannedIncome) >= 0 ? Number(raw.plannedIncome) : 0
            };
        }

        function normaliseData(raw) {
            const budgets = Array.isArray(raw?.budgets) && raw.budgets.length ? raw.budgets.map(normaliseBudget) : [createDefaultBudget()];
            const ids = new Set();
            budgets.forEach((budget, index) => {
                if (ids.has(budget.id)) budget.id = `${budget.id}-${index}`;
                ids.add(budget.id);
            });
            const activeBudgetId = ids.has(String(raw?.activeBudgetId)) ? String(raw.activeBudgetId) : budgets[0].id;
            return { budgets, activeBudgetId };
        }

        function isValidData(data) {
            if (!data || !Array.isArray(data.budgets) || !data.budgets.length || typeof data.activeBudgetId !== 'string') return false;
            const ids = new Set(data.budgets.map(b => b.id));
            if (!ids.has(data.activeBudgetId)) return false;
            return data.budgets.every(b =>
                b && typeof b.id === 'string' && typeof b.name === 'string' &&
                Array.isArray(b.wages) && Array.isArray(b.expenses) && Array.isArray(b.categories) &&
                b.categoryBudgets && typeof b.categoryBudgets === 'object' && !Array.isArray(b.categoryBudgets) &&
                Object.values(b.categoryBudgets).every(v => Number.isFinite(Number(v)) && Number(v) >= 0) &&
                typeof b.rolloverEnabled === 'boolean' && Array.isArray(b.importRules || []) &&
                (b.lastImportRange === null || (b.lastImportRange && parseLocalDate(b.lastImportRange.from) && parseLocalDate(b.lastImportRange.to))) &&
                Number.isFinite(Number(b.plannedIncome || 0)) &&

                Number.isFinite(b.budgetGoal) && b.budgetGoal >= 0 &&
                Number.isFinite(b.savingsGoal) && b.savingsGoal >= 0 &&
                Number.isFinite(Number(b.savingsBalance || 0)) && Number(b.savingsBalance || 0) >= 0 &&
                VALID_PERIODS.has(b.periodType) && parseLocalDate(b.periodStart) &&
                b.wages.every(w => parseLocalDate(w.date) && Number.isFinite(w.amount) && w.amount >= 0 && VALID_RECURRENCES.has(w.recurrence)) &&
                b.expenses.every(e => parseLocalDate(e.date) && Number.isFinite(e.amount) && e.amount >= 0 && VALID_RECURRENCES.has(e.recurrence))
            );
        }

        // ---------- Encryption ----------
        // AES-256-GCM with a key derived from the password by PBKDF2-HMAC-SHA256.
        // The derived key is CACHED for the session (currentKey/currentSalt) so routine
        // autosaves never re-run PBKDF2 or touch the network — only unlocking, setting,
        // or changing the password derives a key.
        //
        // Two modes (recorded in envelope.mode):
        //   "offline" (default): key = PBKDF2(password, salt). Fully local; no network ever.
        //   "online"           : key = HMAC(server secret pepper, PBKDF2(password, salt)),
        //                         where the HMAC is computed by the user's own /api/pepper
        //                         endpoint. An attacker holding only the local file cannot
        //                         brute-force it, because the server secret is required for
        //                         every single guess (turning an offline attack into a
        //                         rate-limited online one).
        const PBKDF2_ITERATIONS = 1000000;          // used when writing new data
        const LEGACY_PBKDF2_ITERATIONS = 600000;    // assumed for envelopes with no `iterations`

        let currentKey = null;    // cached AES-GCM CryptoKey for this session
        let currentSalt = null;   // salt bound to currentKey
        let currentIterations = PBKDF2_ITERATIONS; // PBKDF2 iterations bound to currentKey

        function getEncryptionMode() { return localStorage.getItem('encryptionMode') === 'online' ? 'online' : 'offline'; }
        function getPepperEndpoint() { return (localStorage.getItem('pepperEndpoint') || '/api/pepper').trim() || '/api/pepper'; }

        function bytesToBase64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
        function base64ToBytes(b64) { const s = atob(String(b64 || '')); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }

        async function pbkdf2Bits(password, salt, iterations) {
            const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
            const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, keyMaterial, 256);
            return new Uint8Array(bits);
        }

        // Online mode only: ask the user's own server to HMAC the PBKDF2 output with its secret pepper.
        async function fetchServerKeyBytes(endpoint, hashBytes) {
            let res;
            try {
                res = await fetch(endpointUrlFor(endpoint), {
                    method: 'POST',
                    headers: aiImportHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ hash: bytesToBase64(hashBytes) })
                });
            } catch (e) {
                throw Object.assign(new Error('Could not reach the high-security key server. Check your connection and the endpoint.'), { code: 'SERVER' });
            }
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw Object.assign(new Error(data.error || `Key server error (HTTP ${res.status}).`), { code: 'SERVER' });
            }
            const data = await res.json().catch(() => ({}));
            const keyBytes = base64ToBytes(data.key);
            if (keyBytes.length !== 32) throw Object.assign(new Error('The key server returned an invalid response.'), { code: 'SERVER' });
            return keyBytes;
        }

        async function deriveAesKey(password, salt, iterations, mode, endpoint) {
            let keyBytes = await pbkdf2Bits(password, salt, iterations);
            if (mode === 'online') keyBytes = await fetchServerKeyBytes(endpoint || getPepperEndpoint(), keyBytes);
            return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        }

        // Build an encrypted envelope using an already-derived key (no PBKDF2, no network).
        // `iterations` MUST be the count the key was actually derived with, so the envelope
        // can be decrypted again later.
        async function encryptWithKey(data, key, salt, mode, endpoint, iterations) {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encoded = new TextEncoder().encode(JSON.stringify(data));
            const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
            const env = {
                v: 3,
                kdf: 'PBKDF2-SHA256',
                mode,
                iterations: Number(iterations) > 0 ? Number(iterations) : PBKDF2_ITERATIONS,
                salt: Array.from(salt),
                iv: Array.from(iv),
                data: Array.from(new Uint8Array(encrypted))
            };
            if (mode === 'online') env.endpoint = endpoint || getPepperEndpoint();
            return env;
        }

        // Decrypt an envelope with a password (used when unlocking). Throws on failure;
        // network errors carry code 'SERVER' so the UI can distinguish them from a wrong password.
        async function decryptEnvelope(envelope, password) {
            const salt = new Uint8Array(envelope.salt);
            const iv = new Uint8Array(envelope.iv);
            const cipher = new Uint8Array(envelope.data);
            const iterations = Number(envelope.iterations) > 0 ? Number(envelope.iterations) : LEGACY_PBKDF2_ITERATIONS;
            const mode = envelope.mode === 'online' ? 'online' : 'offline';
            const endpoint = envelope.endpoint || getPepperEndpoint();
            const key = await deriveAesKey(password, salt, iterations, mode, endpoint);
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
            return { data: JSON.parse(new TextDecoder().decode(plain)), key, salt, mode, endpoint, iterations };
        }

        // Create a fresh session key under the CURRENT mode (used at setup, password change, mode switch).
        async function establishSessionKey(password) {
            const mode = getEncryptionMode();
            const endpoint = getPepperEndpoint();
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS, mode, endpoint);
            currentPassword = password; currentKey = key; currentSalt = salt; currentIterations = PBKDF2_ITERATIONS;
            return { key, salt, mode, endpoint };
        }

        // Persist appData using the cached session key. No PBKDF2 and no network (key already derived).
        async function storeEncrypted(data) {
            if (!currentKey || !currentSalt) {
                if (!currentPassword) throw new Error('No encryption key available for this session.');
                await establishSessionKey(currentPassword);
            }
            const env = await encryptWithKey(data, currentKey, currentSalt, getEncryptionMode(), getPepperEndpoint(), currentIterations);
            localStorage.setItem('budgetAppEncrypted', JSON.stringify(env));
        }

        // Try to unlock stored data with a password. Returns decrypted data, or throws
        // (Error.code === 'SERVER' means the online key server was unreachable, not a wrong password).
        async function unlockWithPassword(password) {
            const raw = localStorage.getItem('budgetAppEncrypted');
            if (!raw) return null;
            const envelope = JSON.parse(raw);
            const result = await decryptEnvelope(envelope, password);
            currentPassword = password; currentKey = result.key; currentSalt = result.salt; currentIterations = result.iterations;
            localStorage.setItem('encryptionMode', result.mode);
            if (result.mode === 'online' && envelope.endpoint) localStorage.setItem('pepperEndpoint', envelope.endpoint);
            // Auto-upgrade vaults written with fewer iterations than we now use. Best-effort:
            // if it fails (e.g. an online key server is briefly down) we keep the working key.
            if (result.iterations < PBKDF2_ITERATIONS) {
                try { await establishSessionKey(password); } catch (e) { /* keep the already-working key */ }
            }
            return result.data;
        }

        // ---------- Theme ----------
        function applyTheme() {
            const theme = localStorage.getItem('theme') || 'dark';
            document.body.classList.toggle('light', theme === 'light');
            document.body.classList.toggle('dark', theme !== 'light');
            const metaTheme = document.querySelector('meta[name="theme-color"]');
            if (metaTheme) metaTheme.setAttribute('content', theme === 'light' ? '#eef2f9' : '#080f1d');
        }
        document.getElementById('themeToggle').addEventListener('click', () => {
            const newTheme = document.body.classList.contains('light') ? 'dark' : 'light';
            localStorage.setItem('theme', newTheme);
            applyTheme();
        });

        // ---------- Budget helpers ----------
        function getActiveBudget() {
            return appData.budgets.find(b => b.id === appData.activeBudgetId);
        }

        function saveAndEncrypt() {
            if (!currentPassword) return saveQueue;
            appData = normaliseData(appData);
            const snapshot = cloneData(appData);
            setSaveStatus('Saving encrypted data…');
            saveQueue = saveQueue
                .catch(() => {})
                .then(() => storeEncrypted(snapshot))
                .then(() => setSaveStatus('Saved.'))
                .catch(err => {
                    console.error('Save failed', err);
                    setSaveStatus('Save failed. Export a backup now.');
                    alert('Encrypted save failed. Please export a JSON backup now.');
                });
            return saveQueue;
        }

        function getCurrentPeriod(budget, now = new Date()) {
            const type = VALID_PERIODS.has(budget?.periodType) ? budget.periodType : 'monthly';
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            let start = parseLocalDate(budget?.periodStart) || today;
            let end = addPeriod(start, type);
            let guard = 0;
            while (end <= today && guard++ < 500) {
                start = end;
                end = addPeriod(start, type);
            }
            while (start > today && guard++ < 1000) {
                end = start;
                start = subtractPeriod(start, type);
            }
            return { type, start, end };
        }

        function getAllDataRange(budget) {
            const dates = [...(budget?.wages || []), ...(budget?.expenses || [])]
                .map(item => parseLocalDate(item.date))
                .filter(Boolean)
                .sort((a, b) => a - b);
            if (!dates.length) {
                const period = getCurrentPeriod(budget);
                return { ...period, mode: 'cycle', label: `${PERIOD_LABELS[period.type]} cycle: ${formatPeriodLabel(period)}` };
            }
            return { type: 'all', mode: 'all', start: dates[0], end: addDays(dates[dates.length - 1], 1), label: `All data: ${formatShortDate(dates[0])}–${formatShortDate(dates[dates.length - 1])}` };
        }

        function getLastStatementRange(budget) {
            const saved = normaliseDateRange(budget?.lastImportRange);
            if (!saved) return null;
            const start = parseLocalDate(saved.from);
            const end = addDays(parseLocalDate(saved.to), 1);
            if (!start || !end || start > end) return null;
            return { type: 'statement', mode: 'statement', start, end, label: `Last statement: ${formatShortDate(start)}–${formatShortDate(addDays(end, -1))}` };
        }

        function getActiveViewRange(budget) {
            if (currentFilterMonth) {
                const [y, m] = currentFilterMonth.split('-').map(Number);
                const start = new Date(y, m - 1, 1);
                return { type: 'month', mode: 'month', start, end: new Date(y, m, 1), label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
            }
            const selectedMode = ['cycle','statement','all'].includes(viewRangeMode) ? viewRangeMode : 'cycle';
            if (selectedMode === 'all') return getAllDataRange(budget);
            if (selectedMode === 'statement') {
                const statementRange = getLastStatementRange(budget);
                if (statementRange) return statementRange;
                return getAllDataRange(budget);
            }
            const period = getCurrentPeriod(budget);
            return { ...period, mode: 'cycle', label: `${PERIOD_LABELS[period.type]} cycle: ${formatPeriodLabel(period)}` };
        }

        function itemInRange(item, range) {
            const date = parseLocalDate(item.date);
            return date && date >= range.start && date < range.end;
        }

        function filterAndSearch(items, searchFields, budget, forceRange = false) {
            let filtered = [...items];
            const range = forceRange || currentFilterMonth ? getActiveViewRange(budget || getActiveBudget()) : null;
            if (range) filtered = filtered.filter(i => itemInRange(i, range));
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                filtered = filtered.filter(i => searchFields.some(f => String(i[f] || '').toLowerCase().includes(term)));
            }
            filtered.sort((a,b) => {
                const f = sortState.field, o = sortState.order === 'asc' ? 1 : -1;
                if (f === 'date') return a.date.localeCompare(b.date) * o;
                if (f === 'amount') return (Number(a.amount) - Number(b.amount)) * o;
                return 0;
            });
            return filtered;
        }

        function getCycleItems(budget) {
            const range = getActiveViewRange(budget);
            const wages = filterAndSearch(budget.wages, ['date','source','amount','recurrence'], budget, true);
            const expenses = filterAndSearch(budget.expenses, ['date','category','description','amount','recurrence'], budget, true);
            return { range, wages, expenses };
        }

        function isSavingsCategory(category) {
            return String(category || '').trim().toLowerCase() === 'savings';
        }

        function getSavingsContributions(expenses) {
            return (expenses || [])
                .filter(item => isSavingsCategory(item.category))
                .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        }

        function getSpendingExpenses(expenses) {
            return (expenses || []).filter(item => !isSavingsCategory(item.category));
        }

        function getSavingsTotal(budget, expensesOverride = null) {
            const base = Number(budget?.savingsBalance || 0);
            const contributions = getSavingsContributions(expensesOverride || budget?.expenses || []);
            return base + contributions;
        }

        function getCategoryTotals(expenses) {
            return expenses.reduce((totals, item) => {
                const cat = item.category || 'Other';
                totals[cat] = (totals[cat] || 0) + Number(item.amount || 0);
                return totals;
            }, {});
        }

        function getUpcomingRecurringItems(budget, days = 30) {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const end = addDays(today, days);
            const upcoming = [];
            const pushItems = (items, type) => {
                items.forEach((item, index) => {
                    const next = getNextOccurrence(item, now);
                    if (next && next >= today && next <= end) {
                        upcoming.push({ ...item, type, nextDate: formatDateLocal(next), index });
                    }
                });
            };
            pushItems(budget.wages || [], 'Income');
            pushItems(budget.expenses || [], 'Expense');
            upcoming.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || (a.type === 'Expense' ? -1 : 1));
            return upcoming;
        }

        function hasMatchingExpenseOnDate(budget, item, dateStr) {
            return (budget.expenses || []).some(e =>
                e !== item &&
                e.date === dateStr &&
                (e.category || 'Other') === (item.category || 'Other') &&
                Math.abs(Number(e.amount || 0) - Number(item.amount || 0)) < 0.01
            );
        }

        function hasMatchingIncomeOnDate(budget, item, dateStr) {
            return (budget.wages || []).some(w =>
                w !== item &&
                w.date === dateStr &&
                String(w.source || '') === String(item.source || '') &&
                Math.abs(Number(w.amount || 0) - Number(item.amount || 0)) < 0.01
            );
        }

        function hasMatchingRecurringCopy(budget, item, type, dateStr) {
            return type === 'Income' ? hasMatchingIncomeOnDate(budget, item, dateStr) : hasMatchingExpenseOnDate(budget, item, dateStr);
        }

        function getFutureRecurringOutflowForRange(budget, range) {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            return (budget.expenses || []).reduce((sum, item) => {
                const next = getNextOccurrence(item, now);
                if (!next || next <= today || next >= range.end) return sum;
                const due = formatDateLocal(next);
                if (item.date === due || hasMatchingExpenseOnDate(budget, item, due)) return sum;
                return sum + Number(item.amount || 0);
            }, 0);
        }

        function getCategoryLimitHealth(budget, expenses) {
            const totals = getCategoryTotals(expenses);
            const limits = budget.categoryBudgets || {};
            return budget.categories.map(cat => {
                if (isSavingsCategory(cat)) {
                    const savedInView = getSavingsContributions(expenses);
                    const savedTotal = getSavingsTotal(budget);
                    const limit = Number(budget.savingsGoal || 0);
                    const pctRaw = limit > 0 ? (savedTotal / limit) * 100 : 0;
                    return { category: cat, spent: savedTotal, savedTotal, savedInView, limit, pctRaw, over: false, isSavings: true };
                }
                const spent = totals[cat] || 0;
                const limit = budget?.rolloverEnabled ? getAdjustedCategoryLimit(budget, cat) : Number(limits[cat] || 0);
                const pctRaw = limit > 0 ? (spent / limit) * 100 : 0;
                return { category: cat, spent, limit, pctRaw, over: limit > 0 && spent > limit, isSavings: false };
            });
        }

        function renderBudgetSelector() {
            const budget = getActiveBudget();
            const select = document.getElementById('budgetSelect');
            select.innerHTML = '';
            appData.budgets.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.textContent = b.name;
                select.appendChild(opt);
            });
            select.value = appData.activeBudgetId;
            document.getElementById('deleteBudgetBtn').style.display = appData.budgets.length > 1 ? 'inline-block' : 'none';
            document.querySelectorAll('[data-active-budget-name]').forEach(el => {
                el.textContent = budget ? budget.name : 'Budget';
            });
            document.getElementById('periodTypeSelect').value = budget?.periodType || 'monthly';
            document.getElementById('periodStartInput').value = budget?.periodStart || formatDateLocal(new Date());
            document.getElementById('budgetGoalInput').value = budget?.budgetGoal ? String(budget.budgetGoal) : '';
            document.getElementById('savingsGoalInput').value = budget?.savingsGoal ? String(budget.savingsGoal) : '';
            const savingsBalanceInput = document.getElementById('savingsBalanceInput'); if (savingsBalanceInput) savingsBalanceInput.value = budget?.savingsBalance ? String(budget.savingsBalance) : '';
            const plannedIncomeInput = document.getElementById('plannedIncomeInput'); if (plannedIncomeInput) plannedIncomeInput.value = budget?.plannedIncome ? String(budget.plannedIncome) : '';
            const viewSelect = document.getElementById('viewRangeSelect'); if (viewSelect) viewSelect.value = viewRangeMode;
            const activityFilterSelect = document.getElementById('activityFilterSelect'); if (activityFilterSelect) activityFilterSelect.value = activityFilter;
            const activityLimitSelect = document.getElementById('activityLimitSelect'); if (activityLimitSelect) activityLimitSelect.value = activityLimit;
            const rolloverBox = document.getElementById('rolloverEnabledCheckbox'); if (rolloverBox) rolloverBox.checked = Boolean(budget?.rolloverEnabled);
            const onboardName = document.getElementById('onboardingBudgetName'); if (onboardName) onboardName.value = budget?.name || '';
            renderCategories(budget);
        }

        document.getElementById('budgetSelect').addEventListener('change', function() {
            appData.activeBudgetId = this.value;
            saveAndEncrypt();
            renderAll();
        });

        document.getElementById('newBudgetBtn').addEventListener('click', () => {
            const name = prompt('Budget name:');
            if (!name) return;
            const id = Date.now().toString();
            appData.budgets.push(createDefaultBudget(name, id));
            appData.activeBudgetId = id;
            saveAndEncrypt();
            renderAll();
        });

        document.getElementById('deleteBudgetBtn').addEventListener('click', () => {
            if (appData.budgets.length <= 1) return;
            if (!confirm('Delete current budget?')) return;
            appData.budgets = appData.budgets.filter(b => b.id !== appData.activeBudgetId);
            appData.activeBudgetId = appData.budgets[0].id;
            saveAndEncrypt();
            renderAll();
        });

        document.getElementById('savePeriodSettings').addEventListener('click', () => {
            const budget = getActiveBudget();
            if (!budget) return;
            budget.periodType = document.getElementById('periodTypeSelect').value;
            budget.periodStart = document.getElementById('periodStartInput').value || formatDateLocal(new Date());
            saveAndEncrypt();
            renderAll();
        });

        document.getElementById('setBudgetGoal').addEventListener('click', () => {
            const budget = getActiveBudget();
            if (!budget) return;
            const limit = parseFloat(document.getElementById('budgetGoalInput').value);
            const savings = parseFloat(document.getElementById('savingsGoalInput').value);
            const plannedIncome = parseFloat(document.getElementById('plannedIncomeInput')?.value || '0');
            const savingsBalance = parseFloat(document.getElementById('savingsBalanceInput')?.value || '0');
            budget.budgetGoal = !isNaN(limit) && limit >= 0 ? limit : 0;
            budget.savingsGoal = !isNaN(savings) && savings >= 0 ? savings : 0;
            budget.savingsBalance = !isNaN(savingsBalance) && savingsBalance >= 0 ? savingsBalance : 0;
            budget.plannedIncome = !isNaN(plannedIncome) && plannedIncome >= 0 ? plannedIncome : 0;
            saveAndEncrypt();
            renderAll();
        });

        document.getElementById('savePlannerSettings')?.addEventListener('click', () => {
            const budget = getActiveBudget();
            if (!budget) return;
            budget.rolloverEnabled = Boolean(document.getElementById('rolloverEnabledCheckbox')?.checked);
            saveAndEncrypt();
            renderAll();
            alert('Planner settings saved.');
        });

        // ---------- Categories ----------
        function renderCategories(budget) {
            if (!budget) return;
            budget.categories = uniqueClean([...(budget.categories || []), ...DEFAULT_CATEGORIES, ...budget.expenses.map(e => e.category)]);
            const select = document.getElementById('expenseCategory');
            const current = select.value;
            select.innerHTML = '';
            budget.categories.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                select.appendChild(opt);
            });
            if (budget.categories.includes(current)) select.value = current;

            const chips = document.getElementById('categoryChips');
            chips.innerHTML = budget.categories.map(cat => {
                const protectedCat = DEFAULT_CATEGORIES.includes(cat);
                return `<span class="category-chip">${escapeHTML(cat)}${protectedCat ? '' : `<button type="button" aria-label="Remove ${escapeHTML(cat)}" data-remove-category="${escapeHTML(cat)}">×</button>`}</span>`;
            }).join('');
            chips.querySelectorAll('[data-remove-category]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const value = btn.getAttribute('data-remove-category');
                    budget.categories = budget.categories.filter(c => c !== value);
                    if (budget.categoryBudgets) delete budget.categoryBudgets[value];
                    saveAndEncrypt();
                    renderAll();
                });
            });
            renderCategoryBudgetList(budget);
        }


        function getPreviousPeriod(budget) {
            const current = getCurrentPeriod(budget);
            return { type: current.type, start: subtractPeriod(current.start, current.type), end: current.start };
        }

        function getAdjustedCategoryLimit(budget, category) {
            const base = Number((budget.categoryBudgets || {})[category] || 0);
            if (!budget?.rolloverEnabled || !base) return base;
            const previous = getPreviousPeriod(budget);
            const spentLast = (budget.expenses || []).filter(item => itemInRange(item, previous) && (item.category || 'Other') === category).reduce((sum, item) => sum + Number(item.amount || 0), 0);
            return Math.max(0, base + (base - spentLast));
        }

        function renderCategoryBudgetList(budget) {
            const list = document.getElementById('categoryBudgetList');
            if (!list || !budget) return;
            budget.categoryBudgets = budget.categoryBudgets || {};
            const { expenses } = getCycleItems(budget);
            const totals = getCategoryTotals(expenses);
            list.innerHTML = budget.categories.map(cat => {
                const isSavings = isSavingsCategory(cat);
                const spent = isSavings ? getSavingsContributions(expenses) : (totals[cat] || 0);
                const limit = isSavings ? Number(budget.savingsGoal || 0) : getAdjustedCategoryLimit(budget, cat);
                const totalForProgress = isSavings ? getSavingsTotal(budget) : spent;
                const pctRaw = limit > 0 ? (totalForProgress / limit) * 100 : 0;
                const pct = Math.min(100, pctRaw);
                const status = isSavings
                    ? (limit > 0 ? `£${Math.max(0, limit - getSavingsTotal(budget)).toFixed(2)} left to target` : 'No savings target')
                    : (limit > 0 ? (spent > limit ? `£${(spent - limit).toFixed(2)} over` : `£${Math.max(0, limit - spent).toFixed(2)} left`) : 'No limit');
                return `<div class="category-limit-item ${isSavings ? 'savings-limit-item' : ''}">
                    <div class="category-limit-top"><strong>${escapeHTML(cat)}</strong><span class="${spent > limit && limit > 0 ? 'danger-text' : 'muted'}">${escapeHTML(status)}</span></div>
                    <div class="category-limit-grid">
                        <div>
                            <div class="progress-meta"><span>${isSavings ? `Saved £${getSavingsTotal(budget).toFixed(2)} total • £${spent.toFixed(2)} in this view` : `Spent £${spent.toFixed(2)}`}</span><span>${limit > 0 ? `${pctRaw.toFixed(0)}%` : ''}</span></div>
                            <div class="progress-bar"><div class="progress-fill ${!isSavings && spent > limit && limit > 0 ? 'over' : ''}" style="width:${pct}%"></div></div>
                        </div>
                        <input type="number" min="0" step="0.01" inputmode="decimal" aria-label="${escapeHTML(cat)} ${isSavings ? 'target' : 'limit'}" value="${limit || ''}" data-category-limit="${escapeHTML(cat)}" placeholder="${isSavings ? 'Savings target' : 'Limit'}">
                    </div>
                </div>`;
            }).join('');
            list.querySelectorAll('[data-category-limit]').forEach(input => {
                input.addEventListener('change', () => {
                    const cat = input.getAttribute('data-category-limit');
                    const value = Number(input.value);
                    if (isSavingsCategory(cat)) {
                        budget.savingsGoal = Number.isFinite(value) && value > 0 ? value : 0;
                    } else if (!Number.isFinite(value) || value <= 0) delete budget.categoryBudgets[cat];
                    else budget.categoryBudgets[cat] = value;
                    saveAndEncrypt();
                    renderAll();
                });
            });
        }

        document.getElementById('addCategoryBtn').addEventListener('click', () => {
            const budget = getActiveBudget();
            const input = document.getElementById('newCategoryInput');
            const value = input.value.trim();
            if (!budget || !value) return;
            budget.categories = uniqueClean([...(budget.categories || []), value]);
            input.value = '';
            saveAndEncrypt();
            renderAll();
            document.getElementById('expenseCategory').value = value;
        });

        document.getElementById('resetCategoriesBtn').addEventListener('click', () => {
            const budget = getActiveBudget();
            if (!budget) return;
            budget.categories = uniqueClean([...DEFAULT_CATEGORIES, ...budget.expenses.map(e => e.category)]);
            saveAndEncrypt();
            renderAll();
        });


        // ---------- AI statement import ----------
        function getAiImportSettings() {
            return {
                enabled: localStorage.getItem('aiImportEnabled') === '1',
                endpoint: localStorage.getItem('aiImportEndpoint') || '/api/parse-statement'
            };
        }

        // Optional shared secret for locked-down self-hosted endpoints. If the user has
        // set one (localStorage 'aiImportSecret', matching IMPORT_SHARED_SECRET on the
        // server), it is sent as a header so the server can reject everyone else.
        function aiImportHeaders(base = {}) {
            const secret = localStorage.getItem('aiImportSecret');
            return secret ? { ...base, 'x-budgetvault-key': secret } : { ...base };
        }

        function setAiImportStatus(message, state = '') {
            const el = document.getElementById('aiImportStatus');
            if (!el) return;
            el.textContent = message;
            el.dataset.state = state;
        }

        function updateAiImportSettingsUI() {
            const settings = getAiImportSettings();
            const enabled = document.getElementById('aiImportEnabledCheckbox');
            const endpoint = document.getElementById('aiImportEndpointInput');
            const secret = document.getElementById('aiImportSecretInput');
            if (enabled) enabled.checked = settings.enabled;
            if (endpoint) endpoint.value = settings.endpoint;
            if (secret) secret.value = localStorage.getItem('aiImportSecret') || '';
        }

        function saveAiImportSettings() {
            const enabled = document.getElementById('aiImportEnabledCheckbox')?.checked ? '1' : '0';
            const endpoint = (document.getElementById('aiImportEndpointInput')?.value || '/api/parse-statement').trim() || '/api/parse-statement';
            const secret = (document.getElementById('aiImportSecretInput')?.value || '').trim();
            localStorage.setItem('aiImportEnabled', enabled);
            localStorage.setItem('aiImportEndpoint', endpoint);
            if (secret) localStorage.setItem('aiImportSecret', secret); else localStorage.removeItem('aiImportSecret');
            setAiImportStatus(enabled === '1' ? 'AI import is enabled on this device. Upload a PDF when ready.' : 'AI import is off. Turn it on before uploading statements.', enabled === '1' ? 'saved' : '');
        }

        function updateSecurityModeUI() {
            const mode = getEncryptionMode();
            const toggle = document.getElementById('onlineModeToggle');
            const endpoint = document.getElementById('pepperEndpointInput');
            const status = document.getElementById('onlineModeStatus');
            if (toggle) toggle.checked = mode === 'online';
            if (endpoint) endpoint.value = getPepperEndpoint();
            if (status) {
                status.textContent = mode === 'online'
                    ? 'ON — unlocking this vault needs your key server. Offline brute-force of the local file is impossible.'
                    : 'OFF — offline mode (default). Everything stays on this device; security depends on your password.';
                status.dataset.state = mode === 'online' ? 'saved' : '';
            }
        }

        // Switch between offline and online (server-pepper) encryption, re-encrypting all data.
        async function applyEncryptionMode() {
            if (!currentPassword) { alert('Unlock the app before changing the encryption mode.'); return; }
            const wantOnline = !!document.getElementById('onlineModeToggle')?.checked;
            const endpoint = (document.getElementById('pepperEndpointInput')?.value || '/api/pepper').trim() || '/api/pepper';
            localStorage.setItem('pepperEndpoint', endpoint);
            const targetMode = wantOnline ? 'online' : 'offline';
            const currentMode = getEncryptionMode();
            if (targetMode === currentMode) { updateSecurityModeUI(); setSaveStatus('Encryption mode unchanged.'); return; }
            if (targetMode === 'online') {
                const ok = confirm('Turn ON online high-security mode?\n\n• Unlocking your vault will require reaching your key server each time (after unlocking, edits still work offline).\n• If the server secret (KDF_PEPPER) is lost or changed, your data CANNOT be recovered.\n• Export a plain backup and store it safely before continuing.\n\nContinue?');
                if (!ok) { updateSecurityModeUI(); return; }
            }
            setSaveStatus(`Re-encrypting in ${targetMode} mode…`);
            try {
                localStorage.setItem('encryptionMode', targetMode);
                await establishSessionKey(currentPassword);   // online => contacts your key server
                await storeEncrypted(normaliseData(appData));
            } catch (err) {
                localStorage.setItem('encryptionMode', currentMode); // revert; cached key is unchanged on failure
                updateSecurityModeUI();
                alert(err && err.code === 'SERVER'
                    ? `Could not switch to online mode: ${err.message}`
                    : `Encryption mode switch failed: ${err.message || ''}`);
                return;
            }
            updateSecurityModeUI();
            setSaveStatus('Encryption mode updated.');
            alert(targetMode === 'online'
                ? 'Online high-security mode is ON. Your data was re-encrypted so the local file cannot be brute-forced without your server.'
                : 'Switched to offline mode. Your data was re-encrypted for local-only use.');
        }

        function endpointUrlFor(path) {
            const endpoint = (path || getAiImportSettings().endpoint || '/api/parse-statement').trim();
            if (/^https?:\/\//i.test(endpoint)) return endpoint;
            return endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        }

        async function testAiImportConnection() {
            saveAiImportSettings();
            const endpoint = endpointUrlFor(getAiImportSettings().endpoint).replace(/\/parse-statement\/?$/, '/health');
            setAiImportStatus('Testing Vercel import service...', 'saving');
            try {
                const res = await fetch(endpoint, { cache: 'no-store', headers: aiImportHeaders() });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
                setAiImportStatus(data.openaiConfigured ? 'Connection OK. OpenAI key is configured on Vercel.' : 'Connection OK, but OPENAI_API_KEY is not configured on Vercel yet.', data.openaiConfigured ? 'saved' : 'error');
            } catch (error) {
                setAiImportStatus(`Connection failed: ${error.message}`, 'error');
            }
        }

        function readFileAsBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(new Error('Could not read the PDF file.'));
                reader.onload = () => {
                    const value = String(reader.result || '');
                    resolve(value.includes(',') ? value.split(',').pop() : value);
                };
                reader.readAsDataURL(file);
            });
        }

        function makeLearningKeyword(description) {
            const stop = new Set(['card','payment','purchase','debit','credit','online','mobile','bank','transfer','pos','visa','mastercard','contactless','faster','payment','ltd','limited','the','and','for','from']);
            const words = String(description || '')
                .toLowerCase()
                .replace(/[^a-z0-9£$\s]/g, ' ')
                .split(/\s+/)
                .filter(word => word.length >= 3 && !/^\d+$/.test(word) && !stop.has(word))
                .slice(0, 3);
            return words.join(' ').trim();
        }

        function findImportDuplicate(budget, tx) {
            const list = tx.type === 'income' ? (budget.wages || []) : (budget.expenses || []);
            const desc = String(tx.description || tx.merchant || '').toLowerCase().replace(/\s+/g, ' ').trim();
            return list.some(item => {
                const itemDesc = String(item.source || item.description || '').toLowerCase().replace(/\s+/g, ' ').trim();
                return item.date === tx.date && Math.abs(Number(item.amount || 0) - Number(tx.amount || 0)) < 0.01 && itemDesc === desc;
            });
        }

        function applyLocalImportLearning(tx, budget) {
            if (!budget || tx.type !== 'expense') return tx;
            const desc = String(tx.description || tx.merchant || '').toLowerCase();
            const rule = (budget.importRules || []).find(r => r.keyword && desc.includes(String(r.keyword).toLowerCase()));
            if (rule) {
                return { ...tx, category: rule.category, confidence: Math.max(Number(tx.confidence || 0), 0.92), learnedCategory: true };
            }
            return tx;
        }

        function normaliseImportedTransaction(raw, index, budget) {
            const rawAmount = Number(raw?.amount ?? raw?.rawAmount ?? 0);
            let type = String(raw?.type || '').toLowerCase();
            if (!['income', 'expense'].includes(type)) type = rawAmount < 0 ? 'expense' : 'income';
            const amount = Math.abs(Number.isFinite(rawAmount) ? rawAmount : Number(raw?.amountPositive || 0));
            const date = parseLocalDate(raw?.date) ? raw.date : formatDateLocal(new Date());
            const description = String(raw?.description || raw?.merchant || raw?.source || `Statement item ${index + 1}`).trim();
            const suggestedCategory = type === 'expense' ? String(raw?.suggestedCategory || raw?.category || 'Other').trim() || 'Other' : '';
            const source = type === 'income' ? String(raw?.source || raw?.merchant || description || 'Statement income').trim() : '';
            const confidence = Math.max(0, Math.min(1, Number(raw?.confidence ?? 0.5)));
            const base = {
                id: `import-${Date.now()}-${index}`,
                include: true,
                date,
                type,
                amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
                category: suggestedCategory,
                originalCategory: suggestedCategory,
                source,
                description,
                confidence,
                sourcePage: raw?.sourcePage || raw?.page || '',
                notes: String(raw?.notes || '').trim(),
                merchantKeyword: String(raw?.merchantKeyword || makeLearningKeyword(description)).trim(),
                needsReview: Boolean(raw?.needsReview) || confidence < 0.75 || !amount,
                duplicate: false,
                userEdited: false,
                learnedCategory: false
            };
            const learned = applyLocalImportLearning(base, budget);
            learned.duplicate = findImportDuplicate(budget, learned);
            if (learned.duplicate) learned.include = false;
            return learned;
        }

        function renderImportLearningRules() {
            const budget = getActiveBudget();
            const wrap = document.getElementById('importLearningRules');
            if (!wrap) return;
            const rules = normaliseImportRules(budget?.importRules || []);
            wrap.innerHTML = rules.length ? rules.map(rule => `<span class="category-chip">${escapeHTML(rule.keyword)} → ${escapeHTML(rule.category)} <small>(${Number(rule.uses || 1)}×)</small></span>`).join('') : '<span class="muted">No learned rules yet. Correct categories during AI import to build them.</span>';
        }

        function categoryOptionsForImport(selected) {
            const budget = getActiveBudget();
            const categories = uniqueClean([...(budget?.categories || DEFAULT_CATEGORIES), selected || 'Other']);
            return categories.map(cat => `<option value="${escapeHTML(cat)}" ${cat === selected ? 'selected' : ''}>${escapeHTML(cat)}</option>`).join('');
        }

        function renderImportReview() {
            const tbody = document.querySelector('#aiImportReviewTable tbody');
            const summary = document.getElementById('aiImportSummary');
            if (!tbody || !summary) return;
            const rows = pendingStatementImport || [];
            const selectedCount = rows.filter(r => r.include).length;
            const lowConfidence = rows.filter(r => r.needsReview || Number(r.confidence || 0) < 0.75).length;
            const duplicates = rows.filter(r => r.duplicate).length;
            const statementPeriod = pendingStatementImportMeta?.statementPeriod;
            const periodText = statementPeriod?.from && statementPeriod?.to ? ` • Statement ${statementPeriod.from} to ${statementPeriod.to}` : '';
            summary.classList.toggle('empty-state', !rows.length);
            summary.textContent = rows.length ? `${rows.length} transaction${rows.length === 1 ? '' : 's'} found • ${selectedCount} selected • ${lowConfidence} need review • ${duplicates} possible duplicate${duplicates === 1 ? '' : 's'}${periodText}` : 'No parsed statement waiting for review.';
            let renderRows = rows.map((row, index) => ({ row, index }));
            if (importSort.field === 'confidence') {
                renderRows.sort((a, b) => ((Number(a.row.confidence || 0) - Number(b.row.confidence || 0)) * (importSort.order === 'asc' ? 1 : -1)) || a.row.date.localeCompare(b.row.date));
            } else if (importSort.field === 'date') {
                renderRows.sort((a, b) => a.row.date.localeCompare(b.row.date) * (importSort.order === 'asc' ? 1 : -1));
            }
            tbody.innerHTML = renderRows.length ? renderRows.map(({ row, index }) => {
                const confPct = Math.round(Number(row.confidence || 0) * 100);
                const badgeClass = row.duplicate || row.needsReview || confPct < 75 ? 'needs-review-chip' : 'reviewed-chip';
                const reviewHint = row.duplicate ? 'Possible duplicate. Check before importing. ' : row.needsReview || confPct < 75 ? 'Low confidence. Please check. ' : '';
                return `<tr data-import-index="${index}" class="${row.duplicate ? 'import-duplicate-row' : ''}">
                    <td data-label="Use"><input type="checkbox" data-import-field="include" ${row.include ? 'checked' : ''}></td>
                    <td data-label="Date"><input type="date" data-import-field="date" value="${escapeHTML(row.date)}"></td>
                    <td data-label="Type"><select data-import-field="type"><option value="expense" ${row.type === 'expense' ? 'selected' : ''}>Money out</option><option value="income" ${row.type === 'income' ? 'selected' : ''}>Money in</option></select></td>
                    <td data-label="Amount"><input type="number" min="0.01" step="0.01" inputmode="decimal" data-import-field="amount" value="${Number(row.amount || 0).toFixed(2)}"></td>
                    <td data-label="Category / Source">${row.type === 'income' ? `<input type="text" data-import-field="source" value="${escapeHTML(row.source || 'Statement income')}" placeholder="Income source">` : `<select data-import-field="category">${categoryOptionsForImport(row.category || 'Other')}</select>`}</td>
                    <td data-label="Description"><input type="text" data-import-field="description" value="${escapeHTML(row.description || '')}"><small>${reviewHint}${row.learnedCategory ? 'Learned category applied. ' : ''}${row.notes ? escapeHTML(row.notes) : ''}</small></td>
                    <td data-label="Confidence"><button type="button" class="mini-chip ${badgeClass}" data-action="sort-import-confidence" title="Click to sort by confidence">${confPct}%</button></td>
                </tr>`;
            }).join('') : '<tr class="empty-row"><td colspan="7"><div class="empty-state small">Upload and parse a statement to review transactions here.</div></td></tr>';
            renderImportLearningRules();
        }

        function updatePendingImportField(event) {
            const input = event.target.closest('[data-import-field]');
            if (!input) return;
            const row = input.closest('[data-import-index]');
            if (!row) return;
            const index = Number(row.dataset.importIndex);
            const item = pendingStatementImport[index];
            if (!item) return;
            const field = input.dataset.importField;
            let value = input.type === 'checkbox' ? input.checked : input.value;
            if (field === 'amount') value = Math.max(0, Number(value) || 0);
            item[field] = value;
            if (field === 'category' && item.originalCategory !== value) { item.userEdited = true; item.needsReview = false; }
            if (field === 'source' || field === 'description' || field === 'date' || field === 'amount') item.userEdited = true;
            if (field === 'type') {
                if (value === 'income') item.source = item.source || item.description || 'Statement income';
                else item.category = item.category || item.originalCategory || 'Other';
                renderImportReview();
            }
        }

        async function parseBankStatementPdf() {
            const settings = getAiImportSettings();
            const file = document.getElementById('statementPdfFile')?.files?.[0];
            const consent = document.getElementById('aiImportConsentCheckbox')?.checked;
            const budget = getActiveBudget();
            if (!budget) return;
            if (!settings.enabled) { setAiImportStatus('AI import is switched off. Enable it first in this tab.', 'error'); return; }
            if (!consent) { setAiImportStatus('Please tick the privacy consent box before uploading a statement.', 'error'); return; }
            if (!file) { setAiImportStatus('Choose a PDF bank statement first.', 'error'); return; }
            if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setAiImportStatus('Please choose a PDF file.', 'error'); return; }
            if (file.size > 3.5 * 1024 * 1024) { setAiImportStatus('This PDF is quite large. For Vercel Hobby, try a statement under about 3.5 MB or split/compress it first.', 'error'); return; }
            saveAiImportSettings();
            setAiImportStatus('Reading PDF and sending it to your Vercel import service...', 'saving');
            try {
                const dataBase64 = await readFileAsBase64(file);
                const payload = {
                    filename: file.name,
                    mimeType: file.type || 'application/pdf',
                    dataBase64,
                    currency: 'GBP',
                    categories: budget.categories || DEFAULT_CATEGORIES,
                    learningRules: normaliseImportRules(budget.importRules || []),
                    existingHints: [...(budget.wages || []), ...(budget.expenses || [])].slice(-80).map(item => ({ date: item.date, amount: item.amount, description: item.description || item.source || '', category: item.category || '' }))
                };
                const res = await fetch(endpointUrlFor(settings.endpoint), {
                    method: 'POST',
                    headers: aiImportHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify(payload)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || `Import failed with HTTP ${res.status}`);
                const transactions = Array.isArray(data.transactions) ? data.transactions : [];
                pendingStatementImportMeta = { statementPeriod: data.statementPeriod || null, institution: data.institution || '', warnings: Array.isArray(data.warnings) ? data.warnings : [] };
                pendingStatementImport = transactions.map((tx, index) => normaliseImportedTransaction(tx, index, budget)).filter(tx => tx.amount > 0);
                renderImportReview();
                setAiImportStatus(pendingStatementImport.length ? `Parsed ${pendingStatementImport.length} transaction${pendingStatementImport.length === 1 ? '' : 's'}. Review them below before importing.` : 'The AI response did not contain any usable transactions.', pendingStatementImport.length ? 'saved' : 'error');
            } catch (error) {
                console.error(error);
                setAiImportStatus(`Import failed: ${error.message}`, 'error');
            }
        }

        function rememberImportCorrection(budget, row) {
            if (!budget || row.type !== 'expense' || !row.category) return;
            const keyword = String(row.merchantKeyword || makeLearningKeyword(row.description)).trim();
            if (!keyword || keyword.length < 3) return;
            budget.importRules = normaliseImportRules(budget.importRules || []);
            const existing = budget.importRules.find(rule => rule.keyword.toLowerCase() === keyword.toLowerCase());
            if (existing) {
                existing.category = row.category;
                existing.uses = Number(existing.uses || 0) + 1;
                existing.updatedAt = new Date().toISOString();
            } else {
                budget.importRules.unshift({ keyword, category: row.category, uses: 1, updatedAt: new Date().toISOString() });
            }
            budget.importRules = normaliseImportRules(budget.importRules).slice(0, 150);
        }

        
        function setLastImportRangeFromRows(budget, rows) {
            const dates = (rows || []).map(row => parseLocalDate(row.date)).filter(Boolean).sort((a, b) => a - b);
            let from = pendingStatementImportMeta?.statementPeriod?.from;
            let to = pendingStatementImportMeta?.statementPeriod?.to;
            if (!parseLocalDate(from) || !parseLocalDate(to)) {
                from = dates[0] ? formatDateLocal(dates[0]) : null;
                to = dates.length ? formatDateLocal(dates[dates.length - 1]) : null;
            }
            if (parseLocalDate(from) && parseLocalDate(to)) budget.lastImportRange = { from, to };
        }

        function applyImportBulkType(type) {
            if (!['income','expense'].includes(type)) return;
            (pendingStatementImport || []).forEach(item => {
                if (!item.include) return;
                item.type = type;
                if (type === 'income') item.source = item.source || item.description || 'Statement income';
                else item.category = item.category || item.originalCategory || 'Other';
                item.needsReview = true;
                item.userEdited = true;
            });
            renderImportReview();
        }

        function selectImportRows(mode) {
            (pendingStatementImport || []).forEach(item => {
                if (mode === 'all') item.include = true;
                else if (mode === 'none') item.include = false;
                else if (mode === 'low') item.include = item.needsReview || item.confidence < 0.75 || item.duplicate;
                else if (mode === 'safe') item.include = !item.duplicate && !item.needsReview && item.confidence >= 0.75;
            });
            renderImportReview();
        }

function importSelectedStatementTransactions() {
            const budget = getActiveBudget();
            if (!budget) return;
            const selected = (pendingStatementImport || []).filter(row => row.include && Number(row.amount || 0) > 0 && parseLocalDate(row.date));
            if (!selected.length) { alert('No valid selected transactions to import.'); return; }
            const duplicates = selected.filter(row => row.duplicate).length;
            if (duplicates && !confirm(`${duplicates} selected transaction${duplicates === 1 ? ' is' : 's are'} marked as possible duplicate. Import anyway?`)) return;
            let incomeCount = 0;
            let expenseCount = 0;
            selected.forEach(row => {
                const amount = Math.abs(Number(row.amount || 0));
                if (row.type === 'income') {
                    budget.wages.push({ date: row.date, amount, source: String(row.source || row.description || 'Statement income').trim(), recurrence: 'none', recurring: false, reviewed: true });
                    incomeCount++;
                } else {
                    const category = String(row.category || 'Other').trim() || 'Other';
                    budget.categories = uniqueClean([...(budget.categories || []), category]);
                    budget.expenses.push({ date: row.date, amount, category, description: String(row.description || '').trim(), recurrence: 'none', recurring: false, reviewed: true });
                    rememberImportCorrection(budget, row);
                    expenseCount++;
                }
            });
            setLastImportRangeFromRows(budget, selected);
            pendingStatementImport = [];
            pendingStatementImportMeta = null;
            viewRangeMode = budget.lastImportRange ? 'statement' : 'all';
            localStorage.setItem('viewRangeMode', viewRangeMode);
            currentFilterMonth = null;
            const fm = document.getElementById('filterMonth'); if (fm) fm.value = '';
            saveAndEncrypt();
            renderAll();
            renderImportReview();
            activateTab('home', { scroll: true, anchorId: 'dashboard' });
            setAiImportStatus(`Imported ${incomeCount} money-in and ${expenseCount} money-out transaction${incomeCount + expenseCount === 1 ? '' : 's'} into this vault. Overview is now showing the imported statement range.`, 'saved');
        }

        function clearImportLearning() {
            const budget = getActiveBudget();
            if (!budget) return;
            if (!confirm('Clear all learned merchant/category rules for this budget?')) return;
            budget.importRules = [];
            saveAndEncrypt();
            renderImportLearningRules();
            setAiImportStatus('Import learning rules cleared for this budget.', 'saved');
        }

        function initAiImport() {
            updateAiImportSettingsUI();
            updateSecurityModeUI();
            document.getElementById('applyOnlineModeBtn')?.addEventListener('click', applyEncryptionMode);
            renderImportReview();
            document.getElementById('saveAiImportSettingsBtn')?.addEventListener('click', saveAiImportSettings);
            document.getElementById('testAiImportBtn')?.addEventListener('click', testAiImportConnection);
            document.getElementById('parseStatementBtn')?.addEventListener('click', parseBankStatementPdf);
            document.getElementById('importSelectedTransactionsBtn')?.addEventListener('click', importSelectedStatementTransactions);
            document.getElementById('clearImportReviewBtn')?.addEventListener('click', () => { pendingStatementImport = []; renderImportReview(); setAiImportStatus('Statement review cleared.', ''); });
            document.getElementById('clearImportLearningBtn')?.addEventListener('click', clearImportLearning);
            document.getElementById('aiImportReviewTable')?.addEventListener('input', updatePendingImportField);
            document.getElementById('aiImportReviewTable')?.addEventListener('change', updatePendingImportField);
            document.getElementById('aiImportReviewTable')?.addEventListener('click', event => {
                if (!event.target.closest('[data-action="sort-import-confidence"]')) return;
                importSort.field = 'confidence';
                importSort.order = importSort.order === 'asc' ? 'desc' : 'asc';
                renderImportReview();
            });
            document.getElementById('sortImportConfidenceBtn')?.addEventListener('click', () => { importSort = { field: 'confidence', order: 'asc' }; renderImportReview(); });
            document.getElementById('applyImportTypeBtn')?.addEventListener('click', () => applyImportBulkType(document.getElementById('bulkImportTypeSelect')?.value));
            document.getElementById('selectLowConfidenceBtn')?.addEventListener('click', () => selectImportRows('low'));
            document.getElementById('selectSafeImportBtn')?.addEventListener('click', () => selectImportRows('safe'));
            document.getElementById('selectAllImportBtn')?.addEventListener('click', () => selectImportRows('all'));
        }

        // ---------- Reminders & notifications ----------
        async function requestNotificationPermission() {
            if (!notificationsEnabled || !('Notification' in window)) return false;
            if (Notification.permission === 'granted') return true;
            if (Notification.permission === 'default') {
                const result = await Notification.requestPermission();
                return result === 'granted';
            }
            return false;
        }

        function getNextMonthlyOccurrence(originalDate, now) {
            const source = parseLocalDate(originalDate);
            if (!source) return null;
            const targetDay = source.getDate();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const makeCandidate = (year, month) => {
                const lastDay = new Date(year, month + 1, 0).getDate();
                return new Date(year, month, Math.min(targetDay, lastDay));
            };
            let candidate = makeCandidate(today.getFullYear(), today.getMonth());
            if (candidate < today) candidate = makeCandidate(today.getFullYear(), today.getMonth() + 1);
            return candidate;
        }

        function getNextOccurrence(item, now = new Date()) {
            const recurrence = normaliseRecurrence(item);
            if (recurrence === 'none') return null;
            if (recurrence === 'monthly') return getNextMonthlyOccurrence(item.date, now);
            const interval = recurrence === 'weekly' ? 7 : recurrence === 'biweekly' ? 14 : 28;
            const start = parseLocalDate(item.date);
            if (!start) return null;
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (start >= today) return start;
            const passed = daysBetween(start, today);
            return addDays(start, Math.ceil(passed / interval) * interval);
        }

        function showReminders(budget) {
            if (!budget) return;
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const nextWindow = addDays(today, 30);
            const upcoming = [];
            const check = (items, type) => {
                items.forEach((item, index) => {
                    const next = getNextOccurrence(item, now);
                    if (next && next <= nextWindow && next >= today) {
                        const nextDate = formatDateLocal(next);
                        if (hasMatchingRecurringCopy(budget, item, type, nextDate)) return;
                        upcoming.push({ ...item, type, sourceIndex: index, nextDate, reminderKey: `${appData.activeBudgetId}:${type}:${index}:${nextDate}` });
                    }
                });
            };
            check(budget.wages, 'Income');
            check(budget.expenses, 'Expense');
            upcoming.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
            const listDiv = document.getElementById('reminderList');
            listDiv.innerHTML = upcoming.length ? upcoming.map(r => {
                const label = escapeHTML(r.source || r.category || 'Recurring item');
                const amount = Number(r.amount || 0).toFixed(2);
                const typeClass = r.type === 'Income' ? 'income' : 'expense';
                const actionType = r.type === 'Income' ? 'wage' : 'expense';
                return `<div class="reminder-item">
                    <div class="reminder-copy"><strong>${escapeHTML(r.type)}</strong><span>${label} • ${escapeHTML(RECURRENCE_LABELS[normaliseRecurrence(r)])}</span></div>
                    <div class="reminder-meta"><span class="amount ${typeClass}">£${amount}</span><small>${escapeHTML(r.nextDate)}</small></div>
                    <div class="install-actions reminder-actions"><button class="secondary btn-sm" data-recurring-action="add-next" data-type="${actionType}" data-index="${r.sourceIndex}" data-date="${r.nextDate}">Add due</button><button class="secondary btn-sm" data-recurring-action="edit" data-type="${actionType}" data-index="${r.sourceIndex}">Edit</button><button class="ghost btn-sm" data-recurring-action="stop" data-type="${actionType}" data-index="${r.sourceIndex}">Stop repeat</button></div>
                </div>`;
            }).join('') : '<div class="empty-state small">No recurring bills, subscriptions, or income due in the next 30 days.</div>';
            if (notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
                upcoming.forEach(r => {
                    const notifiedKey = `notified:${r.reminderKey}`;
                    if (sessionStorage.getItem(notifiedKey)) return;
                    sessionStorage.setItem(notifiedKey, '1');
                    const body = hideNotificationAmounts
                        ? `${r.type} due on ${r.nextDate}`
                        : `£${Number(r.amount || 0).toFixed(2)} on ${r.nextDate}`;
                    new Notification(`Reminder: ${r.type}`, { body });
                });
            }
        }

        function handleRecurringAction(event) {
            const button = event.target.closest('[data-recurring-action]');
            if (!button) return;
            const budget = getActiveBudget();
            if (!budget) return;
            const type = button.dataset.type;
            const list = type === 'wage' ? budget.wages : budget.expenses;
            const index = Number(button.dataset.index);
            const item = list?.[index];
            if (!item) return;
            const action = button.dataset.recurringAction;
            if (action === 'edit') { openEditModal(type, index); return; }
            if (action === 'stop') {
                if (!confirm('Stop this item repeating? Existing transactions stay in the vault.')) return;
                item.recurrence = 'none'; item.recurring = false;
            } else if (action === 'add-next') {
                const date = button.dataset.date || formatDateLocal(getNextOccurrence(item) || new Date());
                const exists = list.some(row => row !== item && row.date === date && Math.abs(Number(row.amount || 0) - Number(item.amount || 0)) < 0.01 && String(row.source || row.description || '') === String(item.source || item.description || ''));
                if (exists && !confirm('A similar transaction already exists on that date. Add another copy anyway?')) return;
                const copy = cloneData(item);
                copy.date = date;
                copy.recurrence = 'none';
                copy.recurring = false;
                copy.reviewed = false;
                list.push(copy);
            }
            saveAndEncrypt();
            renderAll();
        }

        // ---------- Render all ----------
        function renderAll() {
            appData = normaliseData(appData);
            const budget = getActiveBudget();
            if (!budget) return;
            renderDashboard(budget);
            renderSmartInsights(budget);
            renderTables(budget);
            renderReviewQueue(budget);
            renderBudgetSelector();
            renderImportLearningRules();
            renderImportReview();
            showReminders(budget);
            updateCharts(budget);
            renderReportsLab(budget);
            resetIdleTimer();
            if (!document.getElementById('yearlyReport').classList.contains('hidden')) renderYearlyReport();
        }

        function renderDashboard(budget) {
            const { range, wages, expenses } = getCycleItems(budget);
            const income = wages.reduce((s,w) => s + Number(w.amount || 0), 0);
            const totalOut = expenses.reduce((s,e) => s + Number(e.amount || 0), 0);
            const savingsMoved = getSavingsContributions(expenses);
            const spendingExpenses = getSpendingExpenses(expenses);
            const exp = spendingExpenses.reduce((s,e) => s + Number(e.amount || 0), 0);
            const plannedIncome = Number(budget.plannedIncome || 0);
            const planningIncome = Math.max(income, plannedIncome);
            const bal = income - totalOut;
            const limit = budget.budgetGoal || 0;
            const savingsGoal = budget.savingsGoal || 0;
            const savingsTotal = getSavingsTotal(budget);
            const savingsBase = Number(budget.savingsBalance || 0);
            const allSavingsMoved = getSavingsContributions(budget.expenses || []);
            const spendPctRaw = limit > 0 ? (exp / limit) * 100 : 0;
            const spendPct = limit > 0 ? Math.min(100, spendPctRaw) : 0;
            const leftToBudget = Math.max(0, limit - exp);
            const projectedLeftover = planningIncome - totalOut;
            const savingsPctRaw = savingsGoal > 0 ? (savingsTotal / savingsGoal) * 100 : 0;
            const savingsPct = savingsGoal > 0 ? Math.min(100, savingsPctRaw) : 0;
            const overBudget = limit > 0 && exp > limit ? `<small class="danger-text">£${(exp-limit).toFixed(2)} over spending limit</small>` : '<small>Within your spending limit. Savings transfers are tracked separately.</small>';
            const savingsText = savingsGoal > 0 ? `${savingsPctRaw.toFixed(0)}% of savings target` : 'No savings target set';
            const savingsMeta = savingsGoal > 0 ? `<small>£${Math.max(0, savingsGoal-savingsTotal).toFixed(2)} left to savings target • £${savingsBase.toFixed(2)} starting + £${allSavingsMoved.toFixed(2)} saved in BudgetVault</small>` : `<small>Current savings total: £${savingsTotal.toFixed(2)}. Set a target to track progress.</small>`;
            document.getElementById('dashboard').innerHTML = `
                <div class="cards dash-grid">
                    <div class="vault-hero">
                        <div class="vh-top">
                            <span class="eyebrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg> Net this cycle</span>
                            <span class="pill">${escapeHTML(range.label)}${currentFilterMonth || searchTerm ? ' · filtered' : ''}</span>
                        </div>
                        <div class="vh-figure ${bal < 0 ? 'neg' : ''}">£${bal.toFixed(2)}</div>
                        <div class="vh-breakdown">
                            <div class="vh-stat in"><span class="k"><span class="dot in"></span>Money in</span><span class="v">£${income.toFixed(2)}</span></div>
                            <div class="vh-stat"><span class="k"><span class="dot out"></span>Money out</span><span class="v">£${totalOut.toFixed(2)}</span></div>
                            <div class="vh-stat"><span class="k"><span class="dot out"></span>Spending</span><span class="v">£${exp.toFixed(2)}</span></div>
                            <div class="vh-stat saved"><span class="k"><span class="dot saved"></span>Saved</span><span class="v">£${savingsMoved.toFixed(2)}</span></div>
                        </div>
                    </div>

                    <div class="card dial-card">
                        <div class="c-top"><div class="c-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 12l4-2.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg></div><span class="c-label">Spending cap</span></div>
                        <div class="dial-wrap">
                            <div class="dial ${limit > 0 && exp > limit ? 'over' : ''}" style="--pct:${spendPct}">
                                <div class="dial-center"><div class="p">${limit > 0 ? spendPctRaw.toFixed(0) + '%' : '—'}</div><div class="l">of cap</div></div>
                            </div>
                            <div class="dial-info">
                                <div class="di-big">£${leftToBudget.toFixed(2)}</div>
                                <div class="di-sub">${limit > 0 ? (exp > limit ? `£${(exp - limit).toFixed(2)} over your £${limit.toFixed(2)} cap` : `left of your £${limit.toFixed(2)} cap`) : 'No spending cap set yet — add one in Plan.'}</div>
                                <div class="di-sub">Spent £${exp.toFixed(2)}${savingsMoved > 0 ? ` · £${savingsMoved.toFixed(2)} moved to savings (not counted)` : ''}</div>
                            </div>
                        </div>
                    </div>

                    <div class="card pos">
                        <div class="c-top"><div class="c-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10l9-5 9 5"/><path d="M5 10v8M19 10v8M9 10v8M15 10v8M3 21h18"/></svg></div><span class="c-label">Savings</span></div>
                        <div class="c-figure">£${savingsTotal.toFixed(2)}</div>
                        <div class="progress">
                            <div class="progress-meta"><span>${savingsGoal > 0 ? `${savingsPctRaw.toFixed(0)}% of £${savingsGoal.toFixed(2)}` : 'No target set'}</span><span>${savingsGoal > 0 ? `£${Math.max(0, savingsGoal - savingsTotal).toFixed(2)} to go` : ''}</span></div>
                            <div class="bar"><span class="pos" style="width:${savingsPct}%"></span></div>
                        </div>
                        <div class="c-foot">£${savingsBase.toFixed(2)} starting + £${allSavingsMoved.toFixed(2)} saved in BudgetVault</div>
                    </div>

                    <div class="card">
                        <div class="c-top"><div class="c-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg></div><span class="c-label">Left to budget</span></div>
                        <div class="c-figure">£${leftToBudget.toFixed(2)}</div>
                        <div class="c-foot">${budget.rolloverEnabled ? 'Category rollover is on — unspent limits carry forward.' : 'Turn on rollover in Plan to carry unused category money forward.'}</div>
                    </div>
                </div>`;
        }

        function renderSmartInsights(budget) {
            const container = document.getElementById('insightCards');
            if (!container || !budget) return;
            const { range, wages, expenses } = getCycleItems(budget);
            const income = wages.reduce((s,w) => s + Number(w.amount || 0), 0);
            const totalOut = expenses.reduce((s,e) => s + Number(e.amount || 0), 0);
            const spent = getSpendingExpenses(expenses).reduce((s,e) => s + Number(e.amount || 0), 0);
            const savingsMoved = getSavingsContributions(expenses);
            const savingsTotal = getSavingsTotal(budget);
            const balance = income - totalOut;
            const upcomingOutflow = getFutureRecurringOutflowForRange(budget, range);
            const remainingSavingsTarget = Math.max(0, Number(budget.savingsGoal || 0) - savingsTotal);
            const safeToSpend = Math.max(0, balance - upcomingOutflow - remainingSavingsTarget);
            const categories = getCategoryLimitHealth(budget, expenses);
            const overCategories = categories.filter(c => c.over);
            const categoryTotals = getCategoryTotals(expenses);
            const topCategory = Object.entries(categoryTotals).sort((a,b) => b[1] - a[1])[0];
            const biggest = [...expenses].sort((a,b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
            const unreviewed = [...(budget.wages || []), ...(budget.expenses || [])].filter(item => !item.reviewed).length;
            const upcoming30 = getUpcomingRecurringItems(budget, 30);
            const billTotal30 = upcoming30.filter(i => i.type === 'Expense').reduce((s, item) => s + Number(item.amount || 0), 0);
            container.innerHTML = `
                <div class="insight hero-insight">
                    <div class="c-top"><span class="c-label">Safe to spend · after bills &amp; savings</span></div>
                    <div class="c-figure">£${safeToSpend.toFixed(2)}</div>
                    <div class="c-foot">Net £${balance.toFixed(2)} − upcoming bills £${upcomingOutflow.toFixed(2)} − savings still to set aside £${remainingSavingsTarget.toFixed(2)}.${savingsMoved > 0 ? ` £${savingsMoved.toFixed(2)} already moved to savings in this view.` : ''}</div>
                </div>
                <div class="insight">
                    <div class="c-top"><span class="c-label">Bills · next 30 days</span><span class="mini-chip">${upcoming30.length} due</span></div>
                    <div class="c-figure">£${billTotal30.toFixed(2)}</div>
                    <div class="c-foot">${upcoming30.length ? `${upcoming30.length} recurring item${upcoming30.length === 1 ? '' : 's'} coming up.` : 'No recurring items scheduled.'}</div>
                </div>
                <div class="insight">
                    <div class="c-top"><span class="c-label">Category limits</span>${overCategories.length ? '<span class="mini-chip needs-review-chip">over</span>' : '<span class="mini-chip reviewed-chip">on track</span>'}</div>
                    <div class="c-figure"${overCategories.length ? ' style="color:var(--neg)"' : ''}>${overCategories.length}</div>
                    <div class="c-foot">${overCategories.length ? `Over: ${overCategories.map(c => escapeHTML(c.category)).slice(0, 3).join(', ')}` : 'All category limits are within range.'}</div>
                </div>
                <div class="insight">
                    <div class="c-top"><span class="c-label">Top category</span></div>
                    <div class="c-figure">${topCategory ? escapeHTML(topCategory[0]) : '—'}</div>
                    <div class="c-foot">${topCategory ? `£${Number(topCategory[1]).toFixed(2)} spent this cycle.` : 'Add expenses to see your biggest area.'}</div>
                </div>
                <div class="insight">
                    <div class="c-top"><span class="c-label">Biggest expense</span></div>
                    <div class="c-figure">${biggest ? `£${Number(biggest.amount || 0).toFixed(2)}` : '—'}</div>
                    <div class="c-foot">${biggest ? `${escapeHTML(biggest.category || 'Other')} · ${escapeHTML(biggest.description || biggest.date)}` : 'No expenses in this cycle.'}</div>
                </div>
                <div class="insight">
                    <div class="c-top"><span class="c-label">To review</span>${unreviewed ? `<span class="mini-chip needs-review-chip">${unreviewed}</span>` : '<span class="mini-chip reviewed-chip">clear</span>'}</div>
                    <div class="c-figure">${unreviewed}</div>
                    <div class="c-foot">${unreviewed ? 'Check new and imported items, then mark them reviewed.' : 'Everything has been reviewed.'}</div>
                </div>`;
        }

        function getRecurrenceBadge(item) {
            const recurrence = normaliseRecurrence(item);
            return recurrence === 'none' ? '<span class="muted">One-off</span>' : `<span class="mini-chip">${escapeHTML(RECURRENCE_LABELS[recurrence])}</span>`;
        }

        
function applyActivityFilter(items, type) {
    let rows = [...items];
    if (activityFilter === 'needs-review') rows = rows.filter(item => !item.reviewed);
    else if (activityFilter === 'reviewed') rows = rows.filter(item => item.reviewed);
    else if (activityFilter === 'recurring') rows = rows.filter(item => normaliseRecurrence(item) !== 'none');
    else if (activityFilter === 'income') rows = type === 'wage' ? rows : [];
    else if (activityFilter === 'expenses') rows = type === 'expense' ? rows : [];
    const limit = activityLimit === 'all' ? Infinity : Number(activityLimit || 50);
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows.slice(0, limit);
}

function renderReviewQueue(budget) {
    const wrap = document.getElementById('reviewQueue');
    if (!wrap || !budget) return;
    const rows = [
        ...(budget.wages || []).map((item, index) => ({ type: 'wage', item, index, label: item.source || 'Income', amountClass: 'income' })),
        ...(budget.expenses || []).map((item, index) => ({ type: 'expense', item, index, label: `${item.category || 'Other'} • ${item.description || 'No description'}`, amountClass: 'expense' }))
    ].filter(row => !row.item.reviewed).sort((a, b) => b.item.date.localeCompare(a.item.date)).slice(0, 12);
    wrap.innerHTML = rows.length ? rows.map(row => `<div class="review-item">
        <div><strong>${escapeHTML(row.label)}</strong><span>${escapeHTML(row.item.date)} • ${row.type === 'wage' ? 'Money in' : 'Money out'}</span></div>
        <div class="review-actions"><span class="amount ${row.amountClass}">£${Number(row.item.amount || 0).toFixed(2)}</span><button class="secondary btn-sm" data-action="review-item" data-type="${row.type}" data-index="${row.index}">Review</button></div>
    </div>`).join('') : '<div class="empty-state small">Nothing needs review. Imported and edited transactions you have checked will appear as reviewed.</div>';
}

function renderTables(budget) {
    const fw = applyActivityFilter(filterAndSearch(budget.wages, ['date','source','amount','recurrence'], budget, false), 'wage');
    const fe = applyActivityFilter(filterAndSearch(budget.expenses, ['date','category','description','amount','recurrence'], budget, false), 'expense');
    const wtbody = document.querySelector('#wageTable tbody');
    wtbody.innerHTML = fw.length ? fw.map(w => {
        const idx = budget.wages.indexOf(w);
        return `<tr>
            <td data-label="Date"><span class="date-badge">${escapeHTML(w.date)}</span></td>
            <td data-label="Amount"><span class="amount income">£${Number(w.amount || 0).toFixed(2)}</span></td>
            <td data-label="Source">${escapeHTML(w.source || 'No source')}</td>
            <td data-label="Repeat">${getRecurrenceBadge(w)}</td>
            <td data-label="Review"><button class="btn-sm ${w.reviewed ? 'secondary reviewed-chip' : 'secondary needs-review-chip'}" data-action="${w.reviewed ? 'toggle-review' : 'review-item'}" data-type="wage" data-index="${idx}">${w.reviewed ? 'Reviewed' : 'Review'}</button></td>
            <td data-label="Action"><div class="install-actions"><button class="secondary btn-sm" data-action="edit-item" data-type="wage" data-index="${idx}">Edit</button><button class="secondary btn-sm" data-action="duplicate-item" data-type="wage" data-index="${idx}">Copy</button><button class="danger btn-sm" data-action="delete-item" data-type="wage" data-index="${idx}">Delete</button></div></td>
        </tr>`;
    }).join('') : '<tr class="empty-row"><td colspan="6"><div class="empty-state small">No income items match the current view/filter.</div></td></tr>';
    const etbody = document.querySelector('#expenseTable tbody');
    etbody.innerHTML = fe.length ? fe.map(e => {
        const idx = budget.expenses.indexOf(e);
        return `<tr>
            <td data-label="Date"><span class="date-badge">${escapeHTML(e.date)}</span></td>
            <td data-label="Amount"><span class="amount expense">£${Number(e.amount || 0).toFixed(2)}</span></td>
            <td data-label="Category">${escapeHTML(e.category || 'Other')}</td>
            <td data-label="Description">${escapeHTML(e.description || 'No description')}</td>
            <td data-label="Repeat">${getRecurrenceBadge(e)}</td>
            <td data-label="Review"><button class="btn-sm ${e.reviewed ? 'secondary reviewed-chip' : 'secondary needs-review-chip'}" data-action="${e.reviewed ? 'toggle-review' : 'review-item'}" data-type="expense" data-index="${idx}">${e.reviewed ? 'Reviewed' : 'Review'}</button></td>
            <td data-label="Action"><div class="install-actions"><button class="secondary btn-sm" data-action="edit-item" data-type="expense" data-index="${idx}">Edit</button><button class="secondary btn-sm" data-action="duplicate-item" data-type="expense" data-index="${idx}">Copy</button><button class="danger btn-sm" data-action="delete-item" data-type="expense" data-index="${idx}">Delete</button></div></td>
        </tr>`;
    }).join('') : '<tr class="empty-row"><td colspan="7"><div class="empty-state small">No expenses match the current view/filter.</div></td></tr>';
}

function handleTableAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const budget = getActiveBudget();
    if (!budget) return;
    const type = button.dataset.type;
    const index = Number(button.dataset.index);
    const list = type === 'wage' ? budget.wages : budget.expenses;
    if (!Array.isArray(list) || !Number.isInteger(index) || !list[index]) return;
    if (button.dataset.action === 'delete-item') {
        list.splice(index, 1);
    } else if (button.dataset.action === 'toggle-review') {
        list[index].reviewed = !list[index].reviewed;
    } else if (button.dataset.action === 'review-item') {
        openEditModal(type, index);
        document.getElementById('editReviewed').checked = true;
        return;
    } else if (button.dataset.action === 'edit-item') {
        openEditModal(type, index);
        return;
    } else if (button.dataset.action === 'duplicate-item') {
        const clone = cloneData(list[index]);
        clone.reviewed = false;
        list.splice(index + 1, 0, clone);
    } else {
        return;
    }
    saveAndEncrypt();
    renderAll();
}


        
// ---------- Charts ----------
function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function getChartColors() {
    return ['#38bdf8','#4ade80','#fb7185','#fbbf24','#a78bfa','#22d3ee','#fb923c','#c084fc','#34d399','#818cf8','#e879f9','#94a3b8'];
}

function prepareCanvas(canvas) {
    if (!canvas) return null;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(280, Math.floor(rect.width || canvas.clientWidth || 320));
    const height = Math.max(220, Math.floor(rect.height || canvas.clientHeight || 260));
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    return { ctx, width, height };
}

function drawEmptyChart(canvas, message) {
    const setup = prepareCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;
    ctx.fillStyle = cssVar('--text-secondary') || '#94a3b8';
    ctx.textAlign = 'center';
    ctx.fillText(message, width / 2, height / 2);
}

function formatMoneyCompact(value) {
    return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
        notation: 'compact',
        maximumFractionDigits: 1
    }).format(value || 0);
}

function niceMax(values) {
    const max = Math.max(0, ...values.map(v => Number(v || 0)));
    if (!max) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(max));
    return Math.ceil((max / magnitude) * 1.15) * magnitude;
}

function drawLegend(ctx, items, width, startY) {
    let x = 16;
    let y = startY;
    items.forEach(item => {
        const text = item.label;
        const textWidth = ctx.measureText(text).width;
        if (x + textWidth + 34 > width - 16) {
            x = 16;
            y += 18;
        }
        ctx.fillStyle = item.color;
        ctx.fillRect(x, y - 5, 12, 12);
        ctx.fillStyle = cssVar('--text-secondary') || '#94a3b8';
        ctx.textAlign = 'left';
        ctx.fillText(text, x + 18, y + 1);
        x += textWidth + 34;
    });
    return y + 16;
}

function drawDonutChart(canvas, labels, values, centerLabel) {
    const total = values.reduce((sum, value) => sum + Number(value || 0), 0);
    if (!total) return drawEmptyChart(canvas, 'No data in this view yet.');
    const setup = prepareCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;
    const colors = getChartColors();
    const legendY = drawLegend(ctx, labels.map((label, idx) => ({ label, color: colors[idx % colors.length] })), width, 16);
    const cx = width / 2;
    const cy = Math.max(legendY + 70, height / 2 + 14);
    const radius = Math.min(width, height - legendY - 12) / 3.1;
    const inner = radius * 0.58;
    let angle = -Math.PI / 2;
    values.forEach((value, idx) => {
        const slice = (Number(value || 0) / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, angle, angle + slice);
        ctx.closePath();
        ctx.fillStyle = colors[idx % colors.length];
        ctx.fill();
        angle += slice;
    });
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'center';
    ctx.fillStyle = cssVar('--text-secondary') || '#94a3b8';
    ctx.fillText(centerLabel, cx, cy - 10);
    ctx.fillStyle = cssVar('--text') || '#f8fafc';
    ctx.font = '600 16px Inter, system-ui, sans-serif';
    ctx.fillText(formatMoneyCompact(total), cx, cy + 14);
    ctx.font = '12px Inter, system-ui, sans-serif';
}

function drawGroupedHorizontalBars(canvas, labels, spent, limits) {
    const rows = labels.length;
    if (!rows) return drawEmptyChart(canvas, 'No category data yet.');
    const setup = prepareCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;
    const legendBottom = drawLegend(ctx, [{ label: 'Spent', color: '#fb7185' }, { label: 'Limit', color: '#38bdf8' }], width, 16);
    const left = 104;
    const right = 18;
    const top = legendBottom + 10;
    const bottom = 22;
    const chartWidth = width - left - right;
    const maxValue = niceMax([...spent, ...limits]);
    const rowHeight = Math.max(28, (height - top - bottom) / rows);
    labels.forEach((label, idx) => {
        const y = top + idx * rowHeight + rowHeight / 2;
        ctx.fillStyle = cssVar('--text-secondary') || '#94a3b8';
        ctx.textAlign = 'left';
        const safeLabel = label.length > 16 ? `${label.slice(0, 14)}…` : label;
        ctx.fillText(safeLabel, 16, y - 7);
        ctx.fillStyle = cssVar('--border') || 'rgba(148,163,184,0.18)';
        ctx.fillRect(left, y - 9, chartWidth, 8);
        ctx.fillStyle = 'rgba(56,189,248,0.42)';
        ctx.fillRect(left, y - 9, Math.max(2, chartWidth * (Number(limits[idx] || 0) / maxValue)), 8);
        ctx.fillStyle = 'rgba(251,113,133,0.7)';
        ctx.fillRect(left, y + 3, Math.max(2, chartWidth * (Number(spent[idx] || 0) / maxValue)), 8);
        ctx.fillStyle = cssVar('--text-secondary') || '#94a3b8';
        ctx.textAlign = 'right';
        ctx.fillText(formatMoneyCompact(Math.max(spent[idx] || 0, limits[idx] || 0)), width - 10, y - 1);
    });
}

function drawComboChart(canvas, incomeLabel, spendingLabel, lineLabel, labels, income, spending, net) {
    if (!labels.length) return drawEmptyChart(canvas, 'No data to chart yet.');
    const setup = prepareCanvas(canvas);
    if (!setup) return;
    const { ctx, width, height } = setup;
    const top = drawLegend(ctx, [{ label: incomeLabel, color: '#4ade80' }, { label: spendingLabel, color: '#fb7185' }, { label: lineLabel, color: '#38bdf8' }], width, 16) + 8;
    const left = 42;
    const right = 14;
    const bottom = 28;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const maxValue = niceMax([...income, ...spending, ...net.map(v => Math.max(0, v))]);
    const gridColor = cssVar('--border') || 'rgba(148,163,184,0.18)';
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = cssVar('--text-secondary') || '#94a3b8';
    ctx.textAlign = 'right';
    [0, 0.5, 1].forEach(step => {
        const y = top + chartHeight - chartHeight * step;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(width - right, y);
        ctx.stroke();
        ctx.fillText(formatMoneyCompact(maxValue * step), left - 6, y);
    });
    const groupWidth = chartWidth / labels.length;
    const barWidth = Math.min(18, groupWidth * 0.22);
    labels.forEach((label, idx) => {
        const xBase = left + groupWidth * idx + groupWidth / 2;
        const incomeHeight = chartHeight * ((income[idx] || 0) / maxValue);
        const spendHeight = chartHeight * ((spending[idx] || 0) / maxValue);
        ctx.fillStyle = 'rgba(74,222,128,0.68)';
        ctx.fillRect(xBase - barWidth - 3, top + chartHeight - incomeHeight, barWidth, incomeHeight);
        ctx.fillStyle = 'rgba(251,113,133,0.68)';
        ctx.fillRect(xBase + 3, top + chartHeight - spendHeight, barWidth, spendHeight);
        ctx.fillStyle = cssVar('--text-secondary') || '#94a3b8';
        ctx.textAlign = 'center';
        const shortLabel = label.length > 10 ? `${label.slice(0, 9)}…` : label;
        ctx.fillText(shortLabel, xBase, height - 10);
    });
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    net.forEach((value, idx) => {
        const x = left + groupWidth * idx + groupWidth / 2;
        const y = top + chartHeight - chartHeight * ((Math.max(0, value || 0)) / maxValue);
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    net.forEach((value, idx) => {
        const x = left + groupWidth * idx + groupWidth / 2;
        const y = top + chartHeight - chartHeight * ((Math.max(0, value || 0)) / maxValue);
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
    });
}

function updateCharts(budget) {
    updateExpenseChart(budget);
    updateBalanceChart(budget);
    updateCashflowChart(budget);
    updateCategoryBudgetChart(budget);
}

function updateExpenseChart(budget) {
    const { expenses } = getCycleItems(budget);
    const cats = {};
    getSpendingExpenses(expenses).forEach(e => {
        const c = e.category || 'Other';
        cats[c] = (cats[c] || 0) + Number(e.amount || 0);
    });
    const rows = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 6);
    drawDonutChart(document.getElementById('expenseChart'), rows.map(([label]) => label), rows.map(([, value]) => value), 'Spending');
}

function updateCategoryBudgetChart(budget) {
    const { expenses } = getCycleItems(budget);
    const rows = getCategoryLimitHealth(budget, expenses)
        .filter(row => row.limit > 0 || row.spent > 0)
        .sort((a, b) => Math.max(b.spent, b.limit) - Math.max(a.spent, a.limit))
        .slice(0, 6);
    drawGroupedHorizontalBars(
        document.getElementById('categoryBudgetChart'),
        rows.map(r => r.category),
        rows.map(r => r.spent),
        rows.map(r => r.limit)
    );
}

function updateBalanceChart(budget) {
    const { wages, expenses } = getCycleItems(budget);
    const income = wages.reduce((s,w)=>s+Number(w.amount||0),0);
    const spending = getSpendingExpenses(expenses).reduce((s,e)=>s+Number(e.amount||0),0);
    const saved = getSavingsContributions(expenses);
    drawDonutChart(document.getElementById('balanceChart'), ['Income', 'Spending', 'Saved'], [income, spending, saved], 'Current view');
}

function getRecentPeriods(budget, count = 6) {
    const current = getCurrentPeriod(budget);
    const periods = [current];
    while (periods.length < count) {
        const nextEnd = periods[0].start;
        periods.unshift({ type: current.type, start: subtractPeriod(nextEnd, current.type), end: nextEnd });
    }
    return periods;
}

function sumInPeriod(items, period) {
    return items.filter(i => itemInRange(i, period)).reduce((s, item) => s + Number(item.amount || 0), 0);
}

function updateCashflowChart(budget) {
    const periods = getRecentPeriods(budget, 6);
    const labels = periods.map(formatPeriodLabel);
    const income = periods.map(p => sumInPeriod(budget.wages, p));
    const spending = periods.map(p => sumInPeriod(budget.expenses, p));
    const net = income.map((value, idx) => value - spending[idx]);
    drawComboChart(document.getElementById('cashflowChart'), 'Income', 'Spending', 'Net', labels, income, spending, net);
}

        // ---------- Yearly Report ----------
        
function renderYearlyReport() {
    const budget = getActiveBudget();
    if (!budget) return;
    const year = parseInt(document.getElementById('yearSelect').value);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const incomeByMonth = Array(12).fill(0), expByMonth = Array(12).fill(0), savingsByMonth = Array(12).fill(0);
    budget.wages.forEach(w => {
        const [y,m] = w.date.split('-');
        if (parseInt(y) === year) incomeByMonth[parseInt(m)-1] += Number(w.amount || 0);
    });
    budget.expenses.forEach(e => {
        const [y,m] = e.date.split('-');
        if (parseInt(y) === year) expByMonth[parseInt(m)-1] += Number(e.amount || 0);
    });
    for (let i = 0; i < 12; i++) savingsByMonth[i] = incomeByMonth[i] - expByMonth[i];
    const totalIncome = incomeByMonth.reduce((a,b)=>a+b,0);
    const totalExp = expByMonth.reduce((a,b)=>a+b,0);
    const totalNet = totalIncome - totalExp;
    document.getElementById('yearlySummary').innerHTML = `
        <div class="card"><div class="label">Income</div><div class="value" style="color:var(--green)">£${totalIncome.toFixed(2)}</div></div>
        <div class="card"><div class="label">Expenses</div><div class="value" style="color:var(--red)">£${totalExp.toFixed(2)}</div></div>
        <div class="card"><div class="label">Net / Saved</div><div class="value">£${totalNet.toFixed(2)}</div></div>`;
    drawComboChart(document.getElementById('yearlyChart'), 'Income', 'Expenses', 'Net / Saved', months, incomeByMonth, expByMonth, savingsByMonth);
}

        document.getElementById('yearlyReportBtn').addEventListener('click', () => {
            const reportDiv = document.getElementById('yearlyReport');
            reportDiv.classList.toggle('hidden');
            if (!reportDiv.classList.contains('hidden')) {
                const yearSelect = document.getElementById('yearSelect');
                const currentYear = new Date().getFullYear();
                yearSelect.innerHTML = '';
                for (let y = currentYear; y >= currentYear-5; y--) {
                    const opt = document.createElement('option');
                    opt.value = y;
                    opt.textContent = y;
                    yearSelect.appendChild(opt);
                }
                yearSelect.value = currentYear;
                renderYearlyReport();
            }
        });
        document.getElementById('yearSelect').addEventListener('change', renderYearlyReport);
        document.getElementById('closeYearlyBtn').addEventListener('click', () => {
            document.getElementById('yearlyReport').classList.add('hidden');
        });

        // ---------- Search, sort, month filter ----------
        document.getElementById('searchBox').addEventListener('input', e => { searchTerm = e.target.value; renderAll(); });
        document.getElementById('viewRangeSelect')?.addEventListener('change', e => { viewRangeMode = e.target.value; localStorage.setItem('viewRangeMode', viewRangeMode); currentFilterMonth = null; const fm = document.getElementById('filterMonth'); if (fm) fm.value=''; renderAll(); });
        document.getElementById('applyFilter').addEventListener('click', () => { currentFilterMonth = document.getElementById('filterMonth').value; renderAll(); });
        document.getElementById('resetFilter').addEventListener('click', () => { currentFilterMonth = null; document.getElementById('filterMonth').value=''; renderAll(); });
        document.getElementById('activityFilterSelect')?.addEventListener('change', e => { activityFilter = e.target.value; localStorage.setItem('activityFilter', activityFilter); renderAll(); });
        document.getElementById('activityLimitSelect')?.addEventListener('change', e => { activityLimit = e.target.value; localStorage.setItem('activityLimit', activityLimit); renderAll(); });
        document.getElementById('reviewQueue')?.addEventListener('click', handleTableAction);
        document.getElementById('reminderList')?.addEventListener('click', handleRecurringAction);
        document.getElementById('applySuggestedCapBtn')?.addEventListener('click', () => { const budget = getActiveBudget(); if (!budget) return; const { wages } = getCycleItems(budget); const income = wages.reduce((s,w)=>s+Number(w.amount||0),0) || Number(budget.plannedIncome || 0); const leftover = Number(document.getElementById('savingsGoalInput')?.value || budget.savingsGoal || 0); const cap = Math.max(0, income - leftover); document.getElementById('budgetGoalInput').value = cap ? cap.toFixed(2) : ''; });
        document.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (sortState.field === field) sortState.order = sortState.order==='asc'?'desc':'asc';
                else { sortState.field = field; sortState.order = 'asc'; }
                renderAll();
            });
        });

        // ---------- Forms ----------
        document.getElementById('wageForm').addEventListener('submit', function(e) {
            e.preventDefault();
            const budget = getActiveBudget();
            if (!budget) return;
            const recurrence = document.getElementById('wageRecurrence').value;
            budget.wages.push({
                date: document.getElementById('wageDate').value,
                amount: parseFloat(document.getElementById('wageAmount').value),
                source: document.getElementById('wageSource').value.trim(),
                recurrence,
                recurring: recurrence !== 'none',
                reviewed: false
            });
            saveAndEncrypt();
            this.reset();
            applyMetaToUI(DEFAULT_APP_META);
            document.getElementById('wageDate').valueAsDate = new Date();
            document.getElementById('wageRecurrence').value = 'none';
            renderAll();
        });

        document.getElementById('expenseForm').addEventListener('submit', function(e) {
            e.preventDefault();
            const budget = getActiveBudget();
            if (!budget) return;
            const recurrence = document.getElementById('expenseRecurrence').value;
            const category = document.getElementById('expenseCategory').value || 'Other';
            budget.categories = uniqueClean([...(budget.categories || []), category]);
            budget.expenses.push({
                date: document.getElementById('expenseDate').value,
                amount: parseFloat(document.getElementById('expenseAmount').value),
                category,
                description: document.getElementById('expenseDesc').value.trim(),
                recurrence,
                recurring: recurrence !== 'none',
                reviewed: false
            });
            saveAndEncrypt();
            this.reset();
            document.getElementById('expenseDate').valueAsDate = new Date();
            document.getElementById('expenseRecurrence').value = 'none';
            renderAll();
        });

        function csvCell(value) {
            let text = String(value ?? '');
            // Neutralise spreadsheet formula injection: catch formula triggers even when
            // preceded by whitespace or a leading tab/carriage-return (all are stripped by
            // spreadsheet apps before evaluating the cell).
            if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
            return `"${text.replace(/"/g, '""')}"`;
        }

        
// ---------- Export / Import / Clear ----------
function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

document.getElementById('exportEncryptedBackup').addEventListener('click', async () => {
    if (!currentPassword) {
        alert('Unlock the app before exporting a backup.');
        return;
    }
    const encrypted = localStorage.getItem('budgetAppEncrypted');
    if (!encrypted) {
        alert('No encrypted data was found to export.');
        return;
    }
    const payload = {
        format: 'budget-tracker-pro-encrypted-v1',
        exportedAt: new Date().toISOString(),
        encrypted: JSON.parse(encrypted)
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'budget_backup_encrypted.json');
});

document.getElementById('exportJSON').addEventListener('click', () => {
    const ok = confirm('Plain JSON is readable by other apps and cloud sync tools. Export it only when you truly need an unencrypted backup. Continue?');
    if (!ok) return;
    const blob = new Blob([JSON.stringify(normaliseData(appData), null, 2)], {type:'application/json'});
    downloadBlob(blob, 'budget_backup_plain.json');
});
document.getElementById('importJSON').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
        try {
            const parsed = JSON.parse(ev.target.result);
            if (parsed?.format === 'budget-tracker-pro-encrypted-v1' && parsed.encrypted) {
                const dec = (await decryptEnvelope(parsed.encrypted, currentPassword)).data;
                const normalised = normaliseData(dec);
                if (!isValidData(normalised)) throw new Error('Invalid encrypted backup.');
                appData = normalised;
                await storeEncrypted(appData);
                renderAll();
                alert('Encrypted backup imported.');
            } else {
                const data = normaliseData(parsed);
                if (isValidData(data)) {
                    appData = data;
                    saveAndEncrypt();
                    renderAll();
                    alert('Backup imported.');
                } else {
                    alert('Invalid or unsafe backup format.');
                }
            }
        } catch {
            alert('Backup import failed. If this is an encrypted backup, unlock the app with the same password that was used when the backup was created.');
        }
    };
    reader.readAsText(file);
    this.value = '';
});
document.getElementById('exportCSV').addEventListener('click', () => {
    const ok = confirm('CSV exports are plain text. Anyone who opens the file can read your transactions. Continue?');
    if (!ok) return;
    const budget = getActiveBudget();
    const rows = [['Type','Date','Amount','Category/Source','Description','Repeat','Reviewed']];
    budget.wages.forEach(w => rows.push(['Income', w.date, w.amount, w.source || '', '', RECURRENCE_LABELS[normaliseRecurrence(w)], w.reviewed ? 'Yes' : 'No']));
    budget.expenses.forEach(e => rows.push(['Expense', e.date, e.amount, e.category || '', e.description || '', RECURRENCE_LABELS[normaliseRecurrence(e)], e.reviewed ? 'Yes' : 'No']));
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n';
    downloadBlob(new Blob([csv], {type:'text/csv'}), 'transactions.csv');
});
document.getElementById('clearDataBtn').addEventListener('click', () => {
    if (confirm('Delete ALL budgets and replace them with a fresh empty one? This cannot be undone.')) {
        appData = { budgets: [createDefaultBudget()], activeBudgetId:'1' };
        saveAndEncrypt();
        renderAll();
    }
});

// ---------- Full app reset (Settings -> Danger zone) ----------
(function setupAppReset() {
    const check = document.getElementById('resetAppConfirmCheck');
    const text = document.getElementById('resetAppConfirmText');
    const btn = document.getElementById('resetAppBtn');
    if (!check || !text || !btn) return;

    // Every key this app writes on its origin. localStorage.clear() is the real
    // wipe; the explicit list documents intent and covers any edge host.
    const RESET_KEYS = [
        'activeAppTab', 'activityFilter', 'activityLimit', 'aiImportEnabled',
        'aiImportEndpoint', 'aiImportSecret', 'budgetAppEncrypted', 'encryptionMode',
        'hideNotificationAmounts', 'installBannerDismissed', 'lockOnBackground',
        'lockTimeoutMinutes', 'notificationsEnabled', 'onboardingCompleted',
        'pepperEndpoint', 'seenAppVersion', 'theme', 'viewRangeMode'
    ];

    function refreshGate() {
        btn.disabled = !(check.checked && text.value.trim().toUpperCase() === 'RESET');
    }
    check.addEventListener('change', refreshGate);
    text.addEventListener('input', refreshGate);

    btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        if (!confirm('Final check: erase ALL BudgetVault data on this device and return to setup? This cannot be undone.')) return;
        btn.disabled = true;
        btn.textContent = 'Resetting…';
        try {
            RESET_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
            try { localStorage.clear(); } catch (e) {}
            try { sessionStorage.clear(); } catch (e) {}
            if (window.caches && caches.keys) {
                try { const names = await caches.keys(); await Promise.all(names.map(n => caches.delete(n))); } catch (e) {}
            }
            if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
                try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); } catch (e) {}
            }
        } finally {
            location.reload();
        }
    });

    refreshGate();
})();

// ---------- Encryption prompt flow ----------

        function resetEncryptionButton(handler, label) {
            const btn = document.getElementById('encryptSubmit');
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.textContent = label;
            newBtn.addEventListener('click', handler);
            return newBtn;
        }

        function showEncryptionPrompt() {
            if (localStorage.getItem('budgetAppEncrypted')) showUnlockPrompt();
            else showSetupPrompt();
        }

        
function showUnlockPrompt() {
    const overlay = document.getElementById('encryptOverlay');
    document.getElementById('appContent').classList.add('hidden');
    overlay.classList.remove('hidden');
    document.getElementById('encryptTitle').textContent = '🔐 Unlock Your Budget';
    document.getElementById('encryptMsg').textContent = 'Enter your password. The app asks again when reopened; set a session PIN inside the app for idle screen locking.';
    document.getElementById('encryptPasswordConfirm').classList.add('hidden');
    document.getElementById('passwordStrengthWrap').classList.add('hidden');
    clearSensitiveFields('encryptPassword', 'encryptPasswordConfirm');
    resetEncryptionButton(async () => {
        const pw = document.getElementById('encryptPassword').value;
        let dec;
        try {
            dec = await unlockWithPassword(pw);
        } catch (err) {
            if (err && err.code === 'SERVER') { alert(err.message); return; }
            alert('Wrong password or corrupted data.');
            return;
        }
        if (dec) {
            const normalised = normaliseData(dec);
            if (isValidData(normalised)) {
                appData = normalised;
                overlay.classList.add('hidden');
                document.getElementById('appContent').classList.remove('hidden');
                renderAll();
                saveAndEncrypt();
                setTimeout(() => maybeShowOnboarding(false), 150);
                clearSensitiveFields('encryptPassword', 'encryptPasswordConfirm');
                return;
            }
        }
        alert('Wrong password or corrupted data.');
    }, 'Decrypt');
}

function showSetupPrompt() {
    const overlay = document.getElementById('encryptOverlay');
    document.getElementById('appContent').classList.add('hidden');
    overlay.classList.remove('hidden');
    document.getElementById('encryptTitle').textContent = '🔐 Set Up Encryption';
    document.getElementById('encryptMsg').textContent = 'Create a strong password. Use 4 random words or 16+ mixed characters. You can add a temporary session PIN after unlocking.';
    document.getElementById('encryptPasswordConfirm').classList.remove('hidden');
    document.getElementById('passwordStrengthWrap').classList.remove('hidden');
    clearSensitiveFields('encryptPassword', 'encryptPasswordConfirm');
    updateStrengthMeter('encryptPassword', 'passwordStrengthFill', 'passwordStrengthText', 'passwordStrengthWrap');
    resetEncryptionButton(async () => {
        const pw = document.getElementById('encryptPassword').value;
        const confirm = document.getElementById('encryptPasswordConfirm').value;
        const strength = evaluatePasswordStrength(pw);
        if (!pw || pw !== confirm) { alert('Passwords do not match.'); return; }
        if (!strength.valid) { alert(`That password is too easy to crack offline (estimated strength ${strength.bits} bits; at least 70 is required).\n\nThe safest choice is 4 random, unrelated words, e.g. "otter lantern copper meadow". Avoid a word plus a year or "!".`); return; }
        appData = { budgets: [createDefaultBudget()], activeBudgetId:'1' };
        try {
            await establishSessionKey(pw);
            await storeEncrypted(appData);
        } catch (err) {
            appData = { budgets: [], activeBudgetId: null };
            alert(err && err.code === 'SERVER' ? err.message : `Could not set up encryption. ${err.message || ''}`);
            return;
        }
        overlay.classList.add('hidden');
        document.getElementById('appContent').classList.remove('hidden');
        renderAll();
        clearSensitiveFields('encryptPassword', 'encryptPasswordConfirm');
        setTimeout(() => maybeShowOnboarding(false), 150);
    }, 'Encrypt & Start');
}

async function changePassword() {
    const old = document.getElementById('changePasswordCurrent').value;
    const newPw = document.getElementById('changePasswordNew').value;
    const confirm = document.getElementById('changePasswordConfirm').value;
    if (old !== currentPassword) { alert('Current password is wrong.'); return; }
    if (!newPw || newPw !== confirm) { alert('New password entries do not match.'); return; }
    const strength = evaluatePasswordStrength(newPw);
    if (!strength.valid) { alert(`That password is too easy to crack offline (estimated strength ${strength.bits} bits; at least 70 is required). A long passphrase of 4 random words is safest.`); return; }
    try {
        await establishSessionKey(newPw);
        await storeEncrypted(normaliseData(appData));
    } catch (err) {
        alert(err && err.code === 'SERVER' ? err.message : `Could not change password. ${err.message || ''}`);
        return;
    }
    clearSensitiveFields('changePasswordCurrent', 'changePasswordNew', 'changePasswordConfirm');
    updateStrengthMeter('changePasswordNew', 'changePasswordStrengthFill', 'changePasswordStrengthText', 'changePasswordStrengthWrap');
    setSaveStatus('Password changed and data re-encrypted.');
    alert('Password changed. Save a new encrypted backup soon.');
}



        function getStarterCategories(style) {
            const packs = {
                balanced: DEFAULT_CATEGORIES,
                family: ['Housing','Utilities','Groceries','Transport','Kids','School','Healthcare','Subscriptions','Insurance','Pets','Savings','Other'],
                essentials: ['Housing','Utilities','Groceries','Transport','Debt','Healthcare','Savings','Insurance','Other'],
                flexible: ['Bills','Food','Travel','Fun','Shopping','Savings','Subscriptions','Other']
            };
            return uniqueClean(packs[style] || DEFAULT_CATEGORIES);
        }

        function renderReportsLab(budget) {
            renderCycleCompare(budget);
            const startInput = document.getElementById('reportStartDate');
            const endInput = document.getElementById('reportEndDate');
            if (startInput && endInput && !startInput.value) {
                const range = getActiveViewRange(budget);
                startInput.value = formatDateLocal(range.start);
                endInput.value = formatDateLocal(addDays(range.end, -1));
            }
            runCustomReport(false);
        }

        function renderCycleCompare(budget) {
            const current = getActiveViewRange(budget);
            const spanDays = Math.max(1, daysBetween(current.start, current.end));
            const previous = { type: current.type || 'range', start: addDays(current.start, -spanDays), end: current.start };
            const currentIncome = sumInPeriod(budget.wages, current);
            const currentSpend = sumInPeriod(budget.expenses, current);
            const prevIncome = sumInPeriod(budget.wages, previous);
            const prevSpend = sumInPeriod(budget.expenses, previous);
            const avgSpend = currentSpend / spanDays;
            const container = document.getElementById('cycleCompareCards');
            if (!container) return;
            container.innerHTML = `
                <div class="mini-stat"><span class="muted">Current view net</span><strong>£${(currentIncome - currentSpend).toFixed(2)}</strong><span>${escapeHTML(current.label)}</span></div>
                <div class="mini-stat"><span class="muted">Previous matching range</span><strong>£${(prevIncome - prevSpend).toFixed(2)}</strong><span>${formatShortDate(previous.start)}–${formatShortDate(addDays(previous.end, -1))}</span></div>
                <div class="mini-stat"><span class="muted">Daily spend pace</span><strong>£${avgSpend.toFixed(2)}</strong><span>${prevSpend ? `${(((currentSpend - prevSpend) / prevSpend) * 100).toFixed(0)}% vs previous range` : 'No previous spend to compare'}</span></div>`;
        }

        function runCustomReport() {
            const budget = getActiveBudget();
            if (!budget) return;
            const start = parseLocalDate(document.getElementById('reportStartDate')?.value);
            const endInclusive = parseLocalDate(document.getElementById('reportEndDate')?.value);
            const summary = document.getElementById('customReportSummary');
            if (!start || !endInclusive || start > endInclusive) {
                if (summary) summary.innerHTML = '<div class="empty-state small">Choose a valid start and end date.</div>';
                drawEmptyChart(document.getElementById('customReportChart'), 'Choose a valid date range.');
                return;
            }
            const end = addDays(endInclusive, 1);
            const range = { start, end };
            const wages = budget.wages.filter(item => itemInRange(item, range));
            const expenses = budget.expenses.filter(item => itemInRange(item, range));
            const income = wages.reduce((sum, item) => sum + Number(item.amount || 0), 0);
            const spending = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
            const byCategory = Object.entries(getCategoryTotals(expenses)).sort((a,b) => b[1]-a[1]).slice(0,5);
            if (summary) summary.innerHTML = `
                <div class="mini-stat"><span class="muted">Income</span><strong>£${income.toFixed(2)}</strong><span>${wages.length} item${wages.length===1?'':'s'}</span></div>
                <div class="mini-stat"><span class="muted">Spending</span><strong>£${spending.toFixed(2)}</strong><span>${expenses.length} item${expenses.length===1?'':'s'}</span></div>
                <div class="mini-stat"><span class="muted">Net</span><strong>£${(income-spending).toFixed(2)}</strong><span>${byCategory[0] ? `${escapeHTML(byCategory[0][0])} is top spend` : 'No expenses in this range'}</span></div>`;
            drawDonutChart(document.getElementById('customReportChart'), byCategory.map(([label]) => label), byCategory.map(([,value]) => value), 'Custom range');
        }

        function fillCategorySelect(select, categories, selected='') {
            if (!select) return;
            select.innerHTML = '';
            categories.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                select.appendChild(opt);
            });
            if (selected && categories.includes(selected)) select.value = selected;
        }

        function openEditModal(type, index) {
            const budget = getActiveBudget();
            if (!budget) return;
            const item = (type === 'wage' ? budget.wages : budget.expenses)[index];
            if (!item) return;
            document.getElementById('editType').value = type;
            document.getElementById('editIndex').value = String(index);
            document.getElementById('editDate').value = item.date;
            document.getElementById('editAmount').value = String(item.amount || '');
            document.getElementById('editRecurrence').value = normaliseRecurrence(item);
            document.getElementById('editReviewed').checked = Boolean(item.reviewed);
            document.getElementById('editModalTitle').textContent = type === 'wage' ? 'Edit income' : 'Edit expense';
            document.getElementById('editSourceWrap').classList.toggle('hidden', type !== 'wage');
            document.getElementById('editCategoryWrap').classList.toggle('hidden', type !== 'expense');
            document.getElementById('editDescriptionWrap').classList.toggle('hidden', type !== 'expense');
            document.getElementById('splitExpenseBtn').classList.toggle('hidden', type !== 'expense');
            document.getElementById('editSource').value = item.source || '';
            fillCategorySelect(document.getElementById('editCategory'), budget.categories || DEFAULT_CATEGORIES, item.category || 'Other');
            document.getElementById('editDescription').value = item.description || '';
            document.getElementById('editModal').classList.remove('hidden');
        }

        function closeEditModal() { document.getElementById('editModal')?.classList.add('hidden'); }
        function closeSplitModal() { document.getElementById('splitModal')?.classList.add('hidden'); }

        function openSplitModal() {
            const budget = getActiveBudget();
            const type = document.getElementById('editType')?.value;
            if (!budget || type !== 'expense') return;
            const idx = Number(document.getElementById('editIndex')?.value);
            const expense = budget.expenses[idx];
            if (!expense) return;
            const half = Number((Number(expense.amount || 0) / 2).toFixed(2));
            fillCategorySelect(document.getElementById('splitCategoryOne'), budget.categories || DEFAULT_CATEGORIES, expense.category || 'Other');
            fillCategorySelect(document.getElementById('splitCategoryTwo'), budget.categories || DEFAULT_CATEGORIES, expense.category || 'Other');
            document.getElementById('splitAmountOne').value = String(half);
            document.getElementById('splitAmountTwo').value = String(Number((Number(expense.amount || 0) - half).toFixed(2)));
            document.getElementById('splitDescOne').value = expense.description || '';
            document.getElementById('splitDescTwo').value = expense.description || '';
            document.getElementById('splitModal').classList.remove('hidden');
        }

        function maybeShowOnboarding(force = false) {
            if (!force && onboardingCompleted) return;
            const budget = getActiveBudget();
            if (!budget) return;
            document.getElementById('onboardingBudgetName').value = budget.name || 'Main';
            document.getElementById('onboardingCycle').value = budget.periodType || 'monthly';
            document.getElementById('onboardingLimit').value = budget.budgetGoal ? String(budget.budgetGoal) : '';
            document.getElementById('onboardingSavings').value = budget.savingsGoal ? String(budget.savingsGoal) : '';
            const onboardingSavingsBalance = document.getElementById('onboardingSavingsBalance'); if (onboardingSavingsBalance) onboardingSavingsBalance.value = budget.savingsBalance ? String(budget.savingsBalance) : '';
            document.getElementById('onboardingRollover').checked = Boolean(budget.rolloverEnabled);
            document.getElementById('onboardingModal')?.classList.remove('hidden');
        }

        function closeOnboarding() {
            document.getElementById('onboardingModal')?.classList.add('hidden');
            onboardingCompleted = true;
            localStorage.setItem('onboardingCompleted', '1');
        }


        // ---------- PWA ----------
        function initPWA() {
            if ('serviceWorker' in navigator) {
                window.addEventListener('load', async () => {
                    try {
                        const reg = await navigator.serviceWorker.register('./sw.js');
                        swRegistrationRef = reg;
                        const updateBanner = document.getElementById('updateBanner');
                        const showUpdate = () => { if (updateBanner) updateBanner.classList.remove('hidden'); };
                        if (reg.waiting) { swWaitingRef = reg.waiting; showUpdate(); }
                        reg.addEventListener('updatefound', () => {
                            const worker = reg.installing;
                            if (!worker) return;
                            worker.addEventListener('statechange', () => {
                                if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                                    swWaitingRef = reg.waiting || worker;
                                    showUpdate();
                                    setSaveStatus('A new version is ready.');
                                }
                            });
                        });
                        navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
                    } catch (err) {
                        console.warn('Service worker registration failed:', err);
                    }
                });
            }

            const installBanner = document.getElementById('installBanner');
            const installBtn = document.getElementById('installAppBtn');
            const dismissBtn = document.getElementById('dismissInstallBtn');
            const installHelp = document.getElementById('installHelp');
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
            const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
            const dismissed = localStorage.getItem('installBannerDismissed') === '1';

            function showInstallBanner() {
                if (!installBanner || isStandalone || dismissed) return;
                installBanner.classList.remove('hidden');
            }

            if (isIOS) {
                installBtn.textContent = 'How to install';
                installHelp.textContent = 'On iPhone/iPad: open in Safari, tap Share, then Add to Home Screen.';
                showInstallBanner();
            }

            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                deferredInstallPrompt = e;
                showInstallBanner();
            });

            installBtn?.addEventListener('click', async () => {
                if (deferredInstallPrompt) {
                    deferredInstallPrompt.prompt();
                    await deferredInstallPrompt.userChoice;
                    deferredInstallPrompt = null;
                    installBanner.classList.add('hidden');
                } else if (isIOS) {
                    alert('Install on iPhone/iPad: tap Safari Share, then Add to Home Screen.');
                }
            });

            dismissBtn?.addEventListener('click', () => {
                localStorage.setItem('installBannerDismissed', '1');
                installBanner.classList.add('hidden');
            });
            document.getElementById('applyUpdateBtn')?.addEventListener('click', () => {
                if (swWaitingRef) {
                    swWaitingRef.postMessage({ type: 'SKIP_WAITING' });
                } else {
                    window.location.reload();
                }
            });
            document.getElementById('dismissUpdateBtn')?.addEventListener('click', () => document.getElementById('updateBanner')?.classList.add('hidden'));

            async function checkPublishedUpdate() { await fetchPublishedMeta(); }

            function updateOnlineState() {
                document.body.classList.toggle('offline', !navigator.onLine);
                if (navigator.onLine) checkPublishedUpdate();
            }
            window.addEventListener('online', updateOnlineState);
            window.addEventListener('offline', updateOnlineState);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && navigator.onLine) checkPublishedUpdate();
            });
            setInterval(() => { if (navigator.onLine) checkPublishedUpdate(); }, 15 * 60 * 1000);
            document.getElementById('checkUpdatesNowBtn')?.addEventListener('click', checkPublishedUpdate);
            updateOnlineState();
            checkPublishedUpdate();
        }

        async function initApp() {
            applyTheme();
            if (!window.crypto?.subtle) {
                alert('Encryption is not available in this browser/context. Use HTTPS, localhost, Safari, Chrome, Edge, or another modern browser.');
                return;
            }
            document.getElementById('changePasswordBtn').addEventListener('click', changePassword);
            document.getElementById('securityJumpBtn')?.addEventListener('click', () => activateTab('security', { scroll: true, anchorId: 'security' }));
            document.getElementById('savePrivacySettings')?.addEventListener('click', async () => {
                notificationsEnabled = Boolean(document.getElementById('enableNotificationsCheckbox')?.checked);
                hideNotificationAmounts = Boolean(document.getElementById('hideNotificationAmountsCheckbox')?.checked);
                localStorage.setItem('notificationsEnabled', notificationsEnabled ? '1' : '0');
                localStorage.setItem('hideNotificationAmounts', hideNotificationAmounts ? '1' : '0');
                const granted = await requestNotificationPermission();
                if (notificationsEnabled && !granted) {
                    alert('Notifications are blocked in this browser. You can still view reminders inside the app.');
                } else {
                    alert('Privacy settings saved.');
                }
            });
            document.getElementById('changePasswordNew')?.addEventListener('input', () => updateStrengthMeter('changePasswordNew', 'changePasswordStrengthFill', 'changePasswordStrengthText', 'changePasswordStrengthWrap'));
            document.getElementById('encryptPassword')?.addEventListener('input', () => {
                if (!document.getElementById('passwordStrengthWrap').classList.contains('hidden')) {
                    updateStrengthMeter('encryptPassword', 'passwordStrengthFill', 'passwordStrengthText', 'passwordStrengthWrap');
                }
            });
            document.querySelector('#wageTable tbody')?.addEventListener('click', handleTableAction);
            document.querySelector('#expenseTable tbody')?.addEventListener('click', handleTableAction);
            document.getElementById('markAllIncomeReviewedBtn')?.addEventListener('click', () => { const budget = getActiveBudget(); if (!budget) return; budget.wages.forEach(item => item.reviewed = true); saveAndEncrypt(); renderAll(); });
            document.getElementById('markAllExpensesReviewedBtn')?.addEventListener('click', () => { const budget = getActiveBudget(); if (!budget) return; budget.expenses.forEach(item => item.reviewed = true); saveAndEncrypt(); renderAll(); });
            document.getElementById('runCustomReportBtn')?.addEventListener('click', () => runCustomReport(true));
            document.getElementById('reportStartDate')?.addEventListener('change', () => runCustomReport(true));
            document.getElementById('reportEndDate')?.addEventListener('change', () => runCustomReport(true));
            document.getElementById('openOnboardingBtn')?.addEventListener('click', () => maybeShowOnboarding(true));
            document.getElementById('openGuideBtn')?.addEventListener('click', openGuideModal);
            document.getElementById('openGuideModalBtn')?.addEventListener('click', openGuideModal);
            document.getElementById('closeGuideBtn')?.addEventListener('click', closeGuideModal);
            document.getElementById('openWhatsNewBtn')?.addEventListener('click', () => maybeShowWhatsNew(true));
            document.getElementById('closeWhatsNewBtn')?.addEventListener('click', () => closeWhatsNewModal(true));
            document.getElementById('goToGuideFromWhatsNewBtn')?.addEventListener('click', () => { closeWhatsNewModal(true); openGuideModal(); });
            document.getElementById('openOnboardingFromGuideBtn')?.addEventListener('click', () => { closeGuideModal(); maybeShowOnboarding(true); });
            document.getElementById('cancelEditBtn')?.addEventListener('click', closeEditModal);
            document.getElementById('splitExpenseBtn')?.addEventListener('click', openSplitModal);
            document.getElementById('cancelSplitBtn')?.addEventListener('click', closeSplitModal);
            document.getElementById('skipOnboardingBtn')?.addEventListener('click', closeOnboarding);
            document.getElementById('editTransactionForm')?.addEventListener('submit', event => {
                event.preventDefault();
                const budget = getActiveBudget();
                if (!budget) return;
                const type = document.getElementById('editType').value;
                const index = Number(document.getElementById('editIndex').value);
                const list = type === 'wage' ? budget.wages : budget.expenses;
                if (!list[index]) return;
                list[index].date = document.getElementById('editDate').value;
                list[index].amount = Number(document.getElementById('editAmount').value || 0);
                list[index].recurrence = document.getElementById('editRecurrence').value;
                list[index].recurring = list[index].recurrence !== 'none';
                list[index].reviewed = Boolean(document.getElementById('editReviewed').checked);
                if (type === 'wage') {
                    list[index].source = document.getElementById('editSource').value.trim();
                } else {
                    list[index].category = document.getElementById('editCategory').value;
                    list[index].description = document.getElementById('editDescription').value.trim();
                    budget.categories = uniqueClean([...(budget.categories || []), list[index].category]);
                }
                closeEditModal();
                saveAndEncrypt();
                renderAll();
            });
            document.getElementById('splitExpenseForm')?.addEventListener('submit', event => {
                event.preventDefault();
                const budget = getActiveBudget();
                if (!budget) return;
                const idx = Number(document.getElementById('editIndex')?.value);
                const original = budget.expenses[idx];
                if (!original) return;
                const amountOne = Number(document.getElementById('splitAmountOne').value || 0);
                const amountTwo = Number(document.getElementById('splitAmountTwo').value || 0);
                if (Math.abs((amountOne + amountTwo) - Number(original.amount || 0)) > 0.01) { alert('Split amounts must add up to the original expense.'); return; }
                const first = { ...cloneData(original), amount: amountOne, category: document.getElementById('splitCategoryOne').value, description: document.getElementById('splitDescOne').value.trim() };
                const second = { ...cloneData(original), amount: amountTwo, category: document.getElementById('splitCategoryTwo').value, description: document.getElementById('splitDescTwo').value.trim() };
                budget.expenses.splice(idx, 1, first, second);
                budget.categories = uniqueClean([...(budget.categories || []), first.category, second.category]);
                closeSplitModal(); closeEditModal();
                saveAndEncrypt();
                renderAll();
            });
            document.getElementById('onboardingForm')?.addEventListener('submit', event => {
                event.preventDefault();
                const budget = getActiveBudget();
                if (!budget) return;
                budget.name = document.getElementById('onboardingBudgetName').value.trim() || budget.name;
                budget.periodType = document.getElementById('onboardingCycle').value;
                budget.budgetGoal = Number(document.getElementById('onboardingLimit').value || 0);
                budget.savingsGoal = Number(document.getElementById('onboardingSavings').value || 0);
                budget.savingsBalance = Number(document.getElementById('onboardingSavingsBalance')?.value || 0);
                budget.rolloverEnabled = Boolean(document.getElementById('onboardingRollover').checked);
                budget.categories = getStarterCategories(document.getElementById('onboardingStyle').value);
                closeOnboarding();
                saveAndEncrypt();
                renderAll();
            });
            applyMetaToUI(DEFAULT_APP_META);
            document.getElementById('wageDate').valueAsDate = new Date();
            document.getElementById('expenseDate').valueAsDate = new Date();
            document.getElementById('periodStartInput').value = formatDateLocal(new Date());
            initSectionTabs();
            initPWA();
            initScreenLock();
            initAiImport();
            updatePinUI();
            updateStrengthMeter('changePasswordNew', 'changePasswordStrengthFill', 'changePasswordStrengthText', 'changePasswordStrengthWrap');
            showEncryptionPrompt();
            window.addEventListener('resize', () => {
                clearTimeout(window.__chartResizeTimer);
                window.__chartResizeTimer = setTimeout(() => {
                    if (!document.getElementById('appContent')?.classList.contains('hidden')) renderAll();
                }, 120);
            });
        }

        window.addEventListener('DOMContentLoaded', initApp);

        