// ============================================================================
// PROJECT REBORN — PRO COMPANION SUITE (v86)
// 1. Live "Farming Mode" (Auto-Postmaster Sweeper)
// 2. Side-by-Side Weapon Comparator (Stat & Perk Diff + Ask Ghost)
// 3. Voice-Guided Raid & Dungeon Tactical Encounter Cheat Sheets
// 4. Interactive Weapon Wishlist & Live Deepsight Red-Border Pattern Tracker
// 5. Clan Fireteam Hub & Live Activity Presence
// 6. PWA Home Screen Shortcuts & Mobile Haptic Feedback
// ============================================================================

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const getState = () => window.__rebornState || {};
const getVoice = () => window.__rebornVoice || null;
const getSfx = () => window.__ghostSfx || { playChirp() {}, playReceive() {} };
const toast = (msg, type = 'info') => window.__ghostShowToast?.(msg, type);

export function haptic(pattern = 14) {
  try {
    if (navigator && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch (_) {}
}

function getBungieHeaders() {
  const sess = getState().bungieSession;
  if (!sess?.access_token) return null;
  return {
    'Authorization': `Bearer ${sess.access_token}`,
    'X-Bungie-Refresh': sess.refresh_token || '',
    'Content-Type': 'application/json',
  };
}

function getActiveChar() {
  const st = getState();
  const chars = st.bungieData?.characters || [];
  if (!chars.length) return null;
  if (st.activeInventoryView && st.activeInventoryView !== 'vault') {
    return chars.find(c => c.characterId === st.activeInventoryView) || chars[0];
  }
  return chars[0];
}

function getAllOwnedWeapons() {
  const bData = getState().bungieData;
  if (!bData) return [];
  const out = [];
  const isWep = (it) => it && (it.category === 'Weapon' || ['Kinetic', 'Energy', 'Heavy'].includes(it.slot));
  (bData.characters || []).forEach(c => {
    (c.equipment || []).filter(isWep).forEach(w => out.push({ ...w, _owner: `${c.className} (Equipped)` }));
    (c.inventory || []).filter(isWep).forEach(w => out.push({ ...w, _owner: c.className }));
  });
  const vList = Array.isArray(bData.vault) ? bData.vault : (bData.vault?.items || []);
  vList.filter(isWep).forEach(w => out.push({ ...w, _owner: 'Vault' }));
  return out;
}

function openDialog(id) {
  const dlg = document.getElementById(id);
  if (!dlg) return;
  haptic(12);
  try { getSfx().playChirp(); } catch (_) {}
  if (typeof dlg.showModal === 'function') {
    if (!dlg.open) dlg.showModal();
  } else {
    dlg.setAttribute('open', '');
  }
}

function closeDialog(id) {
  const dlg = document.getElementById(id);
  if (!dlg) return;
  try { dlg.close(); } catch (_) { dlg.removeAttribute('open'); }
}

// ============================================================================
// 1. LIVE "FARMING MODE" (AUTO-POSTMASTER SWEEPER)
// ============================================================================
let farmingModeOn = false;
let farmingBusy = false;

function syncFarmingUi() {
  const btn = document.getElementById('btnToggleFarmingMode');
  const lbl = document.getElementById('lblFarmingMode');
  if (btn) btn.classList.toggle('is-farming-active', farmingModeOn);
  if (lbl) lbl.textContent = farmingModeOn ? 'Farming: ON' : 'Farming: OFF';
}

async function runFarmingPostmasterSweep(manualTrigger = false) {
  if (!farmingModeOn || farmingBusy) return;
  const bData = getState().bungieData;
  const headers = getBungieHeaders();
  const ch = getActiveChar();
  if (!bData || !headers || !ch) return;

  const pm = ch.postmaster || [];
  if (!manualTrigger && pm.length < 12) return;

  const pullable = pm.filter(it =>
    it && it.itemInstanceId && it.itemHash &&
    (it.category === 'Weapon' || it.category === 'Armor')
  ).slice(0, 6);

  if (!pullable.length) return;

  farmingBusy = true;
  let pulled = 0;
  try {
    for (const it of pullable) {
      try {
        const res = await fetch('/api/bungie/transfer', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            membershipType: bData.player.membershipType,
            itemInstanceId: it.itemInstanceId,
            itemHash: it.itemHash,
            sourceLocation: 'postmaster',
            sourceCharacterId: ch.characterId,
            targetType: 'vault',
            targetCharacterId: ch.characterId,
            isEquipped: false,
          }),
        });
        if (res.ok) pulled++;
      } catch (_) {}
    }
    if (pulled > 0) {
      haptic([18, 40, 18]);
      toast(`🚜 Farming Mode swept ${pulled} Postmaster item${pulled > 1 ? 's' : ''} safely to Vault!`, 'info');
      window.__ghostRefreshInventory?.(true);
    }
  } finally {
    farmingBusy = false;
  }
}

// ============================================================================
// 2. SIDE-BY-SIDE WEAPON COMPARATOR (STAT & PERK DIFF)
// ============================================================================
let compareList = [];

function populateComparePicker() {
  const sel = document.getElementById('cmpWeaponPicker');
  if (!sel) return;
  const all = getAllOwnedWeapons().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  sel.innerHTML = all.slice(0, 400).map(w =>
    `<option value="${esc(w.itemInstanceId)}">${esc(w.name)} (${esc(w._owner)} • ${esc(w.slot)})</option>`
  ).join('');
}

function openWeaponCompareWith(seedItem = null) {
  const all = getAllOwnedWeapons();
  if (!all.length) {
    toast('Sign in to Bungie.net first to compare your weapons.', 'error');
    return;
  }
  populateComparePicker();
  if (seedItem) {
    const fam = String(seedItem.name || '').toLowerCase().trim();
    const sameCopies = all.filter(w => String(w.name || '').toLowerCase().trim() === fam).slice(0, 4);
    compareList = sameCopies.length >= 2 ? sameCopies : [seedItem, ...all.filter(w => w.slot === seedItem.slot && w.itemInstanceId !== seedItem.itemInstanceId).slice(0, 1)];
  } else if (compareList.length === 0) {
    compareList = all.slice(0, 2);
  }
  openDialog('modalWeaponCompare');
  renderWeaponCompare();
}

function renderWeaponCompare() {
  const grid = document.getElementById('cmpGrid');
  if (!grid) return;
  if (!compareList.length) {
    grid.innerHTML = `<div class="nextgen-empty">Pick 2–4 weapons above to compare stats and perks side-by-side.</div>`;
    return;
  }

  const base = compareList[0];
  const baseStats = new Map((base.stats || []).map(s => [s.name, Number(s.value) || 0]));

  // Union of key stat names
  const statNames = [];
  compareList.forEach(w => (w.stats || []).forEach(s => {
    if (s.name && !statNames.includes(s.name)) statNames.push(s.name);
  }));

  grid.innerHTML = compareList.map((w, idx) => {
    const wStats = new Map((w.stats || []).map(s => [s.name, Number(s.value) || 0]));
    const icon = w.icon ? `https://www.bungie.net${w.icon}` : 'icon-192.png';
    const perks = (w.activePerks && w.activePerks.length ? w.activePerks : (w.perkColumns || []).flat().filter(p => p?.selected).map(p => p.name)).slice(0, 5);
    const statRows = statNames.slice(0, 8).map(sn => {
      const val = wStats.get(sn) ?? 0;
      const bVal = baseStats.get(sn) ?? val;
      const diff = idx === 0 ? 0 : val - bVal;
      const diffHtml = diff > 0 ? `<span class="cmp-diff is-pos">+${diff}</span>` : diff < 0 ? `<span class="cmp-diff is-neg">${diff}</span>` : '';
      return `
        <div class="cmp-stat-row">
          <span class="cmp-stat-name">${esc(sn)}</span>
          <span class="cmp-stat-val">${val} ${diffHtml}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="cmp-col-card">
        <div class="cmp-col-head">
          <img src="${icon}" class="svc-icon" alt="">
          <div style="min-width:0; flex:1;">
            <strong style="display:block; font-size:13px;">${esc(w.name)}</strong>
            <span style="font-size:11px; color:#94a3b8;">${esc(w._owner || '')} • ✦ ${w.power || 0}</span>
          </div>
          <button type="button" class="btn-modal-close cmp-rm-btn" data-rm-idx="${idx}" aria-label="Remove">&times;</button>
        </div>
        <div class="cmp-perks-list">${perks.map(p => `<span class="cmp-perk-pill">${esc(p)}</span>`).join('')}</div>
        <div class="cmp-stats-box">${statRows || '<div style="font-size:11px; color:#64748b;">No stat bars available</div>'}</div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.cmp-rm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      compareList.splice(Number(btn.getAttribute('data-rm-idx')), 1);
      renderWeaponCompare();
    });
  });
}

// ============================================================================
// 3. VOICE-GUIDED RAID & DUNGEON ENCOUNTER CHEAT SHEETS
// ============================================================================
const ENCOUNTER_GUIDES = {
  salvations_edge: {
    name: "Salvation's Edge",
    type: 'Raid',
    encounters: [
      {
        title: '1. Substratum (Resonance Ping-Pong)',
        champs: 'Overload & Unstoppable',
        dps: 'Swords / Close-Range Add Clear',
        callouts: 'Split into 3 pairs. Shoot the glowing plate to send light pulses; kill Tormentor to open the center box; deposit 3 matching shapes before the timer.',
        brief: 'Substratum briefing: Split into three pairs. Bounce the plate resonance back and forth, melt the Tormentor immediately when it spawns, and bank three matching Resonance shapes at the center box.',
      },
      {
        title: '4. Verity (Inside / Outside Shapes)',
        champs: 'Unstoppable Ogres',
        dps: 'Fast Add Clear + Mobility',
        callouts: 'Inside 3 players: pass your matching shapes out so you hold the 2 shapes you DO NOT hold on your statue. Outside 3 players: dissect the 3D solids so each statue holds the two shapes its guardian is NOT holding.',
        brief: 'Verity briefing: Inside team, pass away your own starting shapes until you hold the two symbols you are missing. Outside team, dissect the 3D solids so every statue excludes its guardian symbol. Watch for the Ghost phase!',
      },
      {
        title: '5. The Witness (Final Boss)',
        champs: 'Subjugators (Stasis / Strand)',
        dps: 'Still Hunt + Celestial / Microcosm / Linear Fusions',
        callouts: 'Destroy Witness hand glyphs (Triangle = Orange, Circle = Yellow, Square = Red) to earn Glyphbreaker. Break 6 chest buttons to start DPS. Jump the floor shockwave and strafe beams on the center platform!',
        brief: 'Witness final boss briefing: Match hand colors to grab Glyphbreaker and pop six chest buttons. During damage on the center platform, stay glued to your Well, jump the red floor wave, and strafe left or right out of the beam.',
      },
    ],
  },
  vow: {
    name: 'Vow of the Disciple',
    type: 'Raid',
    encounters: [
      {
        title: '3. Exhibition (Relic Relay)',
        champs: 'Overload & Unstoppable',
        dps: 'LMGs / Rocket Sidearms / Tractor',
        callouts: 'Relics: Laser (Nut) kills Taken Knights, Shield (Aegis) cleanses Pervading Darkness, Taken Blight clears shielded blights. Call matching symbols between Dark & Light rooms.',
        brief: 'Exhibition briefing: Rotate all three relics every room. Keep Aegis close to cleanse Darkness, melt Taken Knights with the Laser, and call the single matching glyph to open the door.',
      },
      {
        title: '4. Rhulk, Disciple of the Witness',
        champs: 'None (Abominations)',
        dps: 'Divinity + Precision Linears / Rockets / Izanagi',
        callouts: 'Splitters dunk Leeching Force on matching symbol totems to climb stairs. Shoot Rhulk glaive to grab Emanating Force and dunk his 4 corners. Keep moving during DPS so he does not kick you!',
        brief: 'Rhulk briefing: Split Leeching Force downstairs, climb up and bait Rhulk beam to turn it into Emanating Force, then dunk all four corners. During DPS, break his four glowing crit spots and keep strafing away from his dash.',
      },
    ],
  },
  vespers_host: {
    name: "Vesper's Host",
    type: 'Dungeon',
    encounters: [
      {
        title: '2. Raneiks Unified (Servitor Split)',
        champs: 'Overload',
        dps: 'Glacial Quake / Dimensional Hypotrochoid / Parasite / Wardcliff',
        callouts: 'Scanner spots glowing Servitors (call 2 numbers). Operator shoots matching panels downstairs. Suppressor splits Raneiks into 10 mini-servitors — unleash massive AoE burst!',
        brief: 'Raneiks Unified briefing: Scanner calls the two glowing Servitor numbers, Operator shoots those panels downstairs, and Suppressor splits the boss. Dump heavy AoE weapons and Glacial Quake right when the mini-servitors scatter.',
      },
      {
        title: '3. Corrupted Puppeteer',
        champs: 'None (High Arc Resist)',
        dps: 'Grand Overture / Whisper / Anarchy + Super Spam',
        callouts: 'Use Operator to shoot numbered panels matching Scanner clones, deposit Nuclear Cores in the bunker before radiation hits 10x. During DPS, stay moving out of orange lightning rings and hide in the bunker when wipe begins.',
        brief: 'Corrupted Puppeteer briefing: Equip triple Arc Resist. Bank the Nuclear Cores fast before ten stacks of radiation, watch the glowing orange lightning circles on the floor during damage, and sprint into the safe bunker when she charges the wipe.',
      },
    ],
  },
  sundered_doctrine: {
    name: 'Sundered Doctrine',
    type: 'Dungeon',
    encounters: [
      {
        title: '2. Zoetic Lockset (4 Shriekers)',
        champs: 'Ogres & Wizards',
        dps: 'Anarchy / Witherhoard / Rocket Sidearms / Chaos Reach',
        callouts: 'Bank Knowledge into the 4 wheels to set Left-to-Right truth: Stop (left) prevents spawns, Kill (right) triggers longer DPS. Damage any active Shrieker eye—they share one health bar!',
        brief: 'Zoetic Lockset briefing: Lock Stop on the left wheels to keep adds calm and Kill on the right for a long damage phase. All four Shriekers share one health pool, so stick Anarchy or beam whichever eye opens.',
      },
      {
        title: '3. Kerrev, The Erased',
        champs: 'Subjugators',
        dps: 'Queenbreaker / Lord of Wolves / Linear Fusions',
        callouts: 'Align light lenses across the arena to expose the 3 true symbols and burn away fake ones. Break Kerrev shield with the beam, then melt him while avoiding Strand suspend waves.',
        brief: 'Kerrev briefing: Route the lens beam onto the three true symbols to unlock damage. Stay elevated or mobile to dodge his Strand suspend attacks and focus precision crits with Queenbreaker or Linears.',
      },
    ],
  },
};

let activeEncKey = 'salvations_edge';

function renderEncountersModal() {
  const pillsEl = document.getElementById('encActivityPills');
  const bodyEl = document.getElementById('encBody');
  if (!pillsEl || !bodyEl) return;

  pillsEl.innerHTML = Object.entries(ENCOUNTER_GUIDES).map(([k, g]) => `
    <button type="button" class="inv-pill ${k === activeEncKey ? 'active' : ''}" data-enc-key="${k}">
      ${g.type === 'Raid' ? '👑' : '🏰'} ${esc(g.name)}
    </button>
  `).join('');

  pillsEl.querySelectorAll('[data-enc-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeEncKey = btn.getAttribute('data-enc-key');
      haptic(10);
      renderEncountersModal();
    });
  });

  const guide = ENCOUNTER_GUIDES[activeEncKey];
  bodyEl.innerHTML = (guide?.encounters || []).map((enc, idx) => `
    <div class="pgcr-card">
      <div class="pgcr-top">
        <strong>${esc(enc.title)}</strong>
        <span class="svc-badge is-keep">${esc(enc.champs)}</span>
      </div>
      <div class="svc-perks"><strong>Top DPS:</strong> ${esc(enc.dps)}</div>
      <div class="svc-reason" style="color:#e2e8f0;">${esc(enc.callouts)}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:4px;">
        <button type="button" class="btn-tactical btn-primary btn-sm enc-brief-btn" data-enc-idx="${idx}">🗣️ Ghost Brief Me</button>
        <button type="button" class="btn-tactical btn-secondary btn-sm enc-ask-btn" data-enc-idx="${idx}">❖ Ask Ghost Loadout</button>
      </div>
    </div>
  `).join('');

  bodyEl.querySelectorAll('.enc-brief-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const enc = guide.encounters[Number(btn.getAttribute('data-enc-idx'))];
      if (!enc) return;
      haptic(14);
      getVoice()?.speak?.(enc.brief);
      toast(`🎙️ Ghost briefing: ${enc.title}`, 'info');
    });
  });

  bodyEl.querySelectorAll('.enc-ask-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const enc = guide.encounters[Number(btn.getAttribute('data-enc-idx'))];
      if (!enc) return;
      closeDialog('modalEncounters');
      window.__ghostSendPrompt?.(`Build me the optimal loadout from my owned gear for ${guide.name} — ${enc.title}.`, true);
    });
  });
}

// ============================================================================
// 4. LIVE DEEPSIGHT PATTERN TRACKER & PERSONAL WISHLIST
// ============================================================================
let patData = null;
let patTab = 'progress';
const WL_KEY = 'reborn_weapon_wishlist_v1';

function loadWishlist() {
  try { return JSON.parse(localStorage.getItem(WL_KEY) || '[]'); } catch (_) { return []; }
}
function saveWishlist(list) {
  try { localStorage.setItem(WL_KEY, JSON.stringify(list)); } catch (_) {}
}

async function fetchPatterns(force = false) {
  const headers = getBungieHeaders();
  const statusEl = document.getElementById('patStatus');
  if (!headers) {
    if (statusEl) statusEl.textContent = 'Sign in with Bungie.net to pull live Deepsight patterns.';
    renderPatternsBody();
    return;
  }
  if (statusEl) statusEl.textContent = 'Scanning Enclave Deepsight weapon patterns…';
  try {
    const res = await fetch(`/api/bungie/patterns${force ? '?force=true' : ''}`, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Pattern scan failed');
    patData = data;
    if (statusEl) statusEl.textContent = `${data.totalUnlocked} Patterns Unlocked • ${data.totalInProgress} In Progress`;
    renderPatternsBody();
  } catch (err) {
    if (statusEl) statusEl.textContent = `Pattern scan error: ${err.message}`;
    renderPatternsBody();
  }
}

function renderPatternsBody() {
  const bodyEl = document.getElementById('patBody');
  const wlForm = document.getElementById('patWishlistForm');
  const toolbar = document.getElementById('patToolbar');
  if (!bodyEl) return;

  if (wlForm) wlForm.classList.toggle('hidden', patTab !== 'wishlist');
  if (toolbar) toolbar.classList.toggle('hidden', patTab === 'wishlist');

  if (patTab === 'wishlist') {
    const list = loadWishlist();
    const owned = getAllOwnedWeapons();
    if (!list.length) {
      bodyEl.innerHTML = `<div class="nextgen-empty">Your Wishlist is empty. Add weapons you're farming above to track them against your Vault!</div>`;
      return;
    }
    bodyEl.innerHTML = list.map((w, idx) => {
      const ownedCopies = owned.filter(o => String(o.name || '').toLowerCase().includes(String(w.name || '').toLowerCase()));
      return `
        <div class="vr-item-row ${ownedCopies.length ? 'is-hot' : ''}">
          <div class="svc-info">
            <div class="svc-top">
              <strong>⭐ ${esc(w.name)}</strong>
              <span class="svc-badge ${ownedCopies.length ? 'is-godroll' : 'is-keep'}">${ownedCopies.length ? `OWNED (${ownedCopies.length})` : 'HUNTING'}</span>
            </div>
            <div class="svc-perks">Target: ${esc(w.perks || 'Any God Roll')}</div>
          </div>
          <button type="button" class="btn-modal-close wl-del-btn" data-wl-idx="${idx}" aria-label="Remove">&times;</button>
        </div>
      `;
    }).join('');
    bodyEl.querySelectorAll('.wl-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const l = loadWishlist();
        l.splice(Number(btn.getAttribute('data-wl-idx')), 1);
        saveWishlist(l);
        renderPatternsBody();
      });
    });
    return;
  }

  if (!patData) {
    bodyEl.innerHTML = `<div class="nextgen-empty">Sign in with Bungie.net and tap Refresh to view your live Deepsight patterns.</div>`;
    return;
  }

  const items = patTab === 'unlocked' ? (patData.completed || []) : (patData.inProgress || []);
  if (!items.length) {
    bodyEl.innerHTML = `<div class="nextgen-empty">No patterns found in this category.</div>`;
    return;
  }

  bodyEl.innerHTML = items.map(p => {
    const pct = Math.min(100, Math.round((p.progress / Math.max(1, p.total)) * 100));
    return `
      <div class="vr-item-row ${p.completed ? 'is-hot' : ''}">
        ${p.icon ? `<img src="https://www.bungie.net${p.icon}" class="svc-icon" alt="" loading="lazy">` : ''}
        <div class="svc-info">
          <div class="svc-top">
            <strong>${esc(p.name)}</strong>
            <span class="svc-badge ${p.completed ? 'is-godroll' : 'is-trash'}">${p.progress}/${p.total}</span>
          </div>
          <div class="d2-stat-track" style="margin-top:6px;"><span class="d2-stat-fill" style="width:${pct}%"></span></div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// 5. CLAN FIRETEAM HUB & LIVE PRESENCE STRIP (IN FRIENDS TAB)
// ============================================================================
function updateFireteamPresenceStrip() {
  const strip = document.getElementById('fireteamPresenceStrip');
  const friendsTab = document.getElementById('tab-friends');
  if (!strip || !friendsTab) return;

  // Read live online friends rendered in the Friends tab
  const onlineCards = [...friendsTab.querySelectorAll('.friend-card.is-online, .friend-card')].filter(card =>
    /online|in destiny|orbit|raid|crucible|strikes/i.test(card.textContent || '')
  );
  if (!onlineCards.length) {
    strip.classList.add('hidden');
    return;
  }
  strip.classList.remove('hidden');
  strip.innerHTML = `
    <div class="ft-strip-head">
      <span>🟢 <strong>LIVE FIRETEAM RADAR</strong> — ${onlineCards.length} Guardian${onlineCards.length > 1 ? 's' : ''} Active</span>
      <span class="ft-strip-sub">Tap Inspect on any active friend to compare their live build</span>
    </div>
  `;
}

// ============================================================================
// 6. PWA SHORTCUTS, INSPECT COMPARE INJECTION & HAPTIC BOOTSTRAP
// ============================================================================
function injectInspectCompareButton() {
  const actionBar = document.getElementById('inspectActionBar');
  if (!actionBar || actionBar.dataset.cmpObserver) return;
  actionBar.dataset.cmpObserver = '1';
  const obs = new MutationObserver(() => {
    const it = getState().inspectedItem;
    if (!it || (it.category !== 'Weapon' && !['Kinetic', 'Energy', 'Heavy'].includes(it.slot))) return;
    if (actionBar.querySelector('#btnInspectCompareWeapon')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnInspectCompareWeapon';
    btn.className = 'btn-item-action';
    btn.innerHTML = '<span>⚖️</span> Compare';
    btn.addEventListener('click', () => {
      closeDialog('modalInspectItem');
      openWeaponCompareWith(it);
    });
    actionBar.appendChild(btn);
  });
  obs.observe(actionBar, { childList: true });
}

function handlePwaShortcutLaunch() {
  try {
    const params = new URLSearchParams(window.location.search);
    const sc = params.get('shortcut');
    if (!sc) return;
    setTimeout(() => {
      if (sc === 'hud') document.getElementById('btnOpenGhostHudInv')?.click();
      else if (sc === 'cleaner') document.getElementById('btnOpenSmartVaultCleaner')?.click();
      else if (sc === 'loadouts') document.getElementById('btnOpenDimLoadoutBuilder')?.click();
      else if (sc === 'pgcr') document.getElementById('btnOpenPgcrDebrief')?.click();
    }, 550);
  } catch (_) {}
}

function initProSuite() {
  // Dialog close buttons
  document.querySelectorAll('[data-close-dialog]').forEach(btn => {
    btn.addEventListener('click', () => closeDialog(btn.getAttribute('data-close-dialog')));
  });

  // 1. Farming Mode
  try { farmingModeOn = localStorage.getItem('reborn_farming_mode') === 'true'; } catch (_) {}
  syncFarmingUi();
  document.getElementById('btnToggleFarmingMode')?.addEventListener('click', () => {
    farmingModeOn = !farmingModeOn;
    try { localStorage.setItem('reborn_farming_mode', String(farmingModeOn)); } catch (_) {}
    syncFarmingUi();
    haptic(18);
    getSfx().playChirp();
    toast(farmingModeOn ? '🚜 Farming Mode ON — Auto-sweeping Postmaster to Vault!' : '🚜 Farming Mode paused.', 'info');
    if (farmingModeOn) runFarmingPostmasterSweep(true);
  });
  setInterval(() => runFarmingPostmasterSweep(false), 45000);

  // 2. Weapon Comparator
  document.getElementById('btnOpenWeaponCompare')?.addEventListener('click', () => openWeaponCompareWith(null));
  document.getElementById('btnCmpAddWeapon')?.addEventListener('click', () => {
    const id = document.getElementById('cmpWeaponPicker')?.value;
    if (!id || compareList.length >= 4) return;
    const found = getAllOwnedWeapons().find(w => w.itemInstanceId === id);
    if (found && !compareList.some(x => x.itemInstanceId === id)) {
      compareList.push(found);
      haptic(10);
      renderWeaponCompare();
    }
  });
  document.getElementById('btnCmpClear')?.addEventListener('click', () => {
    compareList = [];
    renderWeaponCompare();
  });
  document.getElementById('btnCmpAskGhost')?.addEventListener('click', () => {
    if (compareList.length < 2) {
      toast('Add at least 2 weapons to compare.', 'error');
      return;
    }
    const summary = compareList.map((w, i) => {
      const perks = (w.activePerks || []).slice(0, 4).join(', ');
      return `#${i + 1} ${w.name} (${perks || w.typeName || w.slot})`;
    }).join(' VS ');
    closeDialog('modalWeaponCompare');
    window.__ghostSendPrompt?.(`Compare these weapons I own and tell me which single roll wins for PvE and PvP: ${summary}`, true);
  });

  // 3. Raid & Dungeon Encounters
  document.getElementById('btnOpenEncounters')?.addEventListener('click', () => {
    openDialog('modalEncounters');
    renderEncountersModal();
  });

  // 4. Patterns & Wishlist
  document.getElementById('btnOpenPatterns')?.addEventListener('click', () => {
    openDialog('modalPatternTracker');
    if (patData) renderPatternsBody();
    else fetchPatterns(false);
  });
  document.getElementById('btnPatRefresh')?.addEventListener('click', () => fetchPatterns(true));
  document.querySelectorAll('#patTabs [data-pat-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      patTab = btn.getAttribute('data-pat-tab') || 'progress';
      document.querySelectorAll('#patTabs [data-pat-tab]').forEach(b => b.classList.toggle('active', b === btn));
      haptic(10);
      renderPatternsBody();
    });
  });
  document.getElementById('btnWlAdd')?.addEventListener('click', () => {
    const nameEl = document.getElementById('wlWeaponName');
    const perksEl = document.getElementById('wlTargetPerks');
    const name = (nameEl?.value || '').trim();
    if (!name) return;
    const list = loadWishlist();
    list.unshift({ name, perks: (perksEl?.value || '').trim() });
    saveWishlist(list);
    if (nameEl) nameEl.value = '';
    if (perksEl) perksEl.value = '';
    haptic(15);
    renderPatternsBody();
    toast(`⭐ Added ${name} to your Wishlist!`, 'info');
  });

  // 5 & 6. Inspect Compare injection, Fireteam presence watcher, Haptics & PWA shortcuts
  injectInspectCompareButton();
  setInterval(updateFireteamPresenceStrip, 4000);
  handlePwaShortcutLaunch();

  // Tactile haptic feedback on key action buttons
  document.addEventListener('click', (e) => {
    if (e.target.closest('.btn-primary, .btn-item-action, .ghost-tool-pill, .nav-tab')) {
      haptic(8);
    }
  }, { passive: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProSuite);
} else {
  initProSuite();
}
