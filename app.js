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
        const CURRENT_APP_VERSION = '1.5.0';
        const TAB_KEYS = ['home', 'add', 'import', 'plan', 'activity', 'reports', 'security'];
        const DEFAULT_APP_META = { version: CURRENT_APP_VERSION, publishedAt: '2026-06-16', notes: [
            'Updated the app with the approved BudgetVault wordmark and logo across the app shell, auth screens, and install assets.',
            'BudgetVault launch build with privacy-first branding, clearer security copy, and GitHub-ready publishing.',
            'Rebranded the app as BudgetVault with stronger privacy-first copy across the experience.',
            "What's new splash now highlights BudgetVault release notes after an update or first open.",
            'Published version check now watches app-meta.json so GitHub Pages updates can surface cleanly.',
            'Service worker update messaging tightened for mobile and desktop users.',
            'AI bank-statement import can send PDFs through your Vercel backend to OpenAI, return strict JSON, and let users review every transaction before it enters the vault.'
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


        function cloneData(data) {
            if (typeof structuredClone === 'function') return structuredClone(data);
            return JSON.parse(JSON.stringify(data));
        }

        function escapeHTML(value) {
            return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
        }

        function evaluatePasswordStrength(password) {
            const value = String(password || '');
            let score = 0;
            const lowered = value.toLowerCase();
            if (value.length >= 12) score++;
            if (value.length >= 16) score++;
            if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
            if (/\d/.test(value)) score++;
            if (/[^A-Za-z0-9\s]/.test(value)) score++;
            if (/\s/.test(value) && value.trim().split(/\s+/).length >= 4) score += 2;
            if (/^(.)\1+$/.test(value) || /(1234|password|qwerty|letmein|budget|money|admin)/i.test(lowered)) score -= 2;
            if (/(.)\1{3,}/.test(value)) score--;
            score = Math.max(0, Math.min(5, score));
            let label = 'Very weak';
            let message = 'Use a longer password.';
            if (score >= 4) { label = 'Strong'; message = 'Good choice. Long unique passwords are best.'; }
            else if (score === 3) { label = 'Good'; message = 'Good, but a longer unique passphrase is safer.'; }
            else if (score === 2) { label = 'Fair'; message = 'Add length and avoid common words or patterns.'; }
            else if (score === 1) { label = 'Weak'; message = 'Too easy to guess if an attacker gets the encrypted file.'; }
            return { score, label, message, valid: value.length >= 12 && score >= 3 };
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
            text.textContent = `${meta.label}: ${meta.message}`;
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
            if (versionChip) versionChip.textContent = `🆕 v${version}`;
            if (currentVersionText) currentVersionText.textContent = `v${CURRENT_APP_VERSION}`;
            if (publishedChip) publishedChip.textContent = `Published ${published}`;
            if (whatsNewTitle) whatsNewTitle.textContent = `What's new in v${version}`;
            if (whatsNewIntro) whatsNewIntro.textContent = `Published ${published}. You can reopen this from the top of the app any time.`;
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
            if (chip) chip.textContent = sessionPIN ? `🛡️ Auto-locks after ${lockTimeoutMinutes} min` : '🛡️ PIN lock optional';
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
                document.getElementById('pinInput')?.closest('.panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                document.getElementById('pinInput')?.focus();
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

        function createDefaultBudget(name = 'Main', id = '1') {
            return {
                id,
                name,
                wages: [],
                expenses: [],
                budgetGoal: 0,
                savingsGoal: 0,
                periodType: 'monthly',
                periodStart: formatDateLocal(new Date()),
                categories: [...DEFAULT_CATEGORIES],
                categoryBudgets: {},
                rolloverEnabled: false,
                importRules: []
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
                periodType: VALID_PERIODS.has(raw?.periodType) ? raw.periodType : 'monthly',
                periodStart: parseLocalDate(raw?.periodStart) ? raw.periodStart : formatDateLocal(new Date()),
                categories: categories.length ? categories : [...DEFAULT_CATEGORIES],
                categoryBudgets,
                rolloverEnabled: Boolean(raw?.rolloverEnabled),
                importRules: normaliseImportRules(raw?.importRules)
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

                Number.isFinite(b.budgetGoal) && b.budgetGoal >= 0 &&
                Number.isFinite(b.savingsGoal) && b.savingsGoal >= 0 &&
                VALID_PERIODS.has(b.periodType) && parseLocalDate(b.periodStart) &&
                b.wages.every(w => parseLocalDate(w.date) && Number.isFinite(w.amount) && w.amount >= 0 && VALID_RECURRENCES.has(w.recurrence)) &&
                b.expenses.every(e => parseLocalDate(e.date) && Number.isFinite(e.amount) && e.amount >= 0 && VALID_RECURRENCES.has(e.recurrence))
            );
        }

        // ---------- Enhanced Encryption (600k PBKDF2 iterations) ----------
        async function deriveKey(password, salt) {
            const enc = new TextEncoder();
            const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
            return crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );
        }

        async function encryptData(data, password) {
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const key = await deriveKey(password, salt);
            const encoded = new TextEncoder().encode(JSON.stringify(data));
            const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
            return { salt: Array.from(salt), iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
        }

        async function decryptData(encryptedObj, password) {
            const salt = new Uint8Array(encryptedObj.salt);
            const iv = new Uint8Array(encryptedObj.iv);
            const data = new Uint8Array(encryptedObj.data);
            const key = await deriveKey(password, salt);
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
            return JSON.parse(new TextDecoder().decode(decrypted));
        }

        async function storeEncrypted(data, password) {
            const enc = await encryptData(data, password);
            localStorage.setItem('budgetAppEncrypted', JSON.stringify(enc));
        }

        async function loadDecrypted(password) {
            const raw = localStorage.getItem('budgetAppEncrypted');
            if (!raw) return null;
            try { return await decryptData(JSON.parse(raw), password); }
            catch { return null; }
        }

        // ---------- Theme ----------
        function applyTheme() {
            const theme = localStorage.getItem('theme') || 'dark';
            document.body.classList.toggle('light', theme === 'light');
            document.body.classList.toggle('dark', theme !== 'light');
            const metaTheme = document.querySelector('meta[name="theme-color"]');
            if (metaTheme) metaTheme.setAttribute('content', theme === 'light' ? '#f8fafc' : '#08111f');
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
                .then(() => storeEncrypted(snapshot, currentPassword))
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

        function getActiveViewRange(budget) {
            if (currentFilterMonth) {
                const [y, m] = currentFilterMonth.split('-').map(Number);
                const start = new Date(y, m - 1, 1);
                return { type: 'month', start, end: new Date(y, m, 1), label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
            }
            const period = getCurrentPeriod(budget);
            return { ...period, label: `${PERIOD_LABELS[period.type]} cycle: ${formatPeriodLabel(period)}` };
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
                const spent = totals[cat] || 0;
                const limit = budget?.rolloverEnabled ? getAdjustedCategoryLimit(budget, cat) : Number(limits[cat] || 0);
                const pctRaw = limit > 0 ? (spent / limit) * 100 : 0;
                return { category: cat, spent, limit, pctRaw, over: limit > 0 && spent > limit };
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
            budget.budgetGoal = !isNaN(limit) && limit >= 0 ? limit : 0;
            budget.savingsGoal = !isNaN(savings) && savings >= 0 ? savings : 0;
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
                const spent = totals[cat] || 0;
                const limit = getAdjustedCategoryLimit(budget, cat);
                const pctRaw = limit > 0 ? (spent / limit) * 100 : 0;
                const pct = Math.min(100, pctRaw);
                const status = limit > 0 ? (spent > limit ? `£${(spent - limit).toFixed(2)} over` : `£${Math.max(0, limit - spent).toFixed(2)} left`) : 'No limit';
                return `<div class="category-limit-item">
                    <div class="category-limit-top"><strong>${escapeHTML(cat)}</strong><span class="${spent > limit && limit > 0 ? 'danger-text' : 'muted'}">${escapeHTML(status)}</span></div>
                    <div class="category-limit-grid">
                        <div>
                            <div class="progress-meta"><span>Spent £${spent.toFixed(2)}</span><span>${limit > 0 ? `${pctRaw.toFixed(0)}%` : ''}</span></div>
                            <div class="progress-bar"><div class="progress-fill ${spent > limit && limit > 0 ? 'over' : ''}" style="width:${pct}%"></div></div>
                        </div>
                        <input type="number" min="0" step="0.01" inputmode="decimal" aria-label="${escapeHTML(cat)} limit" value="${limit || ''}" data-category-limit="${escapeHTML(cat)}" placeholder="Limit">
                    </div>
                </div>`;
            }).join('');
            list.querySelectorAll('[data-category-limit]').forEach(input => {
                input.addEventListener('change', () => {
                    const cat = input.getAttribute('data-category-limit');
                    const value = Number(input.value);
                    if (!Number.isFinite(value) || value <= 0) delete budget.categoryBudgets[cat];
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
            if (enabled) enabled.checked = settings.enabled;
            if (endpoint) endpoint.value = settings.endpoint;
        }

        function saveAiImportSettings() {
            const enabled = document.getElementById('aiImportEnabledCheckbox')?.checked ? '1' : '0';
            const endpoint = (document.getElementById('aiImportEndpointInput')?.value || '/api/parse-statement').trim() || '/api/parse-statement';
            localStorage.setItem('aiImportEnabled', enabled);
            localStorage.setItem('aiImportEndpoint', endpoint);
            setAiImportStatus(enabled === '1' ? 'AI import is enabled on this device. Upload a PDF when ready.' : 'AI import is off. Turn it on before uploading statements.', enabled === '1' ? 'saved' : '');
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
                const res = await fetch(endpoint, { cache: 'no-store' });
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
            const lowConfidence = rows.filter(r => r.needsReview).length;
            const duplicates = rows.filter(r => r.duplicate).length;
            summary.classList.toggle('empty-state', !rows.length);
            summary.textContent = rows.length ? `${rows.length} transaction${rows.length === 1 ? '' : 's'} found • ${selectedCount} selected • ${lowConfidence} need review • ${duplicates} possible duplicate${duplicates === 1 ? '' : 's'}` : 'No parsed statement waiting for review.';
            tbody.innerHTML = rows.length ? rows.map((row, index) => {
                const confPct = Math.round(Number(row.confidence || 0) * 100);
                const badgeClass = row.duplicate || row.needsReview ? 'needs-review-chip' : 'reviewed-chip';
                return `<tr data-import-index="${index}" class="${row.duplicate ? 'import-duplicate-row' : ''}">
                    <td data-label="Use"><input type="checkbox" data-import-field="include" ${row.include ? 'checked' : ''}></td>
                    <td data-label="Date"><input type="date" data-import-field="date" value="${escapeHTML(row.date)}"></td>
                    <td data-label="Type"><select data-import-field="type"><option value="expense" ${row.type === 'expense' ? 'selected' : ''}>Money out</option><option value="income" ${row.type === 'income' ? 'selected' : ''}>Money in</option></select></td>
                    <td data-label="Amount"><input type="number" min="0.01" step="0.01" inputmode="decimal" data-import-field="amount" value="${Number(row.amount || 0).toFixed(2)}"></td>
                    <td data-label="Category / Source">${row.type === 'income' ? `<input type="text" data-import-field="source" value="${escapeHTML(row.source || 'Statement income')}">` : `<select data-import-field="category">${categoryOptionsForImport(row.category || 'Other')}</select>`}</td>
                    <td data-label="Description"><input type="text" data-import-field="description" value="${escapeHTML(row.description || '')}"><small>${row.duplicate ? 'Possible duplicate. ' : ''}${row.learnedCategory ? 'Learned category applied. ' : ''}${row.notes ? escapeHTML(row.notes) : ''}</small></td>
                    <td data-label="Confidence"><span class="mini-chip ${badgeClass}">${confPct}%</span></td>
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
            if (field === 'category' && item.originalCategory !== value) item.userEdited = true;
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
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || `Import failed with HTTP ${res.status}`);
                const transactions = Array.isArray(data.transactions) ? data.transactions : [];
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
            pendingStatementImport = [];
            saveAndEncrypt();
            renderAll();
            renderImportReview();
            setAiImportStatus(`Imported ${incomeCount} money-in and ${expenseCount} money-out transaction${incomeCount + expenseCount === 1 ? '' : 's'} into this vault.`, 'saved');
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
            renderImportReview();
            document.getElementById('saveAiImportSettingsBtn')?.addEventListener('click', saveAiImportSettings);
            document.getElementById('testAiImportBtn')?.addEventListener('click', testAiImportConnection);
            document.getElementById('parseStatementBtn')?.addEventListener('click', parseBankStatementPdf);
            document.getElementById('importSelectedTransactionsBtn')?.addEventListener('click', importSelectedStatementTransactions);
            document.getElementById('clearImportReviewBtn')?.addEventListener('click', () => { pendingStatementImport = []; renderImportReview(); setAiImportStatus('Statement review cleared.', ''); });
            document.getElementById('clearImportLearningBtn')?.addEventListener('click', clearImportLearning);
            document.getElementById('aiImportReviewTable')?.addEventListener('input', updatePendingImportField);
            document.getElementById('aiImportReviewTable')?.addEventListener('change', updatePendingImportField);
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
                        upcoming.push({ ...item, type, nextDate: formatDateLocal(next), reminderKey: `${appData.activeBudgetId}:${type}:${index}:${formatDateLocal(next)}` });
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
                return `<div class="reminder-item">
                    <div class="reminder-copy"><strong>${escapeHTML(r.type)}</strong><span>${label} • ${escapeHTML(RECURRENCE_LABELS[normaliseRecurrence(r)])}</span></div>
                    <div class="reminder-meta"><span class="amount ${typeClass}">£${amount}</span><small>${escapeHTML(r.nextDate)}</small></div>
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

        // ---------- Render all ----------
        function renderAll() {
            appData = normaliseData(appData);
            const budget = getActiveBudget();
            if (!budget) return;
            renderDashboard(budget);
            renderSmartInsights(budget);
            renderTables(budget);
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
            const exp = expenses.reduce((s,e) => s + Number(e.amount || 0), 0);
            const bal = income - exp;
            const limit = budget.budgetGoal || 0;
            const savingsGoal = budget.savingsGoal || 0;
            const spendPctRaw = limit > 0 ? (exp / limit) * 100 : 0;
            const spendPct = limit > 0 ? Math.min(100, spendPctRaw) : 0;
            const safeSavings = Math.max(0, bal);
            const savingsPctRaw = savingsGoal > 0 ? (safeSavings / savingsGoal) * 100 : 0;
            const savingsPct = savingsGoal > 0 ? Math.min(100, savingsPctRaw) : 0;
            const leftToBudget = Math.max(0, limit - exp);
            const overBudget = limit > 0 && exp > limit ? `<small class="danger-text">£${(exp-limit).toFixed(2)} over spending limit</small>` : '<small>Within your spending limit.</small>';
            const savingsText = savingsGoal > 0 ? `${savingsPctRaw.toFixed(0)}% saved this cycle` : 'No savings target set';
            const savingsMeta = savingsGoal > 0 ? `<small>£${Math.max(0, savingsGoal-safeSavings).toFixed(2)} left to target</small>` : '<small>Set a target to track leftover money.</small>';
            document.getElementById('dashboard').innerHTML = `
                <div class="stat-card balance-card">
                    <div class="stat-top"><span class="stat-icon">💷</span><span class="pill">${escapeHTML(range.label)}</span></div>
                    <div class="label">Cycle Balance</div>
                    <div class="value">£${bal.toFixed(2)}</div>
                    <small>${currentFilterMonth || searchTerm ? 'Filtered view' : 'Current planning cycle'}</small>
                </div>
                <div class="stat-card income-card">
                    <div class="stat-top"><span class="stat-icon">↗</span><span class="trend good">Income</span></div>
                    <div class="label">Money In</div>
                    <div class="value">£${income.toFixed(2)}</div>
                    <small>${wages.length} income item${wages.length === 1 ? '' : 's'}</small>
                </div>
                <div class="stat-card expense-card">
                    <div class="stat-top"><span class="stat-icon">↘</span><span class="trend bad">Spending</span></div>
                    <div class="label">Money Out</div>
                    <div class="value">£${exp.toFixed(2)}</div>
                    <small>${expenses.length} expense item${expenses.length === 1 ? '' : 's'}</small>
                </div>
                <div class="stat-card goal-card">
                    <div class="stat-top"><span class="stat-icon">🎯</span><span class="pill">Spending limit</span></div>
                    <div class="label">Budget Limit</div>
                    <div class="value">£${limit.toFixed(2)}</div>
                    <div class="progress-container">
                        <div class="progress-meta"><span>${limit > 0 ? `${spendPctRaw.toFixed(0)}% used` : 'No limit set'}</span></div>
                        <div class="progress-bar"><div class="progress-fill ${exp>limit&&limit>0?'over':''}" style="width:${spendPct}%"></div></div>
                        ${overBudget}
                    </div>
                </div>
                <div class="stat-card goal-card">
                    <div class="stat-top"><span class="stat-icon">🧮</span><span class="pill">Planner</span></div>
                    <div class="label">Left to budget</div>
                    <div class="value">£${leftToBudget.toFixed(2)}</div>
                    <small>${budget.rolloverEnabled ? 'Category rollover is on for next cycle.' : 'Turn on rollover in Budget planner if you want unused category money carried forward.'}</small>
                </div>
                <div class="stat-card goal-card">
                    <div class="stat-top"><span class="stat-icon">🏦</span><span class="pill">Savings</span></div>
                    <div class="label">Savings Target</div>
                    <div class="value">£${safeSavings.toFixed(2)} / £${savingsGoal.toFixed(2)}</div>
                    <div class="progress-container">
                        <div class="progress-meta"><span>${savingsText}</span></div>
                        <div class="progress-bar"><div class="progress-fill" style="width:${savingsPct}%"></div></div>
                        ${savingsMeta}
                    </div>
                </div>`;
        }

        function renderSmartInsights(budget) {
            const container = document.getElementById('insightCards');
            if (!container || !budget) return;
            const { range, wages, expenses } = getCycleItems(budget);
            const income = wages.reduce((s,w) => s + Number(w.amount || 0), 0);
            const spent = expenses.reduce((s,e) => s + Number(e.amount || 0), 0);
            const balance = income - spent;
            const upcomingOutflow = getFutureRecurringOutflowForRange(budget, range);
            const remainingSavingsTarget = Math.max(0, Number(budget.savingsGoal || 0) - Math.max(0, balance));
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
                <div class="card">
                    <div class="stat-top"><span class="stat-icon">👛</span><span class="pill">After bills + savings</span></div>
                    <div class="label">Safe to spend</div>
                    <div class="value">£${safeToSpend.toFixed(2)}</div>
                    <small>Balance £${balance.toFixed(2)} minus upcoming bills £${upcomingOutflow.toFixed(2)} and remaining savings target £${remainingSavingsTarget.toFixed(2)}.</small>
                </div>
                <div class="card">
                    <div class="stat-top"><span class="stat-icon">📅</span><span class="pill">Next 30 days</span></div>
                    <div class="label">Bills / subscriptions</div>
                    <div class="value">£${billTotal30.toFixed(2)}</div>
                    <small>${upcoming30.length} recurring item${upcoming30.length === 1 ? '' : 's'} coming up.</small>
                </div>
                <div class="card">
                    <div class="stat-top"><span class="stat-icon">🏷️</span><span class="pill">Category health</span></div>
                    <div class="label">Limits over</div>
                    <div class="value">${overCategories.length}</div>
                    <small>${overCategories.length ? overCategories.map(c => escapeHTML(c.category)).slice(0, 3).join(', ') : 'All category limits are okay.'}</small>
                </div>
                <div class="card">
                    <div class="stat-top"><span class="stat-icon">✅</span><span class="pill">Clean-up</span></div>
                    <div class="label">Need review</div>
                    <div class="value">${unreviewed}</div>
                    <small>Mark transactions reviewed after checking they are correct.</small>
                </div>
                <div class="card">
                    <div class="stat-top"><span class="stat-icon">🔥</span><span class="pill">Top spend</span></div>
                    <div class="label">Largest category</div>
                    <div class="value">${topCategory ? escapeHTML(topCategory[0]) : '—'}</div>
                    <small>${topCategory ? `£${Number(topCategory[1]).toFixed(2)} this cycle.` : 'Add expenses to see your biggest area.'}</small>
                </div>
                <div class="card">
                    <div class="stat-top"><span class="stat-icon">💳</span><span class="pill">Biggest item</span></div>
                    <div class="label">Largest expense</div>
                    <div class="value">${biggest ? `£${Number(biggest.amount || 0).toFixed(2)}` : '—'}</div>
                    <small>${biggest ? `${escapeHTML(biggest.category || 'Other')} • ${escapeHTML(biggest.description || biggest.date)}` : 'No expenses in this cycle.'}</small>
                </div>`;
        }

        function getRecurrenceBadge(item) {
            const recurrence = normaliseRecurrence(item);
            return recurrence === 'none' ? '<span class="muted">One-off</span>' : `<span class="mini-chip">${escapeHTML(RECURRENCE_LABELS[recurrence])}</span>`;
        }

        
function renderTables(budget) {
    const fw = filterAndSearch(budget.wages, ['date','source','amount','recurrence'], budget, false);
    const fe = filterAndSearch(budget.expenses, ['date','category','description','amount','recurrence'], budget, false);
    const wtbody = document.querySelector('#wageTable tbody');
    wtbody.innerHTML = fw.length ? fw.map(w => {
        const idx = budget.wages.indexOf(w);
        return `<tr>
            <td data-label="Date"><span class="date-badge">${escapeHTML(w.date)}</span></td>
            <td data-label="Amount"><span class="amount income">£${Number(w.amount || 0).toFixed(2)}</span></td>
            <td data-label="Source">${escapeHTML(w.source || 'No source')}</td>
            <td data-label="Repeat">${getRecurrenceBadge(w)}</td>
            <td data-label="Review"><button class="btn-sm ${w.reviewed ? 'secondary reviewed-chip' : 'secondary needs-review-chip'}" data-action="toggle-review" data-type="wage" data-index="${idx}">${w.reviewed ? 'Reviewed' : 'Review'}</button></td>
            <td data-label="Action"><div class="install-actions"><button class="secondary btn-sm" data-action="edit-item" data-type="wage" data-index="${idx}">Edit</button><button class="secondary btn-sm" data-action="duplicate-item" data-type="wage" data-index="${idx}">Copy</button><button class="danger btn-sm" data-action="delete-item" data-type="wage" data-index="${idx}">Delete</button></div></td>
        </tr>`;
    }).join('') : '<tr class="empty-row"><td colspan="6"><div class="empty-state small">No income items match the current view.</div></td></tr>';
    const etbody = document.querySelector('#expenseTable tbody');
    etbody.innerHTML = fe.length ? fe.map(e => {
        const idx = budget.expenses.indexOf(e);
        return `<tr>
            <td data-label="Date"><span class="date-badge">${escapeHTML(e.date)}</span></td>
            <td data-label="Amount"><span class="amount expense">£${Number(e.amount || 0).toFixed(2)}</span></td>
            <td data-label="Category">${escapeHTML(e.category || 'Other')}</td>
            <td data-label="Description">${escapeHTML(e.description || 'No description')}</td>
            <td data-label="Repeat">${getRecurrenceBadge(e)}</td>
            <td data-label="Review"><button class="btn-sm ${e.reviewed ? 'secondary reviewed-chip' : 'secondary needs-review-chip'}" data-action="toggle-review" data-type="expense" data-index="${idx}">${e.reviewed ? 'Reviewed' : 'Review'}</button></td>
            <td data-label="Action"><div class="install-actions"><button class="secondary btn-sm" data-action="edit-item" data-type="expense" data-index="${idx}">Edit</button><button class="secondary btn-sm" data-action="duplicate-item" data-type="expense" data-index="${idx}">Copy</button><button class="danger btn-sm" data-action="delete-item" data-type="expense" data-index="${idx}">Delete</button></div></td>
        </tr>`;
    }).join('') : '<tr class="empty-row"><td colspan="7"><div class="empty-state small">No expenses match the current view.</div></td></tr>';
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
    expenses.forEach(e => {
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
    const exp = expenses.reduce((s,e)=>s+Number(e.amount||0),0);
    drawDonutChart(document.getElementById('balanceChart'), ['Income', 'Spending'], [income, exp], 'Current cycle');
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
        document.getElementById('applyFilter').addEventListener('click', () => { currentFilterMonth = document.getElementById('filterMonth').value; renderAll(); });
        document.getElementById('resetFilter').addEventListener('click', () => { currentFilterMonth = null; document.getElementById('filterMonth').value=''; renderAll(); });
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
            if (/^[=+\-@]/.test(text)) text = `'${text}`;
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
                const dec = await decryptData(parsed.encrypted, currentPassword);
                const normalised = normaliseData(dec);
                if (!isValidData(normalised)) throw new Error('Invalid encrypted backup.');
                appData = normalised;
                await storeEncrypted(appData, currentPassword);
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
        const dec = await loadDecrypted(pw);
        if (dec) {
            const normalised = normaliseData(dec);
            if (isValidData(normalised)) {
                appData = normalised;
                currentPassword = pw;
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
        if (!strength.valid) { alert('Please choose a stronger password. Use 4 random words or at least 12 characters that are unique to this app.'); return; }
        appData = { budgets: [createDefaultBudget()], activeBudgetId:'1' };
        currentPassword = pw;
        await storeEncrypted(appData, pw);
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
    if (!strength.valid) { alert('Use a stronger password. A long unique passphrase is safest.'); return; }
    currentPassword = newPw;
    await storeEncrypted(normaliseData(appData), newPw);
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
            if (!document.getElementById('reportStartDate')?.value) {
                const current = getCurrentPeriod(budget);
                document.getElementById('reportStartDate').value = formatDateLocal(current.start);
                document.getElementById('reportEndDate').value = formatDateLocal(addDays(current.end, -1));
            }
        }

        function renderCycleCompare(budget) {
            const current = getCurrentPeriod(budget);
            const previous = getPreviousPeriod(budget);
            const currentIncome = sumInPeriod(budget.wages, current);
            const currentSpend = sumInPeriod(budget.expenses, current);
            const prevIncome = sumInPeriod(budget.wages, previous);
            const prevSpend = sumInPeriod(budget.expenses, previous);
            const container = document.getElementById('cycleCompareCards');
            if (!container) return;
            container.innerHTML = `
                <div class="mini-stat"><span class="muted">Current net</span><strong>£${(currentIncome - currentSpend).toFixed(2)}</strong><span>${escapeHTML(formatPeriodLabel(current))}</span></div>
                <div class="mini-stat"><span class="muted">Previous net</span><strong>£${(prevIncome - prevSpend).toFixed(2)}</strong><span>${escapeHTML(formatPeriodLabel(previous))}</span></div>
                <div class="mini-stat"><span class="muted">Spending change</span><strong>${prevSpend ? (((currentSpend - prevSpend) / prevSpend) * 100).toFixed(0) : 0}%</strong><span>${currentSpend >= prevSpend ? 'Higher than last cycle' : 'Lower than last cycle'}</span></div>`;
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
            document.getElementById('runCustomReportBtn')?.addEventListener('click', runCustomReport);
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

        