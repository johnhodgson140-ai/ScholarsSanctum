/* ============================================================
   SCHOLAR'S SANCTUM — FULL APP ENGINE
   ============================================================ */

// ============================================================
// STORAGE
// ============================================================
let _storageSizeWarned = false;
function saveDB() {
  const data = JSON.stringify(db);
  // Warn when approaching the ~5 MB localStorage limit
  const sizeKB = Math.round(data.length / 512); // rough KB estimate
  if (sizeKB > 4000 && !_storageSizeWarned) {
    _storageSizeWarned = true;
    showToast('⚠️', 'Storage Nearly Full',
      `Using ~${Math.round(sizeKB/1024*10)/10} MB of ~5 MB limit. Export your data in Settings to prevent loss.`);
  }
  try {
    localStorage.setItem('sanctumDB', data);
  } catch(e) {
    showToast('⚠️', 'Storage Full!', 'Cannot save — export your data from Settings to free space.');
  }
  _scheduleAutoPush();
}
function loadDB() {
  try { return JSON.parse(localStorage.getItem('sanctumDB') || 'null'); }
  catch(e) { localStorage.removeItem('sanctumDB'); return null; }
}

let db;

function initApp() {
  try {
    _loadAuth();
    if (!_requireAuth()) return; // redirect to auth.html if not logged in

    db = loadDB();
    if (!db) db = getDefaultDB();
    if (!db.decks) db.decks = {};
    if (!db.folders) db.folders = {};
    if (!db.stats) db.stats = getDefaultStats();
    if (!db.xp) db.xp = getDefaultXP();
    if (!db.rag) db.rag = { red: 5, amber: 10, green: 50 };
    if (!db.achievements) db.achievements = {};
    if (!db.settings) db.settings = getDefaultSettings();
    if (!db.quests) db.quests = { date: '', list: [] };
    if (!db.heatmap) db.heatmap = {};
    if (!db.masteryHall) db.masteryHall = [];
    if (!db.stats.battleCardsDefeated) db.stats.battleCardsDefeated = 0;
    if (!db.stats.duelBestStreak) db.stats.duelBestStreak = 0;
    if (!db.stats.streakFreezes) db.stats.streakFreezes = 0;
    if (!db.friends) db.friends = {};
    if (!db.calendar) db.calendar = { events: [] };
    try {
      const assigned = new Set(Object.values(db.folders).flatMap(f => f.decks || []));
      Object.keys(db.decks).forEach(deckName => {
        if (!assigned.has(deckName)) {
          try {
            const pct = getDeckMastery(deckName);
            if (pct === 100 && !db.masteryHall.some(h => h.name === deckName)) {
              db.masteryHall.push({ name: deckName, mastered: todayStr(), cards: db.decks[deckName].cards.length });
            }
          } catch(_) {}
          delete db.decks[deckName];
        }
      });
    } catch(_) {}
    applyTheme();
    saveDB();
    try { _loadClipboards(); } catch(_) {}
    try { startSyncListener(); } catch(_) {}
    try { _renderUserNav(); } catch(_) {}
    try { scheduleNotifications(); } catch(_) {}
    try { checkSharedDeckInURL(); } catch(_) {}
    try { checkPendingChallenges(); } catch(_) {}
    try { checkDailyReminder(); } catch(_) {}
    if ('serviceWorker' in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && !window._swReloading) {
          window._swReloading = true;
          window.location.reload();
        }
      });
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    setTimeout(() => { try { _initAIChat(); } catch(_) {} }, 300);
    setTimeout(() => { try { _initMobileToolsBtn(); } catch(_) {} }, 350);
  } catch(e) {
    // Last-resort: if initApp itself crashes, show a toast and don't leave the user stranded
    console.error('initApp error:', e);
    document.body.innerHTML += `<div style="position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#c0392b;color:#fff;padding:16px 24px;border-radius:8px;z-index:9999;font-family:sans-serif;max-width:90vw;text-align:center">
      ⚠ App failed to load. <button onclick="localStorage.clear();location.reload()" style="margin-left:10px;background:#fff;color:#c0392b;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-weight:bold">Reset &amp; Reload</button>
    </div>`;
  }
}

function getDefaultDB() {
  return {
    decks: {}, folders: {},
    stats: getDefaultStats(),
    xp: getDefaultXP(),
    rag: { red: 5, amber: 10, green: 50 },
    achievements: {},
    settings: getDefaultSettings(),
    quests: { date: '', list: [] },
    heatmap: {},
    masteryHall: [],
    calendar: { events: [] }
  };
}

function getDefaultStats() {
  return {
    streak: 0, lastStudyDate: null, bestStreak: 0,
    totalStudyTime: 0, cardsStudiedToday: 0, totalCardsStudied: 0,
    ragCounts: { red: 0, amber: 0, green: 0 },
    greenStreak: 0, bestGreenStreak: 0,
    prestige: 0, lifetimeLevels: 0, lifetimeXP: 0,
    speedTimes: [], todayDate: ''
  };
}

function getDefaultXP() {
  return { level: 1, xp: 0 };
}

function getDefaultSettings() {
  return {
    theme: 'dark', sound: false, speedMode: false,
    dailyGoal: 20, softPrestige: false,
    mobileMode: false, practiceFontSize: '12pt',
    claudeAPIKey: '', claudeModel: 'claude-haiku-4-5-20251001'
  };
}

// ============================================================
// UTILITIES
// ============================================================
function todayStr() { return new Date().toISOString().slice(0, 10); }

// ============================================================
// MARKDOWN PARSER
// ============================================================
function parseMarkdown(text) {
  if (!text) return '';

  // Step 1 — extract math blocks so they survive HTML escaping & markdown
  const mathStore = [];
  const storeMath = (m) => { mathStore.push(m); return `\x00M${mathStore.length - 1}\x00`; };

  let s = text
    .replace(/\$\$[\s\S]+?\$\$/g, storeMath)          // $$...$$  display
    .replace(/\\\[[\s\S]+?\\\]/g,  storeMath)          // \[...\]  display
    .replace(/\\\([\s\S]+?\\\)/g,  storeMath)          // \(...\)  inline
    .replace(/\$[^\$\n]+?\$/g,     storeMath);         // $...$    inline

  // Step 2 — escape HTML special chars in remaining text
  s = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Step 3 — markdown formatting
  s = s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`([^`]+)`/g,     '<code class="md-code">$1</code>')
    .replace(/^#### (.+)$/gm,  '<h5 class="md-h">$1</h5>')
    .replace(/^### (.+)$/gm,   '<h5 class="md-h">$1</h5>')
    .replace(/^## (.+)$/gm,    '<h4 class="md-h">$1</h4>')
    .replace(/^# (.+)$/gm,     '<h3 class="md-h">$1</h3>')
    .replace(/^---+$/gm,       '<hr class="md-hr">')
    .replace(/^[-•]\s+(.+)$/gm,'<li>$1</li>')
    .replace(/^(\d+)\.\s+(.+)$/gm, '<li><span class="md-num">$1.</span> $2</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul class="md-ul">$1</ul>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g,   '<br>');

  // Step 4 — restore math blocks (now safely inside HTML)
  s = s.replace(/\x00M(\d+)\x00/g, (_, i) => mathStore[+i]);

  return s;
}

// Render KaTeX math inside an element (safe no-op if KaTeX not loaded)
function _renderMath(el) {
  if (!el || typeof renderMathInElement !== 'function') return;
  try {
    renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true  },
        { left: '$',  right: '$',  display: false },
        { left: '\\[', right: '\\]', display: true  },
        { left: '\\(', right: '\\)', display: false }
      ],
      throwOnError: false,
      errorColor: '#ff9090'
    });
  } catch(e) {}
}

function sm2(card, quality) {
  let interval = card.interval || 0;
  let easeFactor = card.easeFactor || 2.5;
  let reps = card.repetitions || 0;
  if (quality >= 3) {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);
    reps++;
  } else {
    reps = 0;
    interval = 1;
  }
  easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  return { interval, easeFactor, repetitions: reps, due: Date.now() + interval * 86400000 };
}

function checkStorageSize() {
  if (storageWarningShown) return;
  try {
    const len = (localStorage.getItem('sanctumDB') || '').length;
    if (len > 2000000) {
      storageWarningShown = true;
      showToast('⚠️', 'Storage Warning', `DB is ${(len / 500000).toFixed(1)}MB of ~5MB — export data or remove card images`);
    }
  } catch (e) {}
}

function timeFormat(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function xpRequiredForLevel(level) { return level * 10; }

function getTitle(level, prestige) {
  const prestigeTitles = [
    '', '⚔️ Iron Scholar', '🛡️ Bronze Guardian', '🔮 Silver Mystic',
    '🌟 Gold Sage', '💎 Diamond Arcanist', '🔥 Flame Warden',
    '⚡ Storm Caller', '🌙 Shadow Master', '☀️ Solar Champion', '👑 The Eternal'
  ];
  if (prestige > 0) return prestigeTitles[Math.min(prestige, 10)];

  if (level >= 90) return 'Grand Arcanist';
  if (level >= 75) return 'Runekeeper';
  if (level >= 60) return 'Dragonbound';
  if (level >= 45) return 'Crystal Sage';
  if (level >= 30) return 'Leather-Bound Scholar';
  if (level >= 15) return 'Novice Scribe';
  return 'Apprentice Scholar';
}

function getPrestigeLabel(p) {
  const labels = ['', '⚔️', '🛡️', '🔮', '🌟', '💎', '🔥', '⚡', '🌙', '☀️', '👑'];
  return labels[Math.min(p, 10)] || '';
}

function getCardTheme(level) {
  if (level >= 100) return 'celestial';
  if (level >= 75)  return 'rune';
  if (level >= 50)  return 'dragon';
  if (level >= 35)  return 'crystal';
  if (level >= 20)  return 'leather';
  if (level >= 10)  return 'parchment';
  return 'stone';
}

function applyTheme() {
  const t = db.settings.theme;
  document.body.classList.remove('theme-dark', 'theme-focus', 'theme-light');
  document.body.classList.add('theme-' + t);
  document.body.setAttribute('data-card-theme', getCardTheme(db.xp.level));
  applyMobileMode();
}

// Mobile mode is stored per-device in localStorage (not synced) so phone/desktop stay independent
function _getMobileMode() {
  try {
    const stored = localStorage.getItem('sanctumMobileMode');
    if (stored !== null) return stored === 'true';
    // Auto-detect on very first visit — phones default to mobile mode, desktops to desktop
    const isMobile = window.innerWidth <= 820 || navigator.maxTouchPoints > 1;
    _setMobileMode(isMobile);
    return isMobile;
  } catch(e) { return false; }
}
function _setMobileMode(on) {
  try { localStorage.setItem('sanctumMobileMode', on ? 'true' : 'false'); } catch(e) {}
}

function applyMobileMode() {
  const on = _getMobileMode();
  document.body.classList.toggle('mobile-ui', on);
  document.documentElement.style.overflowX = on ? 'hidden' : '';
  document.body.style.overflowX = on ? 'hidden' : '';
}

function toggleMobileMode() {
  const on = !_getMobileMode();
  _setMobileMode(on);
  applyMobileMode();
  const btn = document.getElementById('mobileModeBtn');
  if (btn) _updateMobileModeBtn(btn);
  showToast(on ? '📱' : '🖥️', on ? 'Mobile Mode On' : 'Desktop Mode On', '');
}

function _updateMobileModeBtn(btn) {
  const on = _getMobileMode();
  btn.textContent = on ? '🖥️ Switch to Desktop' : '📱 Switch to Mobile';
  btn.classList.toggle('active', on);
}

// ============================================================
// PARTICLES (atmospheric embers)
// ============================================================
function spawnParticles() {
  const layer = document.getElementById('particles');
  if (!layer) return;
  // Reduce to 8 particles on mobile to save battery; skip if user prefers reduced motion
  const isMobile = _getMobileMode();
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const count = prefersReduced ? 0 : isMobile ? 8 : 25;
  for (let i = 0; i < count; i++) {
    const e = document.createElement('div');
    e.className = 'ember';
    e.style.left = Math.random() * 100 + 'vw';
    e.style.animationDuration = (6 + Math.random() * 12) + 's';
    e.style.animationDelay = (Math.random() * 10) + 's';
    e.style.opacity = 0;
    e.style.width = e.style.height = (2 + Math.random() * 3) + 'px';
    layer.appendChild(e);
  }
}

// ============================================================
// PORTAL COLOURS
// ============================================================
const PORTAL_COLOURS = [
  ['#00ccff', '#0044ff', '#00ffcc'],
  ['#cc00ff', '#ff00aa', '#8800ff'],
  ['#ff6600', '#ffcc00', '#ff0066'],
  ['#00ff66', '#00ccaa', '#66ff00'],
  ['#ff00ff', '#cc00cc', '#ff66ff'],
  ['#ffaa00', '#ff6600', '#ffcc44'],
  ['#00ffff', '#0088ff', '#44ffee'],
  ['#ff3300', '#ff0066', '#ff6600'],
  ['#aaffaa', '#00ff44', '#88ff00'],
  ['#aa44ff', '#6600cc', '#cc88ff']
];

function getPortalColour(index) {
  return PORTAL_COLOURS[index % PORTAL_COLOURS.length];
}

function drawPixelPortal(canvas, colours) {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  let frame = 0;

  function render() {
    ctx.clearRect(0, 0, size, size);

    // Outer glow ring
    const grad = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r);
    grad.addColorStop(0, colours[0] + 'aa');
    grad.addColorStop(0.7, colours[1] + '66');
    grad.addColorStop(1, colours[2] + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Pixelated swirl rings
    const pixelSize = 6;
    const rings = 5;
    for (let ring = 0; ring < rings; ring++) {
      const ringR = (ring + 1) * (r / rings);
      const dots = Math.floor(2 * Math.PI * ringR / pixelSize);
      for (let d = 0; d < dots; d++) {
        const angle = (d / dots) * Math.PI * 2 + frame * 0.04 * (ring % 2 === 0 ? 1 : -1) + ring * 0.3;
        const px = cx + Math.cos(angle) * ringR;
        const py = cy + Math.sin(angle) * ringR;
        const bright = (Math.sin(angle * 3 + frame * 0.08) + 1) / 2;
        const alpha = 0.4 + bright * 0.6;
        ctx.fillStyle = colours[ring % colours.length] + Math.floor(alpha * 255).toString(16).padStart(2, '0');
        ctx.fillRect(
          Math.floor(px / pixelSize) * pixelSize,
          Math.floor(py / pixelSize) * pixelSize,
          pixelSize - 1, pixelSize - 1
        );
      }
    }

    // Center vortex
    const innerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.35);
    innerGrad.addColorStop(0, '#ffffff22');
    innerGrad.addColorStop(0.5, colours[0] + '44');
    innerGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = innerGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
    ctx.fill();

    frame++;
    requestAnimationFrame(render);
  }
  render();
}

// ============================================================
// WORLD MAP — INDEX.HTML
// ============================================================
function _renderCalendarWidget(containerId) {
  const el = document.getElementById(containerId);
  if (!el || !db.calendar?.events?.length) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = today.toISOString().slice(0,10);
  const upcoming = (db.calendar.events || [])
    .filter(e => e.date >= todayStr)
    .sort((a,b) => a.date.localeCompare(b.date))
    .slice(0,4);
  if (!upcoming.length) { el.style.display = 'none'; return; }
  const _CAL_COLOURS = { exam:'#e74c3c', deadline:'#e67e22', study:'#3498db', assignment:'#9b59b6', other:'#c9a84c' };
  el.innerHTML = '<div class="widget-title">📅 Upcoming</div>' + upcoming.map(ev => {
    const d = new Date(ev.date + 'T00:00:00');
    const diff = Math.round((d - today) / 86400000);
    const label = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `${diff} days`;
    const colour = ev.colour || _CAL_COLOURS[ev.type] || '#c9a84c';
    return `<div class="widget-event" onclick="window.location.href='calendar.html'">
      <span class="widget-dot" style="background:${colour}"></span>
      <span class="widget-event-name">${ev.title}</span>
      <span class="widget-event-when">${label}</span>
    </div>`;
  }).join('');
  el.style.display = '';
}

function renderWorldMap() {
  const grid = document.getElementById('portalGrid');
  const empty = document.getElementById('emptyMap');
  if (!grid) return;
  grid.innerHTML = '';
  _renderCalendarWidget('calendarWidget');

  // Only show top-level folders
  const topLevel = Object.keys(db.folders).filter(f => !db.folders[f].parent);

  if (topLevel.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  topLevel.forEach((folderName, i) => {
    grid.appendChild(createPortalElement(folderName, i, false));
  });

  updateParentFolderSelect();

  // Practice Chamber tile — always visible on home page
  const practiceWrap = document.createElement('div');
  practiceWrap.className = 'portal-wrap practice-home-tile';
  practiceWrap.onclick = () => { window.location.href = 'practice.html'; };
  practiceWrap.innerHTML = `
    <div class="practice-home-icon">✍️</div>
    <div class="portal-name">Practice Chamber</div>
    <div class="portal-meta">${Object.keys(db.practiceBooks || {}).length} book${Object.keys(db.practiceBooks || {}).length !== 1 ? 's' : ''}</div>`;
  grid.appendChild(practiceWrap);
}

function createPortalElement(folderName, colourIndex, isSmall) {
  const colours = getPortalColour(colourIndex);
  const wrap = document.createElement('div');
  wrap.className = 'portal-wrap';

  const portal = document.createElement('div');
  portal.className = 'portal' + (isSmall ? ' small' : '');
  portal.style.color = colours[0];

  const size = isSmall ? 90 : 130;
  const canvas = document.createElement('canvas');
  canvas.className = 'portal-canvas';
  canvas.width = size;
  canvas.height = size;
  portal.appendChild(canvas);

  const delBtn = document.createElement('button');
  delBtn.className = 'portal-delete';
  delBtn.textContent = '✕';
  delBtn.onclick = (e) => { e.stopPropagation(); deleteFolder(folderName); };
  portal.appendChild(delBtn);

  const menuBtn = document.createElement('button');
  menuBtn.className = 'portal-menu-btn';
  menuBtn.textContent = '⋯';
  menuBtn.title = 'Realm actions';
  menuBtn.onclick = (e) => showPortalMenu(e, folderName);
  portal.appendChild(menuBtn);

  const name = document.createElement('div');
  name.className = 'portal-name';
  name.textContent = folderName;

  const meta = document.createElement('div');
  meta.className = 'portal-meta';
  const folder = db.folders[folderName];
  const subCount = Object.keys(db.folders).filter(f => db.folders[f].parent === folderName).length;
  const deckCount = folder.decks ? folder.decks.length : 0;
  meta.textContent = `${deckCount} tome${deckCount !== 1 ? 's' : ''} · ${subCount} realm${subCount !== 1 ? 's' : ''}`;

  wrap.appendChild(portal);
  wrap.appendChild(name);
  wrap.appendChild(meta);

  wrap.onclick = () => {
    window.location.href = `folder.html?folder=${encodeURIComponent(folderName)}`;
  };

  requestAnimationFrame(() => drawPixelPortal(canvas, colours));
  return wrap;
}

function updateParentFolderSelect() {
  const sel = document.getElementById('parentFolderSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— World Map (top level) —</option>';
  Object.keys(db.folders).forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    sel.appendChild(opt);
  });
}

function showCreateFolder() {
  updateParentFolderSelect();
  document.getElementById('createModal').style.display = 'flex';
}

function hideCreateFolder() {
  document.getElementById('createModal').style.display = 'none';
}

function createFolder() {
  const name = document.getElementById('newFolderName').value.trim();
  const parent = document.getElementById('parentFolderSelect').value;
  if (!name) return;

  db.folders[name] = { decks: [], parent: parent || null, colourIndex: Object.keys(db.folders).length };
  saveDB();
  hideCreateFolder();
  document.getElementById('newFolderName').value = '';
  renderWorldMap();
}

function deleteFolder(name) {
  showConfirm(
    `Delete Realm "${name}"`,
    `All tomes inside will be permanently deleted. This cannot be undone.`,
    () => {
      const folder = db.folders[name];
      if (folder && folder.decks) {
        folder.decks.forEach(deckName => {
          if (db.decks[deckName]) {
            const pct = getDeckMastery(deckName);
            if (pct === 100) {
              if (!db.masteryHall) db.masteryHall = [];
              if (!db.masteryHall.some(h => h.name === deckName)) {
                db.masteryHall.push({ name: deckName, mastered: todayStr(), cards: db.decks[deckName].cards.length });
              }
            }
            delete db.decks[deckName];
          }
        });
      }
      Object.keys(db.folders).forEach(f => {
        if (db.folders[f].parent === name) db.folders[f].parent = null;
      });
      delete db.folders[name];
      saveDB();
      if (document.querySelector('.folder-page')) loadFolderPage();
      else renderWorldMap();
    },
    { icon: '🗑️', confirmText: '🗑 Delete Realm', danger: true }
  );
}

// ============================================================
// DAILY QUESTS
// ============================================================
const QUEST_POOL = [
  { text: 'Study 20 cards', target: 20, type: 'cards', xpBonus: 5 },
  { text: 'Study 50 cards', target: 50, type: 'cards', xpBonus: 15 },
  { text: 'Get 5 greens in a row', target: 5, type: 'streak', xpBonus: 8 },
  { text: 'Get 10 greens in a row', target: 10, type: 'streak', xpBonus: 20 },
  { text: 'Study for 15 minutes', target: 15 * 60, type: 'time', xpBonus: 10 },
  { text: 'Answer 30 cards total', target: 30, type: 'cards', xpBonus: 8 },
  { text: 'Get 3 greens in a row', target: 3, type: 'streak', xpBonus: 4 },
  { text: 'Slay 3 Battle Cards today', target: 3, type: 'battle', xpBonus: 50 },
];

function generateDailyQuests() {
  const today = todayStr();
  if (db.quests.date === today && db.quests.list.length > 0) return;
  const shuffled = [...QUEST_POOL].sort(() => Math.random() - 0.5);
  db.quests = {
    date: today,
    list: shuffled.slice(0, 3).map(q => ({ ...q, done: false, progress: 0 }))
  };
  saveDB();
}

function renderDailyQuests() {
  generateDailyQuests();
  const list = document.getElementById('questList');
  if (!list) return;
  list.innerHTML = '';
  db.quests.list.forEach((q, i) => {
    const item = document.createElement('div');
    item.className = 'quest-item' + (q.done ? ' done' : '');
    item.innerHTML = `
      <span>${q.done ? '✅' : '📜'}</span>
      <span>${q.text}</span>
      <span class="quest-xp">+${q.xpBonus} XP</span>
    `;
    list.appendChild(item);
  });
}

function updateQuestProgress(type, amount) {
  if (!db.quests.list) return;
  db.quests.list.forEach((q, i) => {
    if (q.done) return;
    if (q.type === type) {
      if (type === 'streak') {
        if (amount >= q.target) { completeQuest(i); }
      } else {
        q.progress = (q.progress || 0) + amount;
        if (q.progress >= q.target) completeQuest(i);
      }
    }
  });
}

function completeQuest(index) {
  const q = db.quests.list[index];
  if (q.done) return;
  q.done = true;
  addXP(q.xpBonus);
  saveDB();
  showToast('📜', 'Quest Complete!', q.text);
}

// ============================================================
// DAILY GOAL
// ============================================================
function renderDailyGoal() {
  const fill = document.getElementById('goalFill');
  const text = document.getElementById('goalText');
  if (!fill || !text) return;
  const goal = db.settings.dailyGoal || 20;
  const done = db.stats.cardsStudiedToday || 0;
  const pct = Math.min(100, (done / goal) * 100);
  fill.style.width = pct + '%';
  text.textContent = `${done} / ${goal} cards`;
}

// ============================================================
// FOLDER PAGE — FOLDER.HTML
// ============================================================
function loadFolderPage() {
  const params = new URLSearchParams(window.location.search);
  const folderName = params.get('folder');
  if (!folderName || !db.folders[folderName]) {
    window.location.href = 'index.html';
    return;
  }

  const folder = db.folders[folderName];
  document.getElementById('folderTitle').textContent = folderName;
  document.title = `Scholar's Sanctum — ${folderName}`;

  // Breadcrumb
  renderBreadcrumb(folderName);

  // Sub-folders
  const subGrid = document.getElementById('subPortalGrid');
  const subLabel = document.getElementById('subFolderLabel');
  const subFolders = Object.keys(db.folders).filter(f => db.folders[f].parent === folderName);

  if (subFolders.length > 0) {
    subLabel.style.display = 'block';
    subFolders.forEach((sf, i) => {
      subGrid.appendChild(createPortalElement(sf, db.folders[sf].colourIndex || i, true));
    });
  }

  // Decks
  const deckGrid = document.getElementById('deckGrid');
  const deckLabel = document.getElementById('deckLabel');
  const decks = folder.decks || [];

  if (decks.length > 0) {
    deckLabel.style.display = 'block';
    decks.forEach(deckName => {
      if (!db.decks[deckName]) return;
      const tile = createDeckTile(deckName, folderName);
      deckGrid.appendChild(tile);
    });
  }

  const empty = document.getElementById('emptyFolder');
  if (subFolders.length === 0 && decks.length === 0) {
    if (empty) empty.style.display = 'block';
  }
}

function renderBreadcrumb(folderName) {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  const parts = [{ name: '🗺️ World', href: 'index.html' }];

  // Build ancestry chain
  let current = folderName;
  const chain = [];
  while (current) {
    chain.unshift(current);
    current = db.folders[current] ? db.folders[current].parent : null;
  }

  chain.forEach((f, i) => {
    if (i < chain.length - 1) {
      parts.push({ name: f, href: `folder.html?folder=${encodeURIComponent(f)}` });
    } else {
      parts.push({ name: f, href: null });
    }
  });

  bc.innerHTML = parts.map((p, i) =>
    p.href
      ? `<a href="${p.href}">${p.name}</a>${i < parts.length - 1 ? ' → ' : ''}`
      : `<span>${p.name}</span>`
  ).join('');
}

function createDeckTile(deckName, folderName) {
  const deck = db.decks[deckName];
  const tile = document.createElement('div');
  tile.className = 'deck-tile';

  const mastery = getDeckMastery(deckName);
  const svg = createMasteryRingSVG(mastery);

  const delBtn = document.createElement('button');
  delBtn.className = 'deck-delete-btn';
  delBtn.textContent = '✕';
  delBtn.onclick = (e) => {
    e.stopPropagation();
    showConfirm(
      `Delete Tome "${deckName}"`,
      'This will permanently delete all cards and progress in this deck.',
      () => {
        const pct = getDeckMastery(deckName);
        if (pct === 100) {
          if (!db.masteryHall) db.masteryHall = [];
          if (!db.masteryHall.some(h => h.name === deckName)) {
            db.masteryHall.push({ name: deckName, mastered: new Date().toISOString().slice(0, 10), cards: db.decks[deckName].cards.length });
          }
        }
        db.folders[folderName].decks = db.folders[folderName].decks.filter(d => d !== deckName);
        delete db.decks[deckName];
        saveDB();
        tile.remove();
      },
      { icon: '📖', confirmText: '🗑 Delete Tome', danger: true }
    );
  };

  const menuBtn = document.createElement('button');
  menuBtn.className = 'deck-menu-btn';
  menuBtn.textContent = '⋯';
  menuBtn.title = 'Deck actions';
  menuBtn.onclick = (e) => showDeckMenu(e, deckName);

  tile.innerHTML = `
    <div class="deck-mastery-ring">${svg}</div>
    <div class="deck-tile-name">${deckName}</div>
    <div class="deck-tile-count">${deck.cards ? deck.cards.length : 0} cards · ${mastery}% mastered</div>
  `;
  const aiBtn = document.createElement('button');
  aiBtn.className = 'deck-ai-duel-btn';
  aiBtn.textContent = '⚔ AI';
  aiBtn.title = 'AI Duel this deck';
  aiBtn.onclick = (e) => {
    e.stopPropagation();
    window.location.href = `duel.html?aiduel=${encodeURIComponent(deckName)}`;
  };

  tile.appendChild(delBtn);
  tile.appendChild(menuBtn);
  tile.appendChild(aiBtn);
  tile.onclick = () => {
    window.location.href = `deck.html?deck=${encodeURIComponent(deckName)}`;
  };
  return tile;
}

function createMasteryRingSVG(pct) {
  const r = 26, circ = 2 * Math.PI * r;
  const fill = (pct / 100) * circ;
  return `<svg viewBox="0 0 60 60" width="60" height="60">
    <circle cx="30" cy="30" r="${r}" fill="none" stroke="rgba(201,168,76,0.15)" stroke-width="5"/>
    <circle cx="30" cy="30" r="${r}" fill="none" stroke="url(#gold)" stroke-width="5"
      stroke-dasharray="${fill} ${circ}" stroke-linecap="round"
      transform="rotate(-90 30 30)"/>
    <defs>
      <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#8a6a1a"/>
        <stop offset="100%" stop-color="#f0d080"/>
      </linearGradient>
    </defs>
    <text x="30" y="35" text-anchor="middle" fill="#c9a84c"
      font-family="Cinzel,serif" font-size="10">${pct}%</text>
  </svg>`;
}

function getDeckMastery(deckName) {
  const deck = db.decks[deckName];
  if (!deck || !deck.cards || deck.cards.length === 0) return 0;
  const mastered = deck.cards.filter(c => c.mastered).length;
  return Math.round((mastered / deck.cards.length) * 100);
}

// Create sub-folder
function showCreateSubFolder() {
  document.getElementById('createSubModal').style.display = 'flex';
}

function hideCreateSubFolder() {
  document.getElementById('createSubModal').style.display = 'none';
}

function createSubFolder() {
  const params = new URLSearchParams(window.location.search);
  const parentName = params.get('folder');
  const name = document.getElementById('newSubFolderName').value.trim();
  if (!name) return;
  db.folders[name] = { decks: [], parent: parentName, colourIndex: Object.keys(db.folders).length };
  saveDB();
  hideCreateSubFolder();
  location.reload();
}

// Create deck in folder
function showCreateDeck() {
  document.getElementById('createDeckModal').style.display = 'flex';
}

function hideCreateDeck() {
  document.getElementById('createDeckModal').style.display = 'none';
}

function createDeckInFolder() {
  const params = new URLSearchParams(window.location.search);
  const folderName = params.get('folder');
  const name = document.getElementById('newDeckName').value.trim();
  if (!name) return;

  db.decks[name] = { cards: [], rag: { ...db.rag } };
  if (!db.folders[folderName].decks) db.folders[folderName].decks = [];
  db.folders[folderName].decks.push(name);
  saveDB();
  hideCreateDeck();
  location.reload();
}

function confirmDeleteFolder() {
  const params = new URLSearchParams(window.location.search);
  const folderName = params.get('folder');
  deleteFolder(folderName);
  window.location.href = 'index.html';
}

// ============================================================
// FOLDER (REALM) CLIPBOARD — COPY / PASTE
// ============================================================
let clipboardFolder = null;
let activePortalMenu = null;

function _loadClipboards() {
  try {
    const fc = sessionStorage.getItem('clipboardFolder');
    if (fc) clipboardFolder = JSON.parse(fc);
    const dc = sessionStorage.getItem('clipboardDeck');
    if (dc) clipboardDeck = JSON.parse(dc);
  } catch (e) {}
  _updatePasteButtons();
}

function _updatePasteButtons() {
  // Realm paste button (index.html / folder.html action bar)
  const rpb = document.getElementById('pasteRealmBtn');
  if (rpb) rpb.style.display = clipboardFolder ? 'inline-flex' : 'none';
  // Deck paste button (folder.html action bar)
  const dpb = document.getElementById('pasteDeckBtn2');
  if (dpb) dpb.style.display = clipboardDeck ? 'inline-flex' : 'none';
}

function copyFolder(folderName) {
  if (!db.folders[folderName]) return;
  clipboardFolder = {
    name: folderName,
    folder: JSON.parse(JSON.stringify(db.folders[folderName])),
    decks: {}
  };
  (db.folders[folderName].decks || []).forEach(deckName => {
    if (db.decks[deckName])
      clipboardFolder.decks[deckName] = JSON.parse(JSON.stringify(db.decks[deckName]));
  });
  sessionStorage.setItem('clipboardFolder', JSON.stringify(clipboardFolder));
  showToast('📋', 'Realm Copied', `"${folderName}" ready to paste`);
  _updatePasteButtons();
  hidePortalMenu();
}

function pasteFolder(parentName) {
  if (!clipboardFolder) { showToast('❌', 'Nothing to Paste', 'Copy a realm first'); return; }

  let newName = clipboardFolder.name + ' (Copy)';
  let n = 2;
  while (db.folders[newName]) newName = `${clipboardFolder.name} (Copy ${n++})`;

  db.folders[newName] = {
    decks: [],
    parent: parentName || null,
    colourIndex: Object.keys(db.folders).length
  };

  (clipboardFolder.folder.decks || []).forEach(deckName => {
    let newDeckName = deckName + ' (Copy)';
    let d = 2;
    while (db.decks[newDeckName]) newDeckName = `${deckName} (Copy ${d++})`;
    db.decks[newDeckName] = JSON.parse(JSON.stringify(
      clipboardFolder.decks[deckName] || { cards: [] }
    ));
    db.folders[newName].decks.push(newDeckName);
  });

  saveDB();
  showToast('📥', 'Realm Pasted', `"${newName}" summoned`);
  hidePortalMenu();
  location.reload();
}

// Called from action-bar paste button — pastes as child of current folder (or top-level on index)
function pasteRealmHere() {
  const params = new URLSearchParams(window.location.search);
  const currentFolder = params.get('folder') || null;
  pasteFolder(currentFolder);
}

function showPortalMenu(event, folderName) {
  event.stopPropagation();
  hidePortalMenu();
  activePortalMenu = folderName;

  const modal = document.getElementById('portalMenuModal');
  const nameEl = document.getElementById('portalMenuName');
  const pasteBtn = document.getElementById('portalMenuPaste');
  if (!modal) return;

  if (nameEl) nameEl.textContent = folderName;
  if (pasteBtn) pasteBtn.style.display = clipboardFolder ? 'block' : 'none';
  modal.style.display = 'flex';
}

function hidePortalMenu() {
  const modal = document.getElementById('portalMenuModal');
  if (modal) modal.style.display = 'none';
  activePortalMenu = null;
}

// Modal paste button — same behaviour as action-bar paste
function executePasteFolder() { pasteRealmHere(); }

// ============================================================
// DECK CLIPBOARD — COPY / PASTE / MOVE
// ============================================================
let clipboardDeck = null;

function copyDeck(deckName) {
  if (!db.decks[deckName]) return;
  clipboardDeck = { name: deckName, data: JSON.parse(JSON.stringify(db.decks[deckName])) };
  sessionStorage.setItem('clipboardDeck', JSON.stringify(clipboardDeck));
  showToast('📋', 'Copied', `"${deckName}" ready to paste`);
  _updatePasteButtons();
  hideDeckMenu();
}

function pasteDeck() {
  const params = new URLSearchParams(window.location.search);
  const folderName = params.get('folder');
  if (!clipboardDeck) { showToast('❌', 'Nothing to Paste', 'Copy a deck first'); return; }
  if (!db.folders[folderName]) return;

  let newName = clipboardDeck.name + ' (Copy)';
  let n = 2;
  while (db.decks[newName]) newName = `${clipboardDeck.name} (Copy ${n++})`;

  db.decks[newName] = JSON.parse(JSON.stringify(clipboardDeck.data));
  if (!db.folders[folderName].decks) db.folders[folderName].decks = [];
  db.folders[folderName].decks.push(newName);
  saveDB();
  showToast('📥', 'Pasted', `"${newName}" added to this realm`);
  hideDeckMenu();
  location.reload();
}

function moveDeck(deckName, targetFolderName) {
  if (!deckName || !targetFolderName || !db.folders[targetFolderName]) return;
  Object.keys(db.folders).forEach(f => {
    if (db.folders[f].decks) {
      db.folders[f].decks = db.folders[f].decks.filter(d => d !== deckName);
    }
  });
  if (!db.folders[targetFolderName].decks) db.folders[targetFolderName].decks = [];
  db.folders[targetFolderName].decks.push(deckName);
  saveDB();
  showToast('🚀', 'Moved', `"${deckName}" → ${targetFolderName}`);
  hideDeckMenu();
  location.reload();
}

let activeDeckMenu = null;

function showDeckMenu(event, deckName) {
  event.stopPropagation();
  hideDeckMenu();

  const modal = document.getElementById('deckMenuModal');
  const nameEl = document.getElementById('deckMenuName');
  const moveSelect = document.getElementById('moveFolderSelect');
  const pasteBtn = document.getElementById('deckMenuPaste');

  if (!modal) return;
  activeDeckMenu = deckName;
  if (nameEl) nameEl.textContent = deckName;

  // Populate move-to folders (exclude current)
  const params = new URLSearchParams(window.location.search);
  const currentFolder = params.get('folder');
  if (moveSelect) {
    moveSelect.innerHTML = '<option value="">— Select realm —</option>';
    Object.keys(db.folders).filter(f => f !== currentFolder).forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      moveSelect.appendChild(opt);
    });
  }

  // Show paste button only if clipboard has something
  if (pasteBtn) pasteBtn.style.display = clipboardDeck ? 'block' : 'none';

  modal.style.display = 'flex';
}

function hideDeckMenu() {
  const modal = document.getElementById('deckMenuModal');
  if (modal) modal.style.display = 'none';
  activeDeckMenu = null;
}

function executeCopyActive() { if (activeDeckMenu) copyDeck(activeDeckMenu); }

function executeMoveActive() {
  const sel = document.getElementById('moveFolderSelect');
  if (!sel || !sel.value) { showToast('⚠️', 'Select a realm', 'Choose a destination realm first'); return; }
  moveDeck(activeDeckMenu, sel.value);
}

// ============================================================
// STUDY ENGINE — DECK.HTML
// ============================================================
let currentDeck = null;
let currentDeckName = '';
let queue = [];
let queueIndex = 0;
let isFlipped = false;
let cardsAnsweredThisSession = 0;
let timerInterval = null, stopwatchInterval = null;
let timerSeconds = 0, stopwatchSeconds = 0;
let speedStart = 0, speedInterval = null;
let sessionRed = 0, sessionAmber = 0, sessionGreen = 0;
let sessionStartTime = 0, sessionXPearned = 0;
let lastMarked = null;
let dueOnlyMode = false;
let storageWarningShown = false;
let battleCardMode = false;
let battleCardIndex = -1;

// Called from the ⚔ AI Duel button on deck.html
function startAIDuelFromDeck() {
  if (!currentDeckName || !currentDeck) {
    showToast('⚠', 'No Deck', 'Open a deck first.'); return;
  }
  if (!_getAIKey()) {
    showToast('🤖', 'No API Key', 'Add your Claude API key in Settings → AI Tutor first.'); return;
  }
  window.location.href = `duel.html?aiduel=${encodeURIComponent(currentDeckName)}`;
}

function loadDeckFromURL() {
  const params = new URLSearchParams(window.location.search);
  currentDeckName = params.get('deck');
  currentDeck = db.decks[currentDeckName];

  if (!currentDeck) {
    alert('Deck not found!');
    window.location.href = 'index.html';
    return;
  }

  document.title = `Scholar's Sanctum — ${currentDeckName}`;
  const titleEl = document.getElementById('deckStudyTitle');
  if (titleEl) titleEl.textContent = currentDeckName;

  // Set back button to correct folder
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    // Find which folder this deck belongs to
    const folderName = Object.keys(db.folders).find(f =>
      db.folders[f].decks && db.folders[f].decks.includes(currentDeckName)
    );
    if (folderName) {
      backBtn.href = `folder.html?folder=${encodeURIComponent(folderName)}`;
    }
  }

  // Ensure deck has RAG settings
  if (!currentDeck.rag) currentDeck.rag = { ...db.rag };

  // Load RAG inputs
  const rr = document.getElementById('ragRed');
  const ra = document.getElementById('ragAmber');
  const rg = document.getElementById('ragGreen');
  if (rr) rr.value = currentDeck.rag.red;
  if (ra) ra.value = currentDeck.rag.amber;
  if (rg) rg.value = currentDeck.rag.green;
}

function startStudyMode() {
  if (!currentDeck) return;

  if (!currentDeck.cards || currentDeck.cards.length === 0) {
    currentDeck.cards = [{
      front: 'This deck is empty',
      back: 'Add cards using the Edit panel below',
      due: 0, mastered: false
    }];
    saveDB();
  }

  buildQueue();
  renderCard();
  updateXPBar();
  updateFlame();

  // Update streak
  checkDailyStreak();

  // Init session tracking
  sessionRed = 0; sessionAmber = 0; sessionGreen = 0;
  sessionStartTime = Date.now(); sessionXPearned = 0;
  lastMarked = null;
  checkStorageSize();
  _initSwipeGestures();

  // Draw rank badge and island
  updateRankDisplay();
  const islandEl = document.getElementById('islandCanvas');
  if (islandEl) drawPixelIsland(islandEl);

  // Start speed mode if enabled
  if (db.settings.speedMode) startSpeedTimer();
}

function buildQueue() {
  let cards = currentDeck.cards.map((c, i) => ({ ...c, index: i }));
  if (dueOnlyMode) cards = cards.filter(c => (c.due || 0) <= Date.now());
  if (activeTagFilter) cards = cards.filter(c => (c.tags || []).includes(activeTagFilter));
  if (cramMode) cards = cards.sort(() => Math.random() - 0.5);
  else queue = cards.sort((a, b) => (a.due || 0) - (b.due || 0));
  queue = cards;
  queueIndex = 0;
  updateCardCounter();
}

function updateCardCounter() {
  const el = document.getElementById('cardCounter');
  if (!el || !currentDeck) return;
  const due = currentDeck.cards.filter(c => (c.due || 0) <= Date.now()).length;
  el.textContent = dueOnlyMode
    ? `${queue.length} due · ${currentDeck.cards.length} total`
    : `${queue.length} cards · ${due} due today`;
}

function renderCard() {
  if (!queue.length) return;
  const card = queue[queueIndex];
  isFlipped = false;

  const inner = document.getElementById('cardInner');
  if (inner) inner.classList.remove('flipped');

  const frontContent = document.getElementById('cardFrontContent');
  const backContent = document.getElementById('cardBackContent');
  const frontImg = document.getElementById('cardFrontImg');
  const backImg = document.getElementById('cardBackImg');

  if (frontContent) { frontContent.innerHTML = parseMarkdown(card.front || ''); _renderMath(frontContent); }
  if (backContent)  { backContent.innerHTML  = parseMarkdown(card.back  || ''); _renderMath(backContent); }

  if (frontImg) {
    frontImg.innerHTML = card.frontImg
      ? `<img src="${card.frontImg}" alt="front image">`
      : '';
  }
  if (backImg) {
    backImg.innerHTML = card.backImg
      ? `<img src="${card.backImg}" alt="back image">`
      : '';
  }

  // Battle card visual indicator
  const flashcard = document.getElementById('flashcard');
  if (flashcard) {
    if (battleCardMode) {
      flashcard.classList.add('battle-card');
      const battleBadge = document.getElementById('battleBadge') || (() => {
        const badge = document.createElement('div');
        badge.id = 'battleBadge';
        badge.className = 'battle-badge';
        badge.textContent = '⚔️ BATTLE';
        flashcard.appendChild(badge);
        return badge;
      })();
    } else {
      flashcard.classList.remove('battle-card');
      const badge = document.getElementById('battleBadge');
      if (badge) badge.remove();
    }
  }

  // Fill edit fields
  const ef = document.getElementById('editFront');
  const eb = document.getElementById('editBack');
  const et = document.getElementById('editTags');
  if (ef) ef.value = card.front || '';
  if (eb) eb.value = card.back || '';
  if (et) et.value = (card.tags || []).join(', ');

  // Per-card stats, tag chips, multiple choice
  renderCardStatsPanel();
  renderTagChips();
  if (multipleChoiceMode && currentDeck) {
    const orig = currentDeck.cards[card.index];
    renderMultipleChoice(orig?.back || '');
  } else {
    const mc = document.getElementById('mcOptions');
    if (mc) { mc.style.display = 'none'; mc.innerHTML = ''; }
  }

  // Speed mode
  if (db.settings.speedMode) {
    speedStart = Date.now();
    clearInterval(speedInterval);
    const disp = document.getElementById('speedTimerDisplay');
    const st = document.getElementById('speedTimer');
    if (st) st.style.display = 'block';
    speedInterval = setInterval(() => {
      if (disp) disp.textContent = ((Date.now() - speedStart) / 1000).toFixed(1) + 's';
    }, 100);
  }
}

let _lastFlipTime = 0;
function flipCard(e) {
  // Prevent double-flip on mobile (touchend fires synthetic click ~300ms later)
  if (e && e.type === 'click' && (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) return;
  const now = Date.now();
  if (now - _lastFlipTime < 350) return; // debounce: one flip per 350ms
  _lastFlipTime = now;
  const inner = document.getElementById('cardInner');
  if (!inner) return;
  isFlipped = !isFlipped;
  inner.classList.toggle('flipped', isFlipped);
}

function nextCard() {
  queueIndex = (queueIndex + 1) % queue.length;
  renderCard();
}

function prevCard() {
  queueIndex = (queueIndex - 1 + queue.length) % queue.length;
  renderCard();
}

function shuffleDeck() {
  queue.sort(() => Math.random() - 0.5);
  queueIndex = 0;
  renderCard();
}

// ============================================================
// RAG MARKING (SM-2 spaced repetition)
// ============================================================
function mark(level) {
  if (!queue.length) return;
  const card = queue[queueIndex];
  const today = todayStr();
  const orig = currentDeck.cards[card.index];

  // Save undo snapshot
  lastMarked = {
    cardIndex: card.index,
    cardSnap: {
      due: orig.due, mastered: orig.mastered,
      interval: orig.interval, easeFactor: orig.easeFactor, repetitions: orig.repetitions
    },
    statsSnap: {
      ragCounts: { ...db.stats.ragCounts },
      cardsStudiedToday: db.stats.cardsStudiedToday,
      totalCardsStudied: db.stats.totalCardsStudied,
      greenStreak: db.stats.greenStreak,
      bestGreenStreak: db.stats.bestGreenStreak,
      todayDate: db.stats.todayDate
    },
    xpSnap: { level: db.xp.level, xp: db.xp.xp },
    today, heatmapCount: db.heatmap[today] || 0,
    sessionSnap: { red: sessionRed, amber: sessionAmber, green: sessionGreen, xp: sessionXPearned }
  };

  // Apply SM-2
  const qualityMap = { red: 0, amber: 3, green: 5 };
  const result = sm2(orig, qualityMap[level]);
  orig.due = result.due;
  orig.interval = result.interval;
  orig.easeFactor = result.easeFactor;
  orig.repetitions = result.repetitions;
  orig.mastered = level === 'green';
  // Track per-card mark history for retention
  orig.totalMarks = (orig.totalMarks || 0) + 1;
  orig.greenMarks = (orig.greenMarks || 0) + (level === 'green' ? 1 : 0);

  // Session tracking
  if (level === 'red') sessionRed++;
  else if (level === 'amber') sessionAmber++;
  else sessionGreen++;

  // Daily stats (fix: check date before incrementing)
  if (db.stats.todayDate !== today) {
    db.stats.cardsStudiedToday = 0;
    db.stats.todayDate = today;
  }
  db.stats.ragCounts[level]++;
  db.stats.cardsStudiedToday++;
  db.stats.totalCardsStudied++;
  db.heatmap[today] = (db.heatmap[today] || 0) + 1;

  if (level === 'green') {
    const xpReward = battleCardMode ? (Math.floor(Math.random() * 20) + 1) : 1;
    db.stats.greenStreak = (db.stats.greenStreak || 0) + 1;
    if (db.stats.greenStreak > (db.stats.bestGreenStreak || 0)) {
      db.stats.bestGreenStreak = db.stats.greenStreak;
    }
    addXP(xpReward);
    sessionXPearned += xpReward;
    if (battleCardMode) {
      showToast('⚔️', 'VICTORY!', `Battle card defeated! +${xpReward} XP`);
      battleCardMode = false;
      battleCardIndex = -1;
      db.stats.battleCardsDefeated = (db.stats.battleCardsDefeated || 0) + 1;
      updateQuestProgress('battle', 1);
    }
    if (db.settings.sound) playGreenSound();
    showMotivational(db.stats.greenStreak);
  } else {
    db.stats.greenStreak = 0;
  }

  updateQuestProgress('cards', 1);
  updateQuestProgress('streak', db.stats.greenStreak);

  if (db.settings.speedMode) {
    const elapsed = (Date.now() - speedStart) / 1000;
    db.stats.speedTimes = db.stats.speedTimes || [];
    db.stats.speedTimes.push(elapsed);
    clearInterval(speedInterval);
  }

  cardsAnsweredThisSession++;

  // Check for random card battle every 40 cards
  if (cardsAnsweredThisSession % 40 === 0 && !battleCardMode) {
    selectRandomBattleCard();
  }

  checkAchievements();
  saveDB();
  updateFlame();
  renderDailyGoal();
  buildQueue();
  nextCard();
}

function toggleRagActions() {
  const el = document.getElementById('ragActions');
  const btn = document.getElementById('ragToolsToggle');
  if (!el) return;
  const visible = el.classList.toggle('visible');
  if (btn) { btn.classList.toggle('active', visible); btn.textContent = visible ? '✕' : '⋯'; }
}

function undoLastMark() {
  if (!lastMarked) { showToast('↩️', 'Nothing to Undo', 'No recent rating to reverse'); return; }
  const { cardIndex, cardSnap, statsSnap, xpSnap, today, heatmapCount, sessionSnap } = lastMarked;
  Object.assign(currentDeck.cards[cardIndex], cardSnap);
  Object.assign(db.stats, statsSnap);
  db.xp.level = xpSnap.level;
  db.xp.xp = xpSnap.xp;
  db.heatmap[today] = heatmapCount;
  sessionRed = sessionSnap.red; sessionAmber = sessionSnap.amber;
  sessionGreen = sessionSnap.green; sessionXPearned = sessionSnap.xp;
  lastMarked = null;
  saveDB();
  buildQueue();
  queueIndex = Math.max(0, queue.findIndex(c => c.index === cardIndex));
  renderCard();
  updateFlame();
  updateXPBar();
  renderDailyGoal();
  showToast('↩️', 'Undone', 'Last rating reversed');
}

function selectRandomBattleCard() {
  if (!currentDeck || !currentDeck.cards.length) return;
  const randomIdx = Math.floor(Math.random() * currentDeck.cards.length);
  battleCardIndex = randomIdx;
  battleCardMode = true;
  showToast('⚔️', 'BATTLE CARD!', 'Next card is a challenge! Green = 1-20 XP');
}

function toggleDueFilter() {
  dueOnlyMode = !dueOnlyMode;
  buildQueue();
  renderCard();
  updateDueFilterBtn();
}

function updateDueFilterBtn() {
  const btn = document.getElementById('dueFilterBtn');
  if (!btn) return;
  btn.textContent = dueOnlyMode ? '📅 Due Only' : '📚 All Cards';
  btn.classList.toggle('active', dueOnlyMode);
}

function showSessionSummary() {
  _logSession();
  const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('sessionRedCount', sessionRed);
  set('sessionAmberCount', sessionAmber);
  set('sessionGreenCount', sessionGreen);
  set('sessionTotalCount', sessionRed + sessionAmber + sessionGreen);
  set('sessionTime', timeFormat(elapsed));
  set('sessionXP', sessionXPearned);
  const modal = document.getElementById('sessionModal');
  if (modal) modal.style.display = 'flex';
}

function hideSessionSummary() {
  const modal = document.getElementById('sessionModal');
  if (modal) modal.style.display = 'none';
}

function showResetModal() {
  const modal = document.getElementById('resetModal');
  if (modal) modal.style.display = 'flex';
}

function hideResetModal() {
  const modal = document.getElementById('resetModal');
  if (modal) modal.style.display = 'none';
}

function executeReset(type) {
  if (!currentDeck) return;
  if (type === 'all') {
    currentDeck.cards.forEach(c => {
      c.due = 0; c.mastered = false; c.interval = 0; c.easeFactor = 2.5; c.repetitions = 0;
    });
    showToast('🔄', 'Full Reset', 'All cards reset — starting fresh');
  } else if (type === 'unmastered') {
    currentDeck.cards.forEach(c => {
      if (!c.mastered) { c.due = 0; c.interval = 0; c.easeFactor = 2.5; c.repetitions = 0; }
    });
    showToast('🔴', 'Unmastered Reset', 'Unmastered cards rescheduled');
  } else if (type === 'schedule') {
    currentDeck.cards.forEach(c => { c.due = 0; c.interval = 0; c.repetitions = 0; });
    showToast('📅', 'Schedule Reset', 'Due dates reset — mastery kept');
  }
  saveDB(); buildQueue(); renderCard(); hideResetModal();
}

function showMotivational(streak) {
  const messages = {
    5: '🔥 5 in a row — you\'re on fire!',
    10: '⚡ 10 streak — unstoppable!',
    20: '🌟 20 streak — legendary!',
    50: '👑 50 STREAK — GODLIKE!',
  };
  const el = document.getElementById('motivational');
  if (!el) return;
  const msg = messages[streak];
  if (msg) {
    el.textContent = msg;
    el.style.animation = 'none';
    requestAnimationFrame(() => {
      el.style.animation = 'motivFade 3s ease-out forwards';
    });
  }
}

// ============================================================
// XP SYSTEM
// ============================================================
function addXP(amount) {
  db.xp.xp += amount;
  db.stats.lifetimeXP = (db.stats.lifetimeXP || 0) + amount;

  const required = xpRequiredForLevel(db.xp.level);

  if (db.xp.xp >= required) {
    db.xp.xp -= required;
    db.xp.level++;
    db.stats.lifetimeLevels = (db.stats.lifetimeLevels || 0) + 1;
    document.body.setAttribute('data-card-theme', getCardTheme(db.xp.level));
    updateRankDisplay();

    // Check prestige
    if (db.xp.level > 100 && !db.settings.softPrestige) {
      triggerPrestige();
    } else {
      showLevelUp();
    }
  }
  updateXPBar();
}

function updateXPBar() {
  const level = db.xp.level;
  const xp = db.xp.xp;
  const required = xpRequiredForLevel(level);
  const pct = Math.min(100, (xp / required) * 100);

  const fills = document.querySelectorAll('.xp-fill');
  fills.forEach(f => f.style.width = pct + '%');

  const levelLabels = document.querySelectorAll('.xp-level-label');
  levelLabels.forEach(l => l.textContent = `Level ${level}`);

  const countLabels = document.querySelectorAll('.xp-count-label');
  countLabels.forEach(l => l.textContent = `${xp} / ${required} XP`);

  const curr = document.getElementById('xpCurrentText');
  const rem = document.getElementById('xpRemainingText');
  if (curr) curr.textContent = `Current experience: ${db.stats.lifetimeXP || xp}.`;
  if (rem) rem.textContent = `Remaining to level: ${required - xp}.`;
}

function showLevelUp() {
  const overlay = document.getElementById('levelupOverlay');
  if (!overlay) return;

  const level = db.xp.level;
  const rankEl = document.getElementById('levelupRank');
  const levelEl = document.getElementById('levelupLevel');

  if (levelEl) levelEl.textContent = `Level ${level}`;
  if (rankEl) rankEl.textContent = getTitle(level, db.stats.prestige || 0);

  overlay.style.display = 'flex';
  triggerParticleBurst();

  setTimeout(() => { overlay.style.display = 'none'; }, 3000);
}

function triggerPrestige() {
  db.stats.prestige = (db.stats.prestige || 0) + 1;
  db.xp.level = 1;
  db.xp.xp = 0;
  saveDB();
  showToast('👑', 'PRESTIGE!', `You are now ${getPrestigeLabel(db.stats.prestige)} Prestige ${db.stats.prestige}`);
}

// ============================================================
// PARTICLE BURST (level up)
// ============================================================
function triggerParticleBurst() {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const particles = [];
  for (let i = 0; i < 120; i++) {
    particles.push({
      x: canvas.width / 2, y: canvas.height / 2,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.5) * 14,
      life: 1, decay: 0.015 + Math.random() * 0.02,
      size: 3 + Math.random() * 6,
      color: ['#f0d080', '#c9a84c', '#fff8c0', '#ff9900', '#ffffff'][Math.floor(Math.random() * 5)]
    });
  }
  function animateBurst() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.3; p.life -= p.decay;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    if (particles.some(p => p.life > 0)) requestAnimationFrame(animateBurst);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  animateBurst();
}

// ============================================================
// FLAME (Blue animated)
// ============================================================
let flameFrame = 0;
let flameAnimating = false;

function drawFlame() {
  const canvas = document.getElementById('flameCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const streak = db.stats.greenStreak || 0;
  const flameColour = getFlameColour(streak);
  flameAnimating = true;

  function render() {
    ctx.clearRect(0, 0, W, H);
    const t = flameFrame * 0.06;
    const cx = W / 2;

    // Draw flame layers
    for (let layer = 3; layer >= 0; layer--) {
      const layerScale = 1 - layer * 0.15;
      const layerAlpha = 0.3 + layer * 0.2;
      const wobble = Math.sin(t + layer) * 6 * layerScale;

      ctx.beginPath();
      ctx.moveTo(cx, H);

      // Left side
      ctx.quadraticCurveTo(
        cx - 30 * layerScale + wobble, H * 0.7,
        cx - 20 * layerScale + wobble * 0.5, H * 0.45
      );
      ctx.quadraticCurveTo(
        cx - 25 * layerScale, H * 0.25 + Math.sin(t * 1.3) * 5,
        cx + wobble, H * 0.05
      );
      // Right side
      ctx.quadraticCurveTo(
        cx + 25 * layerScale, H * 0.25 + Math.cos(t * 1.1) * 5,
        cx + 20 * layerScale - wobble * 0.5, H * 0.45
      );
      ctx.quadraticCurveTo(
        cx + 30 * layerScale - wobble, H * 0.7,
        cx, H
      );
      ctx.closePath();

      const grad = ctx.createLinearGradient(cx, H, cx, 0);
      grad.addColorStop(0, flameColour.base + Math.floor(layerAlpha * 255).toString(16).padStart(2, '0'));
      grad.addColorStop(0.5, flameColour.mid + Math.floor(layerAlpha * 200).toString(16).padStart(2, '0'));
      grad.addColorStop(1, flameColour.tip + '33');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    flameFrame++;
    if (flameAnimating) requestAnimationFrame(render);
  }
  render();
}

// Draw flame on any canvas with a given streak value (used by AI duel)
function drawFlameOnCanvas(canvas, streak) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const colour = getFlameColour(streak || 0);
  ctx.clearRect(0, 0, W, H);
  const t = Date.now() * 0.001;
  const cx = W / 2;
  for (let layer = 3; layer >= 0; layer--) {
    const ls = 1 - layer * 0.15;
    const la = 0.3 + layer * 0.2;
    const wb = Math.sin(t + layer) * 6 * ls;
    ctx.beginPath();
    ctx.moveTo(cx, H);
    ctx.quadraticCurveTo(cx - 30*ls + wb, H*0.7, cx - 20*ls + wb*0.5, H*0.45);
    ctx.quadraticCurveTo(cx - 25*ls, H*0.25 + Math.sin(t*1.3)*5, cx + wb, H*0.05);
    ctx.quadraticCurveTo(cx + 25*ls, H*0.25 + Math.cos(t*1.1)*5, cx + 20*ls - wb*0.5, H*0.45);
    ctx.quadraticCurveTo(cx + 30*ls - wb, H*0.7, cx, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx, H, cx, 0);
    g.addColorStop(0, colour.base + Math.floor(la*255).toString(16).padStart(2,'0'));
    g.addColorStop(0.5, colour.mid + Math.floor(la*200).toString(16).padStart(2,'0'));
    g.addColorStop(1, colour.tip + '33');
    ctx.fillStyle = g; ctx.fill();
  }
}

function getFlameColour(streak) {
  if (streak >= 50) return { base: '#ff44ff', mid: '#ff00aa', tip: '#ffffff' }; // rainbow/magenta
  if (streak >= 20) return { base: '#ff4400', mid: '#ff8800', tip: '#ffdd00' }; // red/gold
  if (streak >= 10) return { base: '#ddaa00', mid: '#ffdd00', tip: '#ffffff' }; // gold
  if (streak >= 5)  return { base: '#aa00ff', mid: '#cc44ff', tip: '#eeccff' }; // purple
  return { base: '#0044ff', mid: '#44aaff', tip: '#aaddff' }; // blue (default)
}

function updateFlame() {
  const counter = document.getElementById('flameCounter');
  const best = document.getElementById('flameBest');
  if (counter) {
    counter.textContent = db.stats.greenStreak || 0;
    counter.style.animation = 'none';
    requestAnimationFrame(() => { counter.style.animation = 'counterPop 0.3s ease'; });
  }
  if (best) best.textContent = `Best: ${db.stats.bestGreenStreak || 0}`;
}

// ============================================================
// CARD EDIT / SAVE / DELETE
// ============================================================
let pendingFrontImg = null, pendingBackImg = null;

function loadFrontImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { pendingFrontImg = e.target.result; };
  reader.readAsDataURL(file);
}

function loadBackImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { pendingBackImg = e.target.result; };
  reader.readAsDataURL(file);
}

function saveCard() {
  if (!queue.length) return;
  const card = queue[queueIndex];
  const front = document.getElementById('editFront').value.trim();
  const back = document.getElementById('editBack').value.trim();

  currentDeck.cards[card.index].front = front;
  currentDeck.cards[card.index].back = back;
  if (pendingFrontImg) { currentDeck.cards[card.index].frontImg = pendingFrontImg; pendingFrontImg = null; }
  if (pendingBackImg) { currentDeck.cards[card.index].backImg = pendingBackImg; pendingBackImg = null; }

  queue[queueIndex] = { ...currentDeck.cards[card.index], index: card.index };
  saveDB();
  renderCard();
}

function deleteCard() {
  if (!queue.length) return;
  showConfirm(
    'Delete This Card',
    'This card will be permanently removed from the deck.',
    () => {
      const card = queue[queueIndex];
      currentDeck.cards.splice(card.index, 1);
      saveDB();
      buildQueue();
      if (queueIndex >= queue.length) queueIndex = 0;
      renderCard();
    },
    { icon: '🗑️', confirmText: '🗑 Delete Card', danger: true }
  );
}

function forgetCard() {
  if (!queue.length) return;
  const card = queue[queueIndex];
  Object.assign(currentDeck.cards[card.index], { due: 0, mastered: false, interval: 0, easeFactor: 2.5, repetitions: 0 });
  queue[queueIndex] = { ...currentDeck.cards[card.index], index: card.index };
  saveDB();
  showToast('🔁', 'Card Forgotten', 'Progress reset — card queued as new');
}

function forgetAllCards() {
  if (!currentDeck) return;
  const count = currentDeck.cards.length;
  showConfirm(
    'Forget All Cards',
    `Reset all ${count} cards to new? Every card's spaced repetition progress will be cleared.`,
    () => {
      currentDeck.cards.forEach(c => {
        c.due = 0; c.mastered = false; c.interval = 0; c.easeFactor = 2.5; c.repetitions = 0;
      });
      saveDB(); buildQueue(); renderCard();
      showToast('🔁', 'Deck Forgotten', `All ${count} cards reset to new`);
    },
    { icon: '🔁', confirmText: '🔁 Forget All', danger: true }
  );
}

function addNewCard() {
  currentDeck.cards.push({ front: 'New Card Front', back: 'New Card Back', due: 0, mastered: false });
  saveDB();
  buildQueue();
  queueIndex = queue.length - 1;
  renderCard();
}

function toggleEditPanel() {
  const panel = document.getElementById('editPanel');
  if (panel) panel.classList.toggle('hidden');
}

// ============================================================
// RAG SETTINGS PER DECK
// ============================================================
function saveRagSettings() {
  if (!currentDeck) return;
  currentDeck.rag = {
    red: parseInt(document.getElementById('ragRed').value) || 5,
    amber: parseInt(document.getElementById('ragAmber').value) || 10,
    green: parseInt(document.getElementById('ragGreen').value) || 50
  };
  saveDB();
  showToast('⚙', 'RAG Saved', 'Intervals updated for this deck');
}

function applyRagToAll() {
  if (!currentDeck) return;
  const rag = currentDeck.rag || db.rag;
  Object.keys(db.decks).forEach(d => { db.decks[d].rag = { ...rag }; });
  db.rag = { ...rag };
  saveDB();
  showToast('⚙', 'Applied to All', 'RAG intervals synced to all decks');
}

// ============================================================
// PASTE IMPORT
// ============================================================
function parseCardLine(line) {
  const sep = line.includes('—') ? '—' : (line.includes(' - ') ? ' - ' : null);
  if (!sep) return null;
  const parts = line.split(sep);
  const front = parts[0].trim();
  const back = parts.slice(1).join(sep).trim();
  if (!front || !back) return null;
  return { front, back, due: 0, mastered: false };
}

function previewImport() {
  const raw = document.getElementById('importBox').value.trim();
  const preview = document.getElementById('importPreview');
  const btn = document.getElementById('importConfirmBtn');
  preview.innerHTML = '';
  btn.style.display = 'none';
  if (!raw) { preview.innerHTML = '<p>Nothing to import.</p>'; return; }

  const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
  const valid = [], errors = [];
  lines.forEach((line, i) => {
    const c = parseCardLine(line);
    if (c) valid.push(c);
    else errors.push(`Line ${i + 1}: missing separator`);
  });

  let html = '';
  if (valid.length) {
    html += `<p style="color:#27ae60">${valid.length} cards ready to import:</p><ul>`;
    valid.slice(0, 5).forEach(c => { html += `<li><b>${c.front}</b> — ${c.back}</li>`; });
    if (valid.length > 5) html += `<li>...and ${valid.length - 5} more</li>`;
    html += '</ul>';
  }
  if (errors.length) { html += `<p style="color:#e74c3c">${errors.length} errors found.</p>`; }

  preview.innerHTML = html;
  if (valid.length) { btn.style.display = 'inline-block'; window.parsedCards = valid; }
}

function confirmImport() {
  if (!window.parsedCards || !currentDeck) return;
  window.parsedCards.forEach(c => currentDeck.cards.push(c));
  saveDB();
  buildQueue();
  renderCard();
  document.getElementById('importPreview').innerHTML = '<p style="color:#27ae60">✅ Imported successfully!</p>';
  document.getElementById('importBox').value = '';
  document.getElementById('importConfirmBtn').style.display = 'none';
}

// ============================================================
// TIMER
// ============================================================
function toggleTimerPanel() {
  const panel = document.getElementById('timerPanel');
  if (panel) panel.classList.toggle('hidden');
}

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerSeconds++;
    db.stats.totalStudyTime++;
    const d = document.getElementById('timerDisplay');
    const b = document.getElementById('timerBig');
    if (d) d.textContent = timeFormat(timerSeconds);
    if (b) b.textContent = timeFormat(timerSeconds);
    updateQuestProgress('time', 1);
    saveDB();
  }, 1000);
}

function stopTimer() { clearInterval(timerInterval); }

function resetTimer() {
  clearInterval(timerInterval);
  timerSeconds = 0;
  const d = document.getElementById('timerDisplay');
  const b = document.getElementById('timerBig');
  if (d) d.textContent = '00:00';
  if (b) b.textContent = '00:00';
}

function startStopwatch() {
  clearInterval(stopwatchInterval);
  stopwatchInterval = setInterval(() => {
    stopwatchSeconds++;
    const b = document.getElementById('stopwatchBig');
    if (b) b.textContent = timeFormat(stopwatchSeconds);
  }, 1000);
}

function stopStopwatch() { clearInterval(stopwatchInterval); }

function resetStopwatch() {
  clearInterval(stopwatchInterval);
  stopwatchSeconds = 0;
  const b = document.getElementById('stopwatchBig');
  if (b) b.textContent = '00:00';
}

function startSpeedTimer() {
  speedStart = Date.now();
  const st = document.getElementById('speedTimer');
  if (st) st.style.display = 'block';
  speedInterval = setInterval(() => {
    const d = document.getElementById('speedTimerDisplay');
    if (d) d.textContent = ((Date.now() - speedStart) / 1000).toFixed(1) + 's';
  }, 100);
}

// ============================================================
// STREAK
// ============================================================
function checkDailyStreak() {
  const today = todayStr();
  const last = db.stats.lastStudyDate;
  if (last !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (last === yesterday) {
      db.stats.streak = (db.stats.streak || 0) + 1;
    } else if (last !== today) {
      // Missed a day — use streak freeze if available
      if ((db.stats.streakFreezes || 0) > 0) {
        db.stats.streakFreezes--;
        showToast('🧊', 'Freeze Used!', 'Your streak freeze saved your streak!');
      } else {
        db.stats.streak = 1;
      }
    }
    db.stats.lastStudyDate = today;
    if (db.stats.streak > (db.stats.bestStreak || 0)) {
      db.stats.bestStreak = db.stats.streak;
    }
    saveDB();
  }
}

// ============================================================
// ACHIEVEMENTS
// ============================================================
const ACHIEVEMENTS = [
  { id: 'first_blood', icon: '🗡️', name: 'First Blood', desc: 'Answer your first card', check: s => s.totalCardsStudied >= 1 },
  { id: 'bookworm', icon: '📖', name: 'Bookworm', desc: 'Study 100 cards', check: s => s.totalCardsStudied >= 100 },
  { id: 'on_fire', icon: '🔥', name: 'On Fire', desc: '10 green streak', check: s => s.bestGreenStreak >= 10 },
  { id: 'sharpshooter', icon: '🎯', name: 'Sharpshooter', desc: '50 greens in a row', check: s => s.bestGreenStreak >= 50 },
  { id: 'unstoppable', icon: '🏆', name: 'Unstoppable', desc: '7 day study streak', check: s => s.streak >= 7 },
  { id: 'warrior', icon: '⚔️', name: 'Warrior Scholar', desc: 'Study 1000 cards', check: s => s.totalCardsStudied >= 1000 },
  { id: 'grand_master', icon: '👑', name: 'Grand Master', desc: 'Reach level 50', check: (s, xp) => xp.level >= 50 },
  { id: 'legendary', icon: '🌟', name: 'Legendary', desc: 'Reach level 75', check: (s, xp) => xp.level >= 75 },
  { id: 'final_boss', icon: '💀', name: 'The Final Boss', desc: 'Reach level 100', check: (s, xp) => xp.level >= 100 },
  { id: 'the_wizard', icon: '🧙', name: 'The Wizard', desc: 'Study 30 days in a row', check: s => s.streak >= 30 },
  { id: 'lightning', icon: '⚡', name: 'Lightning', desc: 'Answer a card under 3 seconds', check: s => (s.speedTimes || []).some(t => t < 3) },
  { id: 'prestige1', icon: '⚔️', name: 'Iron Scholar', desc: 'Reach Prestige 1', check: s => s.prestige >= 1 },
  { id: 'century', icon: '💯', name: 'Centurion', desc: 'Study 100 cards in one day', check: s => s.cardsStudiedToday >= 100 },
  { id: 'double_century', icon: '🔥', name: 'Inferno', desc: 'Study 200 cards in one day', check: s => s.cardsStudiedToday >= 200 },
  { id: 'half_k', icon: '🌪️', name: 'Maelstrom', desc: 'Study 500 cards in one day', check: s => s.cardsStudiedToday >= 500 },
  { id: 'thousand', icon: '☄️', name: 'Cataclysm', desc: 'Study 1000 cards in one day', check: s => s.cardsStudiedToday >= 1000 },
  // 15 new achievements
  { id: 'fortnight', icon: '🗓️', name: 'Fortnight', desc: '14 day study streak', check: s => s.streak >= 14 },
  { id: 'iron_will', icon: '💪', name: 'Iron Will', desc: 'Study 5000 cards total', check: s => s.totalCardsStudied >= 5000 },
  { id: 'battle_hardened', icon: '🛡️', name: 'Battle Hardened', desc: 'Defeat 10 battle cards', check: s => (s.battleCardsDefeated || 0) >= 10 },
  { id: 'slayer', icon: '🏹', name: 'Slayer', desc: 'Defeat 50 battle cards', check: s => (s.battleCardsDefeated || 0) >= 50 },
  { id: 'warlord', icon: '⚔️', name: 'Warlord', desc: 'Defeat 100 battle cards', check: s => (s.battleCardsDefeated || 0) >= 100 },
  { id: 'collector', icon: '📚', name: 'Collector', desc: 'Own 5 decks at once', check: (s, xp, db) => Object.keys(db.decks).length >= 5 },
  { id: 'library', icon: '🏛️', name: 'Grand Library', desc: 'Own 10 decks at once', check: (s, xp, db) => Object.keys(db.decks).length >= 10 },
  { id: 'green_thumb', icon: '🌿', name: 'Green Thumb', desc: '500 green marks all time', check: s => (s.ragCounts.green || 0) >= 500 },
  { id: 'red_phoenix', icon: '🔴', name: 'Red Phoenix', desc: '1000 red marks — never give up', check: s => (s.ragCounts.red || 0) >= 1000 },
  { id: 'time_keeper', icon: '⏳', name: 'Time Keeper', desc: 'Study for 1 hour total', check: s => s.totalStudyTime >= 3600 },
  { id: 'night_owl', icon: '🌙', name: 'Night Owl', desc: 'Study for 10 hours total', check: s => s.totalStudyTime >= 36000 },
  { id: 'prestige3', icon: '🔮', name: 'Arcane Master', desc: 'Reach Prestige 3', check: s => (s.prestige || 0) >= 3 },
  { id: 'mastermind', icon: '🧠', name: 'Mastermind', desc: '25 green streak', check: s => (s.bestGreenStreak || 0) >= 25 },
  { id: 'destroyer', icon: '💥', name: 'Destroyer', desc: '100 green streak', check: s => (s.bestGreenStreak || 0) >= 100 },
  { id: 'tome_master', icon: '📜', name: 'Tome Master', desc: 'Fully master and archive a deck', check: (s, xp, db) => (db.masteryHall || []).length >= 1 },
  { id: 'duelist', icon: '🤺', name: 'Duelist', desc: 'Reach a 10-green streak in the Duel Arena', check: s => (s.duelBestStreak || 0) >= 10 },
  { id: 'champion', icon: '🥇', name: 'Champion', desc: 'Reach a 25-green streak in the Duel Arena', check: s => (s.duelBestStreak || 0) >= 25 },

  // ── AI Duel Achievements ──
  { id: 'ai_first',      icon: '🤖', name: 'First Challenge',   desc: 'Complete your first AI Duel question',              check: s => (s.aiDuelTotal || 0) >= 1 },
  { id: 'ai_scholar',    icon: '🎓', name: 'AI Scholar',        desc: 'Answer 25 AI Duel questions',                       check: s => (s.aiDuelTotal || 0) >= 25 },
  { id: 'ai_veteran',    icon: '🗡️', name: 'AI Veteran',        desc: 'Answer 100 AI Duel questions',                      check: s => (s.aiDuelTotal || 0) >= 100 },
  { id: 'ai_perfect',    icon: '💯', name: 'Perfect Answer',    desc: 'Score 10/10 on an AI Duel question',                check: s => (s.aiDuelPerfect || 0) >= 1 },
  { id: 'ai_flawless',   icon: '✨', name: 'Flawless',          desc: 'Score 10/10 five times',                            check: s => (s.aiDuelPerfect || 0) >= 5 },
  { id: 'ai_perfectx10', icon: '🌟', name: 'Untouchable',       desc: 'Score 10/10 twenty times',                          check: s => (s.aiDuelPerfect || 0) >= 20 },
  { id: 'ai_streak3',    icon: '🔥', name: 'On a Roll',         desc: 'Get 3 correct AI Duel answers in a row',            check: s => (s.aiDuelBestStreak || 0) >= 3 },
  { id: 'ai_streak5',    icon: '⚡', name: 'Unstoppable Mind',  desc: 'Get 5 correct AI Duel answers in a row',            check: s => (s.aiDuelBestStreak || 0) >= 5 },
  { id: 'ai_streak10',   icon: '💥', name: 'AI Destroyer',      desc: 'Get 10 correct AI Duel answers in a row',           check: s => (s.aiDuelBestStreak || 0) >= 10 },

  // ── Practice Mode Achievements ──
  { id: 'prac_first',    icon: '✍️', name: 'First Words',       desc: 'Write your first practice answer',                  check: s => (s.practiceTotalAnswers || 0) >= 1 },
  { id: 'prac_writer',   icon: '📝', name: 'Word Weaver',       desc: 'Write 10 practice answers',                        check: s => (s.practiceTotalAnswers || 0) >= 10 },
  { id: 'prac_scholar',  icon: '📚', name: 'Prolific Scholar',  desc: 'Write 50 practice answers',                        check: s => (s.practiceTotalAnswers || 0) >= 50 },
  { id: 'prac_speed1',   icon: '⚡', name: 'Quick Pen',         desc: 'Hit 40 WPM in practice',                           check: s => (s.practiceBestWPM || 0) >= 40 },
  { id: 'prac_speed2',   icon: '🚀', name: 'Speed Writer',      desc: 'Hit 60 WPM in practice',                           check: s => (s.practiceBestWPM || 0) >= 60 },
  { id: 'prac_speed3',   icon: '💨', name: 'Thought to Page',   desc: 'Hit 80 WPM in practice',                           check: s => (s.practiceBestWPM || 0) >= 80 },
  { id: 'prac_streak3',  icon: '🔗', name: 'On the Run',        desc: 'Build a 3-day practice streak',                    check: s => (s.practiceStreak || 0) >= 3 },
  { id: 'prac_streak7',  icon: '🗓️', name: 'Practice Devotee',  desc: 'Build a 7-day practice streak',                    check: s => (s.practiceStreak || 0) >= 7 },
  { id: 'prac_streak30', icon: '🏅', name: 'Dedicated Scholar', desc: 'Build a 30-day practice streak',                   check: s => (s.practiceStreak || 0) >= 30 },
];

function checkAchievements() {
  let newUnlock = false;
  ACHIEVEMENTS.forEach(a => {
    if (!db.achievements[a.id] && a.check(db.stats, db.xp, db)) {
      db.achievements[a.id] = { unlocked: true, date: todayStr() };
      showToast(a.icon, a.name, a.desc);
      newUnlock = true;
    }
  });
  if (newUnlock) saveDB();
}

// ============================================================
// STATS PAGE
// ============================================================
function loadStatsPage() {
  _renderCalendarWidget('statsCalendarWidget');

  // Identity
  const title = getTitle(db.xp.level, db.stats.prestige || 0);
  const prestige = db.stats.prestige || 0;

  setText('charTitle', title);
  setText('charLevel', `Level ${db.xp.level}`);
  setText('charPrestige', prestige > 0 ? `Prestige ${prestige} ${getPrestigeLabel(prestige)}` : '');
  setText('prestigeBadge', getPrestigeLabel(prestige));

  // XP bar
  updateXPBar();
  setText('lifetimeXP', (db.stats.lifetimeXP || 0).toLocaleString());

  // Stats
  setText('statStreak', (db.stats.streak || 0) + ' days');
  setText('statBestStreak', db.stats.bestStreak || 0);
  setText('statToday', db.stats.cardsStudiedToday || 0);
  setText('statTotal', (db.stats.totalCardsStudied || 0).toLocaleString());
  setText('statTime', timeFormat(db.stats.totalStudyTime || 0));

  // Due today
  let due = 0;
  Object.values(db.decks).forEach(deck => {
    if (deck.cards) deck.cards.forEach(c => { if ((c.due || 0) <= Date.now()) due++; });
  });
  setText('statDue', due);

  // RAG bars
  const total = (db.stats.ragCounts.red || 0) + (db.stats.ragCounts.amber || 0) + (db.stats.ragCounts.green || 0) || 1;
  setBar('ragBarRed', (db.stats.ragCounts.red / total) * 100);
  setBar('ragBarAmber', (db.stats.ragCounts.amber / total) * 100);
  setBar('ragBarGreen', (db.stats.ragCounts.green / total) * 100);
  setText('ragCountRed', db.stats.ragCounts.red || 0);
  setText('ragCountAmber', db.stats.ragCounts.amber || 0);
  setText('ragCountGreen', db.stats.ragCounts.green || 0);

  // Heatmap
  renderHeatmap();

  // Deck mastery
  renderDeckMastery();

  // Achievements
  renderAchievements();

  // Forecast graph
  renderForecastGraph();

  // Retention rate
  renderRetentionStats();

  // Forgetting curve
  renderForgettingCurve();

  // Session history
  renderSessionHistory();

  // Study planner
  renderStudyPlanner();

  // Exam readiness
  renderExamReadiness();

  // Weekly report
  renderWeeklyReport();

  // Streak freeze
  renderStreakFreezeUI();

  // Reminder settings
  loadReminderSettings();

  // Hall of Fame
  setText('hallPrestige', prestige > 0 ? `Prestige ${prestige} ${getPrestigeLabel(prestige)}` : 'None');
  setText('hallTotal', prestige);
  setText('hallLevels', db.stats.lifetimeLevels || 0);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.min(100, pct) + '%';
}

function renderHeatmap() {
  const grid = document.getElementById('heatmapGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const today = new Date();
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const count = db.heatmap[key] || 0;
    const cell = document.createElement('div');
    cell.className = 'heat-cell ' + (count === 0 ? 'h0' : count < 5 ? 'h1' : count < 15 ? 'h2' : count < 30 ? 'h3' : 'h4');
    cell.title = `${key}: ${count} cards`;
    grid.appendChild(cell);
  }
}

function renderDeckMastery() {
  const list = document.getElementById('deckMasteryList');
  if (!list) return;
  list.innerHTML = '';

  // Only show decks that are assigned to an active folder
  const assignedDecks = new Set(Object.values(db.folders).flatMap(f => f.decks || []));
  const activeDecks = Object.keys(db.decks).filter(n => assignedDecks.has(n));

  activeDecks.forEach(name => {
    const pct = getDeckMastery(name);
    const row = document.createElement('div');
    row.className = 'deck-mastery-row';
    row.innerHTML = `
      <div class="mastery-name">${name}</div>
      <div class="mastery-bar-track"><div class="mastery-bar-fill" style="width:${pct}%"></div></div>
      <div class="mastery-pct">${pct}%</div>
    `;
    list.appendChild(row);
  });

  // Mastery Hall — deleted tomes that reached 100%
  if (db.masteryHall && db.masteryHall.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'mastery-hall-header';
    divider.textContent = '🏆 Hall of Mastered Tomes';
    list.appendChild(divider);
    db.masteryHall.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'deck-mastery-row mastery-hall-entry';
      row.innerHTML = `
        <div class="mastery-name">⭐ ${entry.name} <span class="mastery-hall-date">(${entry.cards} cards · mastered ${entry.mastered})</span></div>
        <div class="mastery-bar-track"><div class="mastery-bar-fill mastery-hall-fill" style="width:100%"></div></div>
        <div class="mastery-pct">100%</div>
      `;
      list.appendChild(row);
    });
  } else if (Object.keys(db.decks).length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:0.9rem;padding:8px 0">No tomes yet.</p>';
  }
}

function renderAchievements() {
  const grid = document.getElementById('achievementsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  ACHIEVEMENTS.forEach(a => {
    const unlocked = !!db.achievements[a.id];
    const item = document.createElement('div');
    item.className = 'achievement-item ' + (unlocked ? 'unlocked' : 'locked');
    item.innerHTML = `
      <div class="achievement-icon">${a.icon}</div>
      <div class="achievement-name">${a.name}</div>
      <div class="achievement-desc">${a.desc}</div>
    `;
    grid.appendChild(item);
  });
}

// ============================================================
// SETTINGS PAGE
// ============================================================
function loadSettingsPage() {
  const themeEl = document.getElementById('themeSelect');
  if (themeEl) themeEl.value = db.settings.theme || 'dark';

  const soundEl = document.getElementById('soundToggle');
  if (soundEl) soundEl.checked = db.settings.sound || false;

  const speedEl = document.getElementById('speedToggle');
  if (speedEl) speedEl.checked = db.settings.speedMode || false;

  const goalEl = document.getElementById('dailyGoalInput');
  if (goalEl) goalEl.value = db.settings.dailyGoal || 20;

  const softEl = document.getElementById('softPrestigeToggle');
  if (softEl) softEl.checked = db.settings.softPrestige || false;

  const rr = document.getElementById('defaultRagRed');
  const ra = document.getElementById('defaultRagAmber');
  const rg = document.getElementById('defaultRagGreen');
  if (rr) rr.value = db.rag.red;
  if (ra) ra.value = db.rag.amber;
  if (rg) rg.value = db.rag.green;

  // Prestige button
  const pbtn = document.getElementById('prestigeBtn');
  if (pbtn) {
    if (db.xp.level >= 100 && !db.settings.softPrestige) {
      pbtn.innerHTML = '<button class="rpg-btn primary" onclick="triggerPrestige()">👑 Prestige Now!</button>';
    } else {
      pbtn.innerHTML = `<p class="rpg-hint">Prestige available at Level 100 (currently Level ${db.xp.level})</p>`;
    }
  }

  renderAccountPanel();
  _loadAISettings();
  const mBtn = document.getElementById('mobileModeBtn');
  if (mBtn) _updateMobileModeBtn(mBtn);
}

function changeTheme() {
  db.settings.theme = document.getElementById('themeSelect').value;
  saveDB();
  applyTheme();
}

function saveSoundSetting() {
  db.settings.sound = document.getElementById('soundToggle').checked;
  saveDB();
}

function saveSpeedSetting() {
  db.settings.speedMode = document.getElementById('speedToggle').checked;
  saveDB();
}

function saveDailyGoal() {
  db.settings.dailyGoal = parseInt(document.getElementById('dailyGoalInput').value) || 20;
  saveDB();
  showToast('🎯', 'Goal Set', `Daily goal: ${db.settings.dailyGoal} cards`);
}

function saveSoftPrestige() {
  db.settings.softPrestige = document.getElementById('softPrestigeToggle').checked;
  saveDB();
}

function saveDefaultRag() {
  db.rag = {
    red: parseInt(document.getElementById('defaultRagRed').value) || 5,
    amber: parseInt(document.getElementById('defaultRagAmber').value) || 10,
    green: parseInt(document.getElementById('defaultRagGreen').value) || 50
  };
  saveDB();
  showToast('⚙', 'RAG Defaults Saved', 'New decks will use these intervals');
}

// ============================================================
// FIREBASE AUTH + CLOUD SYNC (per-account, real-time)
// ============================================================
const FB      = 'https://scholar-s-sanctum-default-rtdb.europe-west1.firebasedatabase.app';
const FB_KEY  = 'AIzaSyDM_Aw_UUO929fYYJ23bQDpkJzWCMSMCjQ';
const FB_AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts';

let _auth         = null;  // { uid, email, displayName, idToken, refreshToken }
let _syncES       = null;  // EventSource live listener
let _syncPushTimer = null; // debounce timer

// ---- Device ID (prevents own-push echo) ----
function _deviceId() {
  let id = localStorage.getItem('sanctumDevice');
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('sanctumDevice', id); }
  return id;
}

// ---- Username validation + profanity filter ----
const _BANNED = [
  'fuck','shit','bitch','cunt','cock','dick','pussy','nigger','nigga',
  'faggot','fag','retard','whore','slut','rape','piss','bastard','ass',
  'asshole','twat','wank','wanker','bollocks','tosser','prick','bellend',
  'spastic','nazi','hitler','isis','jihad','terrorist','porn','nude','sex'
];

function _validateUsername(name) {
  const n = (name || '').trim();
  if (n.length < 2)  return 'Username must be at least 2 characters.';
  if (n.length > 20) return 'Username must be 20 characters or less.';
  if (!/^[a-zA-Z0-9 _\-'.]+$/.test(n))
    return "Only letters, numbers, spaces and _ - ' . are allowed.";
  const stripped = n.toLowerCase().replace(/[^a-z]/g, '');
  for (const w of _BANNED) {
    if (stripped.includes(w)) return 'That username contains inappropriate language — please choose another.';
  }
  return null; // null = valid
}

// ---- Auth helpers ----
function _loadAuth() {
  try { const s = localStorage.getItem('sanctumAuth'); if (s) _auth = JSON.parse(s); } catch(e) {}
}
function _saveAuth(a) { _auth = a; try { localStorage.setItem('sanctumAuth', JSON.stringify(a)); } catch(e) {} }
function _clearAuth() { _auth = null; localStorage.removeItem('sanctumAuth'); }

function _requireAuth() {
  if (_auth) return true;
  if (!window.location.pathname.endsWith('auth.html')) window.location.replace('auth.html');
  return false;
}

function _authErrMsg(data) {
  const m = data?.error?.message || '';
  const map = {
    'EMAIL_EXISTS': 'That email is already registered.',
    'INVALID_EMAIL': 'Invalid email address.',
    'INVALID_PASSWORD': 'Incorrect password.',
    'EMAIL_NOT_FOUND': 'No account found with that email.',
    'INVALID_LOGIN_CREDENTIALS': 'Incorrect email or password.',
    'WEAK_PASSWORD': 'Password must be at least 6 characters.',
    'TOO_MANY_ATTEMPTS_TRY_LATER': 'Too many attempts — try again later.'
  };
  for (const key of Object.keys(map)) { if (m.includes(key)) return map[key]; }
  return m || 'Something went wrong. Try again.';
}

const _ALLOWED_EMAILS = ['johnhodgson140@gmail.com'];

async function registerUser(displayName, email, password) {
  // Private app — only whitelisted emails can register
  if (!_ALLOWED_EMAILS.includes(email.toLowerCase().trim())) {
    throw new Error('This app is private. Registration is not open.');
  }

  // Validate username locally first
  const usernameErr = _validateUsername(displayName);
  if (usernameErr) throw new Error(usernameErr);

  // Check for duplicate username in leaderboard
  const lbRes = await fetch(`${FB}/leaderboard.json`);
  if (lbRes.ok) {
    const lb = await lbRes.json();
    if (lb) {
      const taken = Object.values(lb).some(
        p => p.name && p.name.trim().toLowerCase() === displayName.trim().toLowerCase()
      );
      if (taken) throw new Error('That username is already taken — please choose another.');
    }
  }

  let res = await fetch(`${FB_AUTH}:signUp?key=${FB_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  let data = await res.json();
  if (!res.ok) throw new Error(_authErrMsg(data));

  // Set display name
  await fetch(`${FB_AUTH}:update?key=${FB_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: data.idToken, displayName })
  });

  _saveAuth({ uid: data.localId, email, displayName, idToken: data.idToken, refreshToken: data.refreshToken });
  db = getDefaultDB();
  try { localStorage.setItem('sanctumDB', JSON.stringify(db)); } catch(e) {}
  await _pushUserData();
  window.location.replace('index.html');
}

async function loginUser(email, password) {
  const res = await fetch(`${FB_AUTH}:signInWithPassword?key=${FB_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(_authErrMsg(data));

  _saveAuth({
    uid: data.localId, email: data.email,
    displayName: data.displayName || email.split('@')[0],
    idToken: data.idToken, refreshToken: data.refreshToken
  });

  // Pull this user's data — each account has separate data
  await _pullUserData();
  window.location.replace('index.html');
}

function switchUser() {
  showConfirm('Switch User', 'Your progress will be saved to the cloud first, then you can log in as someone else.',
    async () => {
      try { await _pushUserData(); } catch(e) {}
      if (_syncES) { _syncES.close(); _syncES = null; }
      _clearAuth();
      localStorage.removeItem('sanctumDB');
      window.location.replace('auth.html');
    }, { icon: '🔄', confirmText: '🔄 Switch Account' }
  );
}

function removeFromDevice() {
  showConfirm('Remove Account from Device',
    'Your data stays safely in the cloud. Log back in anytime on any device to restore it.',
    async () => {
      try { await _pushUserData(); } catch(e) {}
      if (_syncES) { _syncES.close(); _syncES = null; }
      _clearAuth();
      localStorage.removeItem('sanctumDB');
      window.location.replace('auth.html');
    }, { icon: '🔒', confirmText: '✔ Remove from Device' }
  );
}

// ---- Per-user Firebase paths ----
function _userDbUrl()  { return `${FB}/users/${_auth.uid}.json`; }
function _lbUrl()      { return `${FB}/leaderboard/${_auth.uid}.json`; }

function _dbSnapshot() {
  const snap = JSON.parse(JSON.stringify(db));
  Object.values(snap.decks || {}).forEach(d =>
    (d.cards || []).forEach(c => { delete c.frontImg; delete c.backImg; })
  );
  delete snap.syncId; delete snap.syncTimestamp;
  return snap;
}

async function _pushUserData() {
  if (!_auth) return;
  await fetch(_userDbUrl(), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: _dbSnapshot(), at: Date.now(), by: _deviceId() })
  });
  // Update public leaderboard entry
  await fetch(_lbUrl(), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: _auth.displayName,
      level: db.xp?.level || 1,
      prestige: db.stats?.prestige || 0,
      lifetimeXP: db.stats?.lifetimeXP || 0,
      totalCards: db.stats?.totalCardsStudied || 0,
      bestStreak: db.stats?.bestStreak || 0,
      currentStreak: db.stats?.streak || 0,
      updatedAt: Date.now()
    })
  });
  db.syncTimestamp = Date.now();
  try { localStorage.setItem('sanctumDB', JSON.stringify(db)); } catch(e) {}
  _refreshSyncTime();
}

async function _pullUserData() {
  if (!_auth) return;
  const res = await fetch(_userDbUrl());
  if (!res.ok) return;
  const remote = await res.json();
  if (remote?.data) {
    db = remote.data;
    db.syncTimestamp = remote.at || Date.now();
    try { localStorage.setItem('sanctumDB', JSON.stringify(db)); } catch(e) {}
    applyTheme();
  }
}

// Auto-push 3 s after any saveDB() call
function _scheduleAutoPush() {
  if (!_auth) return;
  clearTimeout(_syncPushTimer);
  _syncPushTimer = setTimeout(() => { _pushUserData().catch(() => {}); }, 3000);
}

// Live listener — fires on any remote change to this user's data
function startSyncListener() {
  if (!_auth) return;
  if (_syncES) { _syncES.close(); _syncES = null; }
  _syncES = new EventSource(_userDbUrl());
  _syncES.addEventListener('put', e => {
    try {
      const msg = JSON.parse(e.data);
      const remote = msg?.data;
      if (!remote?.data) return;
      if (remote.by === _deviceId()) return;
      if (remote.at <= (db.syncTimestamp || 0)) return;
      db = remote.data;
      db.syncTimestamp = remote.at;
      localStorage.setItem('sanctumDB', JSON.stringify(db));
      applyTheme();
      _refreshCurrentPageUI();
      _refreshSyncTime();
      showToast('☁️', 'Synced', 'Updated from another device');
    } catch(_) {}
  });
}

function _refreshCurrentPageUI() {
  if (document.querySelector('.map-page'))       { renderWorldMap(); renderDailyQuests(); renderDailyGoal(); }
  else if (document.querySelector('.stats-page'))    loadStatsPage();
  else if (document.querySelector('.settings-page')) renderAccountPanel();
  else if (document.querySelector('.folder-page'))   loadFolderPage();
}

function _refreshSyncTime() {
  const el = document.getElementById('syncLastTime');
  if (el && db.syncTimestamp) el.textContent = `Last synced: ${new Date(db.syncTimestamp).toLocaleString()}`;
}

// Manual push/pull for settings page buttons
async function pushSync() {
  showToast('⬆️', 'Saving…', 'Pushing to cloud');
  try { await _pushUserData(); showToast('✅', 'Saved', 'Cloud updated'); }
  catch(e) { showToast('❌', 'Failed', 'Could not reach Firebase'); }
}
async function pullSync() {
  showToast('⬇️', 'Loading…', 'Fetching from cloud');
  try {
    await _pullUserData();
    renderAccountPanel();
    showToast('✅', 'Loaded', 'Local data refreshed from cloud');
  } catch(e) { showToast('❌', 'Failed', 'Could not fetch from Firebase'); }
}

// Account panel in settings
function renderAccountPanel() {
  const nm = document.getElementById('accountName');
  const em = document.getElementById('accountEmail');
  const st = document.getElementById('syncStatus');
  if (nm && _auth) nm.textContent = _auth.displayName;
  if (em && _auth) em.textContent = _auth.email;
  if (st) { st.textContent = '🟢 Auto-syncing'; st.className = 'sync-status connected'; }
  _refreshSyncTime();
}

// Nav: inject leaderboard link + user button on every page
function _renderUserNav() {
  if (!_auth) return;
  document.querySelectorAll('.top-nav').forEach(nav => {
    if (!nav.querySelector('[href="leaderboard.html"]')) {
      const lb = document.createElement('a');
      lb.href = 'leaderboard.html'; lb.className = 'nav-link'; lb.textContent = '🏆 Ranks';
      nav.insertBefore(lb, nav.firstChild);
    }
    if (!nav.querySelector('.user-nav-btn')) {
      const btn = document.createElement('button');
      btn.className = 'nav-link user-nav-btn';
      btn.textContent = `👤 ${_auth.displayName.split(' ')[0]}`;
      btn.onclick = _toggleUserMenu;
      nav.appendChild(btn);
    }
  });
}

let _userMenuEl = null;
function _toggleUserMenu() {
  if (_userMenuEl) { _userMenuEl.remove(); _userMenuEl = null; return; }
  _userMenuEl = document.createElement('div');
  _userMenuEl.className = 'user-menu';
  _userMenuEl.innerHTML = `
    <div class="user-menu-name">${_auth.displayName}</div>
    <div class="user-menu-email">${_auth.email}</div>
    <div class="user-menu-divider"></div>
    <button class="user-menu-item" onclick="switchUser()">🔄 Switch User</button>
    <button class="user-menu-item" onclick="removeFromDevice()">🔒 Remove from Device</button>`;
  const btn = document.querySelector('.user-nav-btn');
  const rect = btn.getBoundingClientRect();
  _userMenuEl.style.top  = (rect.bottom + 6) + 'px';
  _userMenuEl.style.right = (window.innerWidth - rect.right) + 'px';
  document.body.appendChild(_userMenuEl);
  setTimeout(() => document.addEventListener('click', () => {
    if (_userMenuEl) { _userMenuEl.remove(); _userMenuEl = null; }
  }, { once: true }), 10);
}

// Leaderboard page
async function loadLeaderboardPage() {
  const grid = document.getElementById('leaderboardGrid');
  if (!grid) return;
  grid.innerHTML = '<p class="empty-text" style="padding:20px">Loading…</p>';
  try {
    const res = await fetch(`${FB}/leaderboard.json`);
    const data = await res.json();
    if (!data) { grid.innerHTML = '<p class="empty-text">No scholars yet — be the first!</p>'; return; }
    const players = Object.entries(data).map(([uid, p]) => ({ uid, ...p }))
      .sort((a, b) => (b.prestige - a.prestige) || (b.level - a.level) || ((b.lifetimeXP || 0) - (a.lifetimeXP || 0)));
    grid.innerHTML = '';
    const myFriends = db.friends || {};
    players.forEach((p, i) => {
      const me = _auth && p.uid === _auth.uid;
      const isFriend = !!myFriends[p.uid];
      const icon = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      const prestige = p.prestige > 0 ? ` · P${p.prestige}` : '';
      const friendTag = isFriend ? ' 👥' : '';
      const row = document.createElement('div');
      row.className = 'lb-row' + (me ? ' lb-me' : '') + (isFriend ? ' lb-friend' : '');
      row.innerHTML = `
        <div class="lb-rank">${icon}</div>
        <div class="lb-info">
          <div class="lb-name">${p.name}${prestige}${me ? ' 👈' : friendTag}</div>
          <div class="lb-stats">Lv.${p.level} · ${(p.lifetimeXP||0).toLocaleString()} XP · ${(p.totalCards||0).toLocaleString()} cards</div>
        </div>
        <div class="lb-streak">🔥 ${p.currentStreak||0}<br><span style="font-size:0.65rem;opacity:0.55">Best: ${p.bestStreak||0}</span></div>
        ${!me ? `<div class="lb-actions">
          ${!isFriend ? `<button class="rpg-btn small" onclick="addFriend('${p.uid}','${p.name}');loadLeaderboardPage()">👥 Add</button>` : `<button class="rpg-btn small" onclick="removeFriend('${p.uid}');loadLeaderboardPage()">✕ Remove</button>`}
          ${isFriend ? `<button class="rpg-btn small" onclick="challengeFriend('${p.uid}','${p.name}',Object.keys(db.decks)[0]||'')">⚔️ Challenge</button>` : ''}
        </div>` : ''}`;
      grid.appendChild(row);
    });
  } catch(e) {
    grid.innerHTML = '<p class="empty-text">Could not load — check your connection.</p>';
  }
}

function exportDecks() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sanctum_export.json';
  a.click();
}

function importDecks() {
  const file = document.getElementById('importFile').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      db = JSON.parse(e.target.result);
      saveDB();
      alert('Import successful!');
      location.reload();
    } catch { alert('Invalid file.'); }
  };
  reader.readAsText(file);
}

function resetAllData() {
  showConfirm(
    'Delete Everything',
    'This will permanently erase ALL decks, cards, XP, achievements and progress. There is no way to recover this data.',
    () => {
      showConfirm(
        'Final Warning',
        'Are you absolutely sure? Every realm, tome and character stat will be gone forever.',
        () => { localStorage.removeItem('sanctumDB'); location.reload(); },
        { icon: '💀', confirmText: '💀 Destroy Everything', danger: true }
      );
    },
    { icon: '⚠️', confirmText: '⚠️ Yes, Continue', danger: true }
  );
}

// ============================================================
// SOUND (green answer)
// ============================================================
function playGreenSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {}
}

// ============================================================
// CUSTOM CONFIRM MODAL
// ============================================================
function showConfirm(title, message, onConfirm, opts = {}) {
  let modal = document.getElementById('_confirmModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = '_confirmModal';
    modal.className = 'modal-overlay confirm-overlay';
    modal.innerHTML = `
      <div class="rpg-modal confirm-modal">
        <div class="confirm-icon" id="_confirmIcon"></div>
        <div class="confirm-title" id="_confirmTitle"></div>
        <div class="confirm-msg" id="_confirmMsg"></div>
        <div class="confirm-actions">
          <button class="rpg-btn confirm-ok-btn" id="_confirmOk"></button>
          <button class="rpg-btn confirm-back-btn" id="_confirmCancel">✖ Go Back</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  document.getElementById('_confirmIcon').textContent = opts.icon || '⚠️';
  document.getElementById('_confirmTitle').textContent = title;
  document.getElementById('_confirmMsg').textContent = message;

  const okBtn = document.getElementById('_confirmOk');
  okBtn.textContent = opts.confirmText || '✔ Confirm';
  okBtn.className = 'rpg-btn confirm-ok-btn ' + (opts.danger ? 'danger' : 'primary');

  // Replace buttons to strip old listeners
  const freshOk = okBtn.cloneNode(true);
  const freshCancel = document.getElementById('_confirmCancel').cloneNode(true);
  okBtn.replaceWith(freshOk);
  document.getElementById('_confirmCancel').replaceWith(freshCancel);

  document.getElementById('_confirmOk').onclick = () => { modal.style.display = 'none'; onConfirm?.(); };
  document.getElementById('_confirmCancel').onclick = () => { modal.style.display = 'none'; };

  modal.style.display = 'flex';
}

// ============================================================
// TOAST NOTIFICATION
// ============================================================
let toastTimeout = null;

function showToast(icon, title, desc) {
  const toast = document.getElementById('achievementToast');
  if (!toast) return;
  document.getElementById('toastIcon').textContent = icon;
  document.getElementById('toastTitle').textContent = title;
  document.getElementById('toastDesc').textContent = desc;
  toast.style.display = 'flex';
  toast.style.animation = 'none';
  requestAnimationFrame(() => { toast.style.animation = 'toastSlide 0.5s cubic-bezier(0.34,1.56,0.64,1)'; });
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.style.display = 'none'; }, 4000);
}
// ============================================================
// RANK BADGE DISPLAY
// ============================================================
function updateRankDisplay() {
  const icon = document.getElementById('rankIcon');
  const levelEl = document.getElementById('rankLevel');
  const titleEl = document.getElementById('rankTitleLabel');
  if (!icon || !levelEl || !titleEl) return;

  const lv = db.xp.level;
  const pr = db.stats.prestige || 0;
  const themeIcons = {
    stone: '🪨', parchment: '📜', leather: '🛡️',
    crystal: '💎', dragon: '🐉', rune: '🔮', celestial: '⭐'
  };
  icon.textContent = pr > 0 ? getPrestigeLabel(pr) : (themeIcons[getCardTheme(lv)] || '📜');
  levelEl.textContent = `Level ${lv}`;
  titleEl.textContent = getTitle(lv, pr);
}

// ============================================================
// PIXEL ISLAND SCENE
// ============================================================
function drawPixelIsland(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const P = 4;
  let frame = 0;

  const CX = Math.floor(W / P / 2);   // grid center x
  const IY = Math.floor(H / P) - 9;   // island top row
  const TX = CX + 3;                  // tree x
  const CHAR_X = CX - 7;             // character x

  // Pre-compute leaf blob (avoid per-frame randomness)
  const leafCols = ['#0a4a0a', '#156a15', '#1a8a1a', '#0d5a10', '#23961a'];
  const leaves = [];
  const leafRows = [
    { dy: -12, r: 2 }, { dy: -11, r: 3 }, { dy: -10, r: 4 },
    { dy: -9,  r: 5 }, { dy: -8,  r: 5 }, { dy: -7,  r: 4 },
    { dy: -6,  r: 5 }, { dy: -5,  r: 4 }, { dy: -4,  r: 3 }
  ];
  leafRows.forEach(({ dy, r }) => {
    for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) + Math.abs(dy + 8) <= r + 3) {
        const ci = (Math.abs(dx) + Math.abs(dy)) % leafCols.length;
        leaves.push({ x: TX + dx, y: IY + dy, c: leafCols[ci] });
      }
    }
  });

  // Pre-compute stars
  const stars = Array.from({ length: 28 }, () => ({
    x: 2 + Math.random() * (W - 4),
    y: 1 + Math.random() * (H * 0.58),
    phase: Math.random() * Math.PI * 2,
    big: Math.random() > 0.72,
    warm: Math.random() > 0.6
  }));

  function fill(gx, gy, color) {
    ctx.fillStyle = color;
    ctx.fillRect(gx * P, gy * P, P, P);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#010308');
    sky.addColorStop(0.6, '#06031a');
    sky.addColorStop(1, '#0d0530');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Stars (twinkle)
    stars.forEach(s => {
      const a = 0.25 + 0.75 * Math.abs(Math.sin(frame * 0.022 + s.phase));
      ctx.globalAlpha = a;
      ctx.fillStyle = s.warm ? '#ffffc8' : '#c8c8ff';
      const sz = s.big ? 2 : 1;
      ctx.fillRect(s.x, s.y, sz, sz);
    });
    ctx.globalAlpha = 1;

    // Floating offset (gentle bob)
    const bob = Math.sin(frame * 0.018) * 0.5;
    ctx.save();
    ctx.translate(0, bob * P);

    // === Island ===
    // Grass
    for (let x = CX - 9; x <= CX + 9; x++)
      fill(x, IY, (x + frame) % 7 === 0 ? '#42b842' : '#2d922d');
    // Dirt
    for (let x = CX - 10; x <= CX + 10; x++) fill(x, IY + 1, '#6b4020');
    for (let x = CX - 9;  x <= CX + 9;  x++) fill(x, IY + 2, '#7a5030');
    for (let x = CX - 8;  x <= CX + 8;  x++) fill(x, IY + 3, '#8b5e3c');
    // Stone
    for (let x = CX - 7; x <= CX + 7; x++) fill(x, IY + 4, '#6b5045');
    for (let x = CX - 5; x <= CX + 5; x++) fill(x, IY + 5, '#5a4035');
    for (let x = CX - 3; x <= CX + 3; x++) fill(x, IY + 6, '#4a3025');
    // Roots
    [CX - 6, CX - 2, CX + 2, CX + 5].forEach(rx => {
      fill(rx, IY + 7, '#3a2015');
      fill(rx, IY + 8, '#2a1505');
    });

    // === Tree trunk ===
    for (let ty = IY - 9; ty < IY; ty++) {
      fill(TX,     ty, '#4a2808');
      fill(TX + 1, ty, ty % 2 === 0 ? '#5a3820' : '#4a2808');
    }

    // === Leaves ===
    leaves.forEach(l => fill(l.x, l.y, l.c));
    // Bright highlights on leaf top
    [{ x: TX - 1, y: IY - 12 }, { x: TX + 2, y: IY - 11 }, { x: TX, y: IY - 10 }].forEach(h => {
      fill(h.x, h.y, '#40cc40');
    });

    // === Character ===
    const lv = db && db.xp ? db.xp.level : 1;
    const pr = db && db.stats ? (db.stats.prestige || 0) : 0;

    let hair, body, legs, accent;
    if (pr > 0)      { hair = '#ffffff'; body = '#c9a84c'; legs = '#8a6a1a'; accent = '#ffdd44'; }
    else if (lv >= 200) { hair = '#c9a84c'; body = '#9933cc'; legs = '#6600aa'; accent = '#cc88ff'; }
    else if (lv >= 100) { hair = '#aaaaaa'; body = '#cc2200'; legs = '#8a1500'; accent = '#ff8844'; }
    else if (lv >= 50)  { hair = '#333355'; body = '#3366cc'; legs = '#1a3388'; accent = '#88aaff'; }
    else if (lv >= 25)  { hair = '#8B5E3C'; body = '#4a8a20'; legs = '#2a5a10'; accent = '#88cc44'; }
    else if (lv >= 10)  { hair = '#3a2a1a'; body = '#5555aa'; legs = '#333388'; accent = '#8888cc'; }
    else                { hair = '#5a4a3a'; body = '#777777'; legs = '#444444'; accent = '#aaaaaa'; }

    const skin = '#f5c99a';
    const baseY = IY - 1; // feet on island

    // Feet / legs
    fill(CHAR_X,     baseY, legs);
    fill(CHAR_X + 1, baseY, legs);
    fill(CHAR_X + 2, baseY, legs);
    // Body
    fill(CHAR_X,     baseY - 1, body);
    fill(CHAR_X + 1, baseY - 1, body);
    fill(CHAR_X + 2, baseY - 1, body);
    fill(CHAR_X,     baseY - 2, body);
    fill(CHAR_X + 1, baseY - 2, accent);
    fill(CHAR_X + 2, baseY - 2, body);
    // Shoulders / arms
    fill(CHAR_X - 1, baseY - 2, body);
    fill(CHAR_X + 3, baseY - 2, body);
    // Head
    fill(CHAR_X + 1, baseY - 3, skin);
    // Hair
    fill(CHAR_X,     baseY - 4, hair);
    fill(CHAR_X + 1, baseY - 4, hair);
    fill(CHAR_X + 2, baseY - 4, hair);
    // Eye (blink every ~4s)
    const blink = Math.sin(frame * 0.038) > 0.93;
    if (!blink) fill(CHAR_X + 1, baseY - 3, '#222222');

    // Aura particles for high level / prestige
    if (pr > 0 || lv >= 100) {
      const glowCol = pr > 0 ? '#ffdd44' : lv >= 200 ? '#cc88ff' : '#4488ff';
      for (let i = 0; i < 4; i++) {
        const angle = frame * 0.07 + i * (Math.PI / 2);
        const px2 = (CHAR_X + 1) * P + Math.cos(angle) * 10;
        const py2 = (baseY - 2) * P + Math.sin(angle) * 7;
        ctx.globalAlpha = 0.65;
        ctx.fillStyle = glowCol;
        ctx.fillRect(px2, py2, 2, 2);
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    frame++;
    requestAnimationFrame(render);
  }

  render();
}

// ============================================================
// PIXEL BATTLE SCENE
// ============================================================
function drawBattleScene(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const P = 3; // pixel size
  let frame = 0;

  // Battle cycle: walk→clash→retreat (repeats)
  const WALK_FRAMES = 80, CLASH_FRAMES = 60, RETREAT_FRAMES = 80;
  const CYCLE_LENGTH = WALK_FRAMES + CLASH_FRAMES + RETREAT_FRAMES;

  function getCyclePhase() {
    const phase = frame % CYCLE_LENGTH;
    if (phase < WALK_FRAMES) return 'walk';
    if (phase < WALK_FRAMES + CLASH_FRAMES) return 'clash';
    return 'retreat';
  }

  function getPhaseProgress() {
    const phase = frame % CYCLE_LENGTH;
    if (phase < WALK_FRAMES) return phase / WALK_FRAMES;
    if (phase < WALK_FRAMES + CLASH_FRAMES) return (phase - WALK_FRAMES) / CLASH_FRAMES;
    return (phase - WALK_FRAMES - CLASH_FRAMES) / RETREAT_FRAMES;
  }

  function fillPx(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * P, y * P, P, P);
  }

  function drawKnight(baseX, baseY, facing, walkProgress, clashProgress) {
    const walk = Math.sin(walkProgress * Math.PI) * 2; // bob up/down
    const y = baseY + (facing === 'left' ? walk : walk);

    // Legs (walking animation)
    const legOffset = Math.sin(walkProgress * Math.PI * 2) * 1;
    fillPx(baseX, y, '#8a5a3a');      // left leg
    fillPx(baseX + 2, y, '#8a5a3a');  // right leg

    // Body
    fillPx(baseX, y - 1, '#c9581a');
    fillPx(baseX + 1, y - 1, '#c9581a');
    fillPx(baseX + 2, y - 1, '#c9581a');

    // Arms (raised for clash)
    const armRaise = clashProgress * 2;
    fillPx(baseX - 1, y - 1 - armRaise, '#c9581a');
    fillPx(baseX + 3, y - 1 - armRaise, '#c9581a');

    // Head
    fillPx(baseX + 1, y - 2, '#f5c99a');

    // Helmet/Hair
    fillPx(baseX, y - 3, '#444444');
    fillPx(baseX + 1, y - 3, '#444444');
    fillPx(baseX + 2, y - 3, '#444444');

    // Shield or weapon
    if (facing === 'left') {
      fillPx(baseX - 1, y - 2, '#ffaa00'); // gold shield
      fillPx(baseX - 1, y - 1, '#ffaa00');
    } else {
      fillPx(baseX + 3, y - 2, '#ffaa00'); // sword
    }
  }

  function drawMonster(baseX, baseY, hurtProgress) {
    const hurt = hurtProgress > 0.5 ? (hurtProgress - 0.5) * 2 : 0;
    const y = baseY + hurt * 2; // knockback

    // Body (spiky)
    fillPx(baseX, y, '#3a7a2a');
    fillPx(baseX + 1, y, '#3a7a2a');
    fillPx(baseX + 2, y, '#3a7a2a');

    // Spikes
    fillPx(baseX - 1, y - 1, '#2a5a1a');
    fillPx(baseX + 3, y - 1, '#2a5a1a');

    // Head
    fillPx(baseX + 1, y - 1, '#4a9a3a');

    // Eyes (red when hurt)
    const eyeColor = hurt > 0 ? '#ff4444' : '#ffaa00';
    fillPx(baseX, y - 2, eyeColor);
    fillPx(baseX + 2, y - 2, eyeColor);

    // Spikes on top
    fillPx(baseX + 1, y - 3, '#2a5a1a');
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#4488dd');
    sky.addColorStop(1, '#88aaff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Ground
    ctx.fillStyle = '#228844';
    ctx.fillRect(0, H - 20 * P, W, 20 * P);

    // Ground detail (grass)
    ctx.fillStyle = '#1a6a2a';
    for (let x = 0; x < W / P; x += 3) {
      fillPx(x, (H / P) - 5, '#1a6a2a');
    }

    const cyclePhase = getCyclePhase();
    const phaseProgress = getPhaseProgress();

    // Determine positioning based on cycle phase
    let knightX, monsterX, clashIntensity;

    if (cyclePhase === 'walk') {
      knightX = 3 + phaseProgress * 8;
      monsterX = (W / P) - 8 - phaseProgress * 8;
      clashIntensity = 0;
    } else if (cyclePhase === 'clash') {
      knightX = 11;
      monsterX = (W / P) - 16;
      clashIntensity = Math.sin(phaseProgress * Math.PI * 2) * 0.5 + 0.5;
    } else {
      knightX = 11 + (phaseProgress * 8);
      monsterX = (W / P) - 16 - (phaseProgress * 8);
      clashIntensity = 0;
    }

    const groundY = (H / P) - 6;

    // Draw battle
    drawKnight(Math.floor(knightX), groundY, 'left', phaseProgress, clashIntensity);
    drawMonster(Math.floor(monsterX), groundY, clashIntensity);

    // Clash effect (stars/sparks)
    if (clashIntensity > 0.3) {
      for (let i = 0; i < 3; i++) {
        const sparkX = knightX + 4 + Math.cos(frame * 0.1 + i) * 3;
        const sparkY = groundY - 2 + Math.sin(frame * 0.1 + i) * 3;
        ctx.fillStyle = '#ffff00';
        ctx.fillRect(sparkX * P, sparkY * P, P, P);
      }
    }

    frame++;
    requestAnimationFrame(render);
  }

  render();
}

// ============================================================
// DUEL PAGE
// ============================================================
let duelQueue = [];
let duelIndex = 0;
let duelGreenStreak = 0;
let duelBestStreak = 0;
let duelSessionXP = 0;
let duelCardsAnswered = 0;
let duelRed = 0, duelAmber = 0, duelGreen = 0;
let duelStartTime = 0;
let duelLastMarked = null;

function loadDuelPage() {
  const params = new URLSearchParams(window.location.search);
  const realm = params.get('realm');
  const sub = params.get('sub');

  const aiduel = params.get('aiduel');
  if (aiduel) {
    const deck = db.decks[aiduel];
    if (!deck || !deck.cards?.length) {
      showToast('⚠', 'No Cards', `"${aiduel}" has no cards to duel with.`);
      renderDuelPortals(); return;
    }
    _aiDuelDeck         = { cards: deck.cards };
    _aiDuelDeckName     = aiduel;
    _aiDuelPendingRealm = '';
    _aiDuelPendingSub   = aiduel;
    _aiDuelMode         = params.get('mode') === 'deck' ? 'deck' : 'exam';
    startAIDuel(); return;
  }

  if (!realm) {
    renderDuelPortals();
  } else if (!sub) {
    _duelFolderStack = [{ name: realm, label: realm }];
    _renderDuelFolderView(realm);
  } else {
    startDuelStudy(realm, sub);
  }
}

// ── Duel tab switcher ──────────────────────────────────────────
function switchDuelTab(tab) {
  const realmsPanel = document.getElementById('duelRealmsPanel');
  const decksPanel  = document.getElementById('duelDecksPanel');
  const tabRealms   = document.getElementById('duelTabRealms');
  const tabDecks    = document.getElementById('duelTabDecks');
  if (tab === 'realms') {
    if (realmsPanel) realmsPanel.style.display = '';
    if (decksPanel)  decksPanel.style.display  = 'none';
    if (tabRealms)   tabRealms.classList.add('active');
    if (tabDecks)    tabDecks.classList.remove('active');
  } else {
    if (realmsPanel) realmsPanel.style.display = 'none';
    if (decksPanel)  decksPanel.style.display  = '';
    if (tabRealms)   tabRealms.classList.remove('active');
    if (tabDecks)    tabDecks.classList.add('active');
    renderDuelDeckGrid();
  }
}

function renderDuelDeckGrid(filter) {
  const grid  = document.getElementById('duelDeckGrid');
  const empty = document.getElementById('duelDeckEmpty');
  if (!grid) return;
  grid.innerHTML = '';

  const q = (filter || '').toLowerCase();
  const decks = Object.keys(db.decks)
    .filter(name => db.decks[name]?.cards?.length)   // must have cards
    .filter(name => !q || name.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b));

  if (!decks.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  decks.forEach(deckName => {
    const cards   = db.decks[deckName]?.cards || [];
    const mastery = getDeckMastery(deckName);
    const tile = document.createElement('div');
    tile.className = 'duel-sub-card';
    tile.innerHTML = `
      <div class="duel-sub-icon">📖</div>
      <div class="duel-sub-name">${deckName}</div>
      <div class="duel-sub-meta">${cards.length} card${cards.length !== 1 ? 's' : ''} · ${mastery}% mastered</div>`;
    tile.onclick = () => {
      _aiDuelDeck         = { cards };
      _aiDuelDeckName     = deckName;
      _aiDuelPendingRealm = '';
      _aiDuelPendingSub   = deckName;
      _showDuelView('duelModeView');
    };
    grid.appendChild(tile);
  });
}

function filterDuelDecks(val) { renderDuelDeckGrid(val); }

function renderDuelPortals() {
  _showDuelView('duelPortalView');
  const grid = document.getElementById('duelPortalGrid');
  const empty = document.getElementById('duelPortalEmpty');
  const topLevel = Object.keys(db.folders).filter(f => !db.folders[f].parent);

  if (topLevel.length === 0) { if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';

  topLevel.forEach((folderName, i) => {
    const colours = getPortalColour(db.folders[folderName].colourIndex || i);
    const wrap = document.createElement('div');
    wrap.className = 'portal-wrap';

    const portal = document.createElement('div');
    portal.className = 'portal';
    portal.style.color = colours[0];

    const canvas = document.createElement('canvas');
    canvas.className = 'portal-canvas';
    canvas.width = 130; canvas.height = 130;
    portal.appendChild(canvas);

    const name = document.createElement('div');
    name.className = 'portal-name';
    name.textContent = folderName;

    const allDecks = _getAllDecksInFolder(folderName);
    const allCards = allDecks.reduce((n, d) => n + (db.decks[d]?.cards.length || 0), 0);
    const subCount = Object.keys(db.folders).filter(f => db.folders[f].parent === folderName).length;

    const meta = document.createElement('div');
    meta.className = 'portal-meta';
    meta.textContent = allCards > 0
      ? `${allCards} card${allCards !== 1 ? 's' : ''} · ${allDecks.length} deck${allDecks.length !== 1 ? 's' : ''}`
      : 'No cards';

    // Dim portals with no cards
    if (!allCards) wrap.style.opacity = '0.4';

    wrap.appendChild(portal); wrap.appendChild(name); wrap.appendChild(meta);
    wrap.onclick = () => {
      if (!allCards) { showToast('⚠', 'No Cards', `"${folderName}" has no flashcards yet.`); return; }
      window.location.href = `duel.html?realm=${encodeURIComponent(folderName)}`;
    };
    requestAnimationFrame(() => drawPixelPortal(canvas, colours));
    grid.appendChild(wrap);
  });
}

// ── Recursive folder helpers ──────────────────────────────────

// Get all deck names from a folder AND all its descendants (any depth)
function _getAllDecksInFolder(folderName) {
  const result = [];
  const folder = db.folders[folderName];
  if (!folder) return result;
  // Direct decks
  (folder.decks || []).forEach(d => { if (db.decks[d]) result.push(d); });
  // Child folders (recursive)
  Object.keys(db.folders)
    .filter(f => db.folders[f].parent === folderName)
    .forEach(child => result.push(..._getAllDecksInFolder(child)));
  return result;
}

// Get all cards from all decks in a folder tree, tagged with deckName
function _getAllCardsInFolder(folderName) {
  return _getAllDecksInFolder(folderName).flatMap(d =>
    (db.decks[d]?.cards || []).map(c => ({ ...c, deckName: d }))
  );
}

// Get immediate child folders of a parent that contain at least one card (anywhere in their tree)
function _getChildFoldersWithCards(parentName) {
  return Object.keys(db.folders)
    .filter(f => db.folders[f].parent === parentName)
    .filter(f => _getAllDecksInFolder(f).length > 0);
}

// ── Duel navigation stack ─────────────────────────────────────
let _duelFolderStack = []; // breadcrumb: [{name, label}]

function renderDuelSubRealms(realmName) {
  _duelFolderStack = [{ name: realmName, label: realmName }];
  _renderDuelFolderView(realmName);
}

function _renderDuelFolderView(folderName) {
  _showDuelView('duelSubView');

  const grid  = document.getElementById('duelSubGrid');
  const empty = document.getElementById('duelSubEmpty');
  const title = document.getElementById('duelSubTitle');
  const back  = document.getElementById('duelSubBack');
  const header = document.getElementById('duelHeaderTitle');

  grid.innerHTML = '';
  if (empty) empty.style.display = 'none';

  // Breadcrumb label
  const crumb = _duelFolderStack.map(s => s.label).join(' › ');
  if (title)  title.textContent  = crumb;
  if (header) header.textContent = _duelFolderStack[_duelFolderStack.length - 1].label;

  // Back button: go up one level in the stack
  if (back) {
    if (_duelFolderStack.length <= 1) {
      back.href = 'duel.html'; back.onclick = null;
    } else {
      back.href = '';
      back.onclick = (e) => {
        e.preventDefault();
        _duelFolderStack.pop();
        _renderDuelFolderView(_duelFolderStack[_duelFolderStack.length - 1].name);
      };
    }
  }

  const children   = _getChildFoldersWithCards(folderName);
  const directDecks = (db.folders[folderName]?.decks || []).filter(d => db.decks[d]);
  const allDecks    = _getAllDecksInFolder(folderName);
  const allCards    = _getAllCardsInFolder(folderName);

  // Nothing at all
  if (!allDecks.length) {
    if (empty) empty.style.display = 'block';
    return;
  }

  // ── "Duel All" tile (shown when there's more than one thing to pick from) ──
  if (children.length > 0 || directDecks.length > 1) {
    const tile = document.createElement('div');
    tile.className = 'duel-sub-card duel-sub-card-all';
    tile.innerHTML = `
      <div class="duel-sub-icon">⚔️</div>
      <div class="duel-sub-name">All — ${folderName}</div>
      <div class="duel-sub-meta">${allCards.length} card${allCards.length !== 1 ? 's' : ''} · ${allDecks.length} deck${allDecks.length !== 1 ? 's' : ''}</div>`;
    tile.onclick = () => _enterDuelMode(folderName, folderName, allDecks);
    grid.appendChild(tile);
  }

  // ── Direct decks in this folder ──
  directDecks.forEach(deckName => {
    const cards = db.decks[deckName]?.cards || [];
    if (!cards.length) return;
    const tile = document.createElement('div');
    tile.className = 'duel-sub-card';
    tile.innerHTML = `
      <div class="duel-sub-icon">📖</div>
      <div class="duel-sub-name">${deckName}</div>
      <div class="duel-sub-meta">${cards.length} card${cards.length !== 1 ? 's' : ''}</div>`;
    tile.onclick = () => _enterDuelMode(folderName, deckName, [deckName]);
    grid.appendChild(tile);
  });

  // ── Child sub-folders (with their own card counts) ──
  children.forEach(sf => {
    const sfDecks = _getAllDecksInFolder(sf);
    const sfCards = _getAllCardsInFolder(sf);
    const sfHasChildren = _getChildFoldersWithCards(sf).length > 0;

    const tile = document.createElement('div');
    tile.className = 'duel-sub-card';
    tile.innerHTML = `
      <div class="duel-sub-icon">${sfHasChildren ? '🗂' : '⚔️'}</div>
      <div class="duel-sub-name">${sf}${sfHasChildren ? ' ›' : ''}</div>
      <div class="duel-sub-meta">${sfCards.length} card${sfCards.length !== 1 ? 's' : ''} · ${sfDecks.length} deck${sfDecks.length !== 1 ? 's' : ''}</div>`;
    tile.onclick = () => {
      if (sfHasChildren) {
        // Drill deeper
        _duelFolderStack.push({ name: sf, label: sf });
        _renderDuelFolderView(sf);
      } else {
        // Leaf — go straight to mode selector
        _enterDuelMode(folderName, sf, sfDecks);
      }
    };
    grid.appendChild(tile);
  });

  if (!grid.children.length && empty) empty.style.display = 'block';
}

// Set up state and show mode selector
function _enterDuelMode(realmName, subName, deckNames) {
  _aiDuelPendingRealm = realmName;
  _aiDuelPendingSub   = subName;
  const validDecks    = deckNames.filter(d => db.decks[d]);
  _aiDuelDeckName     = validDecks[0] || subName;
  _aiDuelDeck         = { cards: validDecks.flatMap(d => db.decks[d]?.cards || []) };
  _showDuelView('duelModeView');
}

function startDuelStudy(realmName, subName) {
  _showDuelView('duelStudyView');
  const header = document.getElementById('duelHeaderTitle');
  const back = document.getElementById('duelStudyBack');
  if (header) header.textContent = `⚔️ ${subName}`;
  if (back) back.href = `duel.html?realm=${encodeURIComponent(realmName)}`;

  // Recursively collect ALL cards from the folder and every descendant
  duelQueue = [];
  const allDecks = _getAllDecksInFolder(subName);
  if (!allDecks.length) {
    showToast('⚠', 'No Cards', `No flashcards found in "${subName}"`);
    _showDuelView('duelSubView');
    return;
  }
  allDecks.forEach(deckName => {
    db.decks[deckName].cards.forEach((card, idx) => {
      duelQueue.push({ ...card, deckName, cardIndex: idx });
    });
  });

  // Shuffle
  duelQueue.sort(() => Math.random() - 0.5);

  duelIndex = 0;
  duelGreenStreak = 0; duelBestStreak = 0;
  duelSessionXP = 0; duelCardsAnswered = 0;
  duelRed = 0; duelAmber = 0; duelGreen = 0;
  duelStartTime = Date.now();
  duelLastMarked = null;

  updateDuelHUD();
  updateXPBar();
  updateFlame();
  updateRankDisplay();
  const ic = document.getElementById('islandCanvas');
  if (ic) drawPixelIsland(ic);
  drawFlame();
  renderDuelCard();
}

function renderDuelCard() {
  if (!duelQueue.length) {
    const front = document.getElementById('duelFrontContent');
    if (front) front.textContent = 'No cards found in this sub-realm';
    return;
  }
  const card = duelQueue[duelIndex];

  const inner = document.getElementById('duelCardInner');
  if (inner) inner.classList.remove('flipped');

  const front = document.getElementById('duelFrontContent');
  const back = document.getElementById('duelBackContent');
  const frontImg = document.getElementById('duelFrontImg');
  const backImg = document.getElementById('duelBackImg');
  const source = document.getElementById('duelDeckSource');

  if (front) front.innerHTML = parseMarkdown(card.front || '');
  if (back)  back.innerHTML  = parseMarkdown(card.back  || '');
  if (frontImg) frontImg.innerHTML = card.frontImg ? `<img src="${card.frontImg}" alt="">` : '';
  if (backImg) backImg.innerHTML = card.backImg ? `<img src="${card.backImg}" alt="">` : '';
  if (source) source.textContent = `📖 ${card.deckName}`;
}

let _lastDuelFlipTime = 0;
function flipDuelCard(e) {
  if (e && e.type === 'click' && (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) return;
  const now = Date.now();
  if (now - _lastDuelFlipTime < 350) return;
  _lastDuelFlipTime = now;
  const inner = document.getElementById('duelCardInner');
  if (inner) inner.classList.toggle('flipped');
}

function markDuel(level) {
  if (!duelQueue.length) return;
  const card = duelQueue[duelIndex];
  const today = todayStr();
  const orig = db.decks[card.deckName] && db.decks[card.deckName].cards[card.cardIndex];

  // Save undo snapshot
  duelLastMarked = {
    cardIndex: card.cardIndex, deckName: card.deckName,
    cardSnap: orig ? { due: orig.due, mastered: orig.mastered, interval: orig.interval, easeFactor: orig.easeFactor, repetitions: orig.repetitions } : null,
    statsSnap: { ragCounts: { ...db.stats.ragCounts }, cardsStudiedToday: db.stats.cardsStudiedToday, totalCardsStudied: db.stats.totalCardsStudied, greenStreak: db.stats.greenStreak, bestGreenStreak: db.stats.bestGreenStreak, todayDate: db.stats.todayDate },
    xpSnap: { level: db.xp.level, xp: db.xp.xp },
    today, heatmapCount: db.heatmap[today] || 0,
    sessionSnap: { streak: duelGreenStreak, xp: duelSessionXP, cards: duelCardsAnswered, red: duelRed, amber: duelAmber, green: duelGreen }
  };

  // Apply SM-2 back to original deck
  if (orig) {
    const result = sm2(orig, { red: 0, amber: 3, green: 5 }[level]);
    orig.due = result.due; orig.interval = result.interval;
    orig.easeFactor = result.easeFactor; orig.repetitions = result.repetitions;
    orig.mastered = level === 'green';
  }

  // Session tracking
  if (level === 'red') duelRed++;
  else if (level === 'amber') duelAmber++;
  else duelGreen++;

  // Global stats
  db.stats.ragCounts[level]++;
  if (db.stats.todayDate !== today) { db.stats.cardsStudiedToday = 0; db.stats.todayDate = today; }
  db.stats.cardsStudiedToday++;
  db.stats.totalCardsStudied++;
  db.heatmap[today] = (db.heatmap[today] || 0) + 1;
  duelCardsAnswered++;

  if (level === 'green') {
    duelGreenStreak++;
    if (duelGreenStreak > duelBestStreak) duelBestStreak = duelGreenStreak;
    addXP(1); duelSessionXP++;
    db.stats.greenStreak = (db.stats.greenStreak || 0) + 1;
    if (db.stats.greenStreak > (db.stats.bestGreenStreak || 0)) db.stats.bestGreenStreak = db.stats.greenStreak;
    if (!db.stats.duelBestStreak) db.stats.duelBestStreak = 0;
    if (duelGreenStreak > db.stats.duelBestStreak) db.stats.duelBestStreak = duelGreenStreak;

    if (duelGreenStreak % 10 === 0) {
      const bonus = Math.floor(Math.random() * 20) + 1;
      addXP(bonus); duelSessionXP += bonus;
      showToast('🏆', `${duelGreenStreak} Streak!`, `+${bonus} bonus XP`);
    } else if (duelGreenStreak % 3 === 0) {
      const bonus = Math.floor(Math.random() * 5) + 1;
      addXP(bonus); duelSessionXP += bonus;
      showToast('⚔️', '3 in a Row!', `+${bonus} bonus XP`);
    }

    showDuelMotivational(duelGreenStreak);
    if (db.settings.sound) playGreenSound();
  } else {
    duelGreenStreak = 0;
    db.stats.greenStreak = 0;
  }

  updateQuestProgress('cards', 1);
  checkAchievements();
  saveDB();
  updateDuelHUD();
  updateXPBar();
  updateFlame();

  duelIndex = (duelIndex + 1) % duelQueue.length;
  renderDuelCard();
}

function duelUndo() {
  if (!duelLastMarked) { showToast('↩️', 'Nothing to Undo', 'No recent rating to reverse'); return; }
  const { cardIndex, deckName, cardSnap, statsSnap, xpSnap, today, heatmapCount, sessionSnap } = duelLastMarked;
  if (cardSnap && db.decks[deckName] && db.decks[deckName].cards[cardIndex]) {
    Object.assign(db.decks[deckName].cards[cardIndex], cardSnap);
  }
  Object.assign(db.stats, statsSnap);
  db.xp.level = xpSnap.level; db.xp.xp = xpSnap.xp;
  db.heatmap[today] = heatmapCount;
  duelGreenStreak = sessionSnap.streak;
  duelSessionXP = sessionSnap.xp;
  duelCardsAnswered = sessionSnap.cards;
  duelRed = sessionSnap.red; duelAmber = sessionSnap.amber; duelGreen = sessionSnap.green;
  duelLastMarked = null;
  saveDB();
  duelIndex = (duelIndex - 1 + duelQueue.length) % duelQueue.length;
  renderDuelCard();
  updateDuelHUD();
  updateXPBar();
  updateFlame();
  showToast('↩️', 'Undone', 'Last rating reversed');
}

function duelNextCard() {
  duelIndex = (duelIndex + 1) % duelQueue.length;
  renderDuelCard();
}

function duelPrevCard() {
  duelIndex = (duelIndex - 1 + duelQueue.length) % duelQueue.length;
  renderDuelCard();
}

function duelShuffle() {
  duelQueue.sort(() => Math.random() - 0.5);
  duelIndex = 0;
  renderDuelCard();
}

function showDuelSummary() {
  const elapsed = Math.floor((Date.now() - duelStartTime) / 1000);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('duelSumRed',    duelRed);
  set('duelSumAmber',  duelAmber);
  set('duelSumGreen',  duelGreen);
  set('duelSumTotal',  duelCardsAnswered);
  set('duelSumTime',   timeFormat(elapsed));
  set('duelSumXP',     duelSessionXP);
  set('duelSumStreak', duelBestStreak);
  const modal = document.getElementById('duelSummaryModal');
  if (modal) modal.style.display = 'flex';
}

function hideDuelSummary() {
  const modal = document.getElementById('duelSummaryModal');
  if (modal) modal.style.display = 'none';
}

function updateDuelHUD() {
  const s = document.getElementById('duelStreakCount');
  const x = document.getElementById('duelSessionXP');
  const c = document.getElementById('duelCardCount');
  if (s) s.textContent = duelGreenStreak;
  if (x) x.textContent = duelSessionXP;
  if (c) c.textContent = duelCardsAnswered;
}

function showDuelMotivational(streak) {
  const msgs = { 5: '🔥 5 streak!', 10: '⚡ 10 streak!', 25: '🌟 25 — legendary!', 50: '👑 50 — GODLIKE!' };
  const el = document.getElementById('duelMotivational');
  if (!el || !msgs[streak]) return;
  el.textContent = msgs[streak];
  el.style.animation = 'none';
  requestAnimationFrame(() => { el.style.animation = 'motivFade 3s ease-out forwards'; });
}

// ============================================================
// CRAM MODE
// ============================================================
let cramMode = false;

function toggleCramMode() {
  cramMode = !cramMode;
  const btn = document.getElementById('cramBtn');
  if (btn) { btn.textContent = cramMode ? '📖 Cram ON' : '📖 Cram'; btn.classList.toggle('active', cramMode); }
  buildQueue();
  renderCard();
  showToast(cramMode ? '📖' : '✅', cramMode ? 'Cram Mode On' : 'Cram Mode Off',
    cramMode ? 'All cards shown — SM-2 paused' : 'Back to spaced repetition');
}

// In cram mode, mark() still records RAG but skips SM-2 scheduling
function _applySM2OrCram(orig, level) {
  if (cramMode) {
    // Don't change due/interval/easeFactor — just track the answer
    return;
  }
  const result = sm2(orig, { red: 0, amber: 3, green: 5 }[level]);
  orig.due = result.due; orig.interval = result.interval;
  orig.easeFactor = result.easeFactor; orig.repetitions = result.repetitions;
  orig.mastered = level === 'green';
}

// ============================================================
// CARD SEARCH
// ============================================================
function showCardSearch() {
  let modal = document.getElementById('cardSearchModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'cardSearchModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="rpg-modal search-modal" onclick="event.stopPropagation()">
        <div class="modal-title">🔍 Search Cards</div>
        <input class="rpg-input" id="searchInput" placeholder="Search front or back…" oninput="runCardSearch(this.value)" autocomplete="off">
        <div id="searchResults" class="search-results"></div>
        <div class="modal-actions"><button class="rpg-btn" onclick="hideCardSearch()">✖ Close</button></div>
      </div>`;
    modal.onclick = hideCardSearch;
    document.body.appendChild(modal);
  }
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = '';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('searchInput').focus(), 100);
}

function hideCardSearch() {
  const m = document.getElementById('cardSearchModal');
  if (m) m.style.display = 'none';
}

function runCardSearch(query) {
  const results = document.getElementById('searchResults');
  if (!results) return;
  if (!query.trim()) { results.innerHTML = ''; return; }
  const q = query.toLowerCase();
  const hits = [];
  Object.entries(db.decks).forEach(([deckName, deck]) => {
    (deck.cards || []).forEach((card, i) => {
      if ((card.front || '').toLowerCase().includes(q) || (card.back || '').toLowerCase().includes(q)) {
        hits.push({ deckName, card, index: i });
      }
    });
  });
  if (!hits.length) { results.innerHTML = '<p class="rpg-hint">No cards found.</p>'; return; }
  results.innerHTML = hits.slice(0, 30).map(h => `
    <div class="search-hit">
      <div class="search-hit-deck">${h.deckName}</div>
      <div class="search-hit-front">${h.card.front || ''}</div>
      <div class="search-hit-back">${h.card.back || ''}</div>
    </div>`).join('') + (hits.length > 30 ? `<p class="rpg-hint">…and ${hits.length - 30} more</p>` : '');
}

// ============================================================
// MULTIPLE CHOICE MODE
// ============================================================
let multipleChoiceMode = false;

function toggleMultipleChoice() {
  multipleChoiceMode = !multipleChoiceMode;
  const btn = document.getElementById('mcBtn');
  if (btn) { btn.textContent = multipleChoiceMode ? '🔠 MC ON' : '🔠 MC'; btn.classList.toggle('active', multipleChoiceMode); }
  renderCard();
  showToast('🔠', multipleChoiceMode ? 'Multiple Choice On' : 'Multiple Choice Off', '');
}

function renderMultipleChoice(correctAnswer) {
  const wrap = document.getElementById('mcOptions');
  if (!wrap || !currentDeck) return;
  wrap.innerHTML = '';
  if (!multipleChoiceMode) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'grid';
  // Get 3 wrong answers from other cards
  const others = currentDeck.cards
    .filter(c => (c.back || '').trim() !== (correctAnswer || '').trim() && c.back)
    .sort(() => Math.random() - 0.5).slice(0, 3);
  const options = [{ text: correctAnswer, correct: true }, ...others.map(c => ({ text: c.back, correct: false }))]
    .sort(() => Math.random() - 0.5);
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'mc-option';
    btn.innerHTML = parseMarkdown(opt.text || '');
    btn.onclick = () => {
      if (opt.correct) {
        btn.classList.add('mc-correct');
        setTimeout(() => mark('green'), 600);
      } else {
        btn.classList.add('mc-wrong');
        wrap.querySelectorAll('.mc-option').forEach(b => { if (b !== btn) b.classList.add('mc-correct'); });
        setTimeout(() => mark('red'), 1000);
      }
      wrap.querySelectorAll('.mc-option').forEach(b => b.disabled = true);
    };
    wrap.appendChild(btn);
  });
}

// ============================================================
// PER-CARD STATS
// ============================================================
let cardStatsVisible = false;

function toggleCardStats() {
  cardStatsVisible = !cardStatsVisible;
  renderCardStatsPanel();
}

function renderCardStatsPanel() {
  const panel = document.getElementById('cardStatsPanel');
  if (!panel) return;
  if (!cardStatsVisible || !queue.length) { panel.style.display = 'none'; return; }
  const card = currentDeck && currentDeck.cards[queue[queueIndex]?.index];
  if (!card) { panel.style.display = 'none'; return; }
  const due = card.due ? new Date(card.due).toLocaleDateString() : 'Now';
  const ease = card.easeFactor ? card.easeFactor.toFixed(2) : '2.50';
  const reps = card.repetitions || 0;
  const interval = card.interval || 0;
  panel.innerHTML = `<span>📅 Due: ${due}</span><span>🔁 Reps: ${reps}</span><span>📈 Ease: ${ease}</span><span>⏳ Interval: ${interval}d</span>`;
  panel.style.display = 'flex';
}

// ============================================================
// DUE FORECAST GRAPH
// ============================================================
function renderForecastGraph() {
  const canvas = document.getElementById('forecastCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const days = 14;
  const counts = Array(days).fill(0);
  const now = Date.now();
  Object.values(db.decks).forEach(deck => {
    (deck.cards || []).forEach(card => {
      if (!card.due) { counts[0]++; return; }
      const daysUntil = Math.floor((card.due - now) / 86400000);
      if (daysUntil >= 0 && daysUntil < days) counts[daysUntil]++;
    });
  });
  const max = Math.max(...counts, 1);
  ctx.clearRect(0, 0, W, H);
  const barW = Math.floor((W - 20) / days);
  const gold = '#c9a84c', dim = 'rgba(201,168,76,0.15)';
  counts.forEach((count, i) => {
    const barH = Math.max(2, Math.floor((count / max) * (H - 30)));
    const x = 10 + i * barW;
    const y = H - 20 - barH;
    ctx.fillStyle = i === 0 ? '#e74c3c' : gold;
    ctx.fillRect(x, y, barW - 2, barH);
    ctx.fillStyle = 'rgba(232,223,192,0.6)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    if (count > 0) ctx.fillText(count, x + (barW - 2) / 2, y - 2);
    ctx.fillStyle = dim;
    ctx.fillText(i === 0 ? 'T' : `+${i}`, x + (barW - 2) / 2, H - 6);
  });
}

// ============================================================
// CARD TAGGING
// ============================================================
let activeTagFilter = null;

function saveCardTags(tagsStr) {
  if (!queue.length) return;
  const card = currentDeck.cards[queue[queueIndex].index];
  card.tags = tagsStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  saveDB();
  renderTagChips();
}

function renderTagChips() {
  const wrap = document.getElementById('tagChips');
  if (!wrap || !queue.length) return;
  const card = currentDeck.cards[queue[queueIndex]?.index];
  wrap.innerHTML = (card?.tags || []).map(t =>
    `<span class="tag-chip">${t}</span>`).join('');
}

function getAllDeckTags() {
  const tags = new Set();
  (currentDeck?.cards || []).forEach(c => (c.tags || []).forEach(t => tags.add(t)));
  return [...tags];
}

function showTagFilter() {
  const tags = getAllDeckTags();
  if (!tags.length) { showToast('🏷️', 'No Tags', 'Add tags to cards using the edit panel'); return; }
  const html = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
    <button class="tag-chip ${!activeTagFilter ? 'active' : ''}" onclick="setTagFilter(null)">All</button>
    ${tags.map(t => `<button class="tag-chip ${activeTagFilter===t?'active':''}" onclick="setTagFilter('${t}')">${t}</button>`).join('')}
  </div>`;
  let m = document.getElementById('tagFilterModal');
  if (!m) {
    m = document.createElement('div'); m.id = 'tagFilterModal';
    m.className = 'modal-overlay'; m.onclick = () => { m.style.display = 'none'; };
    m.innerHTML = `<div class="rpg-modal" onclick="event.stopPropagation()"><div class="modal-title">🏷️ Filter by Tag</div><div id="tagFilterInner"></div><div class="modal-actions"><button class="rpg-btn" onclick="document.getElementById('tagFilterModal').style.display='none'">✖ Close</button></div></div>`;
    document.body.appendChild(m);
  }
  document.getElementById('tagFilterInner').innerHTML = html;
  m.style.display = 'flex';
}

function setTagFilter(tag) {
  activeTagFilter = tag;
  document.getElementById('tagFilterModal').style.display = 'none';
  buildQueue();
  renderCard();
  showToast('🏷️', tag ? `Filtered: ${tag}` : 'All cards', '');
}

// Override buildQueue to support tag filter
const _origBuildQueue = buildQueue;

// ============================================================
// STREAK FREEZE
// ============================================================
function buyStreakFreeze() {
  const cost = 50;
  if ((db.stats.lifetimeXP || 0) < cost && db.xp.xp < cost) {
    showToast('❌', 'Not Enough XP', `Streak freeze costs ${cost} XP`); return;
  }
  showConfirm('Buy Streak Freeze', `Spend ${cost} XP to protect your streak from breaking if you miss a day?`,
    () => {
      db.stats.streakFreezes = (db.stats.streakFreezes || 0) + 1;
      db.xp.xp = Math.max(0, db.xp.xp - cost);
      saveDB(); updateXPBar();
      showToast('🧊', 'Streak Freeze!', `You now have ${db.stats.streakFreezes} freeze${db.stats.streakFreezes > 1 ? 's' : ''}`);
      renderStreakFreezeUI();
    }, { icon: '🧊', confirmText: `🧊 Buy for ${cost} XP` });
}

function renderStreakFreezeUI() {
  const el = document.getElementById('streakFreezeCount');
  if (el) el.textContent = db.stats.streakFreezes || 0;
}

// ============================================================
// CSV / TSV IMPORT
// ============================================================
function parseCardLine(line) {
  // Try tab-separated first, then em-dash, then " - ", then comma
  let front, back;
  if (line.includes('\t')) {
    const parts = line.split('\t');
    front = parts[0].trim(); back = parts.slice(1).join('\t').trim();
  } else if (line.includes('—')) {
    const parts = line.split('—');
    front = parts[0].trim(); back = parts.slice(1).join('—').trim();
  } else if (line.includes(' - ')) {
    const parts = line.split(' - ');
    front = parts[0].trim(); back = parts.slice(1).join(' - ').trim();
  } else if (line.includes(',')) {
    // CSV: handle quoted fields
    const m = line.match(/^"?([^"]*)"?,(.*)$/);
    if (m) { front = m[1].trim(); back = m[2].replace(/^"|"$/g,'').trim(); }
  }
  if (!front || !back) return null;
  return { front, back, due: 0, mastered: false, tags: [] };
}

// ============================================================
// POMODORO TIMER
// ============================================================
let pomodoroInterval = null;
let pomodoroSecs = 0;
let pomodoroPhase = 'study';
let pomodoroActive = false;

function startPomodoro() {
  if (pomodoroActive) { stopPomodoro(); return; }
  pomodoroPhase = 'study';
  pomodoroSecs = 25 * 60;
  pomodoroActive = true;
  _tickPomodoro();
  const btn = document.getElementById('pomodoroBtn');
  if (btn) btn.textContent = '⏸ Stop Pomodoro';
}

function stopPomodoro() {
  clearInterval(pomodoroInterval);
  pomodoroActive = false;
  pomodoroSecs = 0;
  const btn = document.getElementById('pomodoroBtn');
  if (btn) btn.textContent = '🍅 Start Pomodoro';
  const disp = document.getElementById('pomodoroDisplay');
  if (disp) disp.textContent = '25:00';
}

function _tickPomodoro() {
  clearInterval(pomodoroInterval);
  pomodoroInterval = setInterval(() => {
    pomodoroSecs--;
    const disp = document.getElementById('pomodoroDisplay');
    if (disp) {
      const m = Math.floor(pomodoroSecs / 60).toString().padStart(2,'0');
      const s = (pomodoroSecs % 60).toString().padStart(2,'0');
      disp.textContent = `${m}:${s}`;
    }
    if (pomodoroSecs <= 0) {
      clearInterval(pomodoroInterval);
      if (pomodoroPhase === 'study') {
        pomodoroPhase = 'break';
        pomodoroSecs = 5 * 60;
        showToast('🍅', 'Break Time!', '5 minute break — well done!');
        _triggerNotification('Study session complete!', '5 minute break time.');
        _tickPomodoro();
      } else {
        pomodoroActive = false;
        showToast('✅', 'Break Over!', 'Ready for another session?');
        _triggerNotification('Break over!', 'Ready to study again?');
        stopPomodoro();
      }
    }
  }, 1000);
}

// ============================================================
// DECK SHARING
// ============================================================
function shareDeck(deckName) {
  const deck = db.decks[deckName];
  if (!deck) return;
  // Strip images from shared deck to keep URL small
  const stripped = JSON.parse(JSON.stringify(deck));
  (stripped.cards || []).forEach(c => { delete c.frontImg; delete c.backImg; delete c.due; delete c.mastered; delete c.interval; delete c.easeFactor; delete c.repetitions; });
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({ name: deckName, deck: stripped }))));
  const url = `${window.location.origin}/deck.html?shared=${encoded}`;
  // Copy to clipboard
  navigator.clipboard.writeText(url).then(() => {
    showToast('🔗', 'Link Copied!', 'Share this link to let friends import the deck');
  }).catch(() => {
    showToast('🔗', 'Share Link', url.slice(0, 60) + '…');
  });
}

function checkSharedDeckInURL() {
  const params = new URLSearchParams(window.location.search);
  const shared = params.get('shared');
  if (!shared) return;
  window.history.replaceState({}, '', window.location.pathname);
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(shared))));
    showConfirm(`Import "${parsed.name}"`,
      `Import ${parsed.deck?.cards?.length || 0} cards from a shared deck into a new realm?`,
      () => {
        const folders = Object.keys(db.folders);
        if (!folders.length) { showToast('❌', 'No Realms', 'Create a realm first, then import'); return; }
        let newName = parsed.name;
        let n = 2; while (db.decks[newName]) newName = `${parsed.name} (${n++})`;
        db.decks[newName] = { ...parsed.deck, cards: parsed.deck.cards.map(c => ({ ...c, due: 0, mastered: false })) };
        db.folders[folders[0]].decks = db.folders[folders[0]].decks || [];
        db.folders[folders[0]].decks.push(newName);
        saveDB();
        showToast('📥', 'Imported!', `"${newName}" added to ${folders[0]}`);
      }, { icon: '📥', confirmText: '📥 Import Deck' });
  } catch(e) { showToast('❌', 'Invalid Link', 'Could not parse shared deck'); }
}

// ============================================================
// FRIENDS
// ============================================================
async function addFriend(friendUid, friendName) {
  if (!_auth) return;
  await fetch(`${FB}/friends/${_auth.uid}/${friendUid}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: friendName, addedAt: Date.now() })
  });
  if (!db.friends) db.friends = {};
  db.friends[friendUid] = friendName;
  saveDB();
  showToast('👥', 'Friend Added', `${friendName} added to your friends`);
}

async function removeFriend(friendUid) {
  if (!_auth) return;
  await fetch(`${FB}/friends/${_auth.uid}/${friendUid}.json`, { method: 'DELETE' });
  delete db.friends[friendUid];
  saveDB();
}

async function loadFriends() {
  if (!_auth) return {};
  const res = await fetch(`${FB}/friends/${_auth.uid}.json`);
  if (!res.ok) return {};
  return (await res.json()) || {};
}

// ============================================================
// CHALLENGES
// ============================================================
async function challengeFriend(friendUid, friendName, deckName) {
  if (!_auth) return;
  const id = `${_auth.uid}_${friendUid}_${Date.now()}`;
  const challenge = {
    deck: deckName, from: _auth.uid, fromName: _auth.displayName,
    to: friendUid, toName: friendName,
    createdAt: Date.now(), status: 'pending',
    scores: { [_auth.uid]: null, [friendUid]: null }
  };
  await fetch(`${FB}/challenges/${id}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(challenge)
  });
  showToast('⚔️', 'Challenge Sent!', `${friendName} has been challenged on "${deckName}"`);
}

async function checkPendingChallenges() {
  if (!_auth) return;
  const res = await fetch(`${FB}/challenges.json`);
  if (!res.ok) return;
  const all = await res.json();
  if (!all) return;
  Object.entries(all).forEach(([id, c]) => {
    if (c.to === _auth.uid && c.status === 'pending' && !c.scores[_auth.uid]) {
      showToast('⚔️', 'Challenge!', `${c.fromName} challenges you on "${c.deck}"!`);
    }
  });
}

// ============================================================
// PUSH NOTIFICATIONS (Browser)
// ============================================================
function _triggerNotification(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/icon.svg' });
  }
}

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(p => {
      if (p === 'granted') showToast('🔔', 'Notifications On', 'You\'ll be reminded when cards are due');
      const el = document.getElementById('notifBtn');
      if (el) el.textContent = p === 'granted' ? '🔔 Notifications On' : '🔕 Enable Notifications';
    });
  }
}

function scheduleNotifications() {
  if (Notification.permission !== 'granted') return;
  let dueNow = 0;
  Object.values(db.decks).forEach(deck => {
    (deck.cards || []).forEach(c => { if ((c.due || 0) <= Date.now()) dueNow++; });
  });
  if (dueNow > 0) {
    setTimeout(() => _triggerNotification('Cards Due!', `You have ${dueNow} cards due — open Scholar's Sanctum to study`), 5000);
  }
}

// ============================================================
// IMAGE COMPRESSION
// ============================================================
function compressImage(dataUrl, maxDim, quality, callback) {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    callback(canvas.toDataURL('image/jpeg', quality));
  };
  img.src = dataUrl;
}

function loadFrontImage(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => compressImage(e.target.result, 600, 0.7, compressed => { pendingFrontImg = compressed; });
  reader.readAsDataURL(file);
}

function loadBackImage(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => compressImage(e.target.result, 600, 0.7, compressed => { pendingBackImg = compressed; });
  reader.readAsDataURL(file);
}

// ============================================================
// PRACTICE CHAMBER
// ============================================================
const BOOK_COLOURS = [
  { spine: '#8b1a1a', cover: '#c0392b', label: 'Crimson'  },
  { spine: '#1a5276', cover: '#2471a3', label: 'Sapphire' },
  { spine: '#145a32', cover: '#1e8449', label: 'Emerald'  },
  { spine: '#6c3483', cover: '#9b59b6', label: 'Violet'   },
  { spine: '#784212', cover: '#ca6f1e', label: 'Amber'    },
  { spine: '#1a5276', cover: '#148f77', label: 'Teal'     },
  { spine: '#4a235a', cover: '#7d3c98', label: 'Plum'     },
  { spine: '#6e2f1a', cover: '#b03a2e', label: 'Ruby'     },
];

// Hash a string to an integer (for deterministic per-book style)
function _nameHash(name) {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return h;
}

// Draw a pixelated book icon — each book gets a unique cover style based on its name
function drawPixelBook(canvas, colours, name) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const P = Math.max(2, Math.floor(Math.min(W, H) / 16));
  ctx.clearRect(0, 0, W, H);

  const cols = Math.floor(W / P), rows = Math.floor(H / P);
  const bw   = Math.floor(cols * 0.72);
  const bh   = Math.floor(rows * 0.84);
  const bx   = Math.floor((cols - bw) / 2);
  const by   = Math.floor((rows - bh) / 2);
  const sw   = Math.max(2, Math.floor(bw * 0.15)); // spine width in pixels

  function px(x, y, color, alpha) {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    ctx.globalAlpha = alpha ?? 1;
    ctx.fillStyle = color;
    ctx.fillRect(x * P, y * P, P, P);
    ctx.globalAlpha = 1;
  }

  const hash  = name ? _nameHash(name) : 0;
  const style = hash % 9;  // 9 distinct cover decoration styles

  // ── 1. Main cover body ──
  for (let r = by; r < by + bh; r++)
    for (let c = bx; c < bx + bw; c++)
      px(c, r, colours.cover);

  // ── 2. Spine ──
  for (let r = by; r < by + bh; r++)
    for (let c = bx; c < bx + sw; c++)
      px(c, r, colours.spine);

  // Spine inner highlight
  for (let r = by + 1; r < by + bh - 1; r++) px(bx + sw, r, '#ffffff', 0.18);

  // ── 3. Page edge (right) ──
  for (let r = by + 1; r < by + bh - 1; r++) {
    px(bx + bw - 1, r, '#f0e8cc');
    px(bx + bw - 2, r, '#d4c48a', 0.55);
  }

  // ── 4. Cover decoration by style ──
  const cx0 = bx + sw + 1; // inner cover left edge
  const cx1 = bx + bw - 3; // inner cover right edge
  const cy0 = by + 1;
  const cy1 = by + bh - 2;
  const midX = Math.floor((cx0 + cx1) / 2);
  const midY = Math.floor((cy0 + cy1) / 2);

  switch (style) {
    case 0: // Horizontal ruled lines (classic ledger)
      for (let r = cy0 + 2; r < cy1; r += 3)
        for (let c = cx0; c <= cx1; c++) px(c, r, '#000000', 0.14);
      break;

    case 1: // Bordered frame with inner diamond
      for (let c = cx0; c <= cx1; c++) { px(c, cy0, '#ffffff', 0.3); px(c, cy1, '#ffffff', 0.3); }
      for (let r = cy0; r <= cy1; r++) { px(cx0, r, '#ffffff', 0.3); px(cx1, r, '#ffffff', 0.3); }
      for (let r = cy0; r <= cy1; r++)
        for (let c = cx0; c <= cx1; c++)
          if (Math.abs(r - midY) + Math.abs(c - midX) <= Math.floor((cy1 - cy0) * 0.28))
            px(c, r, '#ffffff', 0.18);
      break;

    case 2: // Diagonal crosshatch
      for (let r = cy0; r <= cy1; r++)
        for (let c = cx0; c <= cx1; c++)
          if ((r - c) % 4 === 0 || (r + c) % 4 === 0) px(c, r, '#000000', 0.12);
      break;

    case 3: // Scattered star dots
      for (let r = cy0 + 2; r < cy1; r += 4)
        for (let c = cx0 + 2; c < cx1; c += 4) {
          px(c, r, '#ffffff', 0.35);
          px(c - 1, r, '#ffffff', 0.1);
          px(c + 1, r, '#ffffff', 0.1);
          px(c, r - 1, '#ffffff', 0.1);
          px(c, r + 1, '#ffffff', 0.1);
        }
      break;

    case 4: // Heraldic shield plaque
      { const pw = Math.floor((cx1 - cx0) * 0.55), ph = Math.floor((cy1 - cy0) * 0.5);
        const px0 = midX - Math.floor(pw / 2), py0 = midY - Math.floor(ph / 2);
        for (let r = py0; r < py0 + ph; r++)
          for (let c = px0; c < px0 + pw; c++) px(c, r, '#ffffff', 0.18);
        // shield cross
        for (let r = py0 + 1; r < py0 + ph - 1; r++) px(midX, r, colours.spine, 0.7);
        for (let c = px0 + 1; c < px0 + pw - 1; c++) px(c, midY, colours.spine, 0.7);
        // shield border
        for (let c = px0; c < px0 + pw; c++) { px(c, py0, '#c9a84c', 0.5); px(c, py0 + ph - 1, '#c9a84c', 0.5); }
        for (let r = py0; r < py0 + ph; r++) { px(px0, r, '#c9a84c', 0.5); px(px0 + pw - 1, r, '#c9a84c', 0.5); }
      }
      break;

    case 5: // Vertical column stripes
      for (let c = cx0 + 2; c <= cx1; c += 4)
        for (let r = cy0; r <= cy1; r++) px(c, r, '#000000', 0.11);
      break;

    case 6: // Corner ornament flourishes
      { const os = Math.floor(Math.min(cx1 - cx0, cy1 - cy0) * 0.22);
        // top-left corner
        for (let i = 0; i <= os; i++) { px(cx0 + i, cy0, '#c9a84c', 0.5); px(cx0, cy0 + i, '#c9a84c', 0.5); }
        // top-right
        for (let i = 0; i <= os; i++) { px(cx1 - i, cy0, '#c9a84c', 0.5); px(cx1, cy0 + i, '#c9a84c', 0.5); }
        // bottom-left
        for (let i = 0; i <= os; i++) { px(cx0 + i, cy1, '#c9a84c', 0.5); px(cx0, cy1 - i, '#c9a84c', 0.5); }
        // bottom-right
        for (let i = 0; i <= os; i++) { px(cx1 - i, cy1, '#c9a84c', 0.5); px(cx1, cy1 - i, '#c9a84c', 0.5); }
        // centre dot
        px(midX, midY, '#c9a84c', 0.6);
      }
      break;

    case 7: // Aged parchment stipple + horizontal rule
      for (let r = cy0; r <= cy1; r++)
        for (let c = cx0; c <= cx1; c++)
          if ((_nameHash(name + r + c) % 12) < 2) px(c, r, '#000000', 0.15);
      for (let r = cy0 + 2; r < cy1; r += 5)
        for (let c = cx0; c <= cx1; c++) px(c, r, '#ffffff', 0.12);
      break;

    case 8: // Bold centre stripe / band
      { const bw2 = Math.floor((cy1 - cy0) * 0.22);
        for (let r = midY - bw2; r <= midY + bw2; r++)
          for (let c = cx0; c <= cx1; c++) px(c, r, '#ffffff', 0.2);
        for (let c = cx0; c <= cx1; c++) {
          px(c, midY - bw2, '#c9a84c', 0.45);
          px(c, midY + bw2, '#c9a84c', 0.45);
        }
      }
      break;
  }

  // ── 5. Gold clasp (position varies by hash) ──
  const claspY = by + Math.floor(bh * (0.35 + (hash % 5) * 0.07));
  px(bx + bw - 2, claspY, '#c9a84c');
  px(bx + bw - 2, claspY + 1, '#c9a84c');
  px(bx + bw - 3, claspY, '#e8c060', 0.6);

  // ── 6. Spine ornaments ──
  const spineOrnY1 = by + 2;
  const spineOrnY2 = by + bh - 3;
  const spineX = bx + Math.floor(sw / 2);
  px(spineX, spineOrnY1, '#c9a84c', 0.8);
  px(spineX, spineOrnY2, '#c9a84c', 0.8);
  if (sw >= 3) {
    px(spineX - 1, spineOrnY1, '#c9a84c', 0.4);
    px(spineX + 1, spineOrnY1, '#c9a84c', 0.4);
    px(spineX - 1, spineOrnY2, '#c9a84c', 0.4);
    px(spineX + 1, spineOrnY2, '#c9a84c', 0.4);
  }

  // ── 7. Cover top/bottom edges ──
  for (let c = bx; c < bx + bw; c++) {
    px(c, by, colours.spine, 0.85);
    px(c, by + bh - 1, colours.spine, 0.85);
  }
}

let activeScrollName = null;
let currentQuestion  = '';
let practiceStreak   = 0;
let writeWPMStart    = null;
let writeWPMInterval = null;
let writeElapsed     = 0;
let writeTimerOn     = false;
let tablePanelOpen   = false;

function loadPracticePage() {
  if (!db.practiceBooks) db.practiceBooks = {};
  if (!db.stats.practiceStreak)      db.stats.practiceStreak = 0;
  if (!db.stats.practiceTotalAnswers) db.stats.practiceTotalAnswers = 0;
  if (!db.stats.practiceBestWPM)      db.stats.practiceBestWPM = 0;
  if (!db.stats.practiceTodayAnswers) db.stats.practiceTodayAnswers = {};
  practiceStreak = db.stats.practiceStreak || 0;
  _renderScrollColourPicker();
  renderScrollPickerGrid();
  _initDraggableTable();
}

let _renamingBook = null;

function renderScrollPickerGrid() {
  const pv = document.getElementById('scrollPickerView');
  const wv = document.getElementById('scrollWriteView');
  if (pv) pv.style.display = 'block';
  if (wv) wv.style.display = 'none';

  const grid  = document.getElementById('scrollPickerGrid');
  const empty = document.getElementById('scrollPickerEmpty');
  if (!grid) return;
  grid.innerHTML = '';

  const books = Object.keys(db.practiceBooks || {});
  if (!books.length) { if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';

  books.forEach(name => {
    const book    = db.practiceBooks[name];
    const colours = BOOK_COLOURS[(book.colourIndex || 0) % BOOK_COLOURS.length];
    const count   = (book.sessions || []).length;

    // Outer portal-style wrap
    const wrap = document.createElement('div');
    wrap.className = 'portal-wrap book-portal-wrap';

    // Book canvas (portal-sized)
    const bookDiv = document.createElement('div');
    bookDiv.className = 'portal book-portal';
    bookDiv.style.color = colours.cover;

    const canvas = document.createElement('canvas');
    canvas.className = 'portal-canvas';
    canvas.width = 130; canvas.height = 130;
    bookDiv.appendChild(canvas);

    // Delete button (top-left like portal-delete)
    const delBtn = document.createElement('button');
    delBtn.className = 'portal-delete';
    delBtn.textContent = '✕';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      showConfirm(`Delete "${name}"`, `All ${count} entries will be permanently deleted.`,
        () => {
          delete db.practiceBooks[name];
          if (activeScrollName === name) {
            activeScrollName = null;
            currentQuestion  = '';
            _pageIndex       = -1;
          }
          saveDB();
          renderScrollPickerGrid();
        },
        { icon: '🗑️', confirmText: '🗑 Delete', danger: true });
    };
    bookDiv.appendChild(delBtn);

    // Rename button (top-right like deck menu)
    const renBtn = document.createElement('button');
    renBtn.className = 'portal-menu-btn';
    renBtn.textContent = '✏️';
    renBtn.title = 'Rename';
    renBtn.onclick = (e) => { e.stopPropagation(); showRenameBook(name); };
    bookDiv.appendChild(renBtn);

    // Name and meta (below, like portal-name / portal-meta)
    const nameEl = document.createElement('div');
    nameEl.className = 'portal-name';
    nameEl.textContent = name;

    const meta = document.createElement('div');
    meta.className = 'portal-meta';
    meta.textContent = `${count} entr${count === 1 ? 'y' : 'ies'}`;

    wrap.appendChild(bookDiv);
    wrap.appendChild(nameEl);
    wrap.appendChild(meta);
    wrap.onclick = () => openScrollForWriting(name);
    grid.appendChild(wrap);

    requestAnimationFrame(() => drawPixelBook(canvas, colours, name));
  });
}

function showRenameBook(name) {
  _renamingBook = name;
  const modal = document.getElementById('renameBookModal');
  const input = document.getElementById('renameBookInput');
  if (!modal || !input) return;
  input.value = name;
  modal.style.display = 'flex';
  setTimeout(() => input.focus(), 100);
}

function hideRenameBook() {
  _renamingBook = null;
  const modal = document.getElementById('renameBookModal');
  if (modal) modal.style.display = 'none';
}

function confirmRenameBook() {
  const newName = (document.getElementById('renameBookInput')?.value || '').trim();
  if (!newName || !_renamingBook) return;
  if (newName === _renamingBook) { hideRenameBook(); return; }
  if (db.practiceBooks[newName]) { showToast('❌', 'Name Taken', 'A book with that name already exists'); return; }
  db.practiceBooks[newName] = db.practiceBooks[_renamingBook];
  delete db.practiceBooks[_renamingBook];
  if (activeScrollName === _renamingBook) activeScrollName = newName;
  saveDB();
  hideRenameBook();
  renderScrollPickerGrid();
  showToast('✅', 'Renamed', `"${newName}"`);
}

function openScrollForWriting(name) {
  activeScrollName = name;
  currentQuestion  = '';
  const sessions = db.practiceBooks[name]?.sessions || [];
  if (sessions.length) currentQuestion = sessions[0].question || '';
  document.getElementById('scrollPickerView').style.display = 'none';
  document.getElementById('scrollWriteView').style.display  = 'flex';
  const nameEl = document.getElementById('writeScrollName');
  if (nameEl) nameEl.textContent = name;
  _pageIndex = -1;
  _renderQuestion();
  renderSavedEntries();
  _updatePracticeStats();
  _updatePageNum();
  _loadWriteFormat();
  _loadDraft(name);
  _startAutosave();
  setTimeout(() => {
    const ic = document.getElementById('islandCanvas');
    if (ic) drawPixelIsland(ic);
  }, 80);
}

function exitToScrollPicker() {
  clearWriteArea();
  _resetWriteTimer();
  renderScrollPickerGrid();
}

function _populateScrollSelect() {
  const sel = document.getElementById('writeScrollSelect');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— Select Scroll —</option>';
  Object.keys(db.practiceBooks).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if (name === activeScrollName) opt.selected = true;
    sel.appendChild(opt);
  });
}

function switchScroll() {
  const sel = document.getElementById('writeScrollSelect');
  activeScrollName = sel?.value || null;
  currentQuestion = '';
  _applyScrollSelect();
}

function _applyScrollSelect() {
  const sel = document.getElementById('writeScrollSelect');
  if (sel && activeScrollName) sel.value = activeScrollName;
  // Load last question for this scroll
  const book = db.practiceBooks[activeScrollName];
  if (book && book.sessions && book.sessions.length) {
    currentQuestion = book.sessions[0].question || '';
  } else {
    currentQuestion = '';
  }
  _renderQuestion();
  renderSavedEntries();
  _updatePracticeStats();
}

function _renderQuestion() {
  const el = document.getElementById('writeQuestionText');
  if (!el) return;
  el.textContent = currentQuestion || '❓ Click to set your question or prompt…';
  el.style.color = currentQuestion ? 'var(--gold-light)' : 'var(--text-dim)';
}

// ---- Scroll management ----
function showNewScrollModal() {
  document.getElementById('newScrollModal').style.display = 'flex';
  setTimeout(() => document.getElementById('newScrollName').focus(), 100);
}
function hideNewScrollModal() {
  document.getElementById('newScrollModal').style.display = 'none';
  document.getElementById('newScrollName').value = '';
}

function createScroll() {
  const name = (document.getElementById('newScrollName').value || '').trim();
  if (!name) return;
  if (db.practiceBooks[name]) { showToast('❌', 'Exists', 'A scroll with that name already exists'); return; }
  const sel = document.querySelector('#scrollColourPicker .colour-swatch.selected');
  const colIdx = sel ? parseInt(sel.dataset.index) : 0;
  db.practiceBooks[name] = { sessions: [], colourIndex: colIdx, createdAt: Date.now() };
  saveDB();
  hideNewScrollModal();
  openScrollForWriting(name);
  showToast('📜', 'Book Created', `"${name}" is ready`);
}

function deleteActiveScroll() {
  if (!activeScrollName) { showToast('⚠️', 'No Scroll', 'Select a scroll first'); return; }
  showConfirm(`Delete "${activeScrollName}"`,
    `All ${(db.practiceBooks[activeScrollName]?.sessions||[]).length} entries will be permanently deleted.`,
    () => {
      delete db.practiceBooks[activeScrollName];
      activeScrollName = null; currentQuestion = '';
      saveDB();
      exitToScrollPicker();
      showToast('🗑️', 'Deleted', 'Book removed');
    }, { icon: '🗑️', confirmText: '🗑 Delete Scroll', danger: true });
}

function _renderScrollColourPicker() {
  const picker = document.getElementById('scrollColourPicker');
  if (!picker) return;
  picker.innerHTML = '';
  BOOK_COLOURS.forEach((c, i) => {
    const sw = document.createElement('div');
    sw.className = 'colour-swatch' + (i === 0 ? ' selected' : '');
    sw.style.background = c.cover;
    sw.dataset.index = i;
    sw.title = c.label;
    sw.onclick = () => { picker.querySelectorAll('.colour-swatch').forEach(s => s.classList.remove('selected')); sw.classList.add('selected'); };
    picker.appendChild(sw);
  });
}

// ---- Question ----
function showAddQuestion() {
  const modal = document.getElementById('addQuestionModal');
  if (!modal) return;
  document.getElementById('questionInput').value = currentQuestion;
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('questionInput').focus(), 100);
}
function hideAddQuestion() {
  document.getElementById('addQuestionModal').style.display = 'none';
}
function setQuestion() {
  currentQuestion = (document.getElementById('questionInput').value || '').trim();
  _renderQuestion();
  hideAddQuestion();
}

// ---- WPM / Timer ----
function startWriteTimer() {
  if (writeTimerOn) return;
  writeTimerOn = true;
  writeWPMStart = Date.now();
  writeElapsed = 0;
  writeWPMInterval = setInterval(() => {
    writeElapsed = Math.floor((Date.now() - writeWPMStart) / 1000);
    const m = String(Math.floor(writeElapsed/60)).padStart(2,'0');
    const s = String(writeElapsed%60).padStart(2,'0');
    const el = document.getElementById('wWriteTimer');
    if (el) el.textContent = `${m}:${s}`;
    _updateWPMDisplay();
  }, 500);
}

const WRITE_XP_INTERVAL = 50; // award XP every 50 words
let _lastXPWordMilestone = 0;

function _updateWPMDisplay() {
  const ta = document.getElementById('writeTextarea');
  if (!ta) return;
  const words = ta.value.trim().split(/\s+/).filter(Boolean).length;
  const mins  = writeElapsed / 60;
  const wpm   = mins > 0 ? Math.round(words / mins) : 0;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('wWriteWPM',  wpm);
  set('wWriteWords', words);
  // Push live WPM to right panel stat box
  set('wBestRight', wpm);
  set('wBestWPM',   wpm);

  // Award random XP every WRITE_XP_INTERVAL words
  const milestone = Math.floor(words / WRITE_XP_INTERVAL);
  if (milestone > _lastXPWordMilestone && words > 0) {
    _lastXPWordMilestone = milestone;
    const bonus = Math.floor(Math.random() * 20) + 1;
    addXP(bonus);
    saveDB();
    showToast('✍️', `${words} words!`, `+${bonus} XP for your writing`);
  }
}

// _pageIndex: -1 = new blank, 0 = newest saved, N-1 = oldest saved
let _pageIndex = -1;

// ── Page preview (rendered markdown + math) ──
let _pageInPreview = false;

function togglePagePreview() { _showPagePreview(!_pageInPreview); }

function _showPagePreview(show) {
  const ta      = document.getElementById('writeTextarea');
  const preview = document.getElementById('writePreview');
  const btn     = document.getElementById('previewToggleBtn');
  if (!ta || !preview) return;
  _pageInPreview = show;
  if (show) {
    preview.innerHTML = '<div class="page-preview-content">' + parseMarkdown(ta.value || '') + '</div>';
    _renderMath(preview);
    ta.style.display = 'none';
    preview.style.display = 'block';
    if (btn) { btn.textContent = '✏️ Edit'; btn.title = 'Back to editing'; }
  } else {
    ta.style.display = '';
    preview.style.display = 'none';
    if (btn) { btn.textContent = '👁 Preview'; btn.title = 'Preview with rendered math'; }
    setTimeout(() => ta.focus(), 50);
  }
}

let _wpmDebounce = null;
function onWriteInput() {
  if (!writeTimerOn) startWriteTimer();
  clearTimeout(_wpmDebounce);
  _wpmDebounce = setTimeout(_updateWPMDisplay, 300);
}

function _getPages() {
  return db.practiceBooks[activeScrollName]?.sessions || [];
}

function _totalPages() {
  return _getPages().length;
}

// Human-readable page number (oldest = 1, newest = N, new blank = N+1)
function _humanPage() {
  const t = _totalPages();
  return _pageIndex === -1 ? t + 1 : t - _pageIndex;
}

function _updatePageNum() {
  const el = document.getElementById('pageFootNum');
  if (!el) return;
  const t = _totalPages();
  const p = _humanPage();
  el.textContent = t === 0 ? 'Page 1' : `Page ${p} of ${_pageIndex === -1 ? t + 1 : t}`;
}

// Save current textarea content before navigating away
function _saveCurrentPageContent() {
  const ta = document.getElementById('writeTextarea');
  if (!ta) return;
  const content = ta.value.trim();
  const book = db.practiceBooks[activeScrollName];
  if (!book) return;

  if (_pageIndex === -1) {
    // New blank page — only save if there's content
    if (!content) return;
    book.sessions.unshift({
      id: Date.now(),
      question: currentQuestion,
      answer: content,
      wpm: 0, wordCount: content.split(/\s+/).filter(Boolean).length,
      duration: writeElapsed, timestamp: Date.now()
    });
    _pageIndex = 0;
  } else {
    if (!content) {
      // Page was cleared — delete this entry entirely
      book.sessions.splice(_pageIndex, 1);
      _pageIndex = -1;
      showToast('🗑️', 'Blank Page Removed', 'Empty page deleted automatically');
    } else {
      // Update existing page
      if (book.sessions[_pageIndex]) {
        book.sessions[_pageIndex].answer = content;
        book.sessions[_pageIndex].wordCount = content.split(/\s+/).filter(Boolean).length;
      }
    }
  }
  saveDB();
}

function _loadPage(index) {
  const pages = _getPages();
  const ta    = document.getElementById('writeTextarea');
  const qEl   = document.getElementById('writeQuestionText');
  if (!ta) return;

  if (index === -1) {
    // New blank page
    _pageIndex       = -1;
    ta.value         = '';
    ta.readOnly      = false;
    ta.style.opacity = '';
    currentQuestion  = '';
    _renderQuestion();
    _resetWriteTimer();
  } else {
    _pageIndex       = index;
    const entry      = pages[index];
    ta.value         = entry?.answer || '';
    ta.readOnly      = false; // allow editing any page
    ta.style.opacity = '1';
    if (entry?.question) { currentQuestion = entry.question; _renderQuestion(); }
  }

  _updatePageNum();
  _loadWriteFormat();
  // Exit preview mode when navigating to a new page
  if (_pageInPreview) _showPagePreview(false);
  else ta.focus();
  _refreshAIContext();
}

function goPrevPage() {
  const prevIdx = _pageIndex; // capture before save changes it
  _saveCurrentPageContent();
  const pages = _getPages();
  if (!pages.length) { showToast('📖', 'No pages yet', 'Write something first'); return; }

  if (prevIdx === -1) {
    _loadPage(0); // go to newest saved
  } else if (prevIdx < pages.length - 1) {
    _loadPage(prevIdx + 1); // go to older
  } else {
    showToast('📖', 'First Page', 'You\'re at the beginning');
  }
}

function goNextPage() {
  const prevIdx = _pageIndex; // capture before save changes it
  _saveCurrentPageContent();
  const pages = _getPages();

  if (prevIdx > 0) {
    _loadPage(prevIdx - 1); // go to newer saved page
  } else {
    // On newest saved (0) or new blank (-1) — open a fresh blank
    _loadPage(-1);
  }
}

// ---- Write formatting ----
function applyWriteFormat() {
  const ta   = document.getElementById('writeTextarea');
  const size = document.getElementById('fontSizeSelect')?.value || '12pt';
  if (!ta) return;
  ta.style.fontSize = size;
  ta.style.color    = '#ffffff';
  localStorage.setItem('writeFontSize', size);
}

function _loadWriteFormat() {
  const size = localStorage.getItem('writeFontSize') || '12pt';
  const sel  = document.getElementById('fontSizeSelect');
  if (sel) sel.value = size;
  applyWriteFormat();
}

function _resetWriteTimer() {
  clearInterval(writeWPMInterval);
  writeTimerOn = false; writeWPMStart = null; writeElapsed = 0;
  _lastXPWordMilestone = 0;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('wWriteWPM','0'); set('wWriteWords','0'); set('wWriteTimer','00:00');
  set('wBestRight','0'); set('wBestWPM','0');
}

// ---- Submit ----
function submitWriteEntry() {
  if (!activeScrollName) { showToast('⚠️', 'No Scroll Selected', 'Choose or create a scroll first'); return; }
  const ta = document.getElementById('writeTextarea');
  const answer = (ta?.value || '').trim();
  if (!answer) { showToast('⚠️', 'Nothing to Save', 'Write something first'); return; }

  const words = answer.split(/\s+/).filter(Boolean).length;
  const mins  = writeElapsed / 60;
  const wpm   = mins > 0 ? Math.round(words / mins) : 0;
  const tableRaw = (document.getElementById('tablePanelInput')?.value || '').trim();
  const tableData = tableRaw ? _parseAnyTable(tableRaw) : null;

  const entry = {
    id: Date.now(),
    question: currentQuestion,
    answer,
    tableData,
    wpm, wordCount: words, duration: writeElapsed,
    timestamp: Date.now()
  };

  if (!db.practiceBooks[activeScrollName].sessions) db.practiceBooks[activeScrollName].sessions = [];
  db.practiceBooks[activeScrollName].sessions.unshift(entry);

  // Stats
  practiceStreak++;
  db.stats.practiceStreak = practiceStreak;
  db.stats.practiceTotalAnswers = (db.stats.practiceTotalAnswers || 0) + 1;
  if (wpm > (db.stats.practiceBestWPM || 0)) db.stats.practiceBestWPM = wpm;
  const today = todayStr();
  db.stats.practiceTodayAnswers[today] = (db.stats.practiceTodayAnswers[today] || 0) + 1;

  saveDB();
  ta.value = ''; ta.readOnly = false; ta.style.opacity = '';
  _resetWriteTimer();
  _clearDraft(activeScrollName);
  stopExamMode();
  _pageIndex = -1;
  renderSavedEntries();
  _updatePracticeStats();
  _updatePageNum();
  showToast('✅', 'Saved!', `${words} words · ${wpm} WPM · Streak ${practiceStreak}`);
}

function clearWriteArea() {
  const ta = document.getElementById('writeTextarea');
  if (ta) ta.value = '';
  _resetWriteTimer();
}

function _updatePracticeStats() {
  const today = todayStr();
  const todayCount = (db.stats.practiceTodayAnswers||{})[today] || 0;
  const streak = db.stats.practiceStreak || 0;
  const total  = db.stats.practiceTotalAnswers || 0;
  const best   = db.stats.practiceBestWPM || 0;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('wStreakRight',   streak);
  set('wTodayRight',   todayCount);
  set('wBestRight',    best);
  set('wAnswersRight', total);
}

// ---- Table panel ----
let tableGridData = null; // { headers:[], rows:[][], showTotals:bool, sortDir:{} }

function toggleTablePanel() {
  const panel = document.getElementById('tablePanel');
  if (!panel) return;
  tablePanelOpen = !tablePanelOpen;
  panel.style.display = tablePanelOpen ? 'flex' : 'none';
  if (tablePanelOpen) {
    // Restore saved grid from sessionStorage if nothing in memory
    if (!tableGridData) {
      try {
        const saved = sessionStorage.getItem('tableGrid');
        if (saved) tableGridData = JSON.parse(saved);
      } catch {}
    }
    if (!tableGridData) _initEmptyGrid();
    else _renderTableGrid(); // re-render restored data
  }
}

let _tablePanelMaximised = false;
function maximiseTablePanel() {
  const panel = document.getElementById('tablePanel');
  if (!panel) return;
  _tablePanelMaximised = !_tablePanelMaximised;
  if (_tablePanelMaximised) {
    panel.style.cssText = 'display:flex;position:fixed;inset:10px;width:auto;height:auto;min-width:unset;min-height:unset;z-index:199;';
  } else {
    panel.style.cssText = 'display:flex;position:fixed;right:20px;bottom:140px;width:420px;min-width:260px;min-height:280px;z-index:199;';
  }
}

function startDragPanel(e) {
  const panel = document.getElementById('tablePanel');
  if (!panel || _tablePanelMaximised) return;
  const isTouch = e.type === 'touchstart';
  const startX = isTouch ? e.touches[0].clientX : e.clientX;
  const startY = isTouch ? e.touches[0].clientY : e.clientY;
  const rect = panel.getBoundingClientRect();
  const offX = startX - rect.left, offY = startY - rect.top;
  function move(ev) {
    const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
    panel.style.left = (cx - offX) + 'px'; panel.style.top = (cy - offY) + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
  }
  function up() {
    document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
    document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up);
  }
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  document.addEventListener('touchmove', move, {passive:true}); document.addEventListener('touchend', up);
}

// Parse pasted text into grid state
// First column of pasted data → row headers; remaining columns → data
function livePreviewTable() {
  const el = document.getElementById('tablePanelInput');
  const input = el?.value || '';
  if (!input.trim()) return;
  const parsed = _parseAnyTable(input);
  if (parsed && parsed.headers.length >= 1) {
    const hasRowHeaders = parsed.headers.length > 1;
    tableGridData = {
      rowHeaderLabel : hasRowHeaders ? parsed.headers[0] : '',
      headers        : hasRowHeaders ? parsed.headers.slice(1) : parsed.headers,
      rowHeaders     : parsed.rows.map(r => hasRowHeaders ? (r[0] || '') : ''),
      rows           : parsed.rows.map(r => hasRowHeaders ? r.slice(1) : [...r]),
      showTotals     : false,
      sortDir        : {}
    };
    _renderTableGrid();
    if (el) el.value = '';
  } else {
    // Show error in container
    const c = document.getElementById('tableGridContainer');
    if (c) c.innerHTML = '<div style="padding:10px;color:#ff9090;font-family:Cinzel,serif;font-size:0.75rem">⚠ Could not detect table format. Paste Excel (tab-separated), CSV, or Markdown ( | col | ).</div>';
  }
}

// Render the editable grid — column headers top, row headers left, fully bordered
function _renderTableGrid() {
  const container = document.getElementById('tableGridContainer');
  if (!container) return;
  if (!tableGridData) { container.innerHTML = ''; return; }

  const { headers, rows, rowHeaders = [], rowHeaderLabel = '', showTotals } = tableGridData;
  const nc = headers.length;
  const nr = rows.length;

  // Column totals (only when every cell in the column is numeric)
  const totals = headers.map((_, ci) => {
    const vals = rows.map(r => parseFloat(String(r[ci] || '').replace(/,/g, '')));
    const nums = vals.filter(n => !isNaN(n) && isFinite(n));
    return nums.length === nr && nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null;
  });

  // ── Header row: [corner] [col headers…] ──
  let thead = '<thead><tr>';
  // Corner cell (row-header label, editable)
  thead += '<th class="tgrid-th tgrid-corner">'
    + '<span class="tgrid-th-text" contenteditable="true"'
    + ' onblur="tableGridData.rowHeaderLabel=this.textContent.trim()"'
    + ' onfocus="event.stopPropagation()" onclick="event.stopPropagation()"'
    + ' style="font-style:italic;opacity:0.7">'
    + _tesc(rowHeaderLabel || '') + '</span></th>';
  // Column headers
  headers.forEach((h, ci) => {
    thead += '<th class="tgrid-th">'
      + '<div class="tgrid-th-inner">'
      + '<span class="tgrid-th-text" contenteditable="true"'
      + ' onblur="tableGridData.headers[' + ci + ']=this.textContent.trim()"'
      + ' onfocus="event.stopPropagation()" onclick="event.stopPropagation()">'
      + _tesc(h) + '</span>'
      + '<button class="tgrid-sort" onclick="_sortTableByCol(' + ci + ')" title="Sort ⇅">⇅</button>'
      + '</div></th>';
  });
  thead += '</tr></thead>';

  // ── Body rows: [row header] [cells…] ──
  let tbody = '<tbody>';
  rows.forEach((row, ri) => {
    tbody += '<tr>';
    // Row header cell
    const rh = rowHeaders[ri] != null ? rowHeaders[ri] : '';
    tbody += '<th class="tgrid-row-header">'
      + '<span contenteditable="true"'
      + ' onblur="tableGridData.rowHeaders[' + ri + ']=this.textContent.trim()"'
      + ' onfocus="event.stopPropagation()">'
      + _tesc(rh) + '</span>'
      + '<button class="tgrid-del-row" onclick="_removeTableRow(' + ri + ')" title="Delete row">×</button>'
      + '</th>';
    // Data cells
    headers.forEach((_, ci) => {
      const val = row[ci] != null ? row[ci] : '';
      const num = parseFloat(String(val).replace(/,/g, ''));
      const isNum = !isNaN(num) && isFinite(num) && String(val).trim() !== '';
      tbody += '<td class="tgrid-cell' + (isNum ? ' tgrid-num' : '') + '">'
        + '<span contenteditable="true"'
        + ' onblur="_onCellEdit(' + ri + ',' + ci + ',this.textContent)"'
        + ' onfocus="event.stopPropagation()">'
        + _tesc(val) + '</span></td>';
    });
    tbody += '</tr>';
  });
  tbody += '</tbody>';

  // ── Footer ──
  let tfoot = '<tfoot>';
  if (showTotals) {
    tfoot += '<tr class="tgrid-totals-row">'
      + '<th class="tgrid-row-header tgrid-total-rn">Σ Total</th>';
    totals.forEach(t => {
      tfoot += '<td class="tgrid-cell tgrid-total">' + (t !== null ? _tfmt(t) : '') + '</td>';
    });
    tfoot += '</tr>';
  }
  tfoot += '<tr class="tgrid-add-row-row">'
    + '<td colspan="' + (nc + 1) + '">'
    + '<button class="tgrid-add-row-btn" onclick="_addTableRow()">+ Add Row</button>'
    + '</td></tr></tfoot>';

  container.innerHTML = '<table class="tgrid-table">' + thead + tbody + tfoot + '</table>';
  // Persist grid state across panel close/reopen
  try { sessionStorage.setItem('tableGrid', JSON.stringify(tableGridData)); } catch {}
}

function _tesc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _tfmt(n) { return Number.isInteger(n) ? n.toLocaleString() : parseFloat(n.toFixed(4)).toLocaleString(); }

function _onCellEdit(ri, ci, value) {
  if (!tableGridData) return;
  while (tableGridData.rows[ri].length <= ci) tableGridData.rows[ri].push('');
  tableGridData.rows[ri][ci] = value.trim();
  if (tableGridData.showTotals) _renderTableGrid();
}

function _initEmptyGrid(cols, rows) {
  const nc = cols || 3, nr = rows || 3;
  tableGridData = {
    rowHeaderLabel : '',
    headers    : Array.from({length: nc}, () => ''),
    rowHeaders : Array.from({length: nr}, () => ''),
    rows       : Array.from({length: nr}, () => new Array(nc).fill('')),
    showTotals : false,
    sortDir    : {}
  };
  _renderTableGrid();
}

function _addTableRow() {
  if (!tableGridData) { _initEmptyGrid(); return; }
  const nr = tableGridData.rows.length;
  if (!tableGridData.rowHeaders) tableGridData.rowHeaders = [];
  tableGridData.rowHeaders.push('');
  tableGridData.rows.push(new Array(tableGridData.headers.length).fill(''));
  _renderTableGrid();
}

function _addTableCol() {
  if (!tableGridData) { _initEmptyGrid(); return; }
  tableGridData.headers.push('');
  tableGridData.rows.forEach(r => r.push(''));
  _renderTableGrid();
}

function _removeTableRow(ri) {
  if (!tableGridData || tableGridData.rows.length <= 1) return;
  tableGridData.rows.splice(ri, 1);
  if (tableGridData.rowHeaders) tableGridData.rowHeaders.splice(ri, 1);
  _renderTableGrid();
}

function _removeTableCol(ci) {
  if (!tableGridData || tableGridData.headers.length <= 1) return;
  tableGridData.headers.splice(ci, 1);
  tableGridData.rows.forEach(r => r.splice(ci, 1));
  _renderTableGrid();
}

function _sortTableByCol(ci) {
  if (!tableGridData) return;
  const dir = tableGridData.sortDir || {};
  const asc = dir[ci] !== true;
  dir[ci] = asc;
  tableGridData.sortDir = dir;
  // Sort rows and row headers together
  const rh = tableGridData.rowHeaders || [];
  const combined = tableGridData.rows.map((r, i) => ({ r, h: rh[i] || '' }));
  combined.sort((a, b) => {
    const av = String(a.r[ci] || '').replace(/,/g, '');
    const bv = String(b.r[ci] || '').replace(/,/g, '');
    const an = parseFloat(av), bn = parseFloat(bv);
    const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv);
    return asc ? cmp : -cmp;
  });
  tableGridData.rows = combined.map(x => x.r);
  tableGridData.rowHeaders = combined.map(x => x.h);
  _renderTableGrid();
}

function _toggleTableTotals() {
  if (!tableGridData) return;
  tableGridData.showTotals = !tableGridData.showTotals;
  _renderTableGrid();
  const btn = document.getElementById('tableTotalsBtn');
  if (btn) btn.classList.toggle('active', tableGridData.showTotals);
}

function _copyTableCSV() {
  if (!tableGridData) return;
  const { headers, rows, rowHeaders = [], rowHeaderLabel = '' } = tableGridData;
  const allHeaders = [rowHeaderLabel, ...headers];
  const allRows = rows.map((r, ri) => [rowHeaders[ri] || '', ...headers.map((_, ci) => r[ci] || '')]);
  const csv = [allHeaders.join(','), ...allRows.map(r => r.join(','))].join('\n');
  navigator.clipboard?.writeText(csv).then(() => showToast('📋', 'Copied', 'Table copied as CSV'));
}

function insertTableIntoAnswer(mode) {
  if (!tableGridData) return;
  const ta = document.getElementById('writeTextarea');
  if (!ta) return;
  const { headers, rows, rowHeaders = [], rowHeaderLabel = '' } = tableGridData;
  const hasRowH = rowHeaders.some(r => r.trim());

  // Build full column list (with row-header col prepended if used)
  const allCols  = hasRowH ? [rowHeaderLabel, ...headers] : headers;
  const allRows  = rows.map((r, ri) =>
    hasRowH ? [rowHeaders[ri] || '', ...headers.map((_, ci) => r[ci] || '')]
            : headers.map((_, ci) => r[ci] || '')
  );

  let text;
  if (mode === 'text') {
    const widths = allCols.map((h, ci) => Math.max(String(h).length, ...allRows.map(r => String(r[ci] || '').length)));
    const pad = (s, n) => String(s || '').padEnd(n);
    text  = allCols.map((h, ci) => pad(h, widths[ci])).join('  ') + '\n';
    text += widths.map(w => '─'.repeat(w)).join('  ') + '\n';
    text += allRows.map(r => allCols.map((_, ci) => pad(r[ci], widths[ci])).join('  ')).join('\n');
  } else {
    const hdr = '| ' + allCols.join(' | ') + ' |';
    const sep = '| ' + allCols.map(() => '---').join(' | ') + ' |';
    const bdy = allRows.map(r => '| ' + r.join(' | ') + ' |').join('\n');
    text = hdr + '\n' + sep + '\n' + bdy;
  }

  ta.value += (ta.value ? '\n\n' : '') + text;
  onWriteInput();
  toggleTablePanel();
}

function clearTablePanel() {
  const el = document.getElementById('tablePanelInput');
  if (el) el.value = '';
  tableGridData = null;
  _renderTableGrid();
}

// ---- AI Table Generation ----

function _tableAIStatus(msg, colour) {
  const bar  = document.getElementById('tableAIStatus');
  const text = document.getElementById('tableAIStatusText');
  if (!bar || !text) return;
  if (!msg) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  text.innerHTML = msg;
  bar.style.borderColor = colour || 'rgba(201,168,76,0.3)';
}

function _loadAITableResult(raw) {
  // Try markdown table first, then CSV fallback
  const parsed = _parseAnyTable(raw.trim());
  if (!parsed || !parsed.headers.length) return false;

  // First column becomes row headers if it looks like a label column
  const firstColIsLabel = parsed.headers.length > 1 &&
    parsed.rows.every(r => isNaN(parseFloat(String(r[0] || '').replace(/,/g, ''))));

  tableGridData = {
    rowHeaderLabel : firstColIsLabel ? parsed.headers[0] : '',
    headers        : firstColIsLabel ? parsed.headers.slice(1) : parsed.headers,
    rowHeaders     : parsed.rows.map(r => firstColIsLabel ? (r[0] || '') : ''),
    rows           : parsed.rows.map(r => firstColIsLabel ? r.slice(1) : [...r]),
    showTotals     : false,
    sortDir        : {}
  };
  _renderTableGrid();
  const el = document.getElementById('tablePanelInput');
  if (el) el.value = '';
  return true;
}

// ✨ Format: convert whatever is in the paste area into a structured table
function aiFormatTable() {
  if (!_getAIKey()) {
    showToast('🤖', 'No API Key', 'Add your Claude API key in Settings → AI Tutor first.');
    return;
  }
  const raw = document.getElementById('tablePanelInput')?.value?.trim();
  if (!raw) {
    showToast('⚠', 'No data', 'Paste your data into the text area below the toolbar first.');
    return;
  }

  const container = document.getElementById('tableGridContainer');
  if (container) container.innerHTML = '<div class="ai-thinking" style="padding:20px;display:flex;justify-content:center"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></div>';
  _tableAIStatus('⏳ AI is formatting your data…', 'rgba(201,168,76,0.3)');

  const prompt = `Convert the following data into a well-structured markdown table.

Rules:
- Identify the most logical column headers from the data
- Put each data item / record as a row
- If there is a natural label column (names, dates, accounts), make it the first column
- Format numbers cleanly (no unnecessary symbols)
- If it is financial data, use clear period and value columns
- Return ONLY the markdown table (using | pipe format), no explanation, no extra text

Data:
${raw}`;

  let result = '';
  _callClaudeAPI(
    'You are a data structuring expert. Convert raw data into clean markdown tables. Output ONLY the markdown table, nothing else.',
    prompt,
    chunk => { result += chunk; },
    () => {
      if (_loadAITableResult(result)) {
        const nc = tableGridData.headers.length;
        const nr = tableGridData.rows.length;
        _tableAIStatus(`✅ Generated ${nc} column${nc!==1?'s':''}, ${nr} row${nr!==1?'s':''}`, 'rgba(80,200,100,0.3)');
        setTimeout(() => _tableAIStatus(''), 3000);
      } else {
        _tableAIStatus('⚠ Could not parse AI response — try rephrasing your data.', 'rgba(255,80,80,0.3)');
        if (container) container.innerHTML = '<div style="padding:10px;color:#ff9090;font-family:Cinzel,serif;font-size:0.75rem">⚠ AI returned an unexpected format. Try again or paste in CSV / Excel format.</div>';
      }
    },
    err => {
      _tableAIStatus(`❌ ${err}`, 'rgba(255,80,80,0.3)');
      if (container) container.innerHTML = `<div style="padding:10px;color:#ff9090;font-family:Cinzel,serif;font-size:0.75rem">❌ ${err}</div>`;
    }
  );
}

// ✨ Generate: describe what table you want — AI creates it
function aiDescribeTable() {
  if (!_getAIKey()) {
    showToast('🤖', 'No API Key', 'Add your Claude API key in Settings → AI Tutor first.');
    return;
  }

  // Show an inline prompt inside the paste area
  const pasteEl = document.getElementById('tablePanelInput');
  if (!pasteEl) return;

  // Reuse the paste textarea as a description input
  pasteEl.placeholder = 'Describe the table you want, e.g. "Income statement for 3 years" or "Comparison of 4 accounting ratios"…';
  pasteEl.value = '';
  pasteEl.focus();

  _tableAIStatus('✏️ Describe the table you want above, then click ✨ Format', 'rgba(160,120,255,0.3)');

  // Swap the Format button temporarily to "Generate from description"
  const btn = document.querySelector('.tbar-ai');
  if (btn) {
    const origText = btn.textContent;
    btn.textContent = '✨ Build it';
    btn.onclick = () => {
      const desc = pasteEl.value.trim();
      if (!desc) { showToast('⚠', 'Add a description', ''); return; }
      btn.textContent = origText;
      btn.onclick = aiFormatTable;
      pasteEl.placeholder = 'Paste here then press Enter or click outside…';
      _aiGenerateTableFromDesc(desc);
    };
  }
}

function _aiGenerateTableFromDesc(description) {
  const container = document.getElementById('tableGridContainer');
  if (container) container.innerHTML = '<div class="ai-thinking" style="padding:20px;display:flex;justify-content:center"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></div>';
  _tableAIStatus('⏳ AI is generating your table…', 'rgba(160,120,255,0.3)');

  const prompt = `Create a realistic, well-structured markdown table based on this description:
"${description}"

Rules:
- Use appropriate column headers for this type of data
- Include 4–8 realistic rows of example data
- If financial, use £ / $ where appropriate and realistic numbers
- If comparison, make columns the options and rows the criteria
- Return ONLY the markdown table (using | pipe format), no explanation

Return the table now:`;

  let result = '';
  _callClaudeAPI(
    'You are a table generation expert. Create realistic, well-structured markdown tables based on descriptions. Output ONLY the markdown table.',
    prompt,
    chunk => { result += chunk; },
    () => {
      if (_loadAITableResult(result)) {
        const nc = tableGridData.headers.length;
        const nr = tableGridData.rows.length;
        _tableAIStatus(`✅ Generated — ${nc} column${nc!==1?'s':''}, ${nr} row${nr!==1?'s':''}`, 'rgba(80,200,100,0.3)');
        setTimeout(() => _tableAIStatus(''), 3000);
        const el = document.getElementById('tablePanelInput');
        if (el) { el.value = ''; el.placeholder = 'Paste here then press Enter or click outside…'; }
      } else {
        _tableAIStatus('⚠ Could not parse result — try a more specific description.', 'rgba(255,80,80,0.3)');
      }
    },
    err => { _tableAIStatus(`❌ ${err}`, 'rgba(255,80,80,0.3)'); }
  );
}

// ---- Draggable float button ----
function _initDraggableTable() {
  const btn = document.getElementById('floatTableBtn');
  if (!btn) return;
  btn.style.right = '20px';
  btn.style.bottom = '120px';
}

let _dragOffX = 0, _dragOffY = 0, _isDragging = false;

function startDragTable(e) {
  const btn = document.getElementById('floatTableBtn');
  if (!btn) return;
  _isDragging = false;
  const isTouch = e.type === 'touchstart';
  const startX = isTouch ? e.touches[0].clientX : e.clientX;
  const startY = isTouch ? e.touches[0].clientY : e.clientY;
  const rect = btn.getBoundingClientRect();
  _dragOffX = startX - rect.left;
  _dragOffY = startY - rect.top;

  function move(ev) {
    _isDragging = true;
    const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
    btn.style.left  = (cx - _dragOffX) + 'px';
    btn.style.top   = (cy - _dragOffY) + 'px';
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
  }
  function up() {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', up);
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  document.addEventListener('touchmove', move, { passive: true });
  document.addEventListener('touchend', up);
}

// ---- Saved entries ----
function renderSavedEntries() {
  if (!activeScrollName || !db.practiceBooks[activeScrollName]) return;
  const sessions = db.practiceBooks[activeScrollName].sessions || [];
  const list = document.getElementById('savedEntriesList');
  const countEl = document.getElementById('savedCount');
  if (!list) return;
  if (countEl) countEl.textContent = sessions.length;

  const section = document.getElementById('savedEntriesSection');
  if (section) section.style.display = 'none'; // pages navigated via Prev/Next

  const query = (document.getElementById('savedSearch')?.value || '').toLowerCase();
  const filtered = query
    ? sessions.filter(s => (s.question + s.answer).toLowerCase().includes(query))
    : sessions;

  list.innerHTML = '';
  filtered.forEach(s => {
    const date = new Date(s.timestamp).toLocaleDateString();
    const time = new Date(s.timestamp).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    const card = document.createElement('div');
    card.className = 'session-card';
    card.innerHTML = `
      <div class="session-card-header">
        <span class="session-meta">${date} ${time} · ${s.wordCount||0} words · ${s.wpm||0} WPM</span>
        <button class="rpg-btn small danger" onclick="deletePracticeEntry(${s.id})">🗑</button>
      </div>
      ${s.question ? `<div class="session-question">❓ ${s.question}</div>` : ''}
      ${s.tableData ? _renderPracticeTable(s.tableData) : ''}
      ${s.answer    ? `<div class="session-answer">${s.answer.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>` : ''}`;
    const ansEl = card.querySelector('.session-answer');
    if (ansEl && s.answer && s.answer.length > 300) {
      ansEl.classList.add('collapsed');
      const tog = document.createElement('button');
      tog.className = 'session-expand-btn';
      tog.textContent = '▼ Show more';
      tog.onclick = () => { const c = ansEl.classList.toggle('collapsed'); tog.textContent = c ? '▼ Show more' : '▲ Show less'; };
      card.appendChild(tog);
    }
    list.appendChild(card);
  });
}

function deletePracticeEntry(id) {
  if (!activeScrollName) return;
  showConfirm('Delete Entry', 'This entry will be permanently deleted.',
    () => {
      db.practiceBooks[activeScrollName].sessions = db.practiceBooks[activeScrollName].sessions.filter(s => s.id !== id);
      saveDB(); renderSavedEntries();
    }, { icon: '🗑️', confirmText: '🗑 Delete', danger: true });
}

// ---- Table parsing (shared with import) ----
function _parseAnyTable(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return null;

  // Helper: parse a CSV line respecting quoted fields
  function parseCSVLine(line) {
    const cells = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  // Markdown / pipe-delimited (highest priority)
  if (lines.some(l => l.includes('|'))) {
    const data = lines.filter(l => !/^\|?\s*[-:]+[-| :]*\|?\s*$/.test(l));
    if (!data.length) return null;
    const parse = l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const headers = parse(data[0]).filter((_, i, a) => a.length > 1 || _ !== '');
    if (!headers.length) return null;
    const rows = data.slice(1).map(parse).filter(r => r.some(c => c));
    // Pad rows to header width
    return { headers, rows: rows.map(r => { while (r.length < headers.length) r.push(''); return r.slice(0, headers.length); }) };
  }

  // Tab-separated (Excel paste)
  if (lines[0].includes('\t')) {
    const parse = l => l.split('\t').map(c => c.trim());
    const headers = parse(lines[0]);
    const rows = lines.slice(1).map(parse).map(r => { while (r.length < headers.length) r.push(''); return r.slice(0, headers.length); });
    return { headers, rows };
  }

  // CSV (quoted or plain)
  if (lines.length > 1 && lines[0].includes(',')) {
    const headers = parseCSVLine(lines[0]);
    const rows = lines.slice(1).map(parseCSVLine).map(r => { while (r.length < headers.length) r.push(''); return r.slice(0, headers.length); });
    return { headers, rows };
  }

  // Single-column fallback (treat each line as a row value, header = "Value")
  if (lines.length > 1) {
    return { headers: ['Value'], rows: lines.map(l => [l.trim()]) };
  }

  return null;
}

function _renderPracticeTable(tableData) {
  if (!tableData) return '';
  const head = tableData.headers.map(h => `<th>${h}</th>`).join('');
  const body = tableData.rows.map(r => `<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('');
  return `<div class="practice-table-wrap"><table class="practice-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}


// ============================================================
// AI TUTOR ENGINE
// ============================================================

function _getAIKey() { return db.settings.claudeAPIKey || ''; }
function _getAIModel() { return db.settings.claudeModel || 'claude-haiku-4-5-20251001'; }

async function _callClaudeAPI(systemPrompt, userPrompt, onChunk, onDone, onError, maxTokens) {
  const key = _getAIKey();
  if (!key) {
    onError?.('No API key. Go to Settings → AI Tutor and add your Claude API key.');
    return;
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: _getAIModel(),
        max_tokens: maxTokens || 1500,
        stream: true,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      onError?.(e.error?.message || `API error ${res.status}`);
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') {
            onChunk?.(j.delta.text);
          }
        } catch {}
      }
    }
    onDone?.();
  } catch (err) {
    onError?.(err.message || 'Network error — check your connection.');
  }
}

// ── Settings page AI functions ──

function toggleAIKeyVisibility() {
  const el = document.getElementById('claudeKeyInput');
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

function saveAIKey() {
  const key   = (document.getElementById('claudeKeyInput')?.value || '').trim();
  const model = document.getElementById('claudeModelSelect')?.value || 'claude-haiku-4-5-20251001';
  db.settings.claudeAPIKey = key;
  db.settings.claudeModel  = model;
  saveDB();
  const st = document.getElementById('aiKeyStatus');
  if (st) st.innerHTML = key
    ? '<span style="color:#7dde8a">✅ Key saved.</span>'
    : '<span style="color:#ff9090">⚠ Key cleared.</span>';
}

function testAIKey() {
  const st = document.getElementById('aiKeyStatus');
  if (st) st.innerHTML = '<span style="color:#c9a84c">⏳ Testing…</span>';
  db.settings.claudeAPIKey = (document.getElementById('claudeKeyInput')?.value || '').trim();
  db.settings.claudeModel  = document.getElementById('claudeModelSelect')?.value || 'claude-haiku-4-5-20251001';
  _callClaudeAPI(
    'You are a helpful assistant.',
    'Reply with exactly: "Connection successful!"',
    () => {},
    () => { if (st) st.innerHTML = '<span style="color:#7dde8a">✅ Connection successful! AI Tutor is ready.</span>'; },
    (err) => { if (st) st.innerHTML = `<span style="color:#ff9090">❌ ${err}</span>`; }
  );
}

function _loadAISettings() {
  const ki = document.getElementById('claudeKeyInput');
  const ms = document.getElementById('claudeModelSelect');
  if (ki) ki.value = db.settings.claudeAPIKey || '';
  if (ms) ms.value = db.settings.claudeModel  || 'claude-haiku-4-5-20251001';
}

// ── Practice page AI panel ──

let _aiMode = 'model';
let _aiResponseText = '';
let _aiStreaming = false;

function toggleAIPanel() {
  const panel = document.getElementById('aiPanel');
  const btn   = document.getElementById('aiPanelBtn');
  if (!panel) return;
  const open = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = open ? 'flex' : 'none';
  if (btn) btn.classList.toggle('active', open);
  if (open) {
    // Restore last-used tab
    const saved = sessionStorage.getItem('aiPanelTab');
    if (saved) setAIMode(saved);
    _refreshAIContext();
  }
}

function _refreshAIContext() {
  // Read question directly from current page entry if available
  if (typeof activeScrollName !== 'undefined' && activeScrollName && _pageIndex >= 0) {
    const entry = db.practiceBooks[activeScrollName]?.sessions[_pageIndex];
    if (entry?.question) currentQuestion = entry.question;
  }
  const qEl = document.getElementById('aiQuestionPreview');
  if (qEl) qEl.textContent = currentQuestion || '(no question set — set one with ❓ or navigate to a page with a question)';
}

function setAIMode(mode) {
  _aiMode = mode;
  sessionStorage.setItem('aiPanelTab', mode);
  document.querySelectorAll('.ai-tab[data-mode]').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
}

const _AI_SYSTEM = 'You are an expert exam tutor. Write clear, structured, exam-standard responses. Use UK English. Format with headings and bullet points where appropriate.';

function runAIFeature() {
  if (_aiStreaming) return;
  _refreshAIContext();
  if (!currentQuestion) { showToast('❓','No Question','Navigate to a page with a question, or set one with the ❓ button.'); return; }

  const area    = document.getElementById('aiResponseArea');
  const copyBtn = document.getElementById('aiCopyBtn');
  const insBtn  = document.getElementById('aiInsertBtn');
  const clrBtn  = document.getElementById('aiClearBtn');
  const genBtn  = document.getElementById('aiGenerateBtn');
  const ta      = document.getElementById('writeTextarea');

  _aiResponseText = '';
  _aiStreaming = true;
  if (copyBtn) copyBtn.style.display = 'none';
  if (insBtn)  insBtn.style.display  = 'none';
  if (clrBtn)  clrBtn.style.display  = 'none';
  if (genBtn)  genBtn.textContent = '⏳ Generating…';

  const userAnswer = ta?.value?.trim() || '';

  const prompts = {
    model: `Question: ${currentQuestion}

First, identify what type of question this is, then answer accordingly:

• CALCULATION (e.g. "Calculate...", "Work out...", "Find the value of..."): Show each step of working clearly, label intermediate values, and state the final answer prominently. Use structured working-out format.

• SHORT ANSWER (e.g. "Define...", "State...", "What is...", "List..."): Give a precise, concise answer in 1–4 sentences. No padding.

• ESSAY / APPLICATION (e.g. "Explain...", "Discuss...", "Evaluate...", "Analyse...", "Assess..."): Write a full structured answer — brief introduction, well-developed body paragraphs each covering one key point with explanation and examples, short conclusion. Exam standard prose.

• MULTI-PART: Address each part in order, clearly labelled (a), (b), etc.

Do not state which type it is — just write the appropriate answer.`,
    scheme: `Question: ${currentQuestion}\n\nCreate a mark scheme / key points checklist. List every point that should be covered as a bullet point, with approximate marks if relevant. Be specific.`,
    plan: `Question: ${currentQuestion}\n\nCreate a concise essay plan: introduction bullet points, main body structure with sub-points, and conclusion. No full sentences — just the skeleton.`,
    feedback: userAnswer
      ? `Question: ${currentQuestion}\n\nStudent's answer:\n${userAnswer}\n\nGive specific feedback: (1) What they covered well, (2) What key points are missing, (3) How to improve structure or depth. End with an estimated mark out of 10.`
      : null,
    improve: userAnswer
      ? `Question: ${currentQuestion}\n\nStudent's original answer:\n${userAnswer}\n\nRewrite this answer at a higher exam standard. Mark every addition with {{+added text+}} and every phrase removed from the original with {{-removed text-}}. Leave unchanged text plain. After the improved answer, add a brief "KEY IMPROVEMENTS:" bullet list.`
      : null
  };

  if ((_aiMode === 'feedback' || _aiMode === 'improve') && !userAnswer) {
    if (area) area.innerHTML = '<div class="ai-error">Write your answer in the page first, then click this.</div>';
    _aiStreaming = false;
    if (genBtn) genBtn.textContent = '✨ Generate';
    return;
  }

  // ── Model Answer: stream into panel, render with math, then write to page ──
  if (_aiMode === 'model') {
    if (area) area.innerHTML = '<div class="ai-thinking"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></div>';

    _callClaudeAPI(
      _AI_SYSTEM,
      prompts.model,
      (chunk) => {
        _aiResponseText += chunk;
        // Show plain text while streaming
        if (area) { area.textContent = _aiResponseText; area.scrollTop = area.scrollHeight; }
      },
      () => {
        _aiStreaming = false;
        if (genBtn) genBtn.textContent = '✨ Generate';
        // Render with full markdown + KaTeX in panel
        if (area) {
          area.innerHTML = '<div class="ai-response-text">' + parseMarkdown(_aiResponseText) + '</div>';
          _renderMath(area);
        }
        // Also write raw text to the textarea so it's editable / saveable
        if (ta) {
          ta.value = _aiResponseText;
          ta.scrollTop = ta.scrollHeight;
        }
        // Auto-save to this page
        if (_pageIndex >= 0 && activeScrollName) {
          const book = db.practiceBooks[activeScrollName];
          if (book?.sessions[_pageIndex]) {
            book.sessions[_pageIndex].answer = _aiResponseText;
            book.sessions[_pageIndex].wordCount = _aiResponseText.split(/\s+/).filter(Boolean).length;
            saveDB();
          }
        } else { _saveCurrentPageContent(); }
        onWriteInput();
        if (copyBtn) copyBtn.style.display = '';
        if (insBtn)  insBtn.style.display  = '';
        if (clrBtn)  clrBtn.style.display  = '';
        // Auto-open preview so user sees rendered version
        _showPagePreview(true);
        showToast('✅', 'Model Answer Ready', 'Rendered below — click ✏️ Edit to modify');
      },
      (err) => {
        _aiStreaming = false;
        if (genBtn) genBtn.textContent = '✨ Generate';
        if (area) area.innerHTML = `<div class="ai-error">❌ ${err}</div>`;
      }
    );
    return;
  }

  // ── All other modes: stream into the panel response area ──
  if (area) area.innerHTML = '<div class="ai-thinking"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></div>';

  _callClaudeAPI(
    _AI_SYSTEM,
    prompts[_aiMode],
    (chunk) => {
      _aiResponseText += chunk;
      if (!area) return;
      if (_aiMode === 'improve') {
        area.innerHTML = '<div class="ai-response-text">' + _renderImprovedDiff(_aiResponseText) + '</div>';
      } else {
        // Show plain text while streaming (fast), render properly on completion
        area.textContent = _aiResponseText;
      }
      area.scrollTop = area.scrollHeight;
    },
    () => {
      _aiStreaming = false;
      if (genBtn) genBtn.textContent = '✨ Generate';
      // Final render: full markdown + KaTeX math
      if (area && _aiMode !== 'improve') {
        area.innerHTML = '<div class="ai-response-text">' + parseMarkdown(_aiResponseText) + '</div>';
        _renderMath(area);
      }
      if (copyBtn) copyBtn.style.display = '';
      if (insBtn)  insBtn.style.display  = '';
      if (clrBtn)  clrBtn.style.display  = '';
    },
    (err) => {
      _aiStreaming = false;
      if (genBtn) genBtn.textContent = '✨ Generate';
      if (area) area.innerHTML = `<div class="ai-error">❌ ${err}</div>`;
    }
  );
}

function copyAIResponse() {
  navigator.clipboard?.writeText(_aiResponseText).then(() => showToast('📋','Copied','AI response copied to clipboard'));
}

function insertAIResponse() {
  const ta = document.getElementById('writeTextarea');
  if (!ta || !_aiResponseText) return;
  const modeLabels = { model:'Model Answer', scheme:'Mark Scheme', plan:'Essay Plan', feedback:'AI Feedback', improve:'Improved Answer' };
  const label = modeLabels[_aiMode] || 'AI Response';
  ta.value += (ta.value ? `\n\n── ${label} ──\n` : '') + _aiResponseText;
  onWriteInput();
  // Auto-save so it persists on this page
  if (_pageIndex >= 0 && activeScrollName) {
    const book = db.practiceBooks[activeScrollName];
    if (book?.sessions[_pageIndex]) {
      book.sessions[_pageIndex].answer = ta.value;
      book.sessions[_pageIndex].wordCount = ta.value.split(/\s+/).filter(Boolean).length;
      saveDB();
    }
  }
  showToast('⬇', label, 'Added to this page and saved');
}

function clearAIResponse() {
  const area = document.getElementById('aiResponseArea');
  if (area) area.innerHTML = '<div class="ai-placeholder">Click <strong>Generate</strong> to get an AI response.</div>';
  _aiResponseText = '';
  document.getElementById('aiCopyBtn')?.style && (document.getElementById('aiCopyBtn').style.display = 'none');
  document.getElementById('aiInsertBtn')?.style && (document.getElementById('aiInsertBtn').style.display = 'none');
  document.getElementById('aiClearBtn')?.style && (document.getElementById('aiClearBtn').style.display = 'none');
}

// ── AI: Generate exam-style questions matching a pasted example ──

function showAIQGen() {
  let modal = document.getElementById('aiQGenModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'aiQGenModal';
    modal.className = 'modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) hideAIQGen(); };
    modal.innerHTML = `<div class="rpg-modal ai-cardgen-modal" onclick="event.stopPropagation()" style="max-width:580px">
      <div class="modal-title">✨ Generate Exam Questions</div>
      <div class="mct-source-tabs" id="aiQGenTabs" style="margin-bottom:12px">
        <button class="mct-src-tab active" data-src="text" onclick="setAIQGenSource('text')">📝 Paste Examples</button>
        <button class="mct-src-tab" data-src="file" onclick="setAIQGenSource('file')">📎 File / Photo</button>
      </div>
      <div id="aiQGenTextSrc">
        <p class="rpg-hint" style="margin-bottom:8px">Paste 1–3 example questions — AI generates new ones in the same style.</p>
        <textarea class="rpg-input" id="aiQGenExamples" rows="5"
          placeholder="e.g.\nPrepare the income statement for the year ended 31 December 2024.\n\nExplain two advantages of the straight-line method of depreciation. (4 marks)"
          style="resize:vertical;font-family:'Crimson Text',serif"></textarea>
      </div>
      <div id="aiQGenFileSrc" style="display:none">
        <p class="rpg-hint" style="margin-bottom:8px">Upload a text file or photo of an exam paper — AI generates questions in the same style.</p>
        <input type="file" id="aiQGenFile" accept=".txt,.md,.csv,.jpg,.jpeg,.png,.webp,.gif"
          class="rpg-input" style="padding:10px;cursor:pointer">
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0">
        <div>
          <label class="rpg-label" style="margin:0 0 4px">Questions to generate</label>
          <input class="rpg-input small" type="number" id="aiQGenCount" value="5" min="1" max="20" style="width:70px;margin:0">
        </div>
        <div style="flex:1">
          <label class="rpg-label" style="margin:0 0 4px">Add to practice book</label>
          <select class="rpg-input" id="aiQGenBook" style="margin:0"></select>
        </div>
      </div>
      <div id="aiQGenStatus" style="min-height:22px;font-family:'Crimson Text',serif;font-size:0.95rem;color:var(--gold)"></div>
      <div id="aiQGenPreview" style="max-height:200px;overflow-y:auto;margin-top:8px"></div>
      <div class="modal-actions" style="margin-top:14px">
        <button class="rpg-btn primary" onclick="runAIQGen()">✨ Generate</button>
        <button class="rpg-btn primary" id="aiQImportBtn" style="display:none" onclick="importAIQuestions()">⬇ Save to Book</button>
        <button class="rpg-btn" onclick="hideAIQGen()">✖ Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
  }
  // Populate book dropdown
  const sel = document.getElementById('aiQGenBook');
  if (sel) {
    sel.innerHTML = Object.keys(db.practiceBooks || {}).map(n => `<option value="${n}">${n}</option>`).join('') || '<option value="">— no books yet —</option>';
  }
  document.getElementById('aiQGenStatus').textContent = '';
  document.getElementById('aiQGenPreview').innerHTML  = '';
  document.getElementById('aiQImportBtn').style.display = 'none';
  modal.style.display = 'flex';
}

function hideAIQGen() {
  const m = document.getElementById('aiQGenModal');
  if (m) m.style.display = 'none';
}

function setAIQGenSource(src) {
  document.querySelectorAll('#aiQGenTabs .mct-src-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.src === src));
  const ts = document.getElementById('aiQGenTextSrc');
  const fs = document.getElementById('aiQGenFileSrc');
  if (ts) ts.style.display = src === 'text' ? '' : 'none';
  if (fs) fs.style.display = src === 'file' ? '' : 'none';
}

let _aiGeneratedQuestions = [];

function runAIQGen() {
  const src    = document.querySelector('#aiQGenTabs .mct-src-tab.active')?.dataset?.src || 'text';
  const count  = parseInt(document.getElementById('aiQGenCount')?.value) || 5;
  const status = document.getElementById('aiQGenStatus');
  const preview= document.getElementById('aiQGenPreview');
  if (status)  status.innerHTML = '<span style="color:#c9a84c">⏳ Generating…</span>';
  if (preview) preview.innerHTML = '';
  document.getElementById('aiQImportBtn').style.display = 'none';
  _aiGeneratedQuestions = [];

  const sys = 'You are an expert exam question writer. Match the style, format, and topic of example questions precisely. Use UK English.';

  const finishQGen = raw => {
    _aiGeneratedQuestions = raw.split(/\n(?=\d+\.)/).map(q => q.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
    if (preview) preview.innerHTML = _aiGeneratedQuestions.map((q, i) =>
      `<div class="ai-q-preview-item"><span class="ai-q-num">${i+1}</span><span>${q.replace(/\n/g,'<br>')}</span></div>`
    ).join('');
    if (status) status.innerHTML = `<span style="color:#7dde8a">✅ Generated ${_aiGeneratedQuestions.length} questions.</span>`;
    document.getElementById('aiQImportBtn').style.display = '';
  };
  const errQGen = err => { if (status) status.innerHTML = `<span style="color:#ff9090">❌ ${err}</span>`; };

  const callWithText = text => {
    const prompt = `Here are example exam questions:\n\n${text}\n\nGenerate ${count} new exam-style questions in exactly the same format, style, difficulty, and subject area. Number them 1. 2. 3. etc. Output only the questions, no commentary.`;
    let raw = '';
    _callClaudeAPI(sys, prompt, chunk => { raw += chunk; }, () => finishQGen(raw), errQGen);
  };

  const callWithImage = (b64, mime) => {
    const messages = [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
      { type: 'text', text: `Generate ${count} new exam-style questions in exactly the same format, style, and topic as shown in this image. Number them 1. 2. 3. etc. Output only the questions.` }
    ]}];
    let raw = '';
    _callClaudeAPIMessages(sys, messages, count * 200, chunk => { raw += chunk; }, () => finishQGen(raw), errQGen);
  };

  if (src === 'file') {
    const file = document.getElementById('aiQGenFile')?.files?.[0];
    if (!file) { status.textContent = '⚠ Choose a file first.'; return; }
    _readAIFile(file,
      result => result.type === 'image' ? callWithImage(result.b64, result.mime) : callWithText(result.content),
      err => errQGen(err)
    );
  } else {
    const examples = (document.getElementById('aiQGenExamples')?.value || '').trim();
    if (!examples) { status.textContent = '⚠ Paste at least one example question first.'; return; }
    callWithText(examples);
  }
}

function importAIQuestions() {
  const bookName = document.getElementById('aiQGenBook')?.value;
  if (!bookName || !db.practiceBooks[bookName]) {
    showToast('⚠','No Book','Select or create a practice book first.'); return;
  }
  if (!_aiGeneratedQuestions.length) return;
  if (!db.practiceBooks[bookName].sessions) db.practiceBooks[bookName].sessions = [];
  const sessions = db.practiceBooks[bookName].sessions;
  const base = Date.now();
  // Sessions are newest-first — unshift in reverse so q[0] lands at sessions[0]
  for (let i = _aiGeneratedQuestions.length - 1; i >= 0; i--) {
    sessions.unshift({
      id        : base + i,
      question  : _aiGeneratedQuestions[i],
      answer    : '',
      timestamp : base + i,
      wordCount : 0,
      wpm       : 0
    });
  }
  db.practiceBooks[bookName].sessions = sessions;
  saveDB();
  showToast('✅', 'Questions Saved', `${_aiGeneratedQuestions.length} pages created in "${bookName}"`);
  hideAIQGen();
  // If already inside this book, jump straight to the first new question (index 0 = newest)
  if (typeof activeScrollName !== 'undefined' && activeScrollName === bookName) {
    _loadPage(0);
  }
}

// ============================================================
// MCT QUIZ BUILDER
// ============================================================
let _mctQuestions = [];
let _mctCurrentIdx = 0;
let _mctScore = 0;
let _mctStreak = 0;
let _mctWrong = 0;
let _mctTopic = '';
let _mctLastContent = '';
let _mctLastImage = null;
let _mctLastImageMime = '';
let _mctLastCount = 10;
let _mctGeneration = 0;
let _mctFlameRAF = null;
let _mctSeenQuestions = [];

function showMCTBuilder() {
  const modal = document.getElementById('mctBuilderModal');
  if (!modal) return;
  // Populate deck dropdown
  const sel = document.getElementById('mctDeckSelect');
  if (sel) {
    const decks = Object.keys(db.decks || {});
    sel.innerHTML = '<option value="">Choose a deck…</option>' +
      decks.map(d => `<option value="${_tesc(d)}">${_tesc(d)}</option>`).join('');
  }
  document.getElementById('mctBuildStatus').textContent = '';
  document.getElementById('mctGenerateBtn').disabled = false;
  modal.style.display = 'flex';
}

function hideMCTBuilder() {
  const m = document.getElementById('mctBuilderModal');
  if (m) m.style.display = 'none';
}

function setMCTSource(src) {
  document.querySelectorAll('.mct-src-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.src === src));
  document.getElementById('mctTextSource').style.display = src === 'text' ? '' : 'none';
  document.getElementById('mctDeckSource').style.display = src === 'deck' ? '' : 'none';
  const fs = document.getElementById('mctFileSource');
  if (fs) fs.style.display = src === 'file' ? '' : 'none';
}

async function runMCTGenerate() {
  const activeSrc = document.querySelector('.mct-src-tab.active')?.dataset?.src || 'text';
  const count  = parseInt(document.getElementById('mctQuestionCount')?.value) || 10;
  const status = document.getElementById('mctBuildStatus');
  const btn    = document.getElementById('mctGenerateBtn');
  const topic  = (document.getElementById('mctTopicInput')?.value || '').trim() || 'study material';

  const proceed = () => {
    _mctLastCount    = count;
    _mctTopic        = topic;
    _mctGeneration   = 0;
    _mctSeenQuestions = [];
    status.innerHTML = '<span style="color:var(--gold)">⏳ Generating ' + count + ' questions…</span>';
    if (btn) btn.disabled = true;
    _runMCTCall(
      () => { hideMCTBuilder(); _startMCTQuiz(); },
      err => { status.textContent = '⚠ ' + err; if (btn) btn.disabled = false; }
    );
  };

  _mctLastContent = '';
  _mctLastImage   = null;
  _mctLastImageMime = '';

  if (activeSrc === 'text') {
    const content = (document.getElementById('mctPasteInput')?.value || '').trim();
    if (!content) { status.textContent = '⚠ Paste some notes first.'; return; }
    _mctLastContent = content;
    proceed();
  } else if (activeSrc === 'deck') {
    const deck = document.getElementById('mctDeckSelect')?.value;
    if (!deck || !db.decks[deck]) { status.textContent = '⚠ Choose a deck first.'; return; }
    _mctLastContent = (db.decks[deck].cards || []).map(c => `Q: ${c.front}\nA: ${c.back}`).join('\n\n');
    if (!document.getElementById('mctTopicInput').value.trim())
      document.getElementById('mctTopicInput').value = deck;
    proceed();
  } else {
    const file = document.getElementById('mctFileInput')?.files?.[0];
    if (!file) { status.textContent = '⚠ Choose a file first.'; return; }
    status.innerHTML = '<span style="color:var(--gold)">⏳ Reading file…</span>';
    _readAIFile(file,
      result => {
        if (result.type === 'image') { _mctLastImage = result.b64; _mctLastImageMime = result.mime; }
        else { _mctLastContent = result.content; }
        proceed();
      },
      err => { status.textContent = '⚠ ' + err; }
    );
  }
}

function regenerateMCTQuiz() {
  if (!_mctLastContent) { showMCTBuilder(); return; }
  _mctGeneration++;
  document.getElementById('mctQuestionText').textContent = '⏳ Generating new questions…';
  document.getElementById('mctOptions').innerHTML = '';
  document.getElementById('mctFeedback').style.display = 'none';
  document.getElementById('mctNextBtn').style.display = 'none';
  document.getElementById('mctProgressText').textContent = 'Loading…';
  document.getElementById('mctScoreText').textContent = '';
  _runMCTCall(
    () => { _mctCurrentIdx = 0; _mctScore = 0; _renderMCTQuestion(); },
    err => { document.getElementById('mctQuestionText').textContent = '⚠ ' + err; }
  );
}

function _runMCTCall(onDone, onError) {
  const count = _mctLastCount;
  const topic = _mctTopic;
  const gen   = _mctGeneration;

  const seenBlock = _mctSeenQuestions.length > 0
    ? `\n\nPREVIOUSLY USED QUESTIONS (do not repeat these — not even the same concept with different wording):\n${_mctSeenQuestions.map((q,i) => `${i+1}. ${q}`).join('\n')}\n\nFor calculation/formula questions where the same formula must be tested, you MUST change all numerical values so the working and answer are completely different.`
    : '';

  const varietyNote = gen > 0
    ? `This is attempt ${gen + 1}. Generate entirely fresh questions covering different aspects, angles, and applications not tested before.`
    : 'Generate a diverse spread of questions covering different aspects of the content.';

  const sys = `You are an exam question generator. Generate exactly ${count} multiple-choice questions based on the content provided.
Return ONLY a valid JSON array — no preamble, no markdown, no code fences. Format:
[{"q":"Question text?","opts":["A) …","B) …","C) …","D) …"],"correct":0,"explanation":"Brief reason (1-2 sentences)."}]
"correct" is the 0-based index of the correct answer (0=A, 1=B, 2=C, 3=D). Make distractors plausible. Questions should be exam-standard.
${varietyNote}${seenBlock}`;

  const usr = `Topic: ${topic}\n\nContent:\n${_mctLastContent}\n\nGenerate ${count} NEW questions not listed above as a JSON array.`;

  const finish = raw => {
    try {
      const s = raw.indexOf('['), e = raw.lastIndexOf(']') + 1;
      if (s < 0 || e <= s) throw new Error('no array');
      _mctQuestions = JSON.parse(raw.slice(s, e));
      _mctQuestions.forEach(q => { if (q.q) _mctSeenQuestions.push(q.q); });
      onDone();
    } catch(_) { onError('Could not parse AI response — try again.'); }
  };

  let raw = '';
  if (_mctLastImage) {
    const imageUsr = `Topic: ${topic}\n\nGenerate ${count} NEW MCT questions from the image as a JSON array.${seenBlock}`;
    const messages = [{
      role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: _mctLastImageMime, data: _mctLastImage } },
        { type: 'text', text: imageUsr }
      ]
    }];
    _callClaudeAPIMessages(sys, messages, count * 250,
      chunk => { raw += chunk; }, () => finish(raw), err => onError(err));
  } else {
    _callClaudeAPI(sys, usr, chunk => { raw += chunk; }, () => finish(raw), err => onError(err), count * 250);
  }
}

function _startMCTQuiz() {
  _mctCurrentIdx = 0;
  _mctScore = 0;
  _mctStreak = 0;
  _mctWrong = 0;
  const picker = document.getElementById('scrollPickerView');
  const write  = document.getElementById('scrollWriteView');
  const view   = document.getElementById('mctQuizView');
  if (picker) picker.style.display = 'none';
  if (write)  write.style.display  = 'none';
  if (view) {
    const isMobile = document.body.classList.contains('mobile-ui');
    view.style.display = 'flex';
    view.style.flexDirection = 'column';
    view.style.height = isMobile ? 'auto' : '100vh';
    view.style.minHeight = isMobile ? '0' : '';
    view.style.overflowY = isMobile ? 'auto' : '';
  }
  const title = document.getElementById('mctQuizTitle');
  if (title) title.textContent = 'MCT for ' + _mctTopic;
  // Draw island
  const ic = document.getElementById('mctIslandCanvas');
  if (ic) drawPixelIsland(ic);
  // Start flame animation
  _startMCTFlame();
  _updateMCTStats();
  _renderMCTQuestion();
}

function _startMCTFlame() {
  if (_mctFlameRAF) { cancelAnimationFrame(_mctFlameRAF); _mctFlameRAF = null; }
  const canvas = document.getElementById('mctFlameCanvas');
  if (!canvas) return;
  function loop() {
    drawFlameOnCanvas(canvas, _mctStreak);
    _mctFlameRAF = requestAnimationFrame(loop);
  }
  loop();
}

function _stopMCTFlame() {
  if (_mctFlameRAF) { cancelAnimationFrame(_mctFlameRAF); _mctFlameRAF = null; }
}

function _updateMCTStats(answered) {
  const total = answered ?? _mctCurrentIdx;
  const el = id => document.getElementById(id);
  if (el('mctCorrectStat')) el('mctCorrectStat').textContent = _mctScore;
  if (el('mctWrongStat'))   el('mctWrongStat').textContent   = _mctWrong;
  if (el('mctTotalStat'))   el('mctTotalStat').textContent   = `${_mctScore} / ${total}`;
  if (el('mctFlameCounter')) {
    el('mctFlameCounter').textContent = _mctStreak;
    el('mctFlameCounter').style.animation = 'none';
    requestAnimationFrame(() => { if (el('mctFlameCounter')) el('mctFlameCounter').style.animation = 'counterPop 0.3s ease'; });
  }
}

function exitMCTQuiz() {
  _stopMCTFlame();
  const view   = document.getElementById('mctQuizView');
  const picker = document.getElementById('scrollPickerView');
  if (view)   view.style.display   = 'none';
  if (picker) picker.style.display = '';
}

function _renderMCTQuestion() {
  const q = _mctQuestions[_mctCurrentIdx];
  if (!q) { finishMCTQuiz(); return; }

  document.getElementById('mctProgressText').textContent =
    `Question ${_mctCurrentIdx + 1} of ${_mctQuestions.length}`;
  document.getElementById('mctScoreText').textContent = `Score: ${_mctScore}`;
  document.getElementById('mctQuestionText').textContent = q.q;

  const optEl = document.getElementById('mctOptions');
  optEl.innerHTML = (q.opts || []).map((opt, i) =>
    `<button class="mct-option-btn" onclick="submitMCTAnswer(${i})">${opt}</button>`
  ).join('');

  const fb = document.getElementById('mctFeedback');
  fb.innerHTML = '';
  fb.className = 'mct-feedback';
  fb.style.display = 'none';
  const nb = document.getElementById('mctNextBtn');
  nb.style.display = 'none';
  nb.onclick = nextMCTQuestion;

  // On mobile scroll question back into view
  if (document.body.classList.contains('mobile-ui')) {
    const qEl = document.getElementById('mctQuestionText');
    if (qEl) setTimeout(() => qEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
}

function submitMCTAnswer(idx) {
  const q = _mctQuestions[_mctCurrentIdx];
  if (!q) return;
  const btns = document.querySelectorAll('.mct-option-btn');
  btns.forEach(b => b.disabled = true);

  const correct = q.correct ?? 0;
  const isCorrect = idx === correct;

  if (isCorrect) {
    btns[idx].classList.add('mct-correct');
    _mctScore++;
    _mctStreak++;
    addXP(1);
  } else {
    btns[idx].classList.add('mct-wrong');
    if (btns[correct]) btns[correct].classList.add('mct-correct');
    _mctStreak = 0;
    _mctWrong++;
  }

  document.getElementById('mctScoreText').textContent = `Score: ${_mctScore}`;
  _updateMCTStats(_mctCurrentIdx + 1);

  const fb = document.getElementById('mctFeedback');
  fb.className = 'mct-feedback ' + (isCorrect ? 'correct' : 'wrong');
  fb.innerHTML = (isCorrect ? '✅ Correct! ' : '❌ Incorrect. ') +
    (q.explanation || '');

  if (!isCorrect) {
    const explDiv = document.createElement('div');
    explDiv.className = 'mct-ai-explain';
    explDiv.textContent = '🤖 Getting AI explanation…';
    fb.appendChild(explDiv);
    _explainMCTWrongAnswer(q, idx, explDiv);
  }

  fb.style.display = '';

  const nb = document.getElementById('mctNextBtn');
  nb.textContent = _mctCurrentIdx < _mctQuestions.length - 1 ? 'Next ▶' : '📊 Results';
  nb.onclick = _mctCurrentIdx < _mctQuestions.length - 1 ? nextMCTQuestion : finishMCTQuiz;
  nb.style.display = '';

  // On mobile scroll feedback into view
  if (document.body.classList.contains('mobile-ui')) {
    setTimeout(() => fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
  }
}

function _explainMCTWrongAnswer(q, userIdx, el) {
  const userOpt = q.opts?.[userIdx] || '';
  const correctOpt = q.opts?.[q.correct] || '';
  const sys = 'You are a concise study tutor. Give a 2-sentence explanation only — no padding.';
  const usr = `Question: ${q.q}
Student chose: ${userOpt}
Correct answer: ${correctOpt}
Briefly explain why the correct answer is right and why the student's choice is wrong.`;

  let text = '';
  _callClaudeAPI(sys, usr,
    chunk => { text += chunk; el.textContent = '🤖 ' + text; },
    () => { el.textContent = '🤖 ' + text; },
    () => { el.textContent = '🤖 (AI explanation unavailable)'; },
    300
  );
}

function nextMCTQuestion() {
  _mctCurrentIdx++;
  if (_mctCurrentIdx >= _mctQuestions.length) { finishMCTQuiz(); return; }
  _renderMCTQuestion();
}

function finishMCTQuiz() {
  const total = _mctQuestions.length;
  const pct   = Math.round(_mctScore / total * 100);
  const stars  = pct >= 80 ? '⭐⭐⭐' : pct >= 60 ? '⭐⭐' : '⭐';

  document.getElementById('mctOptions').innerHTML = '';
  document.getElementById('mctFeedback').style.display = 'none';
  document.getElementById('mctNextBtn').style.display = 'none';
  document.getElementById('mctProgressText').textContent = 'Quiz Complete!';
  document.getElementById('mctScoreText').textContent = '';
  document.getElementById('mctQuestionText').innerHTML =
    `<div style="text-align:center;padding:20px 0">
      <div style="font-family:'Cinzel',serif;font-size:2.2rem;color:var(--gold);margin-bottom:6px">${_mctScore} / ${total}</div>
      <div style="font-size:1.6rem;margin-bottom:8px">${stars}</div>
      <div style="font-family:'Crimson Text',serif;font-size:1.1rem;color:var(--text-dim);margin-bottom:22px">${pct}% correct</div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="rpg-btn primary" onclick="regenerateMCTQuiz()">🔄 New Questions</button>
        <button class="rpg-btn" onclick="showMCTBuilder()">🆕 New Topic</button>
        <button class="rpg-btn" onclick="exitMCTQuiz()">← Back</button>
      </div>
    </div>`;
}

// ── AI: Generate flashcards from notes ──

let _aiGeneratedCards = [];

function showAICardGen() {
  const modal = document.getElementById('aiCardGenModal');
  if (modal) {
    document.getElementById('aiCardGenInput').value = '';
    document.getElementById('aiCardGenStatus').textContent = '';
    document.getElementById('aiCardGenPreview').innerHTML = '';
    document.getElementById('aiCardImportBtn').style.display = 'none';
    const fp = document.getElementById('aiCardFilePreview');
    const fi = document.getElementById('aiCardFileInput');
    if (fp) fp.textContent = '';
    if (fi) fi.value = '';
    _aiGeneratedCards = [];
    setAICardSource('text');
    modal.style.display = 'flex';
  }
}

function hideAICardGen() {
  const m = document.getElementById('aiCardGenModal');
  if (m) m.style.display = 'none';
}

function setAICardSource(src) {
  document.querySelectorAll('#aiCardGenModal .mct-src-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.src === src));
  document.getElementById('aiCardTextSource').style.display = src === 'text' ? '' : 'none';
  document.getElementById('aiCardFileSource').style.display = src === 'file' ? '' : 'none';
}

function runAICardGen() {
  const src    = document.querySelector('#aiCardGenModal .mct-src-tab.active')?.dataset?.src || 'text';
  const count  = parseInt(document.getElementById('aiCardCount')?.value) || 8;
  const status = document.getElementById('aiCardGenStatus');
  const preview= document.getElementById('aiCardGenPreview');

  if (status)  status.innerHTML = '<span>⏳ Generating…</span>';
  if (preview) preview.innerHTML = '';
  _aiGeneratedCards = [];
  document.getElementById('aiCardImportBtn').style.display = 'none';

  if (src === 'file') {
    const file = document.getElementById('aiCardFileInput')?.files?.[0];
    if (!file) { status.textContent = '⚠ Choose a file first.'; return; }
    _readFileAndGenCards(file, count, status, preview);
  } else {
    const notes = (document.getElementById('aiCardGenInput')?.value || '').trim();
    if (!notes) { status.textContent = '⚠ Paste some notes first.'; return; }
    _genCardsFromText(notes, count, status, preview);
  }
}

// Shared helper — reads file input and returns { type:'text', content } or { type:'image', b64, mime }
// Max image dimension sent to AI — keeps file size under ~500KB
const _AI_IMG_MAX = 1568;
const _AI_IMG_QUALITY = 0.82;

function _readAIFile(file, onReady, onError) {
  const isImage = file.type.startsWith('image/');
  const reader  = new FileReader();
  reader.onerror = () => onError('Could not read file.');

  if (isImage) {
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => onError('Could not load image.');
      img.onload = () => {
        // Resize to fit within _AI_IMG_MAX on longest side
        let w = img.width, h = img.height;
        if (w > _AI_IMG_MAX || h > _AI_IMG_MAX) {
          if (w >= h) { h = Math.round(h * _AI_IMG_MAX / w); w = _AI_IMG_MAX; }
          else        { w = Math.round(w * _AI_IMG_MAX / h); h = _AI_IMG_MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', _AI_IMG_QUALITY);
        const b64 = dataUrl.split(',')[1];
        const kb  = Math.round(b64.length * 0.75 / 1024);
        console.log(`Image compressed to ${w}×${h} ~${kb}KB`);
        onReady({ type: 'image', b64, mime: 'image/jpeg' });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    reader.onload = e => onReady({ type: 'text', content: e.target.result });
    reader.readAsText(file);
  }
}

function _readFileAndGenCards(file, count, status, preview) {
  const fp = document.getElementById('aiCardFilePreview');
  if (fp) fp.textContent = '📎 ' + file.name;
  status.innerHTML = '<span>⏳ Reading file…</span>';
  _readAIFile(file,
    result => {
      if (result.type === 'image') _genCardsFromImage(result.b64, result.mime, count, status, preview);
      else _genCardsFromText(result.content, count, status, preview);
    },
    err => { status.innerHTML = `<span style="color:#ff9090">❌ ${err}</span>`; }
  );
}

function _genCardsFromText(notes, count, status, preview) {
  const sys    = 'You are an expert study assistant. Create concise, clear flashcards. Front = question or key term. Back = answer or definition. Keep backs under 60 words.';
  const prompt = `From the following notes, generate exactly ${count} flashcard pairs. Format each as:\nFRONT: [question or term]\nBACK: [answer or definition]\n\nNotes:\n${notes}`;
  let raw = '';
  _callClaudeAPI(sys, prompt,
    chunk => { raw += chunk; },
    () => _finishCardGen(raw, status, preview),
    err  => { status.innerHTML = `<span style="color:#ff9090">❌ ${err}</span>`; },
    count * 150
  );
}

function _genCardsFromImage(b64, mime, count, status, preview) {
  const sys = 'You are an expert study assistant. Create concise, clear flashcards from the image content. Front = question or key term. Back = answer or definition. Keep backs under 60 words.';
  const messages = [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
      { type: 'text', text: `Generate exactly ${count} flashcard pairs from the content in this image. Format each as:\nFRONT: [question or term]\nBACK: [answer or definition]` }
    ]
  }];
  let raw = '';
  _callClaudeAPIMessages(sys, messages, count * 150,
    chunk => { raw += chunk; },
    () => _finishCardGen(raw, status, preview),
    err  => { status.innerHTML = `<span style="color:#ff9090">❌ ${err}</span>`; }
  );
}

function _finishCardGen(raw, status, preview) {
  const pairs = [...raw.matchAll(/FRONT:\s*(.+?)\nBACK:\s*(.+?)(?=\nFRONT:|$)/gs)];
  _aiGeneratedCards = pairs.map(m => ({ front: m[1].trim(), back: m[2].trim() }));
  if (preview) {
    preview.innerHTML = _aiGeneratedCards.map((c, i) =>
      `<div class="ai-card-preview"><div class="ai-card-front">Q${i+1}: ${_tesc(c.front)}</div><div class="ai-card-back">${_tesc(c.back)}</div></div>`
    ).join('');
  }
  if (status) status.innerHTML = `<span style="color:#7dde8a">✅ Generated ${_aiGeneratedCards.length} cards.</span>`;
  if (_aiGeneratedCards.length) document.getElementById('aiCardImportBtn').style.display = '';
}

function importAICards() {
  if (!currentDeck || !_aiGeneratedCards.length) return;
  _aiGeneratedCards.forEach(c => currentDeck.cards.push({ front: c.front, back: c.back, due: 0, mastered: false }));
  saveDB(); buildQueue(); renderCard();
  showToast('✅', `${_aiGeneratedCards.length} cards added`, `To deck "${currentDeckName}"`);
  hideAICardGen();
}

// ── Multi-turn API call (for chat) ──
async function _callClaudeAPIMessages(systemPrompt, messages, maxTok, onChunk, onDone, onError) {
  const key = _getAIKey();
  if (!key) { onError?.('No API key — go to Settings → AI Tutor.'); return; }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: _getAIModel(), max_tokens: maxTok || 1024, stream: true, system: systemPrompt, messages })
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); onError?.(e.error?.message || `Error ${res.status}`); return; }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try { const j = JSON.parse(line.slice(6).trim());
          if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') onChunk?.(j.delta.text);
        } catch {}
      }
    }
    onDone?.();
  } catch (err) { onError?.(err.message || 'Network error'); }
}

// ── Improve My Answer (Grammarly-style diff) ──
function _renderImprovedDiff(raw) {
  // Parse {{+added+}} green, {{-removed-}} red strikethrough
  return raw
    .replace(/\{\{\+(.+?)\+\}\}/gs, '<mark class="ai-diff-add">$1</mark>')
    .replace(/\{\{-(.+?)-\}\}/gs, '<del class="ai-diff-del">$1</del>')
    .replace(/\n/g, '<br>');
}

// ── Gap Detector ──
function runGapDetector() {
  if (!activeScrollName || !db.practiceBooks[activeScrollName]) {
    showToast('⚠','No Book Open','Open a practice book first.'); return;
  }
  const sessions = db.practiceBooks[activeScrollName].sessions || [];
  const questions = sessions.map(s => s.question).filter(Boolean);
  const area = document.getElementById('aiResponseArea');
  const panel = document.getElementById('aiPanel');
  if (panel) panel.style.display = 'flex';
  if (!area) return;
  if (!questions.length) {
    area.innerHTML = '<div class="ai-error">No questions found in this book. Set questions on your pages first.</div>'; return;
  }
  area.innerHTML = '<div class="ai-thinking"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></div>';
  const prompt = `I have been practising with these exam questions:\n\n${questions.map((q,i)=>`${i+1}. ${q}`).join('\n')}\n\nAnalyse these questions and tell me:\n1. ✅ Topics I have covered well\n2. ❌ Important topics that are MISSING from my practice\n3. ⚠️ Areas I may have practised too narrowly\n\nBe specific. Format clearly with emoji bullet points.`;
  let html = '', txt = '';
  _callClaudeAPI(_AI_SYSTEM, prompt,
    c => { txt += c; html += c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>');
      area.innerHTML = '<div class="ai-response-text">' + html + '</div>'; area.scrollTop = area.scrollHeight; },
    () => { _aiResponseText = txt; ['aiCopyBtn','aiClearBtn'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display=''; }); },
    err => { area.innerHTML = `<div class="ai-error">❌ ${err}</div>`; }
  );
}

// ── Topic Deep Dive ──
function showTopicDeepDive() {
  let m = document.getElementById('topicDeepDiveModal');
  if (!m) {
    m = document.createElement('div'); m.id = 'topicDeepDiveModal'; m.className = 'modal-overlay';
    m.onclick = e => { if (e.target===m) m.style.display='none'; };
    m.innerHTML = `<div class="rpg-modal ai-cardgen-modal" onclick="event.stopPropagation()" style="max-width:560px">
      <div class="modal-title">🔍 Topic Deep Dive</div>
      <p class="rpg-hint" style="margin-bottom:12px">Type any topic and get a full explanation, key concepts, real-world examples, and 3 practice questions.</p>
      <input class="rpg-input" id="deepDiveTopic" placeholder="e.g. IAS 16 Property Plant & Equipment, Offer and Acceptance, Ratio Analysis…" style="margin-bottom:10px">
      <div id="deepDiveStatus" style="min-height:20px;font-family:'Crimson Text',serif;font-size:0.95rem;color:var(--gold)"></div>
      <div id="deepDiveResult" style="max-height:340px;overflow-y:auto;margin-top:8px;font-family:'Crimson Text',serif;font-size:0.93rem;color:#e8dfc0;line-height:1.65"></div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="rpg-btn primary" onclick="runTopicDeepDive()">🔍 Deep Dive</button>
        <button class="rpg-btn small" id="deepDiveSaveQBtn" style="display:none" onclick="saveDeepDiveQuestions()">💾 Save Questions to Book</button>
        <button class="rpg-btn" onclick="document.getElementById('topicDeepDiveModal').style.display='none'">✖ Close</button>
      </div>
    </div>`;
    document.body.appendChild(m);
  }
  document.getElementById('deepDiveStatus').textContent = '';
  document.getElementById('deepDiveResult').innerHTML = '';
  document.getElementById('deepDiveSaveQBtn').style.display = 'none';
  m.style.display = 'flex';
  setTimeout(() => document.getElementById('deepDiveTopic')?.focus(), 100);
}

let _deepDiveRawText = '';
function runTopicDeepDive() {
  const topic = document.getElementById('deepDiveTopic')?.value?.trim();
  const status = document.getElementById('deepDiveStatus');
  const result = document.getElementById('deepDiveResult');
  if (!topic) { if (status) status.textContent = '⚠ Enter a topic first.'; return; }
  if (status) status.innerHTML = '<span>⏳ Generating deep dive…</span>';
  result.innerHTML = '';
  _deepDiveRawText = '';

  const prompt = `Create a comprehensive deep dive on: "${topic}"\n\nStructure exactly as:\n## Overview\n[2-3 sentence summary]\n\n## Key Concepts\n[5-8 bullet points of the most important things to know]\n\n## Real-World Example\n[A specific, concrete example]\n\n## Common Exam Questions\n1. [Question]\n2. [Question]\n3. [Question]\n\n## Examiner Tips\n[What examiners look for, common mistakes to avoid]`;

  let html = '';
  _callClaudeAPI(_AI_SYSTEM, prompt,
    c => { _deepDiveRawText += c;
      html += c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/##\s+(.+)/g,'<strong style="color:var(--gold);display:block;margin:10px 0 4px;font-family:Cinzel,serif;font-size:0.8rem">$1</strong>').replace(/\n/g,'<br>');
      result.innerHTML = html; result.scrollTop = result.scrollHeight; },
    () => { if (status) status.innerHTML = '<span style="color:#7dde8a">✅ Done.</span>';
      document.getElementById('deepDiveSaveQBtn').style.display = ''; },
    err => { if (status) status.innerHTML = `<span style="color:#ff9090">❌ ${err}</span>`; }
  );
}

function saveDeepDiveQuestions() {
  const books = Object.keys(db.practiceBooks || {});
  if (!books.length) { showToast('⚠','No Books','Create a practice book first.'); return; }
  // Extract the 3 practice questions from the response
  const qMatches = [..._deepDiveRawText.matchAll(/^\d+\.\s+(.+)$/gm)].map(m => m[1].trim());
  if (!qMatches.length) { showToast('⚠','No Questions Found','Generate a deep dive first.'); return; }
  const bookName = books[0];
  if (!db.practiceBooks[bookName].sessions) db.practiceBooks[bookName].sessions = [];
  if (!db.practiceBooks[bookName].sessions) db.practiceBooks[bookName].sessions = [];
  const sessions = db.practiceBooks[bookName].sessions;
  const base = Date.now();
  for (let i = qMatches.length - 1; i >= 0; i--) {
    sessions.unshift({ id: base+i, question: qMatches[i], answer: '', timestamp: base+i, wordCount: 0, wpm: 0 });
  }
  saveDB();
  showToast('✅','Saved',`${qMatches.length} questions added to "${bookName}"`);
}

// ── Study Plan Generator ──
function showStudyPlan() {
  let m = document.getElementById('studyPlanModal');
  if (!m) {
    m = document.createElement('div'); m.id = 'studyPlanModal'; m.className = 'modal-overlay';
    m.onclick = e => { if (e.target===m) m.style.display='none'; };
    m.innerHTML = `<div class="rpg-modal ai-cardgen-modal" onclick="event.stopPropagation()" style="max-width:580px">
      <div class="modal-title">📅 Study Plan Generator</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label class="rpg-label">Exam Date</label>
          <input class="rpg-input" type="date" id="studyPlanDate" style="margin:0">
        </div>
        <div>
          <label class="rpg-label">Hours per day available</label>
          <input class="rpg-input" type="number" id="studyPlanHours" value="3" min="1" max="12" style="margin:0">
        </div>
      </div>
      <label class="rpg-label">Topics / Subjects to cover</label>
      <textarea class="rpg-input" id="studyPlanTopics" rows="4"
        placeholder="e.g. Financial Accounting, Management Accounting, Auditing, Law of Contract…"
        style="resize:vertical;font-family:'Crimson Text',serif;margin-bottom:10px"></textarea>
      <label class="rpg-label">Any extra notes for the AI</label>
      <input class="rpg-input" id="studyPlanNotes" placeholder="e.g. I'm weakest on consolidations, exams are 3 hours each" style="margin-bottom:10px">
      <div id="studyPlanStatus" style="min-height:20px;font-family:'Crimson Text',serif;font-size:0.95rem;color:var(--gold)"></div>
      <div id="studyPlanResult" style="max-height:380px;overflow-y:auto;margin-top:8px;font-family:'Crimson Text',serif;font-size:0.93rem;color:#e8dfc0;line-height:1.7"></div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="rpg-btn primary" onclick="runStudyPlan()">📅 Generate Plan</button>
        <button class="rpg-btn small" id="studyPlanCopyBtn" style="display:none" onclick="navigator.clipboard?.writeText(document.getElementById('studyPlanResult').innerText).then(()=>showToast('📋','Copied',''))">📋 Copy</button>
        <button class="rpg-btn" onclick="document.getElementById('studyPlanModal').style.display='none'">✖ Close</button>
      </div>
    </div>`;
    document.body.appendChild(m);
  }
  // Pre-fill date as 4 weeks from now
  const d = new Date(); d.setDate(d.getDate() + 28);
  document.getElementById('studyPlanDate').value = d.toISOString().split('T')[0];
  document.getElementById('studyPlanStatus').textContent = '';
  document.getElementById('studyPlanResult').innerHTML = '';
  document.getElementById('studyPlanCopyBtn').style.display = 'none';
  m.style.display = 'flex';
}

function runStudyPlan() {
  const examDate = document.getElementById('studyPlanDate')?.value;
  const hours    = document.getElementById('studyPlanHours')?.value || 3;
  const topics   = document.getElementById('studyPlanTopics')?.value?.trim();
  const notes    = document.getElementById('studyPlanNotes')?.value?.trim();
  const status   = document.getElementById('studyPlanStatus');
  const result   = document.getElementById('studyPlanResult');
  if (!examDate || !topics) { if (status) status.textContent = '⚠ Enter your exam date and topics.'; return; }
  const today = new Date(), exam = new Date(examDate);
  const days = Math.ceil((exam - today) / 86400000);
  if (days <= 0) { if (status) status.textContent = '⚠ Exam date must be in the future.'; return; }

  // Auto-add exam date to Calendar
  if (!db.calendar) db.calendar = { events: [] };
  const examTitle = topics.split(',')[0].trim() + ' Exam';
  const alreadyExists = db.calendar.events.some(e => e.date === examDate && e.type === 'exam');
  if (!alreadyExists) {
    db.calendar.events.push({ id: 'ev_' + Date.now(), title: examTitle, date: examDate, type: 'exam', colour: '#e74c3c', notes: topics, time: '' });
    saveDB();
    showToast('📅', 'Added to Calendar', `"${examTitle}" on ${examDate}`);
  }

  if (status) status.innerHTML = '<span>⏳ Building your personalised plan…</span>';
  result.innerHTML = '';

  const prompt = `Create a detailed ${days}-day study plan for a student with the following details:
- Exam date: ${examDate} (${days} days away)
- Daily study time: ${hours} hours
- Topics to cover: ${topics}
${notes ? `- Additional notes: ${notes}` : ''}

Structure the plan as:
**WEEK X — [Focus Theme]**
Day 1 (Date): [Topic] — [Specific tasks, 2-3 bullet points]
Day 2 (Date): [Topic] — [Tasks]
...

Include review sessions every few days, past paper practice in the final week, and realistic rest. Be specific about what to do each day, not generic advice.`;

  let html = '';
  _callClaudeAPI('You are an expert study coach. Create realistic, specific, day-by-day revision plans. Use UK English.', prompt,
    c => { html += c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\*\*(.+?)\*\*/g,'<strong style="color:var(--gold);font-family:Cinzel,serif;font-size:0.78rem">$1</strong>').replace(/\n/g,'<br>');
      result.innerHTML = html; result.scrollTop = result.scrollHeight; },
    () => { if (status) status.innerHTML = '<span style="color:#7dde8a">✅ Plan ready!</span>';
      document.getElementById('studyPlanCopyBtn').style.display = ''; },
    err => { if (status) status.innerHTML = `<span style="color:#ff9090">❌ ${err}</span>`; },
    2500  // Study plans need more tokens for multi-week output
  );
}

// ── Syllabus Checker ──
function showSyllabusChecker() {
  let m = document.getElementById('syllabusModal');
  if (!m) {
    m = document.createElement('div'); m.id = 'syllabusModal'; m.className = 'modal-overlay';
    m.onclick = e => { if (e.target===m) m.style.display='none'; };
    const deckOptions = Object.keys(db.decks||{}).map(d=>`<option value="${d}">${d}</option>`).join('');
    m.innerHTML = `<div class="rpg-modal ai-cardgen-modal" onclick="event.stopPropagation()" style="max-width:580px">
      <div class="modal-title">📋 Syllabus Checker</div>
      <p class="rpg-hint" style="margin-bottom:12px">Paste your syllabus or past paper topic list. AI will check which topics your flashcards cover and which are missing.</p>
      <label class="rpg-label">Check against deck</label>
      <select class="rpg-input" id="syllabusCheckDeck" style="margin-bottom:10px">${deckOptions}</select>
      <label class="rpg-label">Syllabus / Topic List</label>
      <textarea class="rpg-input" id="syllabusInput" rows="6"
        placeholder="Paste syllabus here, one topic per line or as a list…"
        style="resize:vertical;font-family:'Crimson Text',serif;margin-bottom:10px"></textarea>
      <div id="syllabusStatus" style="min-height:20px;font-family:'Crimson Text',serif;font-size:0.95rem;color:var(--gold)"></div>
      <div id="syllabusResult" style="max-height:320px;overflow-y:auto;margin-top:8px;font-family:'Crimson Text',serif;font-size:0.93rem;color:#e8dfc0;line-height:1.65"></div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="rpg-btn primary" onclick="runSyllabusCheck()">📋 Check Coverage</button>
        <button class="rpg-btn" onclick="document.getElementById('syllabusModal').style.display='none'">✖ Close</button>
      </div>
    </div>`;
    document.body.appendChild(m);
  }
  document.getElementById('syllabusStatus').textContent = '';
  document.getElementById('syllabusResult').innerHTML = '';
  m.style.display = 'flex';
}

function runSyllabusCheck() {
  const deckName = document.getElementById('syllabusCheckDeck')?.value;
  const syllabus = document.getElementById('syllabusInput')?.value?.trim();
  const status   = document.getElementById('syllabusStatus');
  const result   = document.getElementById('syllabusResult');
  if (!syllabus) { if (status) status.textContent = '⚠ Paste your syllabus first.'; return; }
  const deck = db.decks[deckName];
  const cardFronts = (deck?.cards || []).map(c => c.front).join('\n');
  if (!cardFronts) { if (status) status.textContent = '⚠ Selected deck has no cards.'; return; }
  if (status) status.innerHTML = '<span>⏳ Checking coverage…</span>';
  result.innerHTML = '';

  const prompt = `Syllabus topics to cover:\n${syllabus}\n\nMy current flashcard questions:\n${cardFronts}\n\nFor each syllabus topic, classify as:\n✅ COVERED — I have good flashcard coverage\n⚠️ PARTIAL — I have some cards but likely need more\n❌ MISSING — I have no cards on this topic\n\nList every topic. Then at the end, give a COVERAGE SUMMARY with a percentage and top 3 priority gaps to fill.`;

  let html = '';
  _callClaudeAPI('You are an expert study analyst. Be precise and specific about coverage gaps.', prompt,
    c => { html += c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/✅/g,'<span style="color:#7dde8a">✅</span>').replace(/⚠️/g,'<span style="color:#d4a017">⚠️</span>').replace(/❌/g,'<span style="color:#e74c3c">❌</span>').replace(/\n/g,'<br>');
      result.innerHTML = html; result.scrollTop = result.scrollHeight; },
    () => { if (status) status.innerHTML = '<span style="color:#7dde8a">✅ Done.</span>'; },
    err => { if (status) status.innerHTML = `<span style="color:#ff9090">❌ ${err}</span>`; }
  );
}

// ── Build Full Deck from Topic ──
function showBuildDeckFromTopic() {
  let m = document.getElementById('buildDeckModal');
  if (!m) {
    m = document.createElement('div'); m.id = 'buildDeckModal'; m.className = 'modal-overlay';
    m.onclick = e => { if (e.target===m) m.style.display='none'; };
    m.innerHTML = `<div class="rpg-modal ai-cardgen-modal" onclick="event.stopPropagation()" style="max-width:520px">
      <div class="modal-title">✨ Build Deck from Topic</div>
      <p class="rpg-hint" style="margin-bottom:12px">Type any topic and AI will generate a complete flashcard deck covering all the key content.</p>
      <label class="rpg-label">Topic</label>
      <input class="rpg-input" id="buildDeckTopic" placeholder="e.g. IAS 16 Property Plant & Equipment, Law of Contract, Capital Asset Pricing Model…" style="margin-bottom:10px">
      <div style="display:flex;gap:12px">
        <div style="flex:1"><label class="rpg-label">New Deck Name</label>
          <input class="rpg-input" id="buildDeckName" placeholder="Deck name" style="margin:0"></div>
        <div><label class="rpg-label">Cards</label>
          <input class="rpg-input" type="number" id="buildDeckCount" value="15" min="5" max="30" style="margin:0;width:70px"></div>
      </div>
      <div id="buildDeckStatus" style="min-height:20px;font-family:'Crimson Text',serif;font-size:0.95rem;color:var(--gold);margin-top:10px"></div>
      <div id="buildDeckPreview" style="max-height:220px;overflow-y:auto;margin-top:8px"></div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="rpg-btn primary" onclick="runBuildDeck()">✨ Generate Deck</button>
        <button class="rpg-btn primary" id="buildDeckImportBtn" style="display:none" onclick="importBuiltDeck()">⬇ Create Deck</button>
        <button class="rpg-btn" onclick="document.getElementById('buildDeckModal').style.display='none'">✖ Close</button>
      </div>
    </div>`;
    document.body.appendChild(m);
  }
  document.getElementById('buildDeckStatus').textContent = '';
  document.getElementById('buildDeckPreview').innerHTML = '';
  document.getElementById('buildDeckImportBtn').style.display = 'none';
  m.style.display = 'flex';
  setTimeout(() => document.getElementById('buildDeckTopic')?.focus(), 100);
}

let _builtDeckCards = [];
function runBuildDeck() {
  const topic  = document.getElementById('buildDeckTopic')?.value?.trim();
  const count  = parseInt(document.getElementById('buildDeckCount')?.value) || 15;
  const status = document.getElementById('buildDeckStatus');
  const preview= document.getElementById('buildDeckPreview');
  if (!topic) { if (status) status.textContent = '⚠ Enter a topic first.'; return; }
  if (status) status.innerHTML = '<span>⏳ Building deck…</span>';
  preview.innerHTML = ''; _builtDeckCards = [];
  document.getElementById('buildDeckImportBtn').style.display = 'none';
  if (!document.getElementById('buildDeckName').value) document.getElementById('buildDeckName').value = topic;

  const prompt = `Create exactly ${count} flashcard pairs covering the topic: "${topic}"\n\nInclude definitions, key rules, formulas, examples, and common exam scenarios. Format each as:\nFRONT: [clear question or term an examiner might test]\nBACK: [concise accurate answer, under 60 words]\n\nCover breadth — don't repeat similar cards.`;

  let raw = '';
  _callClaudeAPI('You are an expert flashcard creator. Create comprehensive, exam-focused flashcards. UK English.', prompt,
    c => { raw += c; },
    () => {
      const pairs = [...raw.matchAll(/FRONT:\s*(.+?)\nBACK:\s*(.+?)(?=\nFRONT:|$)/gs)];
      _builtDeckCards = pairs.map(m => ({ front: m[1].trim(), back: m[2].trim() }));
      preview.innerHTML = _builtDeckCards.map((c,i) =>
        `<div class="ai-card-preview"><div class="ai-card-front">Q${i+1}: ${c.front}</div><div class="ai-card-back">${c.back}</div></div>`
      ).join('');
      if (status) status.innerHTML = `<span style="color:#7dde8a">✅ ${_builtDeckCards.length} cards generated.</span>`;
      if (_builtDeckCards.length) document.getElementById('buildDeckImportBtn').style.display = '';
    },
    err => { if (status) status.innerHTML = `<span style="color:#ff9090">❌ ${err}</span>`; }
  );
}

function importBuiltDeck() {
  const name = document.getElementById('buildDeckName')?.value?.trim();
  if (!name || !_builtDeckCards.length) return;
  if (db.decks[name] && !confirm(`Deck "${name}" already exists. Add cards to it?`)) return;
  if (!db.decks[name]) db.decks[name] = { cards: [], rag: {}, stats: {} };
  _builtDeckCards.forEach(c => db.decks[name].cards.push({ front: c.front, back: c.back, due: 0, mastered: false }));
  saveDB();
  showToast('✅',`Deck "${name}" created`,`${_builtDeckCards.length} cards added`);
  document.getElementById('buildDeckModal').style.display = 'none';
}

// ── AI Chat Assistant (global floating bubble) ──
let _aiChatHistory = [];
let _aiChatStreaming = false;

// ── Mobile tools shortcut (⚙ button bottom-right, drawer slides up) ──
function _initMobileToolsBtn() {
  if (document.getElementById('mobileToolsBtn')) return;

  // Only inject on learning pages
  const page = window.location.pathname.split('/').pop();
  const learningPages = ['deck.html', 'duel.html', 'practice.html'];
  if (!learningPages.includes(page)) return;

  // Determine which tools to show based on page
  const tools = {
    'deck.html': [
      { icon: '🔢', label: 'Calc',     fn: 'showCalculator()' },
      { icon: '⚖️', label: 'T-Acct',  fn: 'showTAccountPad()' },
      { icon: '📊', label: 'Ratios',   fn: 'showRatioReference()' },
      { icon: '✨', label: 'AI Chat',  fn: 'toggleAIChat()' },
      { icon: '📋', label: 'Summary',  fn: 'showSessionSummary()' },
      { icon: '🔄', label: 'Reset',    fn: 'showResetModal()' },
      { icon: '🔍', label: 'Search',   fn: 'showCardSearch()' },
      { icon: '🏷️', label: 'Tags',     fn: 'showTagFilter()' },
      { icon: '🗺',  label: 'Map',      fn: "window.location.href='index.html'" },
      { icon: '⚔',  label: 'Duel',     fn: "window.location.href='duel.html'" },
      { icon: '✍️', label: 'Practice', fn: "window.location.href='practice.html'" },
      { icon: '⚙',  label: 'Settings', fn: "window.location.href='settings.html'" },
    ],
    'duel.html': [
      { icon: '🔢', label: 'Calc',     fn: 'showCalculator()' },
      { icon: '⚖️', label: 'T-Acct',  fn: 'showTAccountPad()' },
      { icon: '📊', label: 'Ratios',   fn: 'showRatioReference()' },
      { icon: '✨', label: 'AI Chat',  fn: 'toggleAIChat()' },
      { icon: '📊', label: 'Summary',  fn: 'showDuelSummary()' },
      { icon: '🗺',  label: 'Map',      fn: "window.location.href='index.html'" },
      { icon: '⚔',  label: 'Study',    fn: "history.back()" },
      { icon: '✍️', label: 'Practice', fn: "window.location.href='practice.html'" },
      { icon: '⚙',  label: 'Settings', fn: "window.location.href='settings.html'" },
    ],
    'practice.html': [
      { icon: '🔢', label: 'Calc',     fn: 'showCalculator()' },
      { icon: '⚖️', label: 'T-Acct',  fn: 'showTAccountPad()' },
      { icon: '📊', label: 'Ratios',   fn: 'showRatioReference()' },
      { icon: '✨', label: 'AI Tutor', fn: 'toggleAIPanel()' },
      { icon: '✨', label: 'AI Chat',  fn: 'toggleAIChat()' },
      { icon: '⊞',  label: 'Table',    fn: 'toggleTablePanel()' },
      { icon: '🗺',  label: 'Map',      fn: "window.location.href='index.html'" },
      { icon: '⚔',  label: 'Duel',     fn: "window.location.href='duel.html'" },
      { icon: '⚙',  label: 'Settings', fn: "window.location.href='settings.html'" },
    ],
  };

  const pageTools = tools[page] || [];

  // Floating button
  const btn = document.createElement('button');
  btn.id = 'mobileToolsBtn';
  btn.className = 'mobile-tools-btn';
  btn.innerHTML = '⚙';
  btn.title = 'Tools';
  btn.onclick = toggleMobileToolsDrawer;
  document.body.appendChild(btn);

  // Drawer
  const drawer = document.createElement('div');
  drawer.id = 'mobileToolsDrawer';
  drawer.className = 'mobile-tools-drawer';
  drawer.innerHTML = `
    <div class="mobile-tools-drawer-title">⚙ Tools</div>
    <div class="mobile-tools-drawer-grid">
      ${pageTools.map(t =>
        `<button class="rpg-btn small" onclick="${t.fn};closeMobileToolsDrawer()">${t.icon}<br><span style="font-size:0.6rem">${t.label}</span></button>`
      ).join('')}
    </div>
    <button class="rpg-btn" style="margin-top:8px;width:100%" onclick="closeMobileToolsDrawer()">✕ Close</button>`;
  document.body.appendChild(drawer);

  // Tap outside closes drawer
  document.addEventListener('touchstart', (e) => {
    if (!drawer.contains(e.target) && e.target !== btn) closeMobileToolsDrawer();
  }, { passive: true });
}

function toggleMobileToolsDrawer() {
  const d = document.getElementById('mobileToolsDrawer');
  if (d) d.classList.toggle('open');
}
function closeMobileToolsDrawer() {
  const d = document.getElementById('mobileToolsDrawer');
  if (d) d.classList.remove('open');
}

function _initAIChat() {
  if (document.getElementById('aiChatBubble')) return;
  const bubble = document.createElement('button');
  bubble.id = 'aiChatBubble';
  bubble.className = 'ai-chat-bubble';
  bubble.innerHTML = '🤖';
  bubble.title = 'AI Tutor Chat';
  bubble.onclick = toggleAIChat;
  document.body.appendChild(bubble);

  const panel = document.createElement('div');
  panel.id = 'aiChatPanel';
  panel.className = 'ai-chat-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="ai-chat-header">
      <span class="ai-chat-title">✨ AI Tutor</span>
      <button class="ai-chat-close" onclick="toggleAIChat()">✕</button>
    </div>
    <div class="ai-chat-messages" id="aiChatMessages">
      <div class="ai-chat-msg assistant"><div class="ai-chat-bubble-msg">Hello! I'm your AI Tutor. Ask me anything about your studies — I can explain concepts, help with questions, or discuss your flashcard topics.</div></div>
    </div>
    <div class="ai-chat-input-row">
      <input class="rpg-input ai-chat-field" id="aiChatInput" placeholder="Ask anything…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" style="margin:0;flex:1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendAIChatMessage();}">
      <button class="rpg-btn small ai-btn" onclick="sendAIChatMessage()">→</button>
    </div>`;
  document.body.appendChild(panel);
}

function toggleAIChat() {
  const panel = document.getElementById('aiChatPanel');
  const bubble = document.getElementById('aiChatBubble');
  if (!panel) return;
  const open = panel.style.display === 'none';
  panel.style.display = open ? 'flex' : 'none';
  if (bubble) bubble.classList.toggle('active', open);
  if (open) setTimeout(() => document.getElementById('aiChatInput')?.focus(), 100);
}

function _buildChatContext() {
  const page = window.location.pathname.split('/').pop() || window.location.pathname;
  let ctx = 'You are an expert AI study tutor inside Scholar\'s Sanctum, a flashcard and exam practice app. Answer concisely and helpfully. Use UK English.';
  if ((page === 'deck.html' || page === '') && typeof currentDeckName !== 'undefined' && currentDeckName) {
    ctx += ` The student is studying the "${currentDeckName}" deck.`;
    if (typeof currentDeck !== 'undefined' && currentDeck?.cards?.length) {
      const sample = currentDeck.cards.slice(0, 8).map(c => `"${c.front}"`).join(', ');
      ctx += ` Sample topics: ${sample}.`;
    }
  } else if (page === 'practice.html' && typeof activeScrollName !== 'undefined' && activeScrollName) {
    ctx += ` The student is in their "${activeScrollName}" practice book.`;
    if (typeof currentQuestion !== 'undefined' && currentQuestion) ctx += ` Current question: "${currentQuestion}".`;
  }
  return ctx;
}

function _appendChatMsg(role, text) {
  const msgs = document.getElementById('aiChatMessages');
  if (!msgs) return null;
  const div = document.createElement('div');
  div.className = `ai-chat-msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'ai-chat-bubble-msg';
  bubble.textContent = text;
  div.appendChild(bubble);
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return bubble;
}

function sendAIChatMessage() {
  if (_aiChatStreaming) return;
  const input = document.getElementById('aiChatInput');
  const msg = input?.value?.trim();
  if (!msg) return;

  // Clear input instantly — no deferred work before this
  input.value = '';
  input.focus();

  _appendChatMsg('user', msg);
  _aiChatHistory.push({ role: 'user', content: msg });

  const responseBubble = _appendChatMsg('assistant', '');
  if (responseBubble) responseBubble.innerHTML = '<span style="opacity:0.4">…</span>';

  _aiChatStreaming = true;
  let response = '';
  const msgs = document.getElementById('aiChatMessages');

  _callClaudeAPIMessages(
    _buildChatContext(),
    _aiChatHistory,
    800,
    chunk => {
      response += chunk;
      if (responseBubble) responseBubble.textContent = response;
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    },
    () => { _aiChatHistory.push({ role: 'assistant', content: response }); _aiChatStreaming = false; },
    err => { if (responseBubble) responseBubble.textContent = `❌ ${err}`; _aiChatStreaming = false; }
  );
}

// ── AI Duel Mode ──
let _aiDuelDeck        = null;
let _aiDuelDeckName    = '';
let _aiDuelPendingRealm = '';
let _aiDuelPendingSub   = '';
let _aiDuelQNum        = 0;
let _aiDuelScore       = 0;
let _aiDuelCorrect     = 0;
let _aiDuelStreak      = 0;
let _aiDuelBestStreak  = 0;
let _aiDuelCurrentQ    = '';
let _aiDuelStreaming    = false;

// Single source of truth for which duel view is visible
const _DUEL_VIEWS = ['duelPortalView','duelSubView','duelModeView','duelStudyView','aiDuelView'];
function _showDuelView(id) {
  _DUEL_VIEWS.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = v === id ? 'block' : 'none';
  });
  window.scrollTo(0, 0);
}

function showDuelSubView() {
  _showDuelView('duelSubView');
}

function confirmCardDuel() {
  if (_aiDuelPendingRealm && _aiDuelPendingSub) {
    window.location.href = `duel.html?realm=${encodeURIComponent(_aiDuelPendingRealm)}&sub=${encodeURIComponent(_aiDuelPendingSub)}`;
  }
}

let _aiDuelSessionXP = 0;
let _aiDuelMode = 'exam';       // 'exam' | 'deck'
let _aiDuelCurrentBack = '';    // actual card back (deck mode only)
let _aiDuelUsedCards = new Set(); // avoid repeating same card

function startAIDuelMode(mode) {
  _aiDuelMode = mode;
  startAIDuel();
}

function startAIDuel() {
  if (!_getAIKey()) { showToast('🤖','No API Key','Go to Settings → AI Tutor and add your Claude API key.'); return; }
  if (!_aiDuelDeck || !(_aiDuelDeck.cards || []).length) { showToast('⚠','No Cards','This sub-realm has no flashcards to duel with.'); return; }

  if (_aiDuelMode !== 'deck') _aiDuelMode = 'exam'; // default to exam unless explicitly set to deck
  _aiDuelQNum = 0; _aiDuelScore = 0; _aiDuelCorrect = 0;
  _aiDuelStreak = 0; _aiDuelBestStreak = 0; _aiDuelSessionXP = 0;
  _aiDuelCurrentBack = ''; _aiDuelUsedCards = new Set();
  _showDuelView('aiDuelView');

  // Set title based on mode
  const titleEl = document.getElementById('aiDuelTitle');
  const modeLabel = _aiDuelMode === 'deck' ? '📖 AI Deck Duel' : '🤖 AI Duel';
  if (titleEl) titleEl.textContent = `${modeLabel} — ${_aiDuelDeckName}`;

  // Mirror the rank/XP display from the main XP system
  _aiDuelSyncXPBar();
  updateRankDisplay();
  _updateAIDuelHUD();

  // Draw island and flame (same as deck.html)
  const ic = document.getElementById('aiDuelIsland');
  if (ic) drawPixelIsland(ic);
  _startAIDuelFlame();
  setTimeout(_generateAIDuelQuestion, 100);
}

// All XP bars (flashcard, card duel, AI duel) share updateXPBar() via .xp-fill / .xp-level-label / .xp-count-label classes
function _aiDuelSyncXPBar() { updateXPBar(); }

let _aiDuelFlameRunning = false;
function _drawAIDuelFlame() {
  const canvas = document.getElementById('aiDuelFlame');
  if (!canvas || !_aiDuelFlameRunning) { _aiDuelFlameRunning = false; return; }
  drawFlameOnCanvas(canvas, _aiDuelStreak);
  requestAnimationFrame(_drawAIDuelFlame);
}
function _startAIDuelFlame() {
  if (_aiDuelFlameRunning) return;
  _aiDuelFlameRunning = true;
  requestAnimationFrame(_drawAIDuelFlame);
}
function _stopAIDuelFlame() { _aiDuelFlameRunning = false; }

function _updateAIDuelHUD() {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('aiDuelQNum',        _aiDuelQNum + 1);
  set('aiDuelCorrect',     _aiDuelCorrect);
  set('aiDuelSessionXP',   _aiDuelSessionXP);
  set('aiDuelStreak',      _aiDuelStreak);
  set('aiDuelStreakHUD',   _aiDuelStreak);
  set('aiDuelBestStreakLabel', 'Best: ' + _aiDuelBestStreak);
  set('aiDuelCounter',    `Question ${_aiDuelQNum + 1}`);
  _aiDuelSyncXPBar();
}

function _generateAIDuelQuestion() {
  const qEl     = document.getElementById('aiDuelQuestion');
  const wrap    = document.getElementById('aiDuelAnswerWrap');
  const fbEl    = document.getElementById('aiDuelFeedback');
  const inputEl = document.getElementById('aiDuelInput');
  const submitBtn = document.getElementById('aiDuelSubmitBtn');

  if (qEl)  qEl.innerHTML = '<div class="ai-thinking"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></div>';
  // Keep answer wrap visible — user sees question + textarea simultaneously
  if (wrap) wrap.style.display = 'block';
  if (fbEl) fbEl.style.display = 'none';
  if (inputEl) { inputEl.value = ''; inputEl.placeholder = 'AI is generating your question…'; inputEl.disabled = true; }
  if (submitBtn) submitBtn.disabled = true;

  const cards = _aiDuelDeck?.cards || [];
  if (!cards.length) { if (qEl) qEl.textContent = 'No cards found in this deck.'; return; }

  // ── DECK MODE: show actual card front, mark against real back ──
  if (_aiDuelMode === 'deck') {
    // Pick a card we haven't used yet; reset if all used
    let available = cards.filter((_, i) => !_aiDuelUsedCards.has(i));
    if (!available.length) { _aiDuelUsedCards = new Set(); available = cards; }
    const idx  = Math.floor(Math.random() * available.length);
    const card = available[idx];
    const globalIdx = cards.indexOf(card);
    _aiDuelUsedCards.add(globalIdx);

    _aiDuelCurrentQ    = card.front;
    _aiDuelCurrentBack = card.back || '';
    if (qEl) {
      qEl.innerHTML = parseMarkdown(card.front);
      _renderMath(qEl);
    }
    if (wrap) wrap.style.display = 'block';
    setTimeout(() => inputEl?.focus(), 50);
    return; // no AI call needed for question generation
  }

  // ── EXAM MODE: AI generates open-ended question from card topics ──
  const seed    = cards[Math.floor(Math.random() * cards.length)];
  const context = cards.slice(0, 10).map(c => `• ${c.front}: ${c.back}`).join('\n');
  const prompt  = `You are generating an exam question for a student studying this topic.\n\nCard topic: "${seed.front}"\n\nOther cards in this deck:\n${context}\n\nGenerate ONE clear exam-style question that requires a written answer of 2-5 sentences. Do NOT just repeat the card front. Make it require application or explanation. Output only the question text, nothing else.`;

  _aiDuelStreaming = true;
  let q = '';
  _callClaudeAPI(
    'You are an exam question generator. Output only the question — no preamble, no numbering, no quotes.',
    prompt,
    chunk => { q += chunk; if (qEl) qEl.textContent = q; },
    () => {
      _aiDuelCurrentQ = q.trim();
      _aiDuelStreaming = false;
      if (inputEl) { inputEl.disabled = false; inputEl.placeholder = 'Type your answer here…'; }
      if (submitBtn) submitBtn.disabled = false;
      setTimeout(() => inputEl?.focus(), 50);
    },
    err => { if (qEl) qEl.innerHTML = `<span style="color:#ff9090">❌ ${err}</span>`; _aiDuelStreaming = false;
      if (inputEl) { inputEl.disabled = false; } }
  );
}

function _calcAIDuelXP(score, streak) {
  // Base XP based on score
  let xp = score <= 3 ? 1 : score <= 5 ? 2 : score <= 7 ? 3 : score <= 8 ? 4 : score === 9 ? 5 : 6;
  // Perfect score bonus
  if (score === 10) { xp += 4; showToast('🏆', 'Perfect Score!', '+4 bonus XP'); }
  // Streak bonuses
  if (streak >= 10) { xp += 10; showToast('🔥', 'Streak ×10!', '+10 bonus XP'); }
  else if (streak >= 5) { xp += 5; showToast('🔥', 'Streak ×5!', '+5 bonus XP'); }
  else if (streak >= 3) { xp += 2; showToast('🔥', 'Streak ×3!', '+2 bonus XP'); }
  return xp;
}

function submitAIDuelAnswer() {
  if (_aiDuelStreaming) return;
  const answer = (document.getElementById('aiDuelInput')?.value || '').trim();
  if (!answer) { showToast('✏️','No answer','Write something before submitting.'); return; }

  const wrap      = document.getElementById('aiDuelAnswerWrap');
  const submitBtn = document.getElementById('aiDuelSubmitBtn');
  const fbEl      = document.getElementById('aiDuelFeedback');
  const fText     = document.getElementById('aiDuelFeedbackText');
  const badge     = document.getElementById('aiDuelScoreBadge');

  if (submitBtn) submitBtn.disabled = true;
  // Keep answer wrap visible so user can see their answer while reading feedback
  if (inputEl) inputEl.disabled = true;
  if (fbEl) { fbEl.style.display = 'block'; }
  if (fText) fText.innerHTML = '<div class="ai-thinking"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></div>';
  if (badge) badge.textContent = '';

  const prompt = _aiDuelMode === 'deck' && _aiDuelCurrentBack
    ? `Card front (question): ${_aiDuelCurrentQ}\n\nCorrect answer (card back): ${_aiDuelCurrentBack}\n\nStudent's written answer: ${answer}\n\nMark the student's answer against the correct card answer. SCORE: X/10\nFEEDBACK: [2-3 sentences — what they got right, what was missing from the correct answer, one tip]`
    : `Question: ${_aiDuelCurrentQ}\n\nStudent's answer: ${answer}\n\nMark this answer. SCORE: X/10\nFEEDBACK: [2-3 sentences: what was correct, what was missing, one improvement tip]`;

  let raw = '';
  _aiDuelStreaming = true;

  _callClaudeAPI(
    'You are a strict but fair exam marker. Always begin with "SCORE: X/10" on the first line.',
    prompt,
    chunk => {
      raw += chunk;
      const scoreMatch = raw.match(/SCORE:\s*(\d+)\s*\/\s*10/i);
      if (scoreMatch && badge) {
        const s = parseInt(scoreMatch[1]);
        badge.textContent = `${s}/10 — ${s>=8?'🏆 Excellent':s>=6?'✅ Good':s>=4?'⚠️ Partial':'❌ Needs Work'}`;
        badge.className   = 'ai-duel-score-badge ' + (s>=8?'excellent':s>=6?'good':s>=4?'partial':'poor');
      }
      let display = raw.replace(/SCORE:\s*\d+\s*\/\s*10\n?/i,'').replace(/^FEEDBACK:\s*/i,'').replace(/\n/g,'<br>');
      if (fText) fText.innerHTML = `<div class="ai-response-text">${display}</div>`;
    },
    () => {
      _aiDuelStreaming = false;
      const scoreMatch = raw.match(/SCORE:\s*(\d+)\s*\/\s*10/i);
      const score = scoreMatch ? Math.min(10, Math.max(0, parseInt(scoreMatch[1]))) : 5;
      _aiDuelScore += score;

      const wasCorrect = score >= 6;
      if (wasCorrect) {
        _aiDuelCorrect++;
        _aiDuelStreak++;
        _aiDuelBestStreak = Math.max(_aiDuelBestStreak, _aiDuelStreak);
      } else {
        _aiDuelStreak = 0;
      }

      // XP with bonuses
      const xpEarned = _calcAIDuelXP(score, _aiDuelStreak);
      _aiDuelSessionXP += xpEarned;
      addXP(xpEarned);

      // Save stats for achievements
      if (!db.stats.aiDuelTotal) db.stats.aiDuelTotal = 0;
      if (!db.stats.aiDuelPerfect) db.stats.aiDuelPerfect = 0;
      if (!db.stats.aiDuelBestStreak) db.stats.aiDuelBestStreak = 0;
      db.stats.aiDuelTotal++;
      if (score === 10) db.stats.aiDuelPerfect++;
      db.stats.aiDuelBestStreak = Math.max(db.stats.aiDuelBestStreak, _aiDuelBestStreak);
      saveDB();

      _updateAIDuelHUD();
      checkAchievements();
      if (submitBtn) submitBtn.disabled = false;
    },
    err => {
      if (fText) fText.innerHTML = `<span style="color:#ff9090">❌ ${err}</span>`;
      _aiDuelStreaming = false;
      if (submitBtn) { submitBtn.disabled = false; }
      if (wrap) wrap.style.display = 'block';
    }
  );
}

function nextAIDuelQuestion() {
  _aiDuelQNum++;
  _updateAIDuelHUD();
  _generateAIDuelQuestion();
}

function exitAIDuel() {
  _aiDuelStreaming = false;
  _stopAIDuelFlame();
  const accuracy = _aiDuelQNum > 0 ? Math.round((_aiDuelCorrect / _aiDuelQNum) * 100) : 0;
  showToast('📊', 'Duel Complete',
    `${_aiDuelCorrect}/${_aiDuelQNum} correct · ${accuracy}% · +${_aiDuelSessionXP} XP`);

  // If we came from a direct ?aiduel= URL, go back to deck or portals
  const params = new URLSearchParams(window.location.search);
  if (params.get('aiduel')) {
    // Return to deck page the user came from if we know it, else portals
    const deckName = _aiDuelDeckName;
    if (deckName && db.decks[deckName]) {
      window.location.href = `deck.html?deck=${encodeURIComponent(deckName)}`;
    } else {
      window.location.href = 'duel.html';
    }
    return;
  }

  if (_aiDuelPendingRealm) {
    _duelFolderStack = [{ name: _aiDuelPendingRealm, label: _aiDuelPendingRealm }];
    _renderDuelFolderView(_aiDuelPendingRealm);
  } else {
    _showDuelView('duelPortalView');
  }
}

// AI chat is initialised by initApp() → setTimeout(_initAIChat, 300) after db loads

// ============================================================
// CALENDAR
// ============================================================

const _CAL_EVENT_TYPES = {
  exam:       { label: '📝 Exam',           colour: '#e74c3c' },
  deadline:   { label: '⏰ Deadline',        colour: '#e67e22' },
  study:      { label: '📚 Study Session',  colour: '#3498db' },
  assignment: { label: '📋 Assignment',      colour: '#9b59b6' },
  other:      { label: '🎯 Other',           colour: '#c9a84c' }
};

let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth(); // 0-indexed
let _calSelectedDate = '';
let _calEditingId = null;

function loadCalendarPage() {
  if (!db.calendar) db.calendar = { events: [] };
  renderCalendar();
  renderUpcomingEvents();
}

function renderCalendar() {
  const grid  = document.getElementById('calGrid');
  const title = document.getElementById('calMonthTitle');
  if (!grid || !title) return;

  const monthNames = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
  title.textContent = `${monthNames[_calMonth]} ${_calYear}`;

  const today = new Date();
  const todayStr = _calDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  // First day of month (0=Sun..6=Sat), convert to Mon-first (0=Mon..6=Sun)
  const firstDay = new Date(_calYear, _calMonth, 1).getDay();
  const startOffset = (firstDay === 0 ? 6 : firstDay - 1); // offset for Mon-first grid
  const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
  const daysInPrev  = new Date(_calYear, _calMonth, 0).getDate();

  // Build event lookup by date string
  const evByDate = {};
  (db.calendar.events || []).forEach(ev => {
    if (!evByDate[ev.date]) evByDate[ev.date] = [];
    evByDate[ev.date].push(ev);
  });

  grid.innerHTML = '';
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell';

    if (i < startOffset) {
      // Previous month
      const d = daysInPrev - startOffset + i + 1;
      cell.classList.add('cal-other-month');
      cell.innerHTML = `<span class="cal-day-num">${d}</span>`;
    } else if (i >= startOffset + daysInMonth) {
      // Next month
      const d = i - startOffset - daysInMonth + 1;
      cell.classList.add('cal-other-month');
      cell.innerHTML = `<span class="cal-day-num">${d}</span>`;
    } else {
      const day = i - startOffset + 1;
      const dateStr = _calDateStr(_calYear, _calMonth, day);
      const isToday = dateStr === todayStr;
      const events  = evByDate[dateStr] || [];
      const dow = (i % 7); // 0=Mon..6=Sun

      if (isToday) cell.classList.add('cal-today');
      if (dow >= 5) cell.classList.add('cal-weekend-cell');
      if (events.length) cell.classList.add('cal-has-events');

      cell.innerHTML = `<span class="cal-day-num">${day}</span>
        <div class="cal-dots">${events.slice(0,4).map(ev =>
          `<span class="cal-dot" style="background:${ev.colour||_CAL_EVENT_TYPES[ev.type]?.colour||'#c9a84c'}" title="${ev.title}"></span>`
        ).join('')}${events.length > 4 ? `<span class="cal-dot-more">+${events.length-4}</span>` : ''}</div>`;

      cell.onclick = () => openDayModal(dateStr, events);
    }
    grid.appendChild(cell);
  }
}

function _calDateStr(y, m, d) {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function calPrevMonth() {
  _calMonth--;
  if (_calMonth < 0) { _calMonth = 11; _calYear--; }
  renderCalendar();
}
function calNextMonth() {
  _calMonth++;
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  renderCalendar();
}
function calGoToday() {
  const now = new Date();
  _calYear = now.getFullYear();
  _calMonth = now.getMonth();
  renderCalendar();
}

function openDayModal(dateStr, events) {
  _calSelectedDate = dateStr;
  const modal = document.getElementById('dayModal');
  const title = document.getElementById('dayModalTitle');
  const list  = document.getElementById('dayModalEvents');
  if (!modal) return;

  const [y,m,d] = dateStr.split('-');
  const dateObj = new Date(+y, +m-1, +d);
  title.textContent = dateObj.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  if (!events.length) {
    list.innerHTML = '<p class="rpg-hint">No events on this day.</p>';
  } else {
    list.innerHTML = events.map(ev => `
      <div class="cal-event-row" onclick="showEditEvent('${ev.id}'); hideDayModal();">
        <span class="cal-event-dot" style="background:${ev.colour||_CAL_EVENT_TYPES[ev.type]?.colour||'#c9a84c'}"></span>
        <div class="cal-event-detail">
          <div class="cal-event-title">${ev.title}</div>
          <div class="cal-event-meta">${_CAL_EVENT_TYPES[ev.type]?.label || ev.type}${ev.time ? ' · ' + ev.time : ''}${ev.notes ? '<br><span style="opacity:0.7">'+ev.notes+'</span>' : ''}</div>
        </div>
      </div>`).join('');
  }
  modal.style.display = 'flex';
}
function hideDayModal() { document.getElementById('dayModal').style.display = 'none'; }

function renderUpcomingEvents() {
  const upcoming = document.getElementById('calUpcomingList');
  const todayList = document.getElementById('calTodayList');
  if (!upcoming || !todayList) return;

  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = _calDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  const allEvents = (db.calendar.events || [])
    .filter(ev => ev.date >= todayStr)
    .sort((a,b) => a.date.localeCompare(b.date));

  const todayEvents   = allEvents.filter(ev => ev.date === todayStr);
  const futureEvents  = allEvents.filter(ev => ev.date > todayStr).slice(0, 8);

  const renderList = (events, container) => {
    if (!events.length) { container.innerHTML = '<p class="rpg-hint" style="font-size:0.82rem">None</p>'; return; }
    container.innerHTML = events.map(ev => {
      const dateObj = new Date(ev.date + 'T00:00:00');
      const diff = Math.round((dateObj - today) / 86400000);
      const diffLabel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `${diff} days`;
      return `<div class="cal-upcoming-item" onclick="showEditEvent('${ev.id}')">
        <div class="cal-event-dot" style="background:${ev.colour||_CAL_EVENT_TYPES[ev.type]?.colour||'#c9a84c'}"></div>
        <div>
          <div class="cal-upcoming-title-text">${ev.title}</div>
          <div class="cal-upcoming-meta">${diffLabel} · ${_CAL_EVENT_TYPES[ev.type]?.label?.split(' ')[1] || ev.type}</div>
        </div>
      </div>`;
    }).join('');
  };

  renderList(todayEvents, todayList);
  renderList(futureEvents, upcoming);
}

// ── Add / Edit event ──
function showAddEvent(date) {
  _calEditingId = null;
  const modal = document.getElementById('addEventModal');
  if (!modal) return;
  document.getElementById('addEventTitle').textContent = '📅 Add Event';
  document.getElementById('eventTitleInput').value = '';
  document.getElementById('eventDateInput').value = date || _calSelectedDate || _calDateStr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  document.getElementById('eventTimeInput').value = '';
  document.getElementById('eventTypeInput').value = 'exam';
  document.getElementById('eventNotesInput').value = '';
  document.getElementById('eventColourInput').value = '#e74c3c';
  document.getElementById('deleteEventBtn').style.display = 'none';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('eventTitleInput').focus(), 100);
}

function showAddEventOnDate(date) {
  hideDayModal();
  showAddEvent(date);
}

function showEditEvent(id) {
  const ev = (db.calendar.events || []).find(e => e.id === id);
  if (!ev) return;
  _calEditingId = id;
  const modal = document.getElementById('addEventModal');
  document.getElementById('addEventTitle').textContent = '✏️ Edit Event';
  document.getElementById('eventTitleInput').value = ev.title;
  document.getElementById('eventDateInput').value = ev.date;
  document.getElementById('eventTimeInput').value = ev.time || '';
  document.getElementById('eventTypeInput').value = ev.type || 'other';
  document.getElementById('eventNotesInput').value = ev.notes || '';
  document.getElementById('eventColourInput').value = ev.colour || _CAL_EVENT_TYPES[ev.type]?.colour || '#c9a84c';
  document.getElementById('deleteEventBtn').style.display = '';
  modal.style.display = 'flex';
}

function hideAddEvent() { document.getElementById('addEventModal').style.display = 'none'; }

function updateEventColour() {
  const type = document.getElementById('eventTypeInput').value;
  const def  = _CAL_EVENT_TYPES[type]?.colour || '#c9a84c';
  document.getElementById('eventColourInput').value = def;
}

function saveEvent() {
  const title  = document.getElementById('eventTitleInput').value.trim();
  const date   = document.getElementById('eventDateInput').value;
  const time   = document.getElementById('eventTimeInput').value;
  const type   = document.getElementById('eventTypeInput').value;
  const notes  = document.getElementById('eventNotesInput').value.trim();
  const colour = document.getElementById('eventColourInput').value;

  if (!title)  { showToast('⚠','Title required','Enter a title for the event.'); return; }
  if (!date)   { showToast('⚠','Date required','Pick a date for the event.'); return; }

  if (!db.calendar) db.calendar = { events: [] };
  const events = db.calendar.events;

  if (_calEditingId) {
    const idx = events.findIndex(e => e.id === _calEditingId);
    if (idx >= 0) events[idx] = { ...events[idx], title, date, time, type, notes, colour };
  } else {
    events.push({ id: 'ev_' + Date.now(), title, date, time, type, notes, colour });
  }

  db.calendar.events = events;
  saveDB();
  hideAddEvent();
  renderCalendar();
  renderUpcomingEvents();
  showToast('✅', _calEditingId ? 'Event Updated' : 'Event Added', title);

  // Jump calendar to the event's month
  const [y,m] = date.split('-');
  _calYear  = +y; _calMonth = +m - 1;
  renderCalendar();
}

function deleteEvent() {
  if (!_calEditingId) return;
  db.calendar.events = (db.calendar.events || []).filter(e => e.id !== _calEditingId);
  saveDB();
  hideAddEvent();
  renderCalendar();
  renderUpcomingEvents();
  showToast('🗑','Event Deleted','');
}

// ── Ensure db.calendar exists on init ──
document.addEventListener('DOMContentLoaded', () => {
  if (typeof db !== 'undefined' && db && !db.calendar) { db.calendar = { events: [] }; saveDB(); }
});

// ============================================================
// RETENTION RATE & FORGETTING CURVE
// ============================================================
function getDeckRetention(deckName) {
  const deck = db.decks[deckName];
  if (!deck || !deck.cards || !deck.cards.length) return 0;
  let totalMarks = 0, greenMarks = 0;
  deck.cards.forEach(c => { totalMarks += c.totalMarks || 0; greenMarks += c.greenMarks || 0; });
  return totalMarks > 0 ? Math.round((greenMarks / totalMarks) * 100) : null;
}

function renderRetentionStats() {
  const el = document.getElementById('retentionList');
  if (!el) return;
  el.innerHTML = '';
  const decks = Object.keys(db.decks);
  if (!decks.length) { el.innerHTML = '<p class="rpg-hint">No decks yet.</p>'; return; }
  decks.forEach(name => {
    const ret = getDeckRetention(name);
    const mastery = getDeckMastery(name);
    const colour = ret === null ? '#8a7a5a' : ret >= 80 ? '#27ae60' : ret >= 60 ? '#d4a017' : '#c0392b';
    const row = document.createElement('div');
    row.className = 'retention-row';
    row.innerHTML = `
      <div class="retention-name">${name}</div>
      <div class="retention-bar-wrap">
        <div class="retention-bar-track"><div class="retention-bar-fill" style="width:${ret||0}%;background:${colour}"></div></div>
        <span class="retention-pct" style="color:${colour}">${ret !== null ? ret + '%' : '—'}</span>
      </div>
      <div class="retention-mastery">Mastered: ${mastery}%</div>`;
    el.appendChild(row);
  });
}

function renderForgettingCurve() {
  const canvas = document.getElementById('forgettingCurveCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, W, H);

  // Draw curves for each deck (using average ease factor as stability)
  const decks = Object.keys(db.decks);
  const colours = ['#c9a84c','#27ae60','#2471a3','#9b59b6','#e74c3c'];
  const maxDays = 30;

  decks.slice(0, 5).forEach((name, i) => {
    const deck = db.decks[name];
    if (!deck || !deck.cards.length) return;
    const avgEase = deck.cards.reduce((s,c) => s + (c.easeFactor||2.5), 0) / deck.cards.length;
    const stability = avgEase * 8; // approximate days of stability

    ctx.beginPath();
    ctx.strokeStyle = colours[i % colours.length];
    ctx.lineWidth = 2;
    for (let d = 0; d <= maxDays; d++) {
      const retention = Math.exp(-d / stability);
      const x = (d / maxDays) * W;
      const y = H - retention * (H - 10);
      d === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Legend label
    ctx.fillStyle = colours[i % colours.length];
    ctx.font = '10px Cinzel, serif';
    ctx.fillText(name.slice(0, 14), 4, 14 + i * 14);
  });

  // Axes
  ctx.strokeStyle = 'rgba(201,168,76,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H-1); ctx.lineTo(W, H-1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 0);   ctx.lineTo(0, H);   ctx.stroke();

  // Day labels
  ctx.fillStyle = 'rgba(201,168,76,0.5)';
  ctx.font = '9px sans-serif';
  [0,7,14,21,30].forEach(d => {
    const x = (d / maxDays) * W;
    ctx.fillText(`${d}d`, x + 2, H - 2);
  });
}

// ============================================================
// FILL-IN-THE-BLANK MODE
// ============================================================
let fitbMode = false;
let fitbAnswer = '';

function toggleFitbMode() {
  fitbMode = !fitbMode;
  const btn = document.getElementById('fitbBtn');
  if (btn) { btn.textContent = fitbMode ? '✏️ FITB ON' : '✏️ FITB'; btn.classList.toggle('active', fitbMode); }
  renderCard();
  showToast('✏️', fitbMode ? 'Fill-in-the-Blank On' : 'FITB Off',
    fitbMode ? 'Wrap answers in [brackets] or the last word is blanked' : '');
}

function renderFitbCard(backText) {
  const wrap = document.getElementById('fitbWrap');
  if (!wrap) return;
  if (!fitbMode || isFlipped) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  const match = backText.match(/\[([^\]]+)\]/);
  if (match) {
    fitbAnswer = match[1].toLowerCase().trim();
    wrap.querySelector('.fitb-prompt').textContent = backText.replace(/\[([^\]]+)\]/, '________');
  } else {
    const words = backText.trim().split(/\s+/);
    fitbAnswer = words[words.length - 1].toLowerCase().trim();
    wrap.querySelector('.fitb-prompt').textContent = words.slice(0, -1).join(' ') + ' ________';
  }
  const input = wrap.querySelector('.fitb-input');
  if (input) { input.value = ''; input.focus(); }
}

function checkFitbAnswer() {
  const input = document.getElementById('fitbInput');
  if (!input) return;
  const typed = input.value.toLowerCase().trim();
  const correct = typed === fitbAnswer || fitbAnswer.startsWith(typed) && typed.length > fitbAnswer.length * 0.75;
  if (correct) {
    showToast('✅', 'Correct!', `Answer: ${fitbAnswer}`);
    mark('green');
  } else {
    showToast('❌', 'Incorrect', `Answer was: ${fitbAnswer}`);
    mark('red');
  }
}

// ============================================================
// MOST DIFFICULT CARDS
// ============================================================
function renderDifficultCards() {
  const el = document.getElementById('difficultCardsList');
  if (!el || !currentDeck) return;
  const sorted = currentDeck.cards
    .map((c, i) => ({ ...c, index: i }))
    .filter(c => (c.totalMarks || 0) >= 3)
    .sort((a, b) => (a.easeFactor || 2.5) - (b.easeFactor || 2.5))
    .slice(0, 8);
  if (!sorted.length) { el.innerHTML = '<p class="rpg-hint">Not enough data yet — study more cards first.</p>'; return; }
  el.innerHTML = sorted.map((c, i) => `
    <div class="difficult-card-row" onclick="jumpToCard(${c.index})">
      <span class="difficult-rank">#${i+1}</span>
      <span class="difficult-front">${(c.front||'').slice(0,50)}</span>
      <span class="difficult-ease">Ease: ${(c.easeFactor||2.5).toFixed(2)}</span>
      <span class="difficult-rate">${c.totalMarks ? Math.round((c.greenMarks||0)/c.totalMarks*100) : 0}% correct</span>
    </div>`).join('');
}

function jumpToCard(cardIndex) {
  const qi = queue.findIndex(c => c.index === cardIndex);
  if (qi >= 0) { queueIndex = qi; renderCard(); }
}

function showDifficultPanel() {
  const panel = document.getElementById('difficultPanel');
  if (!panel) return;
  renderDifficultCards();
  panel.classList.toggle('hidden');
}

// ============================================================
// ANKI TEXT IMPORT (tab-separated export from Anki)
// ============================================================
function importAnkiText() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.tsv,.csv';
  input.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const lines = ev.target.result.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      const cards = lines.map(l => {
        const parts = l.split('\t');
        if (parts.length >= 2) return { front: parts[0].trim(), back: parts[1].trim(), due: 0, mastered: false };
        return null;
      }).filter(Boolean);
      if (!cards.length) { showToast('❌', 'No Cards Found', 'File should be tab-separated: front [tab] back'); return; }
      if (!currentDeck) { showToast('❌', 'No Deck Open', 'Open a deck first'); return; }
      cards.forEach(c => currentDeck.cards.push(c));
      saveDB(); buildQueue(); renderCard();
      showToast('📥', `Imported ${cards.length} cards`, 'From Anki text export');
    };
    reader.readAsText(file);
  };
  input.click();
}

// ============================================================
// AUTO-GENERATE PRACTICE QUESTION FROM CARDS
// ============================================================
function autoGeneratePracticeQuestion() {
  const decks = Object.keys(db.decks);
  if (!decks.length) { showToast('⚠️', 'No Decks', 'Create some flashcard decks first'); return; }

  let modal = document.getElementById('autoQModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'autoQModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="rpg-modal" onclick="event.stopPropagation()">
      <div class="modal-title">⚡ Auto Question</div>
      <label class="rpg-label">Pick deck</label>
      <select class="rpg-input" id="autoQDeck" style="margin-bottom:12px"></select>
      <div class="modal-actions">
        <button class="rpg-btn primary" onclick="confirmAutoQ()">✨ Generate</button>
        <button class="rpg-btn" onclick="document.getElementById('autoQModal').style.display='none'">✖ Cancel</button>
      </div>
    </div>`;
    modal.onclick = () => modal.style.display = 'none';
    document.body.appendChild(modal);
  }
  const sel = document.getElementById('autoQDeck');
  sel.innerHTML = decks.map(d => `<option value="${d}">${d}</option>`).join('');
  modal.style.display = 'flex';
}

function confirmAutoQ() {
  const deckName = document.getElementById('autoQDeck')?.value;
  const deck = db.decks[deckName];
  if (!deck || !deck.cards.length) return;
  const card = deck.cards[Math.floor(Math.random() * deck.cards.length)];
  currentQuestion = card.front;
  _renderQuestion();
  document.getElementById('autoQModal').style.display = 'none';
  showToast('✨', 'Question Set', `From "${deckName}"`);
}

// ============================================================
// UNDO CARD DELETION (30-second window)
// ============================================================
let _deletedCardBuffer = null;
let _deletedCardTimer  = null;

function deleteCard() {
  if (!queue.length) return;
  const card = queue[queueIndex];
  const cardData  = JSON.parse(JSON.stringify(currentDeck.cards[card.index]));
  const cardIndex = card.index;
  const deckName  = currentDeckName;

  currentDeck.cards.splice(card.index, 1);
  saveDB();
  buildQueue();
  if (queueIndex >= queue.length) queueIndex = 0;
  renderCard();

  _deletedCardBuffer = { data: cardData, index: cardIndex, deckName };
  clearTimeout(_deletedCardTimer);
  _deletedCardTimer = setTimeout(() => { _deletedCardBuffer = null; }, 30000);

  // Show undo toast manually
  const toast = document.getElementById('achievementToast');
  if (toast) {
    document.getElementById('toastIcon').textContent = '🗑️';
    document.getElementById('toastTitle').textContent = 'Card Deleted';
    document.getElementById('toastDesc').textContent = 'Tap here to undo (30s)';
    toast.style.display = 'flex';
    toast.style.cursor = 'pointer';
    toast.onclick = () => { undoCardDeletion(); toast.style.display = 'none'; toast.onclick = null; toast.style.cursor = ''; };
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { toast.style.display = 'none'; toast.onclick = null; }, 30000);
  }
}

function undoCardDeletion() {
  if (!_deletedCardBuffer) return;
  const { data, index, deckName } = _deletedCardBuffer;
  if (db.decks[deckName]) {
    db.decks[deckName].cards.splice(index, 0, data);
    saveDB(); buildQueue(); renderCard();
    showToast('↩️', 'Card Restored', 'Deletion undone');
  }
  _deletedCardBuffer = null;
  clearTimeout(_deletedCardTimer);
}

// ============================================================
// SESSION HISTORY LOG
// ============================================================
function _logSession() {
  if (!cardsAnsweredThisSession) return;
  const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
  if (!db.stats.sessionHistory) db.stats.sessionHistory = [];
  db.stats.sessionHistory.unshift({
    date: new Date().toISOString(),
    deck: currentDeckName,
    cards: cardsAnsweredThisSession,
    green: sessionGreen, amber: sessionAmber, red: sessionRed,
    xp: sessionXPearned, duration: elapsed
  });
  // Keep last 100 sessions
  if (db.stats.sessionHistory.length > 100) db.stats.sessionHistory.length = 100;
  saveDB();
}

function renderSessionHistory() {
  const el = document.getElementById('sessionHistoryList');
  if (!el) return;
  const history = db.stats.sessionHistory || [];
  if (!history.length) { el.innerHTML = '<p class="rpg-hint">No sessions recorded yet.</p>'; return; }
  el.innerHTML = history.slice(0, 30).map(s => {
    const date = new Date(s.date).toLocaleDateString();
    const time = new Date(s.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const acc  = s.cards > 0 ? Math.round((s.green / s.cards) * 100) : 0;
    const dur  = s.duration ? timeFormat(s.duration) : '--';
    return `<div class="session-hist-row">
      <div class="sh-date">${date} ${time}</div>
      <div class="sh-deck">${s.deck || '—'}</div>
      <div class="sh-cards">${s.cards} cards</div>
      <div class="sh-acc" style="color:${acc>=80?'#27ae60':acc>=60?'#d4a017':'#c0392b'}">${acc}% ✅</div>
      <div class="sh-xp">+${s.xp||0} XP</div>
      <div class="sh-time">${dur}</div>
    </div>`;
  }).join('');
}

// ============================================================
// ACCOUNTING & FINANCE TOOLS
// ============================================================

// -- Calculator (NumWorks-style: expression-based, persistent history) --
let calcExpr       = '';      // full expression string being built
let calcLastResult = null;    // ANS value (last computed result)
let _calcAfterResult = false; // true right after = — next digit starts fresh
let calcMemory = parseFloat(localStorage.getItem('calcMemory') || '0');
let calcHistory = JSON.parse(localStorage.getItem('calcHistory') || '[]');
let _calcKeyListenerActive = false;

function _saveCalcMemory() { localStorage.setItem('calcMemory', calcMemory); }

// ── Keyboard shortcuts help overlay ──
function showKeyboardShortcuts() {
  let m = document.getElementById('shortcutsModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'shortcutsModal';
    m.className = 'modal-overlay';
    m.onclick = e => { if (e.target === m) m.style.display = 'none'; };
    m.innerHTML = `<div class="rpg-modal" onclick="event.stopPropagation()" style="max-width:480px;max-height:80vh;overflow-y:auto">
      <div class="modal-title">⌨️ Keyboard Shortcuts</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;font-family:'Crimson Text',serif;font-size:0.92rem">
        <strong style="color:var(--gold);grid-column:1/-1;font-family:'Cinzel',serif;font-size:0.72rem;letter-spacing:1px;margin-top:8px">FLASHCARDS</strong>
        <span><kbd>Space</kbd></span><span>Flip card</span>
        <span><kbd>→</kbd> / <kbd>N</kbd></span><span>Next card</span>
        <span><kbd>←</kbd> / <kbd>P</kbd></span><span>Previous card</span>
        <span><kbd>1</kbd></span><span>Mark Red</span>
        <span><kbd>2</kbd></span><span>Mark Amber</span>
        <span><kbd>3</kbd></span><span>Mark Green</span>
        <span><kbd>U</kbd></span><span>Undo last mark</span>
        <strong style="color:var(--gold);grid-column:1/-1;font-family:'Cinzel',serif;font-size:0.72rem;letter-spacing:1px;margin-top:8px">DUEL MODE</strong>
        <span><kbd>Space</kbd></span><span>Flip card</span>
        <span><kbd>→</kbd> / <kbd>Enter</kbd></span><span>Next card</span>
        <span><kbd>←</kbd></span><span>Previous card</span>
        <span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></span><span>Rate card</span>
        <span><kbd>U</kbd></span><span>Undo</span>
        <strong style="color:var(--gold);grid-column:1/-1;font-family:'Cinzel',serif;font-size:0.72rem;letter-spacing:1px;margin-top:8px">AI DUEL</strong>
        <span><kbd>Ctrl</kbd>+<kbd>Enter</kbd></span><span>Submit answer</span>
        <strong style="color:var(--gold);grid-column:1/-1;font-family:'Cinzel',serif;font-size:0.72rem;letter-spacing:1px;margin-top:8px">CALCULATOR</strong>
        <span><kbd>0–9</kbd> <kbd>.</kbd></span><span>Enter number</span>
        <span><kbd>+ − * /</kbd></span><span>Operators</span>
        <span><kbd>Enter</kbd></span><span>Calculate (=)</span>
        <span><kbd>Backspace</kbd></span><span>Delete last</span>
        <span><kbd>Esc</kbd></span><span>Clear (AC)</span>
        <strong style="color:var(--gold);grid-column:1/-1;font-family:'Cinzel',serif;font-size:0.72rem;letter-spacing:1px;margin-top:8px">PRACTICE</strong>
        <span><kbd>?</kbd></span><span>Show shortcuts</span>
      </div>
      <div class="modal-actions" style="margin-top:16px">
        <button class="rpg-btn primary" onclick="document.getElementById('shortcutsModal').style.display='none'">✕ Close</button>
      </div>
    </div>`;
    document.body.appendChild(m);
  }
  m.style.display = 'flex';
}

// Show shortcuts on ? key anywhere
document.addEventListener('keydown', e => {
  if (e.key === '?' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    showKeyboardShortcuts();
  }
});

// ── QR Code — open app on another device ──
function showQRCode() {
  // Build the app root URL from the current page's path (works on any host/subfolder)
  const appUrl = window.location.href.replace(/\/[^/]*$/, '/');

  let m = document.getElementById('qrModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'qrModal';
    m.className = 'modal-overlay';
    m.onclick = e => { if (e.target === m) m.style.display = 'none'; };
    m.innerHTML = `
      <div class="rpg-modal" onclick="event.stopPropagation()" style="max-width:380px;text-align:center">
        <div class="modal-title">📷 Scan to Open</div>
        <p class="rpg-hint" style="margin-bottom:16px">Point any phone camera at this code — it opens Scholar's Sanctum immediately.</p>
        <div class="qr-container" id="qrContainer" style="display:flex;justify-content:center;margin-bottom:16px">
          <img id="qrImage" style="width:220px;height:220px;border-radius:10px;background:#fff;padding:10px" alt="QR Code loading…">
        </div>
        <div class="qr-url" id="qrUrlText" style="font-family:monospace;font-size:0.78rem;color:var(--text-dim);word-break:break-all;margin-bottom:14px;padding:8px 12px;background:rgba(0,0,0,0.3);border-radius:6px"></div>
        <div class="modal-actions">
          <button class="rpg-btn primary" onclick="copyQRUrl()" id="qrCopyBtn">📋 Copy Link</button>
          <button class="rpg-btn" onclick="document.getElementById('qrModal').style.display='none'">✕ Close</button>
        </div>
      </div>`;
    document.body.appendChild(m);
  }

  // Set the URL to share (always the app root)
  const shareUrl = appUrl.endsWith('/') ? appUrl : appUrl + '/';
  const img = document.getElementById('qrImage');
  const urlText = document.getElementById('qrUrlText');

  if (img) img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(shareUrl)}&color=0d0b18&bgcolor=f0e8cc`;
  if (urlText) urlText.textContent = shareUrl;

  m.style.display = 'flex';
}

function copyQRUrl() {
  const url = document.getElementById('qrUrlText')?.textContent;
  if (url) navigator.clipboard?.writeText(url).then(() => showToast('📋','Copied!','Link copied to clipboard'));
}

function showCalculator() {
  let modal = document.getElementById('calcModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'calcModal';
    modal.className = 'calc-modal';
    modal.innerHTML = `
      <div class="calc-header" onmousedown="startDragCalc(event)" ontouchstart="startDragCalc(event)">
        <span>🔢 Calculator</span>
        <div class="calc-header-btns">
          <button class="calc-size-btn" onclick="resizeCalc(-1)">－</button>
          <button class="calc-size-btn" onclick="resizeCalc(1)">＋</button>
          <button class="calc-close-btn" onclick="hideCalculator()">✕</button>
        </div>
      </div>

      <!-- Scrollable history (past calculations) -->
      <div class="calc-history-area" id="calcHistoryArea">
        <div class="calc-history-inner" id="calcHistoryInner"></div>
      </div>

      <!-- Live expression display (the main screen) -->
      <div class="calc-expr-display" id="calcExprDisplay">0</div>

      <!-- Memory + Clear All bar -->
      <div class="calc-mem-bar">
        <button class="calc-mem-btn" onclick="calcPress('MC')">MC</button>
        <button class="calc-mem-btn" onclick="calcPress('MR')">MR</button>
        <button class="calc-mem-btn" onclick="calcPress('M+')">M+</button>
        <button class="calc-mem-btn" onclick="calcPress('M−')">M−</button>
        <span class="calc-mem-display" id="calcMemDisplay">${calcMemory !== 0 ? 'M:'+calcMemory : ''}</span>
        <button class="calc-mem-btn calc-clear-all" onclick="clearCalcHistory()" title="Clear all history">🗑</button>
      </div>

      <!-- Keypad — 4 cols × 6 rows -->
      <div class="calc-keys">
        <button class="calc-key calc-fn"  onclick="calcPress('C')">AC</button>
        <button class="calc-key calc-fn"  onclick="calcPress('⌫')">⌫</button>
        <button class="calc-key calc-fn"  onclick="calcPress('()')">( )</button>
        <button class="calc-key calc-op"  onclick="calcPress('÷')">÷</button>

        <button class="calc-key calc-ans" onclick="calcPress('ANS')">ANS</button>
        <button class="calc-key calc-fn"  onclick="calcPress('%')">%</button>
        <button class="calc-key calc-fn"  onclick="calcPress('√')">√</button>
        <button class="calc-key calc-op"  onclick="calcPress('×')">×</button>

        <button class="calc-key" onclick="calcPress('7')">7</button>
        <button class="calc-key" onclick="calcPress('8')">8</button>
        <button class="calc-key" onclick="calcPress('9')">9</button>
        <button class="calc-key calc-op"  onclick="calcPress('−')">−</button>

        <button class="calc-key" onclick="calcPress('4')">4</button>
        <button class="calc-key" onclick="calcPress('5')">5</button>
        <button class="calc-key" onclick="calcPress('6')">6</button>
        <button class="calc-key calc-op"  onclick="calcPress('+')">+</button>

        <button class="calc-key" onclick="calcPress('1')">1</button>
        <button class="calc-key" onclick="calcPress('2')">2</button>
        <button class="calc-key" onclick="calcPress('3')">3</button>
        <button class="calc-key calc-fn"  onclick="calcPress('x²')">x²</button>

        <button class="calc-key calc-fn"  onclick="calcPress('±')">±</button>
        <button class="calc-key calc-zero" onclick="calcPress('0')">0</button>
        <button class="calc-key"           onclick="calcPress('.')">.</button>
        <button class="calc-key calc-eq"   onclick="calcPress('=')">=</button>
      </div>`;
    document.body.appendChild(modal);
    const saved = JSON.parse(localStorage.getItem('calcPos') || 'null');
    if (saved) { modal.style.left = saved.left; modal.style.top = saved.top; modal.style.width = saved.w; }
  }
  const visible = modal.style.display === 'flex';
  modal.style.display = visible ? 'none' : 'flex';
  if (!visible) { _attachCalcKeyboard(); _renderCalcHistory(); _calcUpdateDisplay(); }
  else _detachCalcKeyboard();
}

function hideCalculator() {
  const m = document.getElementById('calcModal');
  if (m) m.style.display = 'none';
  _detachCalcKeyboard();
}

let _calcSize = parseInt(localStorage.getItem('calcSize') || '1');
function resizeCalc(dir) {
  _calcSize = Math.max(0, Math.min(3, _calcSize + dir));
  localStorage.setItem('calcSize', _calcSize);
  const modal = document.getElementById('calcModal');
  if (!modal) return;
  const widths = ['180px','240px','300px','380px'];
  modal.style.width = widths[_calcSize];
  _saveCalcPos(modal);
}

function _saveCalcPos(modal) {
  localStorage.setItem('calcPos', JSON.stringify({
    left: modal.style.left, top: modal.style.top, w: modal.style.width
  }));
}

// Drag
function startDragCalc(e) {
  const modal = document.getElementById('calcModal');
  if (!modal) return;
  const isTouch = e.type === 'touchstart';
  const sx = isTouch ? e.touches[0].clientX : e.clientX;
  const sy = isTouch ? e.touches[0].clientY : e.clientY;
  const rect = modal.getBoundingClientRect();
  const ox = sx - rect.left, oy = sy - rect.top;
  function move(ev) {
    const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
    modal.style.left   = (cx - ox) + 'px';
    modal.style.top    = (cy - oy) + 'px';
    modal.style.right  = 'auto';
    modal.style.bottom = 'auto';
  }
  function up() {
    _saveCalcPos(modal);
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', up);
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  document.addEventListener('touchmove', move, { passive: true });
  document.addEventListener('touchend', up);
}

// Keyboard
function _calcKeyHandler(e) {
  const m = document.getElementById('calcModal');
  if (!m || m.style.display === 'none') return;
  if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
  const map = { '/':'÷','*':'×','-':'−','+':'+','=':'=','Enter':'=','Backspace':'⌫','Escape':'C','(':'(', ')':')' };
  const key = map[e.key] || (e.key.match(/^[0-9.]$/) ? e.key : null);
  if (key) { e.preventDefault(); calcPress(key); }
}

function _attachCalcKeyboard() {
  if (_calcKeyListenerActive) return;
  document.addEventListener('keydown', _calcKeyHandler);
  _calcKeyListenerActive = true;
}
function _detachCalcKeyboard() {
  document.removeEventListener('keydown', _calcKeyHandler);
  _calcKeyListenerActive = false;
}

function _calcUpdateDisplay() {
  const el = document.getElementById('calcExprDisplay');
  if (!el) return;
  const text = calcExpr || '0';
  el.textContent = text;
  el.classList.toggle('result-mode', _calcAfterResult);
  const len = text.length;
  el.style.fontSize = len > 24 ? '0.85rem' : len > 16 ? '1rem' : len > 10 ? '1.3rem' : len > 6 ? '1.6rem' : '2rem';
}

function _calcEval(expr) {
  if (!expr.trim()) return null;
  try {
    let js = expr
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .replace(/√\(/g, 'Math.sqrt(')
      .replace(/√(\d+\.?\d*)/g, 'Math.sqrt($1)')
      .replace(/\^2/g, '**2');
    // Auto-close open parentheses
    const open = (js.match(/\(/g) || []).length - (js.match(/\)/g) || []).length;
    js += ')'.repeat(Math.max(0, open));
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + js + ')')();
    if (typeof result !== 'number' || !isFinite(result)) return 'Error';
    return Math.round(result * 1e10) / 1e10;
  } catch { return 'Error'; }
}

function _renderCalcHistory() {
  const inner = document.getElementById('calcHistoryInner');
  const area  = document.getElementById('calcHistoryArea');
  if (!inner) return;
  inner.innerHTML = calcHistory.map(h =>
    `<div class="calc-hist-entry"><span class="calc-hist-expr">${h.expr}</span><span class="calc-hist-result">= ${h.result}</span></div>`
  ).join('');
  if (area) area.scrollTop = area.scrollHeight;
}

function clearCalcHistory() {
  calcHistory = [];
  localStorage.removeItem('calcHistory');
  _renderCalcHistory();
  calcExpr = ''; _calcAfterResult = false;
  _calcUpdateDisplay();
}

function _pushCalcHistory(expr, result) {
  calcHistory.push({ expr, result: String(result) });
  localStorage.setItem('calcHistory', JSON.stringify(calcHistory));
  _renderCalcHistory();
}

function calcPress(k) {
  const memDisp = document.getElementById('calcMemDisplay');
  const isOp = ['÷','×','−','+'].includes(k);

  // ── Memory ──
  if (k === 'MC') {
    calcMemory = 0; _saveCalcMemory();
    if (memDisp) memDisp.textContent = '';
    return;
  }
  if (k === 'MR') {
    const s = String(calcMemory);
    if (_calcAfterResult) { calcExpr = s; _calcAfterResult = false; }
    else calcExpr += s;
    _calcUpdateDisplay(); return;
  }
  if (k === 'M+' || k === 'M−') {
    const v = _calcEval(calcExpr);
    if (typeof v === 'number') {
      calcMemory = Math.round((k === 'M+' ? calcMemory + v : calcMemory - v) * 1e10) / 1e10;
      _saveCalcMemory();
      if (memDisp) memDisp.textContent = 'M:' + calcMemory;
    }
    return;
  }

  // ── ANS ──
  if (k === 'ANS') {
    const ans = calcLastResult !== null ? String(calcLastResult) : '0';
    if (_calcAfterResult) { calcExpr = ans; _calcAfterResult = false; }
    else calcExpr += ans;
    _calcUpdateDisplay(); return;
  }

  // ── Clear ──
  if (k === 'C' || k === 'Escape') {
    calcExpr = ''; _calcAfterResult = false;
    _calcUpdateDisplay(); return;
  }

  // ── Backspace ──
  if (k === '⌫') {
    if (_calcAfterResult) { calcExpr = ''; _calcAfterResult = false; }
    else {
      // Remove last character (handles multi-char tokens like √()
      calcExpr = calcExpr.replace(/√\($|[^]$/, '');
    }
    _calcUpdateDisplay(); return;
  }

  // ── Operators: after a result, continue from it; replace trailing op ──
  if (isOp) {
    if (_calcAfterResult) { _calcAfterResult = false; }
    else if (!calcExpr) { calcExpr = '0'; }
    // Replace a trailing operator with the new one
    calcExpr = calcExpr.replace(/[÷×−+]$/, '') + k;
    _calcUpdateDisplay(); return;
  }

  // ── Brackets (smart toggle: opens ( if balanced, closes ) if open) ──
  if (k === '(' || k === ')' || k === '()') {
    if (_calcAfterResult) { calcExpr = '('; _calcAfterResult = false; _calcUpdateDisplay(); return; }
    const opens  = (calcExpr.match(/\(/g) || []).length;
    const closes = (calcExpr.match(/\)/g) || []).length;
    if (k === '()') {
      // Smart: close if there's an unmatched open, else open
      calcExpr += opens > closes ? ')' : '(';
    } else {
      calcExpr += k;
    }
    _calcUpdateDisplay(); return;
  }

  // ── √ ──
  if (k === '√') {
    if (_calcAfterResult) { calcExpr = '√('; _calcAfterResult = false; }
    else calcExpr += '√(';
    _calcUpdateDisplay(); return;
  }

  // ── x² ──
  if (k === 'x²') {
    const n = parseFloat(calcExpr);
    if (_calcAfterResult && !isNaN(n)) {
      // Square the numeric result directly
      const sq = Math.round(n * n * 1e10) / 1e10;
      _pushCalcHistory(`(${n})²`, sq);
      calcExpr = String(sq);
      // stay in result mode so next digit starts fresh
    } else if (!_calcAfterResult && calcExpr) {
      calcExpr += '^2';
    }
    _calcUpdateDisplay(); return;
  }

  // ── % ──
  if (k === '%') {
    const n = parseFloat(calcExpr);
    if (!isNaN(n)) {
      const pct = Math.round((n / 100) * 1e10) / 1e10;
      _pushCalcHistory(`${n}%`, pct);
      calcExpr = String(pct);
      _calcAfterResult = true;
    }
    _calcUpdateDisplay(); return;
  }

  // ── ± ──
  if (k === '±') {
    if (!calcExpr || calcExpr === '0') { calcExpr = '-'; }
    else if (calcExpr.startsWith('-')) { calcExpr = calcExpr.slice(1); }
    else { calcExpr = '-(' + calcExpr + ')'; }
    _calcAfterResult = false;
    _calcUpdateDisplay(); return;
  }

  // ── = ──
  if (k === '=' || k === 'Enter') {
    if (!calcExpr) return;
    const result = _calcEval(calcExpr);
    _pushCalcHistory(calcExpr, result);
    calcLastResult = typeof result === 'number' ? result : null;
    calcExpr = String(result);
    _calcAfterResult = true;
    _calcUpdateDisplay(); return;
  }

  // ── Digits & decimal ──
  if (k === '.' || (k >= '0' && k <= '9')) {
    if (_calcAfterResult) {
      calcExpr = k === '.' ? '0.' : k;
      _calcAfterResult = false;
    } else {
      if (k === '.' && /\d+\.$/.test(calcExpr)) return; // already has decimal in last number
      calcExpr += k;
    }
    _calcUpdateDisplay();
  }
}

// -- T-Account pad --
function showTAccountPad() {
  let modal = document.getElementById('tAccountModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'tAccountModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="rpg-modal t-account-modal" onclick="event.stopPropagation()" style="max-width:600px">
      <div class="modal-title">⚖️ T-Account Practice</div>
      <input class="rpg-input" id="tAccountName" placeholder="Account name (e.g. Cash, Revenue)…" style="margin-bottom:14px">
      <div class="t-account-table">
        <div class="t-account-header"><span>DR (Debit)</span><span>CR (Credit)</span></div>
        <div class="t-account-body">
          <div class="t-account-col" id="tDebitCol"></div>
          <div class="t-account-divider"></div>
          <div class="t-account-col" id="tCreditCol"></div>
        </div>
        <div class="t-account-entry">
          <input class="rpg-input small" id="tEntryDesc" placeholder="Description">
          <input class="rpg-input small" id="tEntryAmt" type="number" placeholder="Amount" min="0">
          <button class="rpg-btn small" onclick="addTEntry('debit')">DR</button>
          <button class="rpg-btn small" onclick="addTEntry('credit')">CR</button>
        </div>
      </div>
      <div class="t-account-totals" id="tTotals"></div>
      <div class="modal-actions">
        <button class="rpg-btn danger" onclick="clearTAccount()">Clear</button>
        <button class="rpg-btn" onclick="document.getElementById('tAccountModal').style.display='none'">Close</button>
      </div>
    </div>`;
    modal.onclick = () => modal.style.display = 'none';
    document.body.appendChild(modal);
    modal._debits = []; modal._credits = [];
  }
  modal.style.display = 'flex';
  updateTAccount(modal);
}

function addTEntry(side) {
  const modal = document.getElementById('tAccountModal');
  const desc  = document.getElementById('tEntryDesc')?.value.trim();
  const amt   = parseFloat(document.getElementById('tEntryAmt')?.value || 0);
  if (!desc || !amt) { showToast('⚠️', 'Fill both fields', ''); return; }
  if (side === 'debit')  modal._debits.push({ desc, amt });
  else                    modal._credits.push({ desc, amt });
  document.getElementById('tEntryDesc').value = '';
  document.getElementById('tEntryAmt').value  = '';
  updateTAccount(modal);
}

function updateTAccount(modal) {
  const dc = document.getElementById('tDebitCol');
  const cc = document.getElementById('tCreditCol');
  const tot = document.getElementById('tTotals');
  if (!dc || !cc) return;
  dc.innerHTML = modal._debits.map(e => `<div class="t-entry"><span>${e.desc}</span><span>£${e.amt.toFixed(2)}</span></div>`).join('');
  cc.innerHTML = modal._credits.map(e => `<div class="t-entry"><span>${e.desc}</span><span>£${e.amt.toFixed(2)}</span></div>`).join('');
  const dr = modal._debits.reduce((s,e) => s + e.amt, 0);
  const cr = modal._credits.reduce((s,e) => s + e.amt, 0);
  const bal = dr - cr;
  if (tot) tot.innerHTML = `<span>DR Total: <strong>£${dr.toFixed(2)}</strong></span><span>CR Total: <strong>£${cr.toFixed(2)}</strong></span><span style="color:${Math.abs(bal)<0.01?'#27ae60':'#e74c3c'}">Balance: <strong>£${Math.abs(bal).toFixed(2)} ${bal>0?'DR':bal<0?'CR':'✓ Balanced'}</strong></span>`;
}

function clearTAccount() {
  const modal = document.getElementById('tAccountModal');
  modal._debits = []; modal._credits = [];
  updateTAccount(modal);
}

// -- Financial ratio quick reference --
const ACCOUNTING_RATIOS = [
  { name: 'Gross Profit Margin', formula: '(Revenue − COGS) ÷ Revenue × 100', category: 'Profitability' },
  { name: 'Net Profit Margin',   formula: 'Net Profit ÷ Revenue × 100',         category: 'Profitability' },
  { name: 'ROCE',                formula: 'EBIT ÷ Capital Employed × 100',       category: 'Profitability' },
  { name: 'ROE',                 formula: 'Net Income ÷ Shareholders\' Equity × 100', category: 'Profitability' },
  { name: 'Current Ratio',       formula: 'Current Assets ÷ Current Liabilities',     category: 'Liquidity' },
  { name: 'Quick Ratio',         formula: '(Current Assets − Inventory) ÷ Current Liabilities', category: 'Liquidity' },
  { name: 'Debt-to-Equity',      formula: 'Total Debt ÷ Shareholders\' Equity',  category: 'Leverage' },
  { name: 'Interest Cover',      formula: 'EBIT ÷ Interest Expense',             category: 'Leverage' },
  { name: 'Gearing Ratio',       formula: 'Debt ÷ (Debt + Equity) × 100',       category: 'Leverage' },
  { name: 'Asset Turnover',      formula: 'Revenue ÷ Total Assets',              category: 'Efficiency' },
  { name: 'Inventory Turnover',  formula: 'COGS ÷ Average Inventory',            category: 'Efficiency' },
  { name: 'Receivables Days',    formula: '(Receivables ÷ Revenue) × 365',       category: 'Efficiency' },
  { name: 'Payables Days',       formula: '(Payables ÷ COGS) × 365',            category: 'Efficiency' },
  { name: 'EPS',                 formula: '(Net Income − Preferred Divs) ÷ Shares Outstanding', category: 'Investor' },
  { name: 'P/E Ratio',           formula: 'Market Price per Share ÷ EPS',        category: 'Investor' },
  { name: 'Dividend Yield',      formula: 'DPS ÷ Market Price × 100',            category: 'Investor' },
  { name: 'NPV',                 formula: 'Σ [Cₜ ÷ (1+r)ᵗ] − Initial Investment', category: 'Investment' },
  { name: 'IRR',                 formula: 'Rate where NPV = 0',                  category: 'Investment' },
  { name: 'Payback Period',      formula: 'Initial Investment ÷ Annual Cash Flow', category: 'Investment' },
  { name: 'ARR',                 formula: '(Avg Annual Profit ÷ Avg Investment) × 100', category: 'Investment' },
];

function showRatioReference() {
  let modal = document.getElementById('ratioModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'ratioModal';
    modal.className = 'modal-overlay';
    const categories = [...new Set(ACCOUNTING_RATIOS.map(r => r.category))];
    modal.innerHTML = `<div class="rpg-modal ratio-modal" onclick="event.stopPropagation()" style="max-width:620px;max-height:80vh;overflow-y:auto">
      <div class="modal-title">📊 Financial Ratios</div>
      <input class="rpg-input" placeholder="Search ratios…" oninput="filterRatios(this.value)" style="margin-bottom:12px">
      <div id="ratioList">
        ${categories.map(cat => `
          <div class="ratio-category">${cat}</div>
          ${ACCOUNTING_RATIOS.filter(r => r.category === cat).map(r => `
            <div class="ratio-row">
              <div class="ratio-name">${r.name}</div>
              <div class="ratio-formula">${r.formula}</div>
              <button class="rpg-btn small" onclick="addRatioAsCard('${r.name.replace(/'/g,"\\'")}','${r.formula.replace(/'/g,"\\'")}')">➕ Card</button>
            </div>`).join('')}
        `).join('')}
      </div>
      <div class="modal-actions"><button class="rpg-btn" onclick="document.getElementById('ratioModal').style.display='none'">Close</button></div>
    </div>`;
    modal.onclick = () => modal.style.display = 'none';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
}

function filterRatios(query) {
  const list = document.getElementById('ratioList');
  if (!list) return;
  const q = query.toLowerCase();
  list.querySelectorAll('.ratio-row').forEach(row => {
    const match = row.textContent.toLowerCase().includes(q);
    row.style.display = match ? '' : 'none';
  });
  list.querySelectorAll('.ratio-category').forEach(cat => {
    const sibs = [];
    let next = cat.nextElementSibling;
    while (next && !next.classList.contains('ratio-category')) { sibs.push(next); next = next.nextElementSibling; }
    cat.style.display = sibs.some(s => s.style.display !== 'none') ? '' : 'none';
  });
}

function addRatioAsCard(name, formula) {
  showQuickAdd();
  setTimeout(() => {
    const f = document.getElementById('quickAddFront');
    const b = document.getElementById('quickAddBack');
    if (f) f.value = name;
    if (b) b.value = formula;
  }, 100);
}

// -- Card templates for accounting --
const CARD_TEMPLATES = [
  { name: '📖 Definition',    front: '[Term]',           back: '[Definition]' },
  { name: '🧮 Formula',       front: 'Formula for [X]?', back: '[Formula] = [Components]' },
  { name: '📊 Ratio',         front: 'How to calculate [Ratio]?', back: '[Formula]\nTypically: [benchmark]' },
  { name: '📒 Journal Entry', front: '[Transaction description]', back: 'DR [Account]   £[amount]\nCR [Account]   £[amount]' },
  { name: '⚖️ Debit or Credit?', front: 'Does [item] increase with a Debit or Credit?', back: '[DR/CR] — because [reason]' },
  { name: '📈 Ratio Analysis', front: 'What does a high [ratio] indicate?', back: '[Interpretation] — suggests [conclusion]' },
];

function showCardTemplates() {
  let modal = document.getElementById('cardTemplateModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'cardTemplateModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="rpg-modal" onclick="event.stopPropagation()">
      <div class="modal-title">📋 Card Templates</div>
      <div class="template-list">
        ${CARD_TEMPLATES.map((t,i) => `
          <div class="template-item" onclick="useTemplate(${i})">
            <div class="template-name">${t.name}</div>
            <div class="template-preview">${t.front}</div>
          </div>`).join('')}
      </div>
      <div class="modal-actions"><button class="rpg-btn" onclick="document.getElementById('cardTemplateModal').style.display='none'">✖ Cancel</button></div>
    </div>`;
    modal.onclick = () => modal.style.display = 'none';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
}

function useTemplate(index) {
  const t = CARD_TEMPLATES[index];
  document.getElementById('cardTemplateModal').style.display = 'none';
  const ef = document.getElementById('editFront');
  const eb = document.getElementById('editBack');
  if (ef) ef.value = t.front;
  if (eb) eb.value = t.back;
  const editPanel = document.getElementById('editPanel');
  if (editPanel) editPanel.classList.remove('hidden');
  showToast('📋', 'Template Applied', t.name);
}

// ============================================================
// 1. AUTO-SAVE DRAFTS (practice chamber)
// ============================================================
let _autosaveInterval = null;

function _startAutosave() {
  clearInterval(_autosaveInterval);
  _autosaveInterval = setInterval(() => {
    const ta = document.getElementById('writeTextarea');
    if (!ta || !activeScrollName) return;
    localStorage.setItem('practiceAutosave_' + activeScrollName, ta.value);
  }, 30000);
}

function _loadDraft(bookName) {
  const saved = localStorage.getItem('practiceAutosave_' + bookName);
  if (!saved) return;
  const ta = document.getElementById('writeTextarea');
  if (ta && !ta.value) {
    ta.value = saved;
    showToast('💾', 'Draft Restored', 'Unsaved work recovered');
    onWriteInput();
  }
}

function _clearDraft(bookName) {
  localStorage.removeItem('practiceAutosave_' + (bookName || activeScrollName));
}

// ============================================================
// 2. EXPORT ANSWER TO PDF
// ============================================================
function exportAnswerToPDF() {
  const question = currentQuestion || '';
  const answer   = document.getElementById('writeTextarea')?.value || '';
  const book     = activeScrollName || 'Practice';
  if (!answer.trim()) { showToast('⚠️', 'Nothing to Export', 'Write an answer first'); return; }

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>${book}</title>
  <style>
    body { font-family: 'Times New Roman', serif; font-size: 12pt; margin: 25.4mm; color: #111; }
    h2   { font-size: 14pt; border-bottom: 1px solid #ccc; padding-bottom: 6px; }
    .q   { background: #f5f5f5; padding: 12px; border-left: 4px solid #999; margin-bottom: 20px; font-style: italic; }
    pre  { white-space: pre-wrap; font-family: inherit; font-size: 12pt; line-height: 1.8; }
    @media print { body { margin: 20mm; } }
  </style></head><body>
  <h2>📚 ${book}</h2>
  ${question ? `<div class="q">❓ ${question}</div>` : ''}
  <pre>${answer.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
  <script>window.onload=()=>{window.print();}<\/script>
  </body></html>`);
  win.document.close();
}

// ============================================================
// 3. EXAM MODE (practice chamber)
// ============================================================
let examModeActive  = false;
let examWordLimit   = 0;
let examTimeLimit   = 0;
let examCountdown   = null;
let examSecsLeft    = 0;

function showExamModeSetup() {
  let m = document.getElementById('examModeModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'examModeModal';
    m.className = 'modal-overlay';
    m.innerHTML = `<div class="rpg-modal" onclick="event.stopPropagation()">
      <div class="modal-title">⏱ Exam Mode</div>
      <label class="rpg-label">Time limit (minutes, 0 = none)</label>
      <input class="rpg-input" id="examTimeInput" type="number" min="0" max="180" value="45" style="margin-bottom:10px">
      <label class="rpg-label">Word limit (0 = none)</label>
      <input class="rpg-input" id="examWordInput" type="number" min="0" max="5000" value="0" style="margin-bottom:0">
      <div class="modal-actions">
        <button class="rpg-btn primary" onclick="startExamMode()">⏱ Start Exam</button>
        <button class="rpg-btn" onclick="document.getElementById('examModeModal').style.display='none'">✖ Cancel</button>
      </div>
    </div>`;
    m.onclick = () => m.style.display = 'none';
    document.body.appendChild(m);
  }
  m.style.display = 'flex';
}

function startExamMode() {
  examModeActive = true;
  examTimeLimit  = parseInt(document.getElementById('examTimeInput')?.value || 0) * 60;
  examWordLimit  = parseInt(document.getElementById('examWordInput')?.value || 0);
  examSecsLeft   = examTimeLimit;
  document.getElementById('examModeModal').style.display = 'none';

  const bar = document.getElementById('examBar');
  if (bar) bar.style.display = 'flex';
  // Hide WPM bar in exam conditions
  const wpmBar = document.querySelector('.write-wpm-bar');
  if (wpmBar) wpmBar.style.display = 'none';

  if (examTimeLimit > 0) {
    clearInterval(examCountdown);
    examCountdown = setInterval(() => {
      examSecsLeft--;
      const el = document.getElementById('examCountdownDisplay');
      if (el) {
        const m = String(Math.floor(examSecsLeft/60)).padStart(2,'0');
        const s = String(examSecsLeft%60).padStart(2,'0');
        el.textContent = `${m}:${s}`;
        el.style.color = examSecsLeft < 60 ? '#e74c3c' : '#c9a84c';
      }
      if (examSecsLeft <= 0) {
        clearInterval(examCountdown);
        showToast('⏱', 'Time Up!', 'Exam time has ended');
        submitWriteEntry();
        stopExamMode();
      }
    }, 1000);
  }
  showToast('⏱', 'Exam Mode', examTimeLimit > 0 ? `${examTimeLimit/60}min timer started` : 'Word limit mode active');
}

function stopExamMode() {
  examModeActive = false;
  clearInterval(examCountdown);
  const bar = document.getElementById('examBar');
  if (bar) bar.style.display = 'none';
  const wpmBar = document.querySelector('.write-wpm-bar');
  if (wpmBar) wpmBar.style.display = '';
}

// ============================================================
// 4. SPLIT VIEW (practice chamber)
// ============================================================
let splitViewActive = false;

function toggleSplitView() {
  splitViewActive = !splitViewActive;
  const wrap = document.querySelector('.word-doc-wrap');
  const panel = document.getElementById('splitViewPanel');
  if (!wrap) return;
  if (splitViewActive) {
    if (!panel) {
      const p = document.createElement('div');
      p.id = 'splitViewPanel';
      p.className = 'split-view-panel';
      p.innerHTML = '<div class="split-view-title">📋 Reference Answer</div><div class="split-view-content" id="splitViewContent"></div>';
      wrap.parentNode.insertBefore(p, wrap);
      wrap.style.flex = '1';
      wrap.parentNode.style.display = 'flex';
      wrap.parentNode.style.gap = '0';
    }
    // Load latest saved entry for this book
    const sessions = db.practiceBooks[activeScrollName]?.sessions || [];
    const content = document.getElementById('splitViewContent');
    if (content) {
      if (sessions.length) {
        const s = sessions[0];
        content.innerHTML = `<div class="split-q">${s.question || ''}</div><pre class="split-answer">${(s.answer || '').replace(/</g,'&lt;')}</pre>`;
      } else {
        content.textContent = 'No saved entries yet.';
      }
    }
    document.getElementById('splitViewPanel').style.display = 'flex';
    showToast('📋', 'Split View On', 'Showing last saved answer alongside');
  } else {
    if (panel) panel.style.display = 'none';
    showToast('📋', 'Split View Off', '');
  }
}

// ============================================================
// 5. CONFIDENCE RATING BEFORE CARD FLIP
// ============================================================
let confidenceMode = false;
let confidencePreRating = null;

function toggleConfidenceMode() {
  confidenceMode = !confidenceMode;
  const btn = document.getElementById('confidenceBtn');
  if (btn) { btn.textContent = confidenceMode ? '🧠 Confidence ON' : '🧠 Confidence'; btn.classList.toggle('active', confidenceMode); }
  renderCard();
  showToast('🧠', confidenceMode ? 'Confidence Mode On' : 'Confidence Mode Off',
    confidenceMode ? 'Rate yourself before seeing the answer' : '');
}

function rateConfidence(level) {
  confidencePreRating = level;
  const panel = document.getElementById('confidencePanel');
  if (panel) panel.style.display = 'none';
  flipCard();
}

function _renderConfidencePanel() {
  const panel = document.getElementById('confidencePanel');
  if (!panel) return;
  if (confidenceMode && !isFlipped) {
    panel.style.display = 'flex';
  } else {
    panel.style.display = 'none';
  }
}

// ============================================================
// 6. STUDY PLANNER (enhanced in stats page)
// ============================================================
function renderStudyPlanner() {
  const el = document.getElementById('studyPlannerGrid');
  if (!el) return;
  el.innerHTML = '';
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    let due = 0;
    Object.values(db.decks).forEach(deck => {
      (deck.cards || []).forEach(card => {
        const cardDue = new Date(card.due || 0).toISOString().slice(0, 10);
        if (cardDue === key) due++;
      });
    });
    const cell = document.createElement('div');
    cell.className = 'planner-cell' + (i === 0 ? ' planner-today' : '');
    const dayName = d.toLocaleDateString('en', { weekday: 'short' });
    const dayNum  = d.getDate();
    cell.innerHTML = `<div class="planner-day">${dayName}</div><div class="planner-date">${dayNum}</div><div class="planner-count${due > 0 ? ' planner-has-cards' : ''}">${due > 0 ? due : '—'}</div>`;
    el.appendChild(cell);
  }
}

// ============================================================
// 7. VOICE ANSWERS (speech-to-text)
// ============================================================
let _voiceRec = null;
let _voiceActive = false;

function toggleVoiceInput(targetId = 'writeTextarea') {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('❌', 'Not Supported', 'Voice input is not supported in this browser — try Chrome');
    return;
  }
  if (_voiceActive) { _voiceRec?.stop(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  _voiceRec = new SR();
  _voiceRec.continuous = true;
  _voiceRec.interimResults = false;
  _voiceRec.lang = 'en-GB';
  _voiceRec.onresult = e => {
    const ta = document.getElementById(targetId);
    if (!ta) return;
    const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ');
    ta.value += (ta.value ? ' ' : '') + transcript;
    if (targetId === 'writeTextarea') onWriteInput();
  };
  _voiceRec.onend = () => {
    _voiceActive = false;
    const btn = document.getElementById('voiceBtn');
    if (btn) { btn.textContent = '🎙️'; btn.classList.remove('active'); }
  };
  _voiceRec.start();
  _voiceActive = true;
  const btn = document.getElementById('voiceBtn');
  if (btn) { btn.textContent = '⏹ Stop'; btn.classList.add('active'); }
  showToast('🎙️', 'Listening…', 'Speak your answer — press stop when done');
}

// ============================================================
// 8. PREDICTED EXAM READINESS
// ============================================================
function calculateDeckReadiness(deckName) {
  const deck = db.decks[deckName];
  if (!deck || !deck.cards || !deck.cards.length) return 0;
  const now = Date.now();
  const dayMs = 86400000;
  let score = 0;
  deck.cards.forEach(card => {
    const mastered  = card.mastered ? 1 : 0;
    const ease      = Math.min(1, (card.easeFactor || 2.5) / 3);
    const overduePenalty = card.due && card.due < now ? Math.max(0, 1 - (now - card.due) / (7 * dayMs)) : 1;
    score += (mastered * 0.6 + ease * 0.4) * overduePenalty;
  });
  return Math.round((score / deck.cards.length) * 100);
}

function renderExamReadiness() {
  const list = document.getElementById('readinessList');
  if (!list) return;
  list.innerHTML = '';
  const decks = Object.keys(db.decks);
  if (!decks.length) { list.innerHTML = '<p class="rpg-hint">No decks yet.</p>'; return; }
  decks.forEach(name => {
    const pct = calculateDeckReadiness(name);
    const colour = pct >= 80 ? '#27ae60' : pct >= 50 ? '#d4a017' : '#c0392b';
    const row = document.createElement('div');
    row.className = 'readiness-row';
    row.innerHTML = `
      <div class="readiness-name">${name}</div>
      <div class="readiness-bar-track"><div class="readiness-bar-fill" style="width:${pct}%;background:${colour}"></div></div>
      <div class="readiness-pct" style="color:${colour}">${pct}%</div>`;
    list.appendChild(row);
  });
}

// ============================================================
// 9. STUDY ROOMS (Firebase real-time)
// ============================================================
let _roomCode    = null;
let _roomES      = null;

function showStudyRoomPanel() {
  let modal = document.getElementById('studyRoomModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'studyRoomModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="rpg-modal" onclick="event.stopPropagation()">
      <div class="modal-title">👥 Study Room</div>
      ${_roomCode ? `<div class="rpg-hint" style="text-align:center;margin-bottom:10px">Current room: <strong style="color:var(--gold)">${_roomCode}</strong></div>` : ''}
      <div class="modal-actions" style="flex-direction:column;gap:8px">
        <button class="rpg-btn primary" onclick="createStudyRoom()">🏠 Create New Room</button>
        <div style="display:flex;gap:8px">
          <input class="rpg-input" id="joinRoomInput" placeholder="4-digit room code…" maxlength="4" style="flex:1">
          <button class="rpg-btn" onclick="joinStudyRoom()">→ Join</button>
        </div>
        ${_roomCode ? `<button class="rpg-btn danger" onclick="leaveStudyRoom()">✕ Leave Room</button>` : ''}
      </div>
      <div id="roomMembersList" style="margin-top:12px"></div>
      <div class="modal-actions"><button class="rpg-btn" onclick="document.getElementById('studyRoomModal').style.display='none'">✖ Close</button></div>
    </div>`;
    modal.onclick = () => modal.style.display = 'none';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  if (_roomCode) _renderRoomMembers();
}

async function createStudyRoom() {
  _roomCode = Math.floor(1000 + Math.random() * 9000).toString();
  await _pushRoomPresence();
  _listenRoom();
  document.getElementById('studyRoomModal').style.display = 'none';
  showToast('👥', `Room ${_roomCode} Created`, 'Share this code with friends to study together');
  _updateRoomBtn();
}

async function joinStudyRoom() {
  const code = document.getElementById('joinRoomInput')?.value?.trim();
  if (!code || code.length !== 4) { showToast('❌', 'Invalid Code', 'Enter a 4-digit room code'); return; }
  _roomCode = code;
  await _pushRoomPresence();
  _listenRoom();
  document.getElementById('studyRoomModal').style.display = 'none';
  showToast('👥', `Joined Room ${_roomCode}`, 'You are now in the study room');
  _updateRoomBtn();
}

async function _pushRoomPresence() {
  if (!_auth || !_roomCode) return;
  await fetch(`${FB}/rooms/${_roomCode}/${_auth.uid}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: _auth.displayName, level: db.xp?.level || 1, cardsToday: db.stats?.cardsStudiedToday || 0, updatedAt: Date.now() })
  });
}

function _listenRoom() {
  if (_roomES) { _roomES.close(); _roomES = null; }
  _roomES = new EventSource(`${FB}/rooms/${_roomCode}.json`);
  _roomES.addEventListener('put', e => {
    try { const d = JSON.parse(e.data); if (d.data) _renderRoomMembers(d.data); } catch(_) {}
  });
}

function _renderRoomMembers(data) {
  const list = document.getElementById('roomMembersList');
  if (!list || !data) return;
  const members = Object.values(data).sort((a, b) => (b.cardsToday || 0) - (a.cardsToday || 0));
  list.innerHTML = `<div class="room-title">👥 Room ${_roomCode} — Live</div>` +
    members.map(m => `<div class="room-member"><span>${m.name}</span><span>Lv.${m.level} · ${m.cardsToday||0} cards</span></div>`).join('');
}

async function leaveStudyRoom() {
  if (!_auth || !_roomCode) return;
  await fetch(`${FB}/rooms/${_roomCode}/${_auth.uid}.json`, { method: 'DELETE' });
  if (_roomES) { _roomES.close(); _roomES = null; }
  _roomCode = null;
  document.getElementById('studyRoomModal').style.display = 'none';
  _updateRoomBtn();
  showToast('👥', 'Left Room', 'You have left the study room');
}

function _updateRoomBtn() {
  const btn = document.getElementById('studyRoomBtn');
  if (!btn) return;
  btn.textContent = _roomCode ? `👥 Room ${_roomCode}` : '👥 Study Room';
  btn.classList.toggle('active', !!_roomCode);
}

// ============================================================
// 10. WEEKLY REPORT
// ============================================================
function renderWeeklyReport() {
  const el = document.getElementById('weeklyReport');
  if (!el) return;
  const today = new Date();
  let totalCards = 0, totalDays = 0, bestDay = 0, bestDayName = '';
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const count = db.heatmap[key] || 0;
    totalCards += count;
    if (count > 0) totalDays++;
    if (count > bestDay) { bestDay = count; bestDayName = d.toLocaleDateString('en', { weekday: 'short' }); }
    days.push({ key, count, label: d.toLocaleDateString('en', { weekday: 'short' }) });
  }
  const avg = totalDays > 0 ? Math.round(totalCards / totalDays) : 0;
  const maxCount = Math.max(...days.map(d => d.count), 1);
  el.innerHTML = `
    <div class="weekly-summary">
      <div class="weekly-stat"><div class="weekly-stat-label">Total Cards</div><div class="weekly-stat-val">${totalCards}</div></div>
      <div class="weekly-stat"><div class="weekly-stat-label">Days Active</div><div class="weekly-stat-val">${totalDays}/7</div></div>
      <div class="weekly-stat"><div class="weekly-stat-label">Daily Avg</div><div class="weekly-stat-val">${avg}</div></div>
      <div class="weekly-stat"><div class="weekly-stat-label">Best Day</div><div class="weekly-stat-val">${bestDayName || '—'}</div></div>
    </div>
    <div class="weekly-bars">
      ${days.map(d => `<div class="weekly-bar-wrap">
        <div class="weekly-bar" style="height:${Math.round((d.count/maxCount)*60)+4}px;background:${d.count>0?'var(--gold)':'rgba(201,168,76,0.15)'}"></div>
        <div class="weekly-bar-label">${d.label}</div>
        <div class="weekly-bar-count">${d.count||''}</div>
      </div>`).join('')}
    </div>`;
}

// ============================================================
// 11. SWIPE GESTURES (flashcard)
// ============================================================
function _initSwipeGestures() {
  const card = document.getElementById('flashcard');
  if (!card || card._swipeInit) return;
  card._swipeInit = true;
  let startX = 0, startY = 0;
  card.addEventListener('touchstart', e => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; }, { passive: true });
  card.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) { flipCard(); return; } // tap = flip
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 60)       mark('green');
      else if (dx < -60) mark('red');
    } else {
      if (dy < -60) mark('amber');
    }
  }, { passive: true });
  // Visual swipe hints
  card.style.transition = 'transform 0.15s';
  card.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    card.style.transform = `translateX(${dx * 0.3}px) rotate(${dx * 0.02}deg)`;
  }, { passive: true });
  card.addEventListener('touchend', (e) => {
    setTimeout(() => { card.style.transform = ''; }, 150);
    // Prevent the browser from firing a synthetic click after swipe
    if (Math.abs(e.changedTouches[0].clientX - startX) > 8) e.preventDefault();
  }, { passive: false });
}

// ============================================================
// 12. SCHEDULED REMINDERS
// ============================================================
function saveReminderTime() {
  const input = document.getElementById('reminderTimeInput');
  if (!input || !input.value) return;
  localStorage.setItem('studyReminderTime', input.value);
  showToast('🔔', 'Reminder Set', `Daily reminder at ${input.value}`);
}

function checkDailyReminder() {
  const time = localStorage.getItem('studyReminderTime');
  if (!time || Notification.permission !== 'granted') return;
  const [h, m]   = time.split(':').map(Number);
  const now       = new Date();
  const target    = new Date(); target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const ms = target - now;
  setTimeout(() => {
    if (db.stats.lastStudyDate !== todayStr()) {
      _triggerNotification("Time to Study! 📚", "You haven't studied today — open Scholar's Sanctum!");
    }
    checkDailyReminder(); // reschedule for tomorrow
  }, ms);
}

function loadReminderSettings() {
  const input = document.getElementById('reminderTimeInput');
  const saved = localStorage.getItem('studyReminderTime');
  if (input && saved) input.value = saved;
}

// ============================================================
// 13. PRINT FLASHCARDS
// ============================================================
function printDeckFlashcards() {
  if (!currentDeck || !currentDeck.cards.length) { showToast('⚠️', 'No Cards', 'Nothing to print'); return; }
  const win = window.open('', '_blank');
  const cards = currentDeck.cards;
  win.document.write(`<!DOCTYPE html><html><head><title>Flashcards — ${currentDeckName}</title>
  <style>
    body { font-family: Georgia, serif; margin: 0; }
    h1   { text-align: center; font-size: 16pt; margin: 20px 0 10px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
    .card { border: 1px solid #ccc; padding: 16px; min-height: 80px; page-break-inside: avoid; }
    .front { background: #fff8f0; font-weight: bold; }
    .back  { background: #f0f8ff; }
    .label { font-size: 8pt; color: #999; margin-bottom: 4px; text-transform: uppercase; }
    @media print { body { margin: 0; } h1 { font-size: 14pt; } }
  </style></head><body>
  <h1>${currentDeckName} — Flashcards</h1>
  <div class="grid">
    ${cards.map((c, i) => `
      <div class="card front"><div class="label">Card ${i + 1} — Front</div>${(c.front||'').replace(/</g,'&lt;')}</div>
      <div class="card back"><div class="label">Card ${i + 1} — Back</div>${(c.back||'').replace(/</g,'&lt;')}</div>
    `).join('')}
  </div>
  <script>window.onload=()=>{window.print();}<\/script>
  </body></html>`);
  win.document.close();
}

// ============================================================
// 14. QUICK ADD CARD (floating button on any page)
// ============================================================
function showQuickAdd() {
  let modal = document.getElementById('quickAddModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'quickAddModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="rpg-modal" onclick="event.stopPropagation()">
      <div class="modal-title">⚡ Quick Add Card</div>
      <label class="rpg-label">Deck</label>
      <select class="rpg-input" id="quickAddDeck" style="margin-bottom:10px"></select>
      <label class="rpg-label">Front</label>
      <input class="rpg-input" id="quickAddFront" placeholder="Front of card…" style="margin-bottom:10px">
      <label class="rpg-label">Back</label>
      <textarea class="rpg-input" id="quickAddBack" placeholder="Back of card…" rows="3" style="margin-bottom:0"></textarea>
      <div class="modal-actions">
        <button class="rpg-btn primary" onclick="confirmQuickAdd()">➕ Add Card</button>
        <button class="rpg-btn" onclick="document.getElementById('quickAddModal').style.display='none'">✖ Cancel</button>
      </div>
    </div>`;
    modal.onclick = () => modal.style.display = 'none';
    document.body.appendChild(modal);
  }
  // Populate deck list
  const sel = document.getElementById('quickAddDeck');
  sel.innerHTML = Object.keys(db.decks).map(n => `<option value="${n}">${n}</option>`).join('');
  if (!sel.innerHTML) { showToast('⚠️', 'No Decks', 'Create a deck first'); return; }
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('quickAddFront').focus(), 100);
}

function confirmQuickAdd() {
  const deckName = document.getElementById('quickAddDeck')?.value;
  const front    = document.getElementById('quickAddFront')?.value?.trim();
  const back     = document.getElementById('quickAddBack')?.value?.trim();
  if (!deckName || !front || !back) { showToast('⚠️', 'Fill All Fields', 'Deck, front and back are required'); return; }
  db.decks[deckName].cards.push({ front, back, due: 0, mastered: false });
  saveDB();
  document.getElementById('quickAddModal').style.display = 'none';
  document.getElementById('quickAddFront').value = '';
  document.getElementById('quickAddBack').value  = '';
  showToast('➕', 'Card Added', `Added to "${deckName}"`);
}

// Add quick-add FAB to every page
function _renderQuickAddFAB() {
  if (document.getElementById('quickAddFAB')) return;
  const fab = document.createElement('button');
  fab.id = 'quickAddFAB';
  fab.className = 'quick-add-fab';
  fab.textContent = '＋';
  fab.title = 'Quick add card';
  fab.onclick = showQuickAdd;
  document.body.appendChild(fab);
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', e => {
  if (document.activeElement.tagName === 'INPUT' ||
      document.activeElement.tagName === 'TEXTAREA' ||
      document.activeElement.tagName === 'SELECT') return;

  if (document.querySelector('.study-page')) {
    if (e.key === ' ') { e.preventDefault(); flipCard(); }
    if (e.key === 'Enter') { e.preventDefault(); nextCard(); }
    if (e.key === 'ArrowRight') nextCard();
    if (e.key === 'ArrowLeft') prevCard();
    if (e.key === '1') mark('red');
    if (e.key === '2') mark('amber');
    if (e.key === '3') mark('green');
    if (e.key === 'u' || e.key === 'U') undoLastMark();
  }

  if (document.querySelector('.duel-page') && document.getElementById('duelStudyView') &&
      document.getElementById('duelStudyView').style.display !== 'none') {
    if (e.key === ' ') { e.preventDefault(); flipDuelCard(); }
    if (e.key === 'Enter') { e.preventDefault(); duelNextCard(); }
    if (e.key === 'ArrowRight') duelNextCard();
    if (e.key === 'ArrowLeft') duelPrevCard();
    if (e.key === '1') markDuel('red');
    if (e.key === '2') markDuel('amber');
    if (e.key === '3') markDuel('green');
    if (e.key === 'u' || e.key === 'U') duelUndo();
  }
});