/**
 * R.E.B.O.R.N. v3.1 Enhancement Suite
 * - Floating Always-On Quick-Comms Ghost Relay Drawer
 * - Smart Vault Duplicate Weapon Analyzer & 1-Click Dismantle Prep
 * - AI Auto-Fill Weapon Roll inside God Roll Finder Modal
 * - Automatic X-Clan-Passcode header injection on protected admin/write endpoints
 */

const RENDER_BACKEND_URL = 'https://projectreborn.onrender.com';
const IS_FIREBASE_HOST = typeof window !== 'undefined' && (
  window.location.hostname.endsWith('.web.app') ||
  window.location.hostname.endsWith('.firebaseapp.com')
);
if (typeof window !== 'undefined') {
  window.__REBORN_API_BASE = IS_FIREBASE_HOST ? RENDER_BACKEND_URL : '';
}

const STATIC_CDN_GET_PATHS = new Set([
  '/api/wiki',
  '/api/godrolls',
  '/api/builds',
  '/api/firebase/web-config',
  '/api/network',
]);

const PROTECTED_API_PREFIXES = [
  '/api/config',
  '/api/firebase/web-config',
  '/api/auth/bungie/config',
  '/api/wiki',
  '/api/godrolls',
];

// Transparently route dynamic /api/* calls to Render when on Firebase Hosting + attach X-Clan-Passcode
(function installRebornFetchHook() {
  if (typeof window === 'undefined' || window.__rebornFetchHooked) return;
  window.__rebornFetchHooked = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      let url = typeof input === 'string' ? input : (input?.url || '');
      const method = String(init?.method || 'GET').toUpperCase();
      const isWrite = method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';

      if (IS_FIREBASE_HOST && typeof input === 'string' && input.startsWith('/api/')) {
        const cleanPath = input.split('?')[0];
        const useStaticCdn = method === 'GET' && STATIC_CDN_GET_PATHS.has(cleanPath);
        if (!useStaticCdn) {
          input = RENDER_BACKEND_URL + input;
          url = input;
        }
      }

      const isProtected = PROTECTED_API_PREFIXES.some(p => url.includes(p)) && !url.includes('/import-youtube') && !url.includes('/suggest');
      if (isWrite && isProtected) {
        const code = sessionStorage.getItem('reborn_clan_passcode') || '';
        if (code) {
          const headers = new Headers(init.headers || {});
          if (!headers.has('X-Clan-Passcode')) {
            headers.set('X-Clan-Passcode', code);
          }
          init = { ...init, headers };
        }
      }
    } catch (_) {}
    return origFetch(input, init);
  };
})();

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ==========================================================================
   1. FLOATING ALWAYS-ON "ASK GHOST" BUTTON (OPENS FULL AI & VOICE COMMS)
   ========================================================================== */
function mountFloatingRebornComms() {
  if (document.getElementById('rebornQuickFab')) return;

  const fab = document.createElement('button');
  fab.id = 'rebornQuickFab';
  fab.type = 'button';
  fab.className = 'reborn-quick-fab';
  fab.title = 'Ask Ghost — Open R.E.B.O.R.N. AI & Voice Comms';
  fab.innerHTML = `
    <span class="reborn-fab-core">❖</span>
    <span class="reborn-fab-label">Ask Ghost</span>
  `;

  document.body.appendChild(fab);

  fab.addEventListener('click', () => {
    if (typeof window.__toggleGhostCommsDrawer === 'function') {
      window.__toggleGhostCommsDrawer();
    }
  });
}

/* ==========================================================================
   2. SMART VAULT DUPLICATE WEAPON ANALYZER & 1-CLICK DISMANTLE PREP
   ========================================================================== */
function scoreWeaponCopy(item) {
  let score = 0;
  const vc = item.godRollCheck?.verdictCode || '';
  if (vc === 'DUAL_GOD_ROLL') score += 500;
  else if (vc === 'PVE_GOD_ROLL' || vc === 'PVP_GOD_ROLL') score += 350;
  else if (vc === 'SOLID_KEEP') score += 180;
  if (item.isCrafted) score += 120;
  if (item.isMasterworked) score += 60;
  if (item.isLocked) score += 40;
  score += Math.min(Number(item.power || 0), 3000) * 0.05;
  return score;
}

function openDuplicateAnalyzerModal() {
  const bData = window.__rebornState?.bungieData;
  if (!bData) {
    alert('Sign in with Bungie.net and sync your Inventory first to analyze Vault duplicates.');
    return;
  }

  let modal = document.getElementById('modalDuplicateAnalyzer');
  if (!modal) {
    modal = document.createElement('dialog');
    modal.id = 'modalDuplicateAnalyzer';
    modal.className = 'hud-modal reborn-dup-modal';
    modal.innerHTML = `
      <div class="modal-card reborn-dup-card">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">🧹 R.E.B.O.R.N. // SMART VAULT DUPLICATE ANALYZER</h3>
            <span class="modal-sub">Groups duplicate weapons across all 3 Characters &amp; Vault, ranks rolls, and preps extras for safe dismantling.</span>
          </div>
          <button type="button" class="btn-modal-close" id="btnCloseDupModal">&times;</button>
        </div>
        <div class="modal-body" id="rebornDupBody" style="max-height:65vh; overflow-y:auto;"></div>
        <div class="modal-footer" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <span id="rebornDupSummary" style="color:#94A3B8; font-size:13px;"></span>
          <div style="display:flex; gap:10px;">
            <button type="button" class="btn-tactical btn-secondary" id="btnCloseDupFooter">Close</button>
            <button type="button" class="btn-tactical btn-primary" id="btnPrepSelectedDups">🛡️ Prep Selected for Dismantle</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#btnCloseDupModal')?.addEventListener('click', () => modal.close());
    modal.querySelector('#btnCloseDupFooter')?.addEventListener('click', () => modal.close());
  }

  // Gather all owned weapons
  const allWeapons = [];
  for (const ch of (bData.characters || [])) {
    for (const it of [...(ch.equipment || []), ...(ch.inventory || [])]) {
      if (it.category === 'Weapon' && it.itemInstanceId) {
        allWeapons.push({ ...it, _ownerLabel: ch.className });
      }
    }
  }
  const vaultList = Array.isArray(bData.vault) ? bData.vault : (bData.vault?.items || []);
  for (const it of vaultList) {
    if (it.category === 'Weapon' && it.itemInstanceId) {
      allWeapons.push({ ...it, _ownerLabel: 'Vault' });
    }
  }

  const groups = new Map();
  for (const w of allWeapons) {
    const key = (w.name || '').toLowerCase().trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }

  const dupGroups = [...groups.values()]
    .filter(list => list.length > 1)
    .sort((a, b) => b.length - a.length);

  const bodyEl = modal.querySelector('#rebornDupBody');
  const sumEl = modal.querySelector('#rebornDupSummary');
  const prepBtn = modal.querySelector('#btnPrepSelectedDups');

  if (dupGroups.length === 0) {
    bodyEl.innerHTML = `<div style="text-align:center; padding:32px; color:#94A3B8;">✓ No duplicate weapons detected across your Vault and Characters. Your Armory is clean, Guardian!</div>`;
    sumEl.textContent = '0 duplicate groups';
    if (prepBtn) prepBtn.disabled = true;
    modal.showModal();
    return;
  }

  const itemById = new Map();
  let defaultCheckedCount = 0;

  bodyEl.innerHTML = dupGroups.map(list => {
    const ranked = [...list].sort((a, b) => scoreWeaponCopy(b) - scoreWeaponCopy(a));
    const rows = ranked.map((it, idx) => {
      itemById.set(it.itemInstanceId, it);
      const isBest = idx === 0;
      const verdict = (it.godRollCheck?.verdictCode || 'EVALUATED').replace(/_/g, ' ');
      const activePerkNames = Array.isArray(it.activePerks) && it.activePerks.length
        ? it.activePerks
        : (it.perkColumns || []).flat().filter(p => p && p.selected && p.name).map(p => p.name);
      const perks = activePerkNames.slice(0, 4).join(' • ') || 'Perks unavailable';
      const checked = !isBest && !it.isEquipped && !['DUAL_GOD_ROLL', 'PVE_GOD_ROLL', 'PVP_GOD_ROLL'].includes(it.godRollCheck?.verdictCode || '');
      if (checked) defaultCheckedCount++;
      return `
        <label class="reborn-dup-row ${isBest ? 'is-best' : ''}">
          <input type="checkbox" class="reborn-dup-chk" value="${escHtml(it.itemInstanceId)}" ${checked ? 'checked' : ''} ${it.isEquipped ? 'disabled' : ''}>
          <div class="reborn-dup-info">
            <div class="reborn-dup-line1">
              <span class="reborn-dup-badge ${isBest ? 'keep' : 'extra'}">${isBest ? '★ KEEP BEST' : 'DUPLICATE'}</span>
              <strong>${escHtml(it._ownerLabel)}</strong>
              <span>⚡ ${it.power || 0}</span>
              <span class="reborn-verdict-tag">${escHtml(verdict)}</span>
              ${it.isLocked ? '<span>🔒</span>' : ''}
              ${it.isCrafted ? '<span>🛠️ Crafted</span>' : ''}
            </div>
            <div class="reborn-dup-perks">${escHtml(perks)}</div>
          </div>
        </label>
      `;
    }).join('');

    return `
      <div class="reborn-dup-group">
        <div class="reborn-dup-group-head">
          <strong>${escHtml(ranked[0].name)}</strong>
          <span>${ranked.length} copies (${escHtml(ranked[0].slot)} • ${escHtml(ranked[0].element)})</span>
        </div>
        ${rows}
      </div>
    `;
  }).join('');

  sumEl.textContent = `${dupGroups.length} duplicate weapon groups • ${defaultCheckedCount} recommended for dismantle prep`;
  if (prepBtn) {
    prepBtn.disabled = false;
    prepBtn.onclick = async () => {
      const checkedIds = [...bodyEl.querySelectorAll('.reborn-dup-chk:checked')].map(el => el.value);
      if (checkedIds.length === 0) {
        alert('Select at least one duplicate weapon to prep for dismantle.');
        return;
      }
      const sess = window.__rebornState?.bungieSession;
      const defaultChar = bData.characters?.[0]?.characterId || '';
      if (!sess?.access_token || !defaultChar) {
        alert('Missing active Bungie session.');
        return;
      }
      prepBtn.disabled = true;
      prepBtn.textContent = 'Prepping…';
      try {
        const res = await fetch('/api/bungie/dismantle-prep', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sess.access_token}`,
            'X-Bungie-Refresh': sess.refresh_token || '',
          },
          body: JSON.stringify({
            membershipType: bData.player.membershipType,
            defaultCharacterId: defaultChar,
            targetCharacterId: defaultChar,
            unlockOnly: false,
            items: checkedIds.map(id => {
              const it = itemById.get(id);
              return {
                itemInstanceId: it.itemInstanceId,
                itemHash: it.itemHash,
                sourceLocation: it.location || 'vault',
                sourceCharacterId: it.characterId || '',
                slot: it.slot || 'Kinetic',
                isLocked: Boolean(it.isLocked),
                isEquipped: Boolean(it.isEquipped),
                name: it.name || '',
              };
            }),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Dismantle prep failed.');
        alert(`✓ Prepped ${(data.prepared || []).length} duplicate weapon(s) (unlocked & moved to your active Guardian for safe in-game dismantling).`);
        modal.close();
      } catch (err) {
        alert('Dismantle prep error: ' + err.message);
      } finally {
        prepBtn.disabled = false;
        prepBtn.textContent = '🛡️ Prep Selected for Dismantle';
      }
    };
  }

  modal.showModal();
}

function mountDuplicateAnalyzerButton() {
  const refreshBtn = document.getElementById('btnRefreshInventory');
  if (!refreshBtn || document.getElementById('btnOpenDuplicateAnalyzer')) return;
  const dupBtn = document.createElement('button');
  dupBtn.id = 'btnOpenDuplicateAnalyzer';
  dupBtn.type = 'button';
  dupBtn.className = 'btn-tactical btn-secondary';
  dupBtn.textContent = '🧹 Duplicate Analyzer';
  dupBtn.title = 'Scan Vault & Characters for duplicate weapon rolls';
  dupBtn.addEventListener('click', openDuplicateAnalyzerModal);
  refreshBtn.insertAdjacentElement('afterend', dupBtn);
}

/* ==========================================================================
   3. AI AUTO-FILL WEAPON ROLL BUTTON IN GOD ROLL MODAL
   ========================================================================== */
function mountGodRollAutoFill() {
  const nameInput = document.getElementById('rollWeaponName');
  if (!nameInput || document.getElementById('btnAutoFillGodRoll')) return;

  const btn = document.createElement('button');
  btn.id = 'btnAutoFillGodRoll';
  btn.type = 'button';
  btn.className = 'btn-tactical btn-secondary reborn-autofill-btn';
  btn.textContent = '🤖 Auto-Fill with R.E.B.O.R.N.';
  btn.title = 'Ask R.E.B.O.R.N. to populate verified PvE and PvP God Roll perks for this weapon';
  nameInput.insertAdjacentElement('afterend', btn);

  btn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      alert('Enter a Destiny 2 weapon name first!');
      nameInput.focus();
      return;
    }
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = '🤖 Analyzing Weapon Matrix…';
    try {
      const res = await fetch('/api/godrolls/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slot: document.getElementById('rollSlot')?.value || '',
          type: document.getElementById('rollType')?.value || '',
          element: document.getElementById('rollElement')?.value || '',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.suggestion) {
        throw new Error(data?.detail || 'Could not auto-fill weapon roll.');
      }
      const s = data.suggestion;
      const setVal = (id, v) => {
        const el = document.getElementById(id);
        if (el && v) el.value = v;
      };
      setVal('rollSource', s.source);
      setVal('rollSlot', s.slot);
      setVal('rollType', s.type);
      setVal('rollElement', s.element);
      setVal('rollFrame', s.frame);

      const isExotic = s.template === 'exotic';
      if (isExotic) {
        document.getElementById('btnTemplateExotic')?.click();
        setVal('pveBarrelExotic', s.pve?.barrel);
        setVal('pveMagExotic', s.pve?.mag);
        setVal('pvePerk1Exotic', s.pve?.perk1);
        setVal('pvePerk2Exotic', s.pve?.perk2);
        setVal('pveOriginTraitExotic', s.pve?.originTrait);
        setVal('pveNotesExotic', s.pve?.notes);
        setVal('pvpBarrelExotic', s.pvp?.barrel);
        setVal('pvpMagExotic', s.pvp?.mag);
        setVal('pvpPerk1Exotic', s.pvp?.perk1);
        setVal('pvpPerk2Exotic', s.pvp?.perk2);
        setVal('pvpOriginTraitExotic', s.pvp?.originTrait);
        setVal('pvpNotesExotic', s.pvp?.notes);
      } else {
        document.getElementById('btnTemplateLegendary')?.click();
        setVal('pveBarrel', s.pve?.barrel);
        setVal('pveMag', s.pve?.mag);
        setVal('pvePerk1', s.pve?.perk1);
        setVal('pvePerk2', s.pve?.perk2);
        setVal('pveOriginTrait', s.pve?.originTrait);
        setVal('pveMasterwork', s.pve?.masterwork);
        setVal('pveNotes', s.pve?.notes);
        setVal('pvpBarrel', s.pvp?.barrel);
        setVal('pvpMag', s.pvp?.mag);
        setVal('pvpPerk1', s.pvp?.perk1);
        setVal('pvpPerk2', s.pvp?.perk2);
        setVal('pvpOriginTrait', s.pvp?.originTrait);
        setVal('pvpMasterwork', s.pvp?.masterwork);
        setVal('pvpNotes', s.pvp?.notes);
      }
    } catch (err) {
      alert('Auto-Fill failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  window.__openDuplicateAnalyzerModal = openDuplicateAnalyzerModal;
  mountFloatingRebornComms();
  mountDuplicateAnalyzerButton();
  mountGodRollAutoFill();
});
