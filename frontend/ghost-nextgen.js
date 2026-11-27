// ============================================================================
// PROJECT REBORN — NEXT-GEN GHOST SUITE (v78)
// 1. Full-Screen Hands-Free "Hey Ghost" Voice HUD + Mid-Activity Commands
// 2. Smart Vault Cleaner ("Trash or Keep" AI Auditor)
// 3. Live Activity Prep & Anti-Champion Checker
// 4. Interactive 3D Ghost Shell, Eye & Reactive Moods
// 5. Weekly Reset & Vendor God Roll Radar
// 6. Live Crucible / Raid Post-Game Debrief (PGCR)
// ============================================================================

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const getState = () => window.__rebornState || {};
const getVoice = () => window.__rebornVoice || null;
const getSfx = () => window.__ghostSfx || { playChirp() {}, playReceive() {} };
const toast = (msg, type = 'info') => {
  if (typeof window.__ghostShowToast === 'function') window.__ghostShowToast(msg, type);
};

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
    const found = chars.find(c => c.characterId === st.activeInventoryView);
    if (found) return found;
  }
  return chars[0];
}

function openModal(id) {
  const dlg = document.getElementById(id);
  if (!dlg) return;
  try { getSfx().playChirp(); } catch (_) {}
  if (typeof dlg.showModal === 'function') {
    if (!dlg.open) dlg.showModal();
  } else {
    dlg.setAttribute('open', '');
  }
}

function closeModal(id) {
  const dlg = document.getElementById(id);
  if (!dlg) return;
  try { dlg.close(); } catch (_) { dlg.removeAttribute('open'); }
}

// ============================================================================
// 4. INTERACTIVE 3D GHOST SHELLS, EYE COLORS & REACTIVE MOODS
// ============================================================================
function syncGhostCustomizers() {
  const st = getState();
  const shell = st.ghostShell || 'generalist';
  const eye = st.ghostEye || 'auto';
  ['ghostShellSelect', 'ghostHudShellSelect'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value !== shell) el.value = shell;
  });
  ['ghostEyeSelect', 'ghostHudEyeSelect'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value !== eye) el.value = eye;
  });
}

function applyGhostShell(shell) {
  const st = getState();
  st.ghostShell = shell || 'generalist';
  try { localStorage.setItem('reborn_ghost_shell', st.ghostShell); } catch (_) {}
  syncGhostCustomizers();
  getSfx().playChirp();
}

function applyGhostEye(eye) {
  const st = getState();
  st.ghostEye = eye || 'auto';
  try { localStorage.setItem('reborn_ghost_eye', st.ghostEye); } catch (_) {}
  syncGhostCustomizers();
  getSfx().playChirp();
}

function updateAutoGhostMood() {
  const st = getState();
  if (st.isThinking) {
    st.ghostMood = 'streaming';
    return;
  }
  const chars = st.bungieData?.characters || [];
  let maxPm = 0;
  chars.forEach(c => {
    const cnt = (c.postmaster || []).length;
    if (cnt > maxPm) maxPm = cnt;
  });
  if (maxPm >= 18) st.ghostMood = 'alert';
  else if (maxPm >= 15) st.ghostMood = 'warning';
  else if (st.ghostMood !== 'alert' && st.ghostMood !== 'warning') st.ghostMood = 'normal';
}

// ============================================================================
// 1. FULL-SCREEN HANDS-FREE "HEY GHOST" VOICE HUD
// ============================================================================
let hudGhost3D = null;
let hudAutoLoop = false;
let hudRecognizer = null;
let hudListening = false;
let hudRingRaf = null;

function setHudStatus(label, mode = 'standby') {
  const pill = document.getElementById('ghostHudMoodPill');
  const dot = document.getElementById('ghostHudStatusDot');
  if (pill) pill.textContent = label;
  if (dot) {
    dot.className = `ghost-hud-dot is-${mode}`;
  }
}

async function openGhostHud() {
  const overlay = document.getElementById('ghostHandsFreeOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  syncGhostCustomizers();
  getSfx().playChirp();

  // Mount dedicated Three.js 3D Ghost in full-screen stage
  const host = document.getElementById('ghostHudCanvasHost');
  if (host && !hudGhost3D) {
    try {
      const { DestinyGhost3DAvatar } = await import('./ghost-3d.js?v=20261126_v78');
      hudGhost3D = new DestinyGhost3DAvatar(
        host,
        () => getState(),
        () => getVoice()?.getLiveAudioLevel?.() || 0,
        () => {
          getSfx().playChirp();
          getVoice()?.speak?.('Eyes up, Guardian. Ghost comms channel is live.');
        }
      );
    } catch (err) {
      console.warn('[GhostHUD] 3D mount fallback:', err);
    }
  }
  if (hudGhost3D) {
    hudGhost3D.resize();
    hudGhost3D.start();
  }
  startHudRingVisualizer();
}

function closeGhostHud() {
  const overlay = document.getElementById('ghostHandsFreeOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  document.body.style.overflow = '';
  hudAutoLoop = false;
  stopHudMic();
  if (hudGhost3D) hudGhost3D.stop();
  if (hudRingRaf) {
    cancelAnimationFrame(hudRingRaf);
    hudRingRaf = null;
  }
  const loopBtn = document.getElementById('btnGhostHudLoop');
  if (loopBtn) {
    loopBtn.classList.remove('active');
    loopBtn.textContent = '🔁 Auto-Loop: OFF';
  }
}

function startHudRingVisualizer() {
  if (hudRingRaf) cancelAnimationFrame(hudRingRaf);
  const outer = document.getElementById('ghostHudRingOuter');
  const inner = document.getElementById('ghostHudRingInner');
  const tick = () => {
    const overlay = document.getElementById('ghostHandsFreeOverlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    hudRingRaf = requestAnimationFrame(tick);
    const st = getState();
    const lvl = getVoice()?.getLiveAudioLevel?.() || (st.isSpeaking ? 0.35 : 0);
    if (outer) {
      const s = 1 + lvl * 0.28 + (hudListening ? 0.08 : 0);
      outer.style.transform = `scale(${s.toFixed(3)})`;
      outer.style.opacity = String(Math.min(0.95, 0.22 + lvl * 0.7 + (hudListening ? 0.35 : 0)));
    }
    if (inner) {
      const s2 = 1 + lvl * 0.16;
      inner.style.transform = `scale(${s2.toFixed(3)})`;
    }
    if (st.isSpeaking) setHudStatus('TRANSMITTING', 'speaking');
    else if (st.isThinking) setHudStatus('CALCULATING', 'thinking');
    else if (hudListening) setHudStatus('LISTENING…', 'listening');
    else setHudStatus(hudAutoLoop ? 'AUTO-LOOP ARMED' : 'STANDBY', 'standby');
  };
  hudRingRaf = requestAnimationFrame(tick);
}

async function sendHudVoicePrompt(text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  const st = getState();
  const trEl = document.getElementById('ghostHudTranscript');
  const repEl = document.getElementById('ghostHudReply');
  if (trEl) trEl.textContent = `“${clean}”`;
  if (repEl) repEl.textContent = 'Ghost is analyzing your loadout & telemetry…';

  st.isThinking = true;
  st.ghostMood = 'streaming';
  setHudStatus('CALCULATING', 'thinking');

  try {
    const sess = st.bungieSession;
    const activeChar = getActiveChar();
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sess?.access_token ? { 'Authorization': `Bearer ${sess.access_token}`, 'X-Bungie-Refresh': sess.refresh_token || '' } : {}),
      },
      body: JSON.stringify({
        message: clean,
        guardianClass: activeChar?.className || st.guardianClass || 'Warlock',
        subclass: activeChar?.subclass?.element || st.subclass || 'Solar',
        activity: st.activity || 'Grandmaster+',
        responseStyle: 'concise',
        history: (st.chatHistory || []).slice(-6),
        inventoryContext: st.bungieData ? {
          activeCharacterId: activeChar?.characterId || '',
          playerName: st.bungieData.player?.fullBungieName || '',
          characters: (st.bungieData.characters || []).map(c => ({
            characterId: c.characterId,
            className: c.className,
            light: c.light,
            subclass: c.subclass?.name || '',
            postmasterCount: (c.postmaster || []).length,
            equippedWeapons: (c.equipped?.weapons || []).map(w => w.name),
            equippedArmor: (c.equipped?.armor || []).map(a => a.name),
          })),
        } : null,
      }),
    });
    const data = await res.json();
    const reply = data.reply || 'Comms relay completed.';
    if (repEl) repEl.textContent = reply.replace(/[*#`]/g, '').slice(0, 320);

    // Auto-execute safe mid-activity Ghost actions (Postmaster Pull / Transfers)
    const actions = Array.isArray(data.ghost_actions) ? data.ghost_actions : [];
    for (const act of actions) {
      if (typeof window.__ghostExecuteAction === 'function') {
        try {
          await window.__ghostExecuteAction(act);
        } catch (_) {}
      }
    }

    st.isThinking = false;
    updateAutoGhostMood();

    // Speak reply via ElevenLabs Ghost Voice & resume Auto-Loop when finished
    const v = getVoice();
    if (v && typeof v.speak === 'function') {
      v.speak(reply);
      if (hudAutoLoop) {
        const waitSpeak = setInterval(() => {
          const overlay = document.getElementById('ghostHandsFreeOverlay');
          if (!overlay || overlay.classList.contains('hidden') || !hudAutoLoop) {
            clearInterval(waitSpeak);
            return;
          }
          if (!getState().isSpeaking && !getState().isThinking) {
            clearInterval(waitSpeak);
            setTimeout(() => {
              if (hudAutoLoop && !hudListening) startHudMic();
            }, 450);
          }
        }, 350);
      }
    }
  } catch (err) {
    st.isThinking = false;
    updateAutoGhostMood();
    if (repEl) repEl.textContent = `Comms error: ${err.message}`;
  }
}

function startHudMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast('Speech Recognition is not supported in this browser. Use quick command chips below.', 'error');
    return;
  }
  if (hudListening) {
    stopHudMic();
    return;
  }
  try { getVoice()?.stop?.(); } catch (_) {}

  const micBtn = document.getElementById('btnGhostHudMic');
  const trEl = document.getElementById('ghostHudTranscript');

  hudRecognizer = new SR();
  hudRecognizer.continuous = false;
  hudRecognizer.interimResults = true;
  hudRecognizer.lang = 'en-US';

  let finalTranscript = '';

  hudRecognizer.onstart = () => {
    hudListening = true;
    getState().isListening = true;
    micBtn?.classList.add('is-listening');
    if (trEl) trEl.textContent = 'Listening… speak your command to Ghost';
    setHudStatus('LISTENING…', 'listening');
  };

  hudRecognizer.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const txt = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalTranscript += txt + ' ';
      else interim += txt;
    }
    if (trEl) trEl.textContent = (finalTranscript + interim).trim() || 'Listening…';
  };

  hudRecognizer.onerror = () => {
    hudListening = false;
    getState().isListening = false;
    micBtn?.classList.remove('is-listening');
  };

  hudRecognizer.onend = () => {
    hudListening = false;
    getState().isListening = false;
    micBtn?.classList.remove('is-listening');
    const spoken = finalTranscript.trim();
    if (spoken) {
      sendHudVoicePrompt(spoken);
    } else if (hudAutoLoop) {
      setTimeout(() => {
        const overlay = document.getElementById('ghostHandsFreeOverlay');
        if (hudAutoLoop && overlay && !overlay.classList.contains('hidden')) startHudMic();
      }, 600);
    }
  };

  try { hudRecognizer.start(); } catch (_) {}
}

function stopHudMic() {
  hudListening = false;
  getState().isListening = false;
  document.getElementById('btnGhostHudMic')?.classList.remove('is-listening');
  try { hudRecognizer?.stop?.(); } catch (_) {}
}

// ============================================================================
// 2. SMART VAULT CLEANER ("TRASH OR KEEP" AI AUDITOR)
// ============================================================================
let svcAuditItems = [];
let svcCurrentFilter = 'trash';

function auditVaultWeapons() {
  const st = getState();
  const bData = st.bungieData;
  if (!bData) return [];

  const allWeapons = [];
  const familyCounts = new Map();

  const pushW = (w, loc, charId, owner) => {
    if (!w || !w.itemInstanceId) return;
    if (!['Kinetic', 'Energy', 'Heavy'].includes(w.slot)) return;
    const fam = String(w.name || '').toLowerCase().replace(/\s*\(adept\)|\s*\(timelost\)|\s*\(harrowed\)/g, '').trim();
    familyCounts.set(fam, (familyCounts.get(fam) || 0) + 1);
    allWeapons.push({ ...w, _loc: loc, _charId: charId, _owner: owner, _fam: fam });
  };

  (bData.characters || []).forEach(c => {
    (c.equipped?.weapons || []).forEach(w => pushW(w, 'equipped', c.characterId, `${c.className} (Eq)`));
    (c.inventory?.weapons || []).forEach(w => pushW(w, 'character', c.characterId, c.className));
  });
  (bData.vault?.weapons || []).forEach(w => pushW(w, 'vault', '', 'Vault'));

  // Score every weapon
  const scoreItem = (it) => {
    const vc = it.godRollCheck?.verdictCode || '';
    const vScore = vc === 'DUAL_GOD_ROLL' ? 100 : vc === 'PVE_GOD_ROLL' || vc === 'PVP_GOD_ROLL' ? 85 : vc === 'STRONG_ROLL' ? 60 : 20;
    const hits = Math.max(it.godRollCheck?.pveTraitHits || 0, it.godRollCheck?.pvpTraitHits || 0) * 12;
    return vScore + hits + (it.isCrafted ? 40 : 0) + (it.isExotic ? 50 : 0) + (it.isLocked ? 15 : 0);
  };

  // Best copy per family
  const bestByFam = new Map();
  allWeapons.forEach(w => {
    const sc = scoreItem(w);
    const prev = bestByFam.get(w._fam);
    if (!prev || sc > prev.score) bestByFam.set(w._fam, { id: w.itemInstanceId, score: sc });
  });

  const vaultOnly = allWeapons.filter(w => w._loc === 'vault');
  return vaultOnly.map(w => {
    const vc = w.godRollCheck?.verdictCode || '';
    const famCount = familyCounts.get(w._fam) || 1;
    const isBest = bestByFam.get(w._fam)?.id === w.itemInstanceId;
    const perks = (w.activePerks && w.activePerks.length ? w.activePerks : (w.perkColumns || []).flat().filter(p => p?.selected).map(p => p.name)).slice(0, 4);
    const perkText = perks.join(' • ') || 'Standard perks';

    let tag = 'keep';
    let badge = '✓ KEEP';
    let reason = 'Unique roll in your arsenal — keep until a stronger roll drops.';

    if (w.isExotic) {
      tag = 'keep';
      badge = '✦ EXOTIC';
      reason = 'Exotic weapon — automatically protected from sharding.';
    } else if (w.isCrafted) {
      tag = 'godroll';
      badge = '🛠️ CRAFTED';
      reason = 'Shaped/Crafted weapon with custom enhanced perks — always keep.';
    } else if (['DUAL_GOD_ROLL', 'PVE_GOD_ROLL', 'PVP_GOD_ROLL'].includes(vc)) {
      tag = 'godroll';
      badge = '★ GOD ROLL';
      reason = `Matches your ${vc.replace(/_/g, ' ').toLowerCase()} target (${perkText}). Lock and keep!`;
    } else if (famCount > 1 && !isBest) {
      tag = 'trash';
      badge = '🗑️ SAFE TO SHARD';
      reason = `You own ${famCount} copies of ${w.name}; another copy has stronger perks or higher tier.`;
    } else if (famCount > 1 && isBest) {
      tag = 'duplicate';
      badge = '★ BEST COPY';
      reason = `Strongest of your ${famCount} ${w.name} copies (${perkText}). Shard the extras.`;
    } else if (vc === 'WEAK_ROLL' || vc === 'TRASH_ROLL' || (!w.isLocked && (w.godRollCheck?.inDatabase && Math.max(w.godRollCheck?.pveTraitHits || 0, w.godRollCheck?.pvpTraitHits || 0) === 0))) {
      tag = 'trash';
      badge = '🗑️ SAFE TO SHARD';
      reason = `0/2 target god-roll traits matched (${perkText}). Safe to clear Vault space.`;
    }

    return { item: w, tag, badge, reason, perkText, famCount };
  });
}

function renderSmartVaultCleaner() {
  const listEl = document.getElementById('svcList');
  const sumEl = document.getElementById('svcSummaryBar');
  if (!listEl || !sumEl) return;

  if (!getState().bungieData) {
    sumEl.textContent = 'Sign in with Bungie.net on the Inventory page first to audit your Vault.';
    listEl.innerHTML = '';
    return;
  }

  svcAuditItems = auditVaultWeapons();
  const trashCount = svcAuditItems.filter(x => x.tag === 'trash').length;
  const dupCount = svcAuditItems.filter(x => x.famCount > 1).length;
  const grCount = svcAuditItems.filter(x => x.tag === 'godroll').length;

  sumEl.innerHTML = `
    <strong>${svcAuditItems.length}</strong> Vault Weapons Scanned •
    <span class="svc-stat-trash">🗑️ ${trashCount} Safe to Shard</span> •
    <span class="svc-stat-gr">★ ${grCount} God Rolls / Crafted</span> •
    <span>⚠ ${dupCount} Duplicate Copies</span>
  `;

  const filtered = svcAuditItems.filter(x => {
    if (svcCurrentFilter === 'trash') return x.tag === 'trash';
    if (svcCurrentFilter === 'duplicate') return x.famCount > 1;
    if (svcCurrentFilter === 'godroll') return x.tag === 'godroll';
    return true;
  });

  if (!filtered.length) {
    listEl.innerHTML = `<div class="nextgen-empty">No Vault weapons in this category — your Vault is clean here!</div>`;
    return;
  }

  listEl.innerHTML = filtered.slice(0, 80).map(entry => {
    const w = entry.item;
    const icon = w.icon ? `https://www.bungie.net${w.icon}` : 'icon-192.png';
    const checked = entry.tag === 'trash' && !w.isLocked ? 'checked' : '';
    const disabled = w.isExotic || w.isCrafted ? 'disabled' : '';
    return `
      <label class="svc-row is-${entry.tag}">
        <input type="checkbox" class="svc-chk" value="${esc(w.itemInstanceId)}" ${checked} ${disabled}>
        <img src="${icon}" alt="" class="svc-icon" loading="lazy">
        <div class="svc-info">
          <div class="svc-top">
            <strong>${esc(w.name)}</strong>
            <span class="svc-badge is-${entry.tag}">${esc(entry.badge)}</span>
            ${w.isLocked ? '<span class="svc-lock">🔒</span>' : ''}
          </div>
          <div class="svc-perks">${esc(entry.perkText)}</div>
          <div class="svc-reason">❖ Ghost: ${esc(entry.reason)}</div>
        </div>
      </label>
    `;
  }).join('');
}

async function moveSelectedVaultTrash() {
  const bData = getState().bungieData;
  const headers = getBungieHeaders();
  const activeChar = getActiveChar();
  if (!bData || !headers || !activeChar) {
    toast('Sign in to Bungie.net first.', 'error');
    return;
  }
  const checkedIds = [...document.querySelectorAll('#svcList .svc-chk:checked')].map(el => el.value);
  if (!checkedIds.length) {
    toast('Select at least one weapon to move for dismantling.', 'error');
    return;
  }
  const byId = new Map(svcAuditItems.map(x => [x.item.itemInstanceId, x.item]));
  const btn = document.getElementById('btnSvcMoveTrash');
  if (btn) { btn.disabled = true; btn.textContent = '🚀 Moving to Character…'; }
  try {
    const res = await fetch('/api/bungie/dismantle-prep', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        membershipType: bData.player.membershipType,
        defaultCharacterId: activeChar.characterId,
        targetCharacterId: activeChar.characterId,
        unlockOnly: false,
        items: checkedIds.map(id => {
          const it = byId.get(id);
          return {
            itemInstanceId: it.itemInstanceId,
            itemHash: it.itemHash,
            sourceLocation: 'vault',
            sourceCharacterId: '',
            slot: it.slot || 'Kinetic',
            isLocked: Boolean(it.isLocked),
            isEquipped: false,
            name: it.name || '',
          };
        }),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Dismantle prep failed');
    toast(`Moved ${data.movedCount ?? checkedIds.length} weapons to ${activeChar.className} for fast dismantling!`, 'info');
    if (typeof window.__ghostRefreshInventory === 'function') await window.__ghostRefreshInventory(true);
    renderSmartVaultCleaner();
  } catch (err) {
    toast(`Vault Cleaner error: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Move Selected Trash to Character'; }
  }
}

// ============================================================================
// 3. LIVE ACTIVITY PREP & ANTI-CHAMPION CHECKER
// ============================================================================
let apCurrentMode = 'gm';

const CHAMP_COUNTERS = {
  barrier: {
    label: 'Anti-Barrier',
    icon: '◈',
    verbs: ['radiant', 'volatile', 'unraveling'],
    exotics: ['arbalest', 'wish-ender', 'revision zero', 'eri', 'lament', 'deterministic chaos'],
    types: ['pulse rifle', 'sidearm', 'sniper rifle', 'scout rifle', 'submachine gun'],
  },
  overload: {
    label: 'Overload',
    icon: '◉',
    verbs: ['jolt', 'suppress', 'slow'],
    exotics: ['le monarque', 'divinity', 'thunderlord', 'secant', 'tractor cannon', 'two-tailed fox'],
    types: ['auto rifle', 'submachine gun', 'hand cannon', 'sword', 'machine gun', 'rocket launcher'],
  },
  unstoppable: {
    label: 'Unstoppable',
    icon: '▲',
    verbs: ['ignition', 'blind', 'shatter', 'suspend'],
    exotics: ['leviathan', 'malfeasance', 'bastion', 'devil\'s ruin', 'dragon\'s breath', 'conditional finality'],
    types: ['hand cannon', 'fusion rifle', 'grenade launcher', 'glaive', 'shotgun', 'linear fusion'],
  },
};

function detectChampionCoverage(charObj) {
  const equippedWeapons = charObj?.equipped?.weapons || [];
  const subName = String(charObj?.subclass?.name || '').toLowerCase();
  const subElem = String(charObj?.subclass?.element || '').toLowerCase();
  const artifactPerks = (charObj?.artifact?.perks || []).map(p => String(p.name || p).toLowerCase());

  const covered = {};
  for (const [key, rule] of Object.entries(CHAMP_COUNTERS)) {
    const sources = [];
    // Check equipped exotics
    equippedWeapons.forEach(w => {
      const wn = String(w.name || '').toLowerCase();
      if (rule.exotics.some(ex => wn.includes(ex))) sources.push(`${w.name} (Intrinsic)`);
      // Check active artifact mods matching weapon type
      const wt = String(w.type || '').toLowerCase();
      const artMatch = artifactPerks.find(ap => ap.includes(key) || (ap.includes(wt) && (ap.includes('barrier') || ap.includes('overload') || ap.includes('unstop'))));
      if (artMatch) sources.push(`${w.name} (Artifact)`);
    });
    // Check subclass verbs
    if (key === 'barrier' && (subElem === 'solar' || subElem === 'void' || subElem === 'strand' || subElem === 'prismatic')) {
      sources.push(`${charObj?.subclass?.element || 'Subclass'} Verbs (Radiant/Volatile/Unravel)`);
    }
    if (key === 'overload' && (subElem === 'arc' || subElem === 'void' || subElem === 'stasis' || subElem === 'prismatic')) {
      sources.push(`${charObj?.subclass?.element || 'Subclass'} Verbs (Jolt/Suppress/Slow)`);
    }
    if (key === 'unstoppable' && (subElem === 'solar' || subElem === 'arc' || subElem === 'stasis' || subElem === 'strand' || subElem === 'prismatic')) {
      sources.push(`${charObj?.subclass?.element || 'Subclass'} Verbs (Ignite/Blind/Shatter/Suspend)`);
    }
    covered[key] = sources;
  }
  return covered;
}

function findVaultCounterWeapon(champKey) {
  const bData = getState().bungieData;
  const vaultWeapons = bData?.vault?.weapons || [];
  const rule = CHAMP_COUNTERS[champKey];
  if (!rule) return null;
  const exoticHit = vaultWeapons.find(w => rule.exotics.some(ex => String(w.name || '').toLowerCase().includes(ex)));
  if (exoticHit) return exoticHit;
  return vaultWeapons.find(w => rule.types.some(tp => String(w.type || '').toLowerCase().includes(tp))) || null;
}

async function pullWeaponToActiveChar(weapon) {
  const bData = getState().bungieData;
  const headers = getBungieHeaders();
  const activeChar = getActiveChar();
  if (!bData || !headers || !activeChar || !weapon) return;
  try {
    const res = await fetch('/api/bungie/transfer', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        membershipType: bData.player.membershipType,
        itemInstanceId: weapon.itemInstanceId,
        itemHash: weapon.itemHash,
        sourceLocation: 'vault',
        sourceCharacterId: '',
        targetType: 'character',
        targetCharacterId: activeChar.characterId,
        isEquipped: false,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Transfer failed');
    toast(`Pulled ${weapon.name} to ${activeChar.className}!`, 'info');
    if (typeof window.__ghostRefreshInventory === 'function') await window.__ghostRefreshInventory(true);
    renderActivityPrep();
  } catch (err) {
    toast(`Transfer failed: ${err.message}`, 'error');
  }
}

function renderActivityPrep() {
  const out = document.getElementById('apResults');
  if (!out) return;
  const activeChar = getActiveChar();
  if (!activeChar) {
    out.innerHTML = `<div class="nextgen-empty">Sign in with Bungie.net first to audit your live equipped loadout.</div>`;
    return;
  }

  const cov = detectChampionCoverage(activeChar);
  const stats = activeChar.stats || {};
  const healthStat = stats.Health || stats.Resilience || 0;
  const weapons = activeChar.equipped?.weapons || [];
  const heavy = weapons.find(w => w.slot === 'Heavy');

  const checks = [];
  if (apCurrentMode === 'gm' || apCurrentMode === 'dungeon') {
    ['barrier', 'overload', 'unstoppable'].forEach(k => {
      const ok = cov[k].length > 0;
      const fixWep = !ok ? findVaultCounterWeapon(k) : null;
      checks.push({
        title: `${CHAMP_COUNTERS[k].icon} ${CHAMP_COUNTERS[k].label} Coverage`,
        ok,
        detail: ok ? cov[k].slice(0, 2).join(' • ') : `No equipped ${CHAMP_COUNTERS[k].label} weapon or subclass counter detected.`,
        fixWep,
      });
    });
  }

  if (apCurrentMode === 'raid' || apCurrentMode === 'dungeon') {
    const heavyType = String(heavy?.type || '').toLowerCase();
    const goodBossDps = /rocket|linear|grenade launcher|sword|machine gun/.test(heavyType);
    checks.push({
      title: '💥 Boss DPS Heavy Slot',
      ok: Boolean(heavy && goodBossDps),
      detail: heavy ? `Equipped: ${heavy.name} (${heavy.type})` : 'No Heavy weapon equipped.',
      fixWep: null,
    });
  }

  if (apCurrentMode === 'trials') {
    checks.push({
      title: '❤️ PvP Survivability (Health / Resilience)',
      ok: healthStat >= 80,
      detail: `Current Health stat: ${healthStat} (Recommended: 80+ for Trials dueling).`,
      fixWep: null,
    });
    const pvpGodRoll = weapons.some(w => ['PVP_GOD_ROLL', 'DUAL_GOD_ROLL'].includes(w.godRollCheck?.verdictCode || ''));
    checks.push({
      title: '🎯 PvP God Roll Equipped',
      ok: pvpGodRoll,
      detail: pvpGodRoll ? 'Verified PvP God Roll active in your weapon slots.' : 'No verified PvP God Roll equipped — check your Vault or God Rolls tab.',
      fixWep: null,
    });
  } else {
    checks.push({
      title: '🛡️ Endgame Survivability',
      ok: healthStat >= 70,
      detail: `Current Health stat: ${healthStat} on ${activeChar.className} (${activeChar.subclass?.name || 'Subclass'}).`,
      fixWep: null,
    });
  }

  const missingCount = checks.filter(c => !c.ok).length;
  getState().ghostMood = missingCount >= 2 ? 'alert' : missingCount === 1 ? 'warning' : 'normal';

  out.innerHTML = `
    <div class="ap-hero-status ${missingCount === 0 ? 'is-ready' : 'is-warn'}">
      <strong>${esc(activeChar.className)} • ⚡ ${activeChar.light || 0} • ${esc(activeChar.subclass?.name || 'Subclass')}</strong>
      <span>${missingCount === 0 ? '✅ MISSION READY — All tactical checks green!' : `⚠️ ${missingCount} Readiness Gap${missingCount > 1 ? 's' : ''} Detected`}</span>
    </div>
    <div class="ap-checks-grid">
      ${checks.map((c, idx) => `
        <div class="ap-check-card ${c.ok ? 'is-ok' : 'is-gap'}">
          <div class="ap-check-head">
            <span>${esc(c.title)}</span>
            <span class="ap-check-badge">${c.ok ? 'READY' : 'GAP'}</span>
          </div>
          <div class="ap-check-detail">${esc(c.detail)}</div>
          ${c.fixWep ? `<button type="button" class="btn-tactical btn-primary btn-sm ap-fix-btn" data-fix-idx="${idx}">⚡ 1-Tap Pull: ${esc(c.fixWep.name)}</button>` : ''}
        </div>
      `).join('')}
    </div>
  `;

  out.querySelectorAll('.ap-fix-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = checks[Number(btn.getAttribute('data-fix-idx'))];
      if (c?.fixWep) pullWeaponToActiveChar(c.fixWep);
    });
  });
}

// ============================================================================
// 5. WEEKLY RESET & VENDOR GOD ROLL RADAR
// ============================================================================
let vendorCacheData = null;

async function loadVendorRadar(force = false, silentBanner = false) {
  const headers = getBungieHeaders();
  const statusEl = document.getElementById('vrStatus');
  const bodyEl = document.getElementById('vrBody');
  const bannerEl = document.getElementById('vendorAlertsBanner');

  if (!headers) {
    if (!silentBanner && statusEl) statusEl.textContent = 'Sign in with Bungie.net to scan live Tower & Xûr vendor rolls.';
    return;
  }

  if (!silentBanner && statusEl) statusEl.textContent = 'Scanning Banshee-44, Xûr, Ada-1, Zavala, Shaxx & Saint-14…';
  try {
    const activeChar = getActiveChar();
    const qs = new URLSearchParams();
    if (activeChar?.characterId) qs.set('characterId', activeChar.characterId);
    if (force) qs.set('force', 'true');
    const res = await fetch(`/api/bungie/vendors?${qs.toString()}`, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Vendor scan failed');
    vendorCacheData = data;

    // Update Inventory Home Alert Banner if highlights exist
    const hl = data.highlights || [];
    if (bannerEl) {
      if (hl.length > 0) {
        const top = hl[0];
        bannerEl.classList.remove('hidden');
        bannerEl.innerHTML = `
          <span>🏪 <strong>VENDOR RADAR:</strong> ${esc(top.vendorName)} is selling <strong>${esc(top.name)}</strong> (${esc(top.badge)}) — ${esc(top.detail)}${hl.length > 1 ? ` +${hl.length - 1} more` : ''}</span>
          <button type="button" class="btn-tactical btn-sm btn-primary" id="btnBannerOpenVendors">Inspect Vendors</button>
        `;
        document.getElementById('btnBannerOpenVendors')?.addEventListener('click', () => {
          openModal('modalVendorRadar');
          renderVendorRadar(vendorCacheData);
        });
      } else {
        bannerEl.classList.add('hidden');
      }
    }

    if (!silentBanner) renderVendorRadar(data);
  } catch (err) {
    if (!silentBanner && statusEl) statusEl.textContent = `Vendor scan unavailable: ${err.message}`;
    if (!silentBanner && bodyEl) bodyEl.innerHTML = `<div class="nextgen-empty">${esc(err.message)}</div>`;
  }
}

function renderVendorRadar(data) {
  const statusEl = document.getElementById('vrStatus');
  const bodyEl = document.getElementById('vrBody');
  if (!bodyEl || !data) return;
  const hl = data.highlights || [];
  const vendors = data.vendors || [];
  if (statusEl) {
    statusEl.textContent = `${vendors.length} live vendors scanned • ${hl.length} hot roll / high-stat alerts`;
  }

  let html = '';
  if (hl.length > 0) {
    html += `<div class="vr-highlights">
      <div class="vr-sec-title">🔥 HOT VENDOR ALERTS</div>
      ${hl.map(h => `
        <div class="vr-item-row is-hot">
          ${h.icon ? `<img src="https://www.bungie.net${h.icon}" class="svc-icon" alt="" loading="lazy">` : ''}
          <div class="svc-info">
            <div class="svc-top"><strong>${esc(h.name)}</strong> <span class="svc-badge is-godroll">${esc(h.badge)}</span></div>
            <div class="svc-perks">${esc(h.vendorName)} • ${esc(h.detail)}</div>
          </div>
        </div>
      `).join('')}
    </div>`;
  }

  vendors.forEach(v => {
    const weps = v.weapons || [];
    const arms = v.armor || [];
    if (!weps.length && !arms.length) return;
    html += `
      <div class="vr-vendor-card">
        <div class="vr-vendor-head"><strong>${esc(v.name)}</strong> <span>${esc(v.role)}</span></div>
        ${weps.slice(0, 6).map(w => `
          <div class="vr-item-row ${w.isHot ? 'is-hot' : ''}">
            ${w.icon ? `<img src="https://www.bungie.net${w.icon}" class="svc-icon" alt="" loading="lazy">` : ''}
            <div class="svc-info">
              <div class="svc-top">
                <strong>${esc(w.name)}</strong>
                ${w.isHot ? '<span class="svc-badge is-godroll">★ HOT ROLL</span>' : `<span class="svc-badge is-keep">${esc(w.slot)}</span>`}
              </div>
              <div class="svc-perks">${esc((w.perks || []).join(' • ') || w.type)}</div>
            </div>
          </div>
        `).join('')}
        ${arms.filter(a => a.isHot).slice(0, 4).map(a => `
          <div class="vr-item-row is-hot">
            ${a.icon ? `<img src="https://www.bungie.net${a.icon}" class="svc-icon" alt="" loading="lazy">` : ''}
            <div class="svc-info">
              <div class="svc-top"><strong>${esc(a.name)}</strong> <span class="svc-badge is-godroll">🔥 ${a.totalStat} TOTAL</span></div>
              <div class="svc-perks">${esc(a.slot)} • ${a.maxSpike} ${esc(a.maxSpikeLabel)} spike</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  });

  bodyEl.innerHTML = html || `<div class="nextgen-empty">No tracked vendor weapons or high-stat armor found right now.</div>`;
}

// ============================================================================
// 6. LIVE CRUCIBLE / RAID POST-GAME DEBRIEF (PGCR)
// ============================================================================
async function loadPgcrDebrief() {
  const headers = getBungieHeaders();
  const statusEl = document.getElementById('pgcrStatus');
  const bodyEl = document.getElementById('pgcrBody');
  if (!bodyEl) return;

  if (!headers) {
    if (statusEl) statusEl.textContent = 'Sign in with Bungie.net to pull your recent matches & raids.';
    bodyEl.innerHTML = '';
    return;
  }

  if (statusEl) statusEl.textContent = 'Fetching your last 5 Post-Game Carnage Reports from Bungie…';
  bodyEl.innerHTML = `<div class="nextgen-empty">Loading PGCR telemetry…</div>`;

  try {
    const activeChar = getActiveChar();
    const qs = new URLSearchParams({ count: '5' });
    if (activeChar?.characterId) qs.set('characterId', activeChar.characterId);
    const res = await fetch(`/api/bungie/pgcr?${qs.toString()}`, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'PGCR lookup failed');

    const matches = data.matches || [];
    if (statusEl) statusEl.textContent = `Showing last ${matches.length} activities for ${data.playerName || 'Guardian'}`;

    if (!matches.length) {
      bodyEl.innerHTML = `<div class="nextgen-empty">No recent Destiny 2 activities found on this character.</div>`;
      return;
    }

    bodyEl.innerHTML = matches.map((m, idx) => {
      const mins = Math.max(1, Math.round((m.durationSeconds || 0) / 60));
      const weps = (m.topWeapons || []).map(w => `${w.name} (${w.kills})`).join(' • ') || 'Ability / Super kills';
      const winClass = /victory|cleared/i.test(m.standing || '') ? 'is-win' : 'is-loss';
      return `
        <div class="pgcr-card">
          <div class="pgcr-top">
            <div>
              <strong>${esc(m.activityName)}</strong>
              <span class="pgcr-mode">${esc(m.mode)} • ${mins}m</span>
            </div>
            <span class="pgcr-standing ${winClass}">${esc(m.standing)}</span>
          </div>
          <div class="pgcr-stats-row">
            <span>⚔️ <strong>${m.kills}</strong> K</span>
            <span>💀 <strong>${m.deaths}</strong> D</span>
            <span>🤝 <strong>${m.assists}</strong> A</span>
            <span>📈 <strong>${m.kd}</strong> K/D</span>
            <span>🎯 <strong>${m.precisionPct}%</strong> Prec</span>
          </div>
          <div class="pgcr-weps">Top Weapons: ${esc(weps)}</div>
          <button type="button" class="btn-tactical btn-secondary btn-sm pgcr-review-btn" data-pgcr-idx="${idx}">
            ❖ Ask Ghost to Review This Run
          </button>
        </div>
      `;
    }).join('');

    bodyEl.querySelectorAll('.pgcr-review-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = matches[Number(btn.getAttribute('data-pgcr-idx'))];
        if (!m) return;
        const wepList = (m.topWeapons || []).map(w => `${w.name} (${w.kills} kills, ${w.precisionKills} precision)`).join(', ') || 'abilities/supers';
        const prompt = `Review my recent Destiny 2 ${m.mode} run (${m.activityName} — ${m.standing}): ${m.kills} kills, ${m.deaths} deaths, ${m.assists} assists (${m.kd} K/D), ${m.precisionPct}% precision kills, top weapons: ${wepList}. Give me a sharp tactical debrief and 2 specific loadout or mod tweaks for my next run.`;
        closeModal('modalPgcrDebrief');
        window.__ghostSendPrompt?.(prompt, true);
      });
    });
  } catch (err) {
    if (statusEl) statusEl.textContent = `PGCR error: ${err.message}`;
    bodyEl.innerHTML = `<div class="nextgen-empty">${esc(err.message)}</div>`;
  }
}

// ============================================================================
// BOOTSTRAP ALL NEXT-GEN LISTENERS
// ============================================================================
function initNextGenGhostSuite() {
  // Close buttons for all next-gen dialogs
  document.querySelectorAll('[data-close-dialog]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close-dialog')));
  });

  // 3D Ghost Shell & Eye Selectors (both Comms Drawer & Full-Screen HUD)
  syncGhostCustomizers();
  ['ghostShellSelect', 'ghostHudShellSelect'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', (e) => applyGhostShell(e.target.value));
  });
  ['ghostEyeSelect', 'ghostHudEyeSelect'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', (e) => applyGhostEye(e.target.value));
  });

  // Hands-Free Full-Screen Ghost HUD triggers
  document.getElementById('btnOpenGhostHudInv')?.addEventListener('click', openGhostHud);
  document.getElementById('btnCommsFullScreenHud')?.addEventListener('click', openGhostHud);
  document.getElementById('btnCloseGhostHud')?.addEventListener('click', closeGhostHud);
  document.getElementById('btnGhostHudMic')?.addEventListener('click', startHudMic);
  document.getElementById('btnGhostHudStop')?.addEventListener('click', () => {
    getVoice()?.stop?.();
    getSfx().playChirp();
  });
  document.getElementById('btnGhostHudLoop')?.addEventListener('click', (e) => {
    hudAutoLoop = !hudAutoLoop;
    e.currentTarget.classList.toggle('active', hudAutoLoop);
    e.currentTarget.textContent = hudAutoLoop ? '🔁 Auto-Loop: ON' : '🔁 Auto-Loop: OFF';
    getSfx().playChirp();
    if (hudAutoLoop && !hudListening) startHudMic();
  });
  document.querySelectorAll('#ghostHudQuickChips [data-hud-prompt]').forEach(chip => {
    chip.addEventListener('click', () => {
      getSfx().playChirp();
      sendHudVoicePrompt(chip.getAttribute('data-hud-prompt'));
    });
  });

  // Smart Vault Cleaner
  document.getElementById('btnOpenSmartVaultCleaner')?.addEventListener('click', () => {
    openModal('modalSmartVaultCleaner');
    renderSmartVaultCleaner();
  });
  document.querySelectorAll('#svcFilterPills [data-svc-filter]').forEach(pill => {
    pill.addEventListener('click', () => {
      svcCurrentFilter = pill.getAttribute('data-svc-filter') || 'trash';
      document.querySelectorAll('#svcFilterPills [data-svc-filter]').forEach(p => p.classList.toggle('active', p === pill));
      renderSmartVaultCleaner();
    });
  });
  document.getElementById('btnSvcSelectAllTrash')?.addEventListener('click', () => {
    document.querySelectorAll('#svcList .svc-row.is-trash .svc-chk:not(:disabled)').forEach(chk => { chk.checked = true; });
    getSfx().playChirp();
  });
  document.getElementById('btnSvcMoveTrash')?.addEventListener('click', moveSelectedVaultTrash);

  // Live Activity Prep
  document.getElementById('btnOpenActivityPrep')?.addEventListener('click', () => {
    openModal('modalActivityPrep');
    renderActivityPrep();
  });
  document.querySelectorAll('#apActivityPills [data-ap-mode]').forEach(pill => {
    pill.addEventListener('click', () => {
      apCurrentMode = pill.getAttribute('data-ap-mode') || 'gm';
      document.querySelectorAll('#apActivityPills [data-ap-mode]').forEach(p => p.classList.toggle('active', p === pill));
      renderActivityPrep();
    });
  });
  document.getElementById('btnApAskGhost')?.addEventListener('click', () => {
    const activeChar = getActiveChar();
    const modeLabel = { gm: 'Grandmaster Nightfall', raid: 'Raid Boss DPS', dungeon: 'Dungeon', trials: 'Trials of Osiris' }[apCurrentMode] || 'Endgame';
    const prompt = `Prep my ${activeChar?.className || 'Guardian'} for ${modeLabel}. Check my equipped weapons, Anti-Champion coverage, and recommend exact vault swaps or resistance mods.`;
    closeModal('modalActivityPrep');
    window.__ghostSendPrompt?.(prompt, true);
  });

  // Weekly Vendor God Roll Radar
  document.getElementById('btnOpenVendorRadar')?.addEventListener('click', () => {
    openModal('modalVendorRadar');
    if (vendorCacheData) renderVendorRadar(vendorCacheData);
    else loadVendorRadar(false, false);
  });
  document.getElementById('btnVrRefresh')?.addEventListener('click', () => loadVendorRadar(true, false));

  // Live PGCR Post-Game Debrief
  document.getElementById('btnOpenPgcrDebrief')?.addEventListener('click', () => {
    openModal('modalPgcrDebrief');
    loadPgcrDebrief();
  });
  document.getElementById('btnPgcrRefresh')?.addEventListener('click', loadPgcrDebrief);

  // Periodic background mood check + one-time silent vendor radar banner load once Bungie data arrives
  let vendorBannerFetched = false;
  setInterval(() => {
    updateAutoGhostMood();
    if (!vendorBannerFetched && getState().bungieSession?.access_token && getState().bungieData?.characters?.length) {
      vendorBannerFetched = true;
      loadVendorRadar(false, true);
    }
  }, 2500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNextGenGhostSuite);
} else {
  initNextGenGhostSuite();
}
