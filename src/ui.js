// HUD overlay + minimap + targeting reticle. Pure DOM/canvas.
import * as THREE from 'three';
import { ARENA } from './arena.js';
import { formatTime } from './match.js';

let _hud = null;
let _minimap = null;
let _ctx = null;
let _reticle = null;
let _rctx = null;

export function createHUD() {
  if (_hud) return _hud;
  _hud = document.createElement('div');
  _hud.id = 'hud';
  _hud.style.cssText = `
    position: fixed; bottom: 16px; right: 16px; z-index: 100;
    background: rgba(8,16,28,0.78); backdrop-filter: blur(8px);
    border: 1px solid rgba(120,200,255,0.18); border-radius: 14px;
    padding: 12px 14px; color: #d8eef8; width: 240px; pointer-events: none;
    font-family: 'Inter', system-ui, sans-serif; font-size: 12px;
  `;
  _hud.innerHTML = `
    <div class="stat"><span>HEALTH</span><span><b id="hpVal">100</b>%</span></div>
    <div class="bar-bg"><div id="hpBar" class="bar-fill health-fill" style="width:100%"></div></div>
    <div class="stat"><span>BOOST</span><span><b id="boostVal">100</b>%</span></div>
    <div class="bar-bg"><div id="boostBar" class="bar-fill boost-fill" style="width:100%"></div></div>
    <div class="stat"><span>OVERHEAT</span><span><b id="heatVal">0</b>%</span></div>
    <div class="bar-bg"><div id="heatBar" class="bar-fill heat-fill" style="width:0%"></div></div>
    <div class="stat"><span>MISSILE</span><span id="missileLabel">READY</span></div>
    <div class="bar-bg"><div id="missileBar" class="bar-fill" style="width:100%;background:linear-gradient(90deg,#ff8866,#ffaa44);"></div></div>
    <div class="stat" style="margin-top:6px;"><span>FLARES</span><span><b id="flareVal">5</b>/<b id="flareMax">5</b></span></div>
    <div class="missile-icons" id="flareIcons"></div>
    <div class="stat" style="margin-top:8px;"><span>SPEED</span><span><b id="speedVal">0</b> m/s</span></div>
    <div class="stat"><span>SCORE</span><span><b id="scoreVal">0</b></span></div>
  `;
  document.body.appendChild(_hud);

  // Minimap
  _minimap = document.createElement('canvas');
  _minimap.width = 180; _minimap.height = 180;
  _minimap.style.cssText = `
    position: fixed; top: 16px; right: 16px; z-index: 100;
    border: 1px solid rgba(120,200,255,0.25); border-radius: 50%;
    background: rgba(6,12,22,0.85); pointer-events: none;
  `;
  document.body.appendChild(_minimap);
  _ctx = _minimap.getContext('2d');

  // Top-left status banner
  const banner = document.createElement('div');
  banner.id = 'banner';
  banner.style.cssText = `
    position: fixed; top: 16px; left: 16px; z-index: 100;
    background: rgba(8,16,28,0.78); backdrop-filter: blur(8px);
    border-left: 3px solid #4cf; color: #cfe; padding: 8px 14px;
    border-radius: 6px; font-family: monospace; font-size: 12px;
    letter-spacing: 0.08em;
  `;
  banner.textContent = 'WASD/arrows · Space boost · E fire · Q missile · W×2 loop · A×2/D×2 dodge · S×2 flares';
  document.body.appendChild(banner);

  // Reticle / lock overlay (full-screen canvas)
  _reticle = document.createElement('canvas');
  _reticle.style.cssText = `
    position: fixed; inset: 0; z-index: 90; pointer-events: none;
  `;
  _resizeReticle();
  document.body.appendChild(_reticle);
  _rctx = _reticle.getContext('2d');
  window.addEventListener('resize', _resizeReticle);

  // Out-of-bounds warning overlay
  const oob = document.createElement('div');
  oob.id = 'oob-overlay';
  oob.style.cssText = `
    position: fixed; inset: 0; z-index: 350; display: none;
    flex-direction: column; align-items: center; justify-content: flex-start;
    padding-top: 18vh; pointer-events: none; color: #ff5555;
    font-family: monospace; letter-spacing: 0.3em;
    background: radial-gradient(circle at center, transparent 30%, rgba(255,40,40,0.25) 80%);
  `;
  oob.innerHTML = `
    <div style="font-size:18px;animation: pulse 0.8s ease-in-out infinite alternate;">RETURN TO COMBAT AREA</div>
    <div id="oobCount" style="font-size:64px;font-weight:200;margin-top:6px;line-height:1;">10</div>
    <style>@keyframes pulse { from { opacity: 0.55; } to { opacity: 1; } }</style>
  `;
  document.body.appendChild(oob);

  // Death overlay
  const death = document.createElement('div');
  death.id = 'death-overlay';
  death.style.cssText = `
    position: fixed; inset: 0; z-index: 400; display: none;
    flex-direction: column; align-items: center; justify-content: center;
    pointer-events: none; background: rgba(20,4,4,0.35); color: #ffaaaa;
    font-family: monospace; letter-spacing: 0.3em;
  `;
  death.innerHTML = `
    <div style="font-size:22px;margin-bottom:8px;">DOWN</div>
    <div style="font-size:64px;font-weight:300;color:#ff6868;" id="respawnCount">4</div>
    <div style="font-size:11px;opacity:0.7;margin-top:4px;">RESPAWNING</div>
  `;
  document.body.appendChild(death);

  // Match scoreboard (top center): timer + per-team kills
  const score = document.createElement('div');
  score.id = 'match-score';
  score.style.cssText = `
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    z-index: 100; display: flex; gap: 18px; align-items: center;
    background: rgba(8,16,28,0.78); backdrop-filter: blur(8px);
    border: 1px solid rgba(120,200,255,0.18); border-radius: 12px;
    padding: 10px 18px; color: #d8eef8; font-family: 'Inter', system-ui, sans-serif;
    font-size: 14px; pointer-events: none;
  `;
  score.innerHTML = `
    <span style="color:#ff7b6e;font-weight:600;">RED <b id="redScore">0</b></span>
    <span style="opacity:0.4;">/</span>
    <span style="font-family:monospace;font-size:18px;letter-spacing:0.1em;" id="matchTimer">5:00</span>
    <span style="opacity:0.4;">/</span>
    <span style="color:#4caaff;font-weight:600;"><b id="blueScore">0</b> BLUE</span>
    <span style="opacity:0.5;font-size:11px;margin-left:6px;" id="killGoal">→ 15</span>
  `;
  document.body.appendChild(score);

  // Class-select / intro overlay
  const intro = document.createElement('div');
  intro.id = 'intro-overlay';
  intro.style.cssText = `
    position: fixed; inset: 0; z-index: 700; display: none;
    align-items: center; justify-content: center;
    background: rgba(6,12,22,0.92); backdrop-filter: blur(10px);
    color: #d8eef8; font-family: 'Inter', system-ui, sans-serif;
  `;
  intro.innerHTML = `
    <div style="text-align:center;max-width:820px;width:90%;">
      <div style="font-size:42px;font-weight:700;letter-spacing:0.18em;margin-bottom:6px;">DOGFIGHTER</div>
      <div style="opacity:0.55;font-family:monospace;letter-spacing:0.2em;margin-bottom:24px;">PILOT BRIEFING</div>

      <div style="display:flex;gap:6px;justify-content:center;margin-bottom:22px;">
        <button class="mode-tab active" data-mode="solo">SOLO</button>
        <button class="mode-tab" data-mode="mp">MULTIPLAYER</button>
      </div>

      <div id="lobbyPanel" style="display:none;margin-bottom:22px;">
        <div style="display:flex;gap:8px;justify-content:center;margin-bottom:12px;">
          <input id="playerName" placeholder="Pilot name" maxlength="20"
                 style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#d8eef8;padding:8px 14px;border-radius:6px;font-family:inherit;width:200px;text-align:center;">
        </div>
        <div style="display:flex;gap:14px;justify-content:center;align-items:flex-start;">
          <div style="flex:0 0 320px;">
            <div style="display:flex;gap:6px;margin-bottom:8px;">
              <input id="roomName" placeholder="Room name" maxlength="32"
                     style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#d8eef8;padding:8px 12px;border-radius:6px;font-family:inherit;font-size:12px;">
              <select id="roomMode"
                      style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#d8eef8;padding:8px;border-radius:6px;font-family:inherit;font-size:11px;cursor:pointer;">
                <option value="ffa">FFA</option>
                <option value="team2v2">2v2</option>
              </select>
              <button id="createRoomBtn" class="btn-secondary">CREATE</button>
            </div>
            <div id="roomList" style="background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.08);border-radius:6px;min-height:140px;max-height:200px;overflow:auto;padding:6px;text-align:left;font-size:12px;font-family:monospace;"></div>
          </div>
          <div style="flex:1;text-align:left;">
            <div id="lobbyStatus" style="font-family:monospace;font-size:11px;opacity:0.7;letter-spacing:0.05em;line-height:1.5;padding-top:4px;margin-bottom:10px;">
              CONNECTING...
            </div>
            <div id="lobbyRoster" style="display:none;">
              <div style="font-family:monospace;font-size:10px;opacity:0.5;letter-spacing:0.18em;margin-bottom:6px;">PILOTS IN ROOM</div>
              <div id="rosterList" style="background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px;font-size:12px;font-family:monospace;min-height:80px;"></div>
            </div>
          </div>
        </div>
      </div>

      <div style="margin-bottom:14px;display:flex;gap:8px;justify-content:center;align-items:center;font-family:monospace;font-size:11px;letter-spacing:0.18em;opacity:0.7;">
        MAP:
        <select id="mapSelect" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#d8eef8;padding:6px 10px;border-radius:6px;font-family:inherit;font-size:11px;letter-spacing:0.1em;cursor:pointer;">
          <option value="desert">DESERT</option>
          <option value="mountains" disabled>MOUNTAINS (decimate first)</option>
        </select>
      </div>
      <div id="classGrid" style="display:flex;gap:14px;justify-content:center;margin-bottom:24px;"></div>
      <button id="launchBtn" style="
        background:#4cf;color:#06121f;border:0;padding:14px 40px;
        border-radius:8px;font-size:14px;letter-spacing:0.2em;font-weight:700;
        cursor:pointer;font-family:inherit;
      ">LAUNCH MATCH</button>
      <div style="opacity:0.45;font-size:11px;margin-top:18px;font-family:monospace;letter-spacing:0.15em;line-height:1.6;">
        WASD/ARROWS · SPACE BOOST · E FIRE · Q MISSILE<br>
        W×2 LOOP · A×2/D×2 DODGE · S×2 FLARES · HOLD S TO LOOP
      </div>
    </div>
    <style>
      .mode-tab {
        background: rgba(255,255,255,0.04); color: #d8eef8;
        border: 1px solid rgba(255,255,255,0.12); padding: 8px 22px;
        border-radius: 6px; font-family: inherit; font-size: 12px;
        letter-spacing: 0.18em; font-weight: 600; cursor: pointer;
        transition: all 0.12s;
      }
      .mode-tab.active { background: #4cf; color: #06121f; border-color: #4cf; }
      .btn-secondary {
        background: rgba(255,255,255,0.08); color: #d8eef8;
        border: 1px solid rgba(255,255,255,0.12); padding: 8px 14px;
        border-radius: 6px; font-family: inherit; font-size: 11px;
        letter-spacing: 0.15em; font-weight: 600; cursor: pointer;
      }
      .btn-secondary:hover { background: rgba(76,200,255,0.15); }
      .room-row {
        display: flex; justify-content: space-between; align-items: center;
        padding: 6px 8px; border-radius: 4px; cursor: pointer;
        transition: background 0.1s;
      }
      .room-row:hover { background: rgba(76,200,255,0.12); }
      .room-row.full { opacity: 0.4; cursor: not-allowed; }
    </style>
  `;
  document.body.appendChild(intro);

  // Countdown overlay (3-2-1 before MP match start)
  const countdown = document.createElement('div');
  countdown.id = 'countdown-overlay';
  countdown.style.cssText = `
    position: fixed; inset: 0; z-index: 800; display: none;
    align-items: center; justify-content: center;
    background: rgba(6,12,22,0.85); backdrop-filter: blur(10px);
    color: #d8eef8; font-family: 'Inter', system-ui, sans-serif;
  `;
  countdown.innerHTML = `
    <div style="text-align:center;">
      <div style="font-size:14px;letter-spacing:0.3em;opacity:0.5;margin-bottom:14px;">MATCH STARTING</div>
      <div id="countdownNum" style="font-size:140px;font-weight:200;color:#4cf;line-height:1;">3</div>
    </div>
  `;
  document.body.appendChild(countdown);

  // End-of-match overlay
  const end = document.createElement('div');
  end.id = 'end-overlay';
  end.style.cssText = `
    position: fixed; inset: 0; z-index: 600; display: none;
    align-items: center; justify-content: center;
    background: rgba(6,12,22,0.85); backdrop-filter: blur(10px);
    color: #d8eef8; font-family: 'Inter', system-ui, sans-serif;
  `;
  end.innerHTML = `
    <div style="text-align:center;max-width:480px;">
      <div id="endTitle" style="font-size:48px;font-weight:700;letter-spacing:0.2em;margin-bottom:8px;">VICTORY</div>
      <div id="endReason" style="opacity:0.65;font-family:monospace;letter-spacing:0.15em;margin-bottom:24px;">REACHED KILL GOAL</div>
      <div id="endScore" style="display:flex;justify-content:center;gap:32px;font-size:20px;margin-bottom:32px;">
        <div><div style="color:#ff7b6e;font-size:12px;letter-spacing:0.2em;">RED</div><div id="endRed">0</div></div>
        <div><div style="color:#4caaff;font-size:12px;letter-spacing:0.2em;">BLUE</div><div id="endBlue">0</div></div>
      </div>
      <button id="restartBtn" style="
        background:#4cf;color:#06121f;border:0;padding:12px 32px;
        border-radius:8px;font-size:14px;letter-spacing:0.2em;font-weight:700;
        cursor:pointer;font-family:inherit;
      ">PLAY AGAIN</button>
    </div>
  `;
  document.body.appendChild(end);

  return _hud;
}

export function updateMatchHUD(match) {
  const scoreEl = document.getElementById('match-score');
  const endEl   = document.getElementById('end-overlay');
  if (!scoreEl || !endEl) return;

  if (match.state === 'playing') {
    scoreEl.style.display = 'flex';
    endEl.style.display = 'none';
    if (match.mode.teamBased) {
      document.getElementById('redScore').textContent = match.kills.red;
      document.getElementById('blueScore').textContent = match.kills.blue;
    } else {
      // FFA: show top score on red side, dash on blue
      document.getElementById('redScore').textContent = match.topScore ?? 0;
      document.getElementById('blueScore').textContent = '—';
    }
    document.getElementById('matchTimer').textContent = formatTime(match.timeRemainingSec);
    document.getElementById('killGoal').textContent = '→ ' + match.mode.killGoal;
  } else if (match.state === 'ended') {
    scoreEl.style.display = 'none';
    endEl.style.display = 'flex';
    const title = document.getElementById('endTitle');
    if (match.winner === 'draw') {
      title.textContent = 'DRAW';
      title.style.color = '#d8eef8';
    } else if (match.mode.teamBased) {
      title.textContent = match.winner === 'red' ? 'RED WINS' : 'BLUE WINS';
      title.style.color = match.winner === 'red' ? '#ff7b6e' : '#4caaff';
    } else {
      // FFA: winner is a player id; use the leader's name if available.
      const name = match.topPlayer?.name || match.topPlayer?.id?.slice(0, 6) || 'PILOT';
      title.textContent = name.toUpperCase() + ' WINS';
      title.style.color = '#a8ffb8';
    }
    document.getElementById('endReason').textContent =
      match.winReason === 'killGoal' ? 'REACHED KILL GOAL' :
      match.winReason === 'timeout'  ? 'TIME EXPIRED'      : '—';
    if (match.mode.teamBased) {
      document.getElementById('endRed').textContent  = match.kills.red;
      document.getElementById('endBlue').textContent = match.kills.blue;
    } else {
      document.getElementById('endRed').textContent  = match.topScore ?? 0;
      document.getElementById('endBlue').textContent = '—';
    }
  } else {
    scoreEl.style.display = 'none';
    endEl.style.display = 'none';
  }
}

export function onRestartClick(handler) {
  const btn = document.getElementById('restartBtn');
  if (btn) btn.onclick = handler;
}

/**
 * Render the class-select grid + lobby and resolve when the player clicks
 * LAUNCH. The optional `network` argument enables the MULTIPLAYER tab.
 *
 * Resolves with: { plane, mode: 'solo' | 'mp', roomId? }
 */
export function showClassSelect(classes, network = null) {
  const overlay = document.getElementById('intro-overlay');
  const grid = document.getElementById('classGrid');
  const launch = document.getElementById('launchBtn');
  if (!overlay) return Promise.resolve({ plane: classes[0].key, mode: 'solo' });

  let selected = classes[0].key;
  let mode = 'solo';
  let joinedRoomId = null;
  let joinedMode = 'ffa';
  let roomList = [];

  /* ----------------------- mode tabs --------------------------- */
  const lobbyPanel = document.getElementById('lobbyPanel');
  const tabs = overlay.querySelectorAll('.mode-tab');
  tabs.forEach((t) => {
    t.onclick = () => {
      mode = t.dataset.mode;
      tabs.forEach((x) => x.classList.toggle('active', x === t));
      lobbyPanel.style.display = (mode === 'mp') ? 'block' : 'none';
      if (mode === 'mp') initLobby();
    };
  });

  /* ----------------------- lobby setup ------------------------- */
  let lobbyInited = false;
  let unsubs = [];     // network listener cleanup handles
  function initLobby() {
    if (lobbyInited || !network) return;
    lobbyInited = true;
    const status = document.getElementById('lobbyStatus');
    network.connect();
    if (network.connected) onConnected(); else network.on('connected', onConnected);

    function onConnected() {
      status.innerHTML = 'CONNECTED.<br>SELECT A ROOM OR CREATE ONE.';
      network.listRooms().then((rooms) => { roomList = rooms; renderRoomList(); });
    }
    unsubs.push(network.on('roomList', (rooms) => {
      roomList = rooms;
      renderRoomList();
    }));
    // Roster is owned by the network module — we just re-render on changes.
    unsubs.push(network.on('playerJoined', () => { if (joinedRoomId) renderRoster(); }));
    unsubs.push(network.on('playerLeft',   () => { if (joinedRoomId) renderRoster(); }));

    document.getElementById('createRoomBtn').onclick = async () => {
      const name = document.getElementById('roomName').value.trim() || 'New Room';
      const playerName = document.getElementById('playerName').value.trim() || 'Pilot';
      const roomMode = document.getElementById('roomMode').value || 'ffa';
      try {
        const res = await network.createRoom({ name, mode: roomMode, playerName, plane: selected });
        joinedRoomId = res.roomId;
        joinedMode = roomMode;
        status.innerHTML = `IN ROOM <b>${escapeHtml(name)}</b> (${roomMode === 'ffa' ? 'FREE-FOR-ALL' : '2V2 TEAMS'})<br>YOU ARE THE HOST.`;
        renderRoster();
      } catch (err) {
        status.innerHTML = `<span style="color:#ff8a8a;">CREATE FAILED: ${escapeHtml(err.message)}</span>`;
      }
    };
  }

  function renderRoster() {
    const panel = document.getElementById('lobbyRoster');
    const list = document.getElementById('rosterList');
    if (!panel || !list || !network) return;
    const roster = network.roster;
    panel.style.display = roster.length ? 'block' : 'none';
    // Host = first player in JOIN ORDER (room creator). On host departure,
    // the next player in line becomes host automatically.
    const hostId = network.getHost()?.id || null;
    const youAreHost = network.isHost();
    list.innerHTML = roster.map((p) => {
      const isYou = p.id === network.you?.id;
      const teamColor = p.team === 'red' || p.team === 'blue'
        ? (p.team === 'blue' ? '#4caaff' : '#ff7b6e')
        : '#aaa';
      const hostBadge = p.id === hostId
        ? `<span style="background:#4cf;color:#06121f;padding:1px 6px;border-radius:3px;font-size:9px;letter-spacing:0.15em;margin-left:6px;">HOST</span>`
        : '';
      const youBadge = isYou
        ? `<span style="opacity:0.5;margin-left:6px;font-size:10px;">(you)</span>` : '';
      return `<div style="display:flex;align-items:center;padding:4px 6px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${teamColor};margin-right:8px;"></span>
        <span>${escapeHtml(p.name || 'Pilot')}</span>${youBadge}${hostBadge}
        <span style="margin-left:auto;opacity:0.5;font-size:10px;">${escapeHtml(p.plane || '')}</span>
      </div>`;
    }).join('');
    // Update LAUNCH button visibility.
    const launchBtn = document.getElementById('launchBtn');
    if (launchBtn) {
      if (mode === 'mp' && !youAreHost) {
        launchBtn.textContent = 'WAITING FOR HOST…';
        launchBtn.disabled = true;
        launchBtn.style.opacity = '0.5';
        launchBtn.style.cursor = 'default';
      } else {
        launchBtn.textContent = 'LAUNCH MATCH';
        launchBtn.disabled = false;
        launchBtn.style.opacity = '1';
        launchBtn.style.cursor = 'pointer';
      }
    }
  }

  function renderRoomList() {
    const el = document.getElementById('roomList');
    if (!el) return;
    if (roomList.length === 0) {
      el.innerHTML = `<div style="opacity:0.4;text-align:center;padding:24px 8px;">NO ROOMS YET</div>`;
      return;
    }
    el.innerHTML = '';
    for (const r of roomList) {
      const row = document.createElement('div');
      row.className = 'room-row' + (r.players >= r.maxPlayers ? ' full' : '');
      row.innerHTML = `<span>${escapeHtml(r.name)}</span><span style="opacity:0.6;">${r.players}/${r.maxPlayers}</span>`;
      row.onclick = async () => {
        if (joinedRoomId) return;                 // already in a room — ignore further clicks
        if (r.players >= r.maxPlayers) return;
        const playerName = document.getElementById('playerName').value.trim() || 'Pilot';
        try {
          await network.joinRoom({ roomId: r.id, playerName, plane: selected });
          joinedRoomId = r.id;
          joinedMode = r.mode || 'ffa';
          document.getElementById('lobbyStatus').innerHTML =
            `IN ROOM <b>${escapeHtml(r.name)}</b> (${joinedMode === 'ffa' ? 'FFA' : '2V2'})<br>WAITING FOR HOST TO LAUNCH.`;
          renderRoster();
        } catch (err) {
          document.getElementById('lobbyStatus').innerHTML =
            `<span style="color:#ff8a8a;">JOIN FAILED: ${escapeHtml(err.message)}</span>`;
        }
      };
      el.appendChild(row);
    }
  }

  /* ----------------------- class cards ------------------------- */
  function renderCards() {
    grid.innerHTML = '';
    for (const c of classes) {
      const card = document.createElement('div');
      const isActive = c.key === selected;
      card.style.cssText = `
        flex: 1; max-width: 220px; cursor: pointer; text-align: left;
        background: ${isActive ? 'rgba(76,200,255,0.12)' : 'rgba(255,255,255,0.04)'};
        border: 1px solid ${isActive ? '#4cf' : 'rgba(255,255,255,0.1)'};
        border-radius: 12px; padding: 16px; transition: all 0.12s;
      `;
      card.innerHTML = `
        <div style="color:${c.color};font-size:13px;letter-spacing:0.2em;font-weight:700;">${c.label.toUpperCase()}</div>
        <div style="opacity:0.55;font-size:11px;font-family:monospace;margin-bottom:14px;">${c.tagline}</div>
        ${statBar('HP',       c.stats.hp)}
        ${statBar('SPEED',    c.stats.speed)}
        ${statBar('AGILITY',  c.stats.agility)}
        ${statBar('MISSILES', c.stats.payload)}
      `;
      card.onclick = () => { selected = c.key; renderCards(); };
      grid.appendChild(card);
    }
  }

  function statBar(label, value) {
    const pct = Math.round(value * 100);
    return `
      <div style="display:flex;justify-content:space-between;font-size:10px;margin-top:6px;opacity:0.7;letter-spacing:0.1em;">
        <span>${label}</span><span>${pct}</span>
      </div>
      <div style="background:rgba(255,255,255,0.08);height:4px;border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:#4cf;"></div>
      </div>
    `;
  }

  renderCards();
  overlay.style.display = 'flex';

  return new Promise((resolve) => {
    function finishLaunch() {
      for (const u of unsubs) try { u(); } catch (_) {}
      unsubs = [];
      overlay.style.display = 'none';
      const mapSel = document.getElementById('mapSelect');
      const map = mapSel ? mapSel.value : 'desert';
      resolve({ plane: selected, mode, roomId: joinedRoomId, matchMode: joinedMode, map });
    }

    function runCountdown(seconds, onDone) {
      const cd = document.getElementById('countdown-overlay');
      const num = document.getElementById('countdownNum');
      if (!cd || !num) { onDone(); return; }
      cd.style.display = 'flex';
      let n = seconds;
      num.textContent = n;
      const tick = () => {
        n -= 1;
        if (n <= 0) {
          cd.style.display = 'none';
          onDone();
        } else {
          num.textContent = n;
          setTimeout(tick, 1000);
        }
      };
      setTimeout(tick, 1000);
    }

    // Anyone in the room (host or not) waits for the match-start event.
    if (network) {
      unsubs.push(network.on('remoteEvent', (_id, event) => {
        if (event?.type === 'match-start' && joinedRoomId) {
          overlay.style.display = 'none';
          runCountdown(event.seconds || 3, finishLaunch);
        }
      }));
    }

    launch.onclick = () => {
      if (mode === 'solo') {
        overlay.style.display = 'none';
        const mapSel = document.getElementById('mapSelect');
        const map = mapSel ? mapSel.value : 'desert';
        resolve({ plane: selected, mode, roomId: null, matchMode: 'ffa', map });
        return;
      }
      if (!joinedRoomId) {
        document.getElementById('lobbyStatus').innerHTML =
          '<span style="color:#ff8a8a;">JOIN OR CREATE A ROOM FIRST.</span>';
        return;
      }
      if (!network.isHost()) return; // disabled state already prevents this, but be safe
      // Broadcast countdown to everyone in the room (including ourselves via
      // the listener path; the host also runs the countdown locally below).
      network.sendEvent({ type: 'match-start', seconds: 3 });
      overlay.style.display = 'none';
      runCountdown(3, finishLaunch);
    };
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function updateHUD(plane) {
  if (!_hud || !plane) return;

  const hpPct = (plane.HP / plane.maxHP) * 100;
  const boostPct = (plane.boost / plane.maxBoost) * 100;
  const heatPct = plane.heat;

  document.getElementById('hpVal').textContent = Math.round(hpPct);
  document.getElementById('hpBar').style.width = hpPct + '%';
  document.getElementById('boostVal').textContent = Math.round(boostPct);
  document.getElementById('boostBar').style.width = boostPct + '%';
  document.getElementById('heatVal').textContent = Math.round(heatPct);
  document.getElementById('heatBar').style.width = heatPct + '%';
  document.getElementById('flareVal').textContent = plane.flares;
  document.getElementById('flareMax').textContent = plane.maxFlares;
  document.getElementById('speedVal').textContent = Math.round(plane.speed);
  document.getElementById('scoreVal').textContent = plane.score;

  // Missile reload bar — fills from 0 → 100% over plane.missileReloadSec.
  const reloadFrac = plane.missileReloadSec > 0
    ? 1 - Math.min(1, plane.missileCD / plane.missileReloadSec)
    : 1;
  const missileBar = document.getElementById('missileBar');
  const missileLabel = document.getElementById('missileLabel');
  if (missileBar) missileBar.style.width = (reloadFrac * 100) + '%';
  if (missileLabel) {
    missileLabel.textContent = plane.missileCD > 0
      ? Math.ceil(plane.missileCD) + 's'
      : 'READY';
    missileLabel.style.color = plane.missileCD > 0 ? '#888' : '#a8ffb8';
  }

  // Flare dots
  const flareIcons = document.getElementById('flareIcons');
  if (flareIcons.childElementCount !== plane.maxFlares) {
    flareIcons.innerHTML = '';
    for (let i = 0; i < plane.maxFlares; i++) {
      const d = document.createElement('div');
      d.className = 'missile';
      d.textContent = '✦';
      d.style.color = '#ffe066';
      flareIcons.appendChild(d);
    }
  }
  for (let i = 0; i < flareIcons.childElementCount; i++) {
    flareIcons.children[i].classList.toggle('ready', i < plane.flares);
  }

  // Death overlay + respawn countdown
  const death = document.getElementById('death-overlay');
  death.style.display = plane.alive ? 'none' : 'flex';
  if (!plane.alive) {
    const counter = document.getElementById('respawnCount');
    if (counter) counter.textContent = Math.max(0, Math.ceil(plane.respawnTimer));
  }

  // Out-of-bounds warning + countdown
  const oobEl = document.getElementById('oob-overlay');
  if (oobEl) {
    if (plane._oob && plane.alive) {
      oobEl.style.display = 'flex';
      const cn = document.getElementById('oobCount');
      if (cn) cn.textContent = Math.max(0, Math.ceil(plane._oobTimer ?? 0));
    } else {
      oobEl.style.display = 'none';
    }
  }
}

export function updateMinimap(player, others) {
  if (!_ctx) return;
  const w = _minimap.width, h = _minimap.height;
  _ctx.clearRect(0, 0, w, h);

  // Subtle grid
  _ctx.strokeStyle = 'rgba(120,200,255,0.12)';
  _ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    _ctx.beginPath();
    _ctx.moveTo((i / 4) * w, 0); _ctx.lineTo((i / 4) * w, h);
    _ctx.moveTo(0, (i / 4) * h); _ctx.lineTo(w, (i / 4) * h);
    _ctx.stroke();
  }

  const project = (x, z) => ({
    px: ((x + ARENA.width / 2) / ARENA.width) * w,
    py: ((z + ARENA.depth / 2) / ARENA.depth) * h,
  });

  // Player position used for distance calculations.
  const pp = player && player.alive ? player.body.translation() : null;

  for (const p of others) {
    if (!p.alive) continue;
    const t = p.body.translation();
    const { px, py } = project(t.x, t.z);
    let color;
    if (p.team === 'ufo' || p.isUfo) color = '#44ff77';            // UFO = green
    else if (player && p.team === player.team) color = '#4caaff';  // friendly
    else color = '#ff7b6e';                                         // enemy
    const size = (p.team === 'ufo' || p.isUfo) ? 7 : 4.5;
    drawHeadingTriangle(_ctx, px, py, headingOf(p), size, color);

    // Distance label (3D distance, formatted compactly). Number naturally
    // gets smaller as the target approaches.
    if (pp) {
      const dx = t.x - pp.x, dy = t.y - pp.y, dz = t.z - pp.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const label = dist < 1000 ? `${Math.round(dist)}m` : `${(dist / 1000).toFixed(1)}k`;
      _ctx.font = 'bold 9px monospace';
      _ctx.fillStyle = color;
      _ctx.textAlign = 'center';
      _ctx.shadowColor = 'rgba(0,0,0,0.85)';
      _ctx.shadowBlur = 2;
      _ctx.fillText(label, px, py + 14);
      _ctx.shadowBlur = 0;
    }
  }
  if (player && player.alive) {
    const t = player.body.translation();
    const { px, py } = project(t.x, t.z);
    drawHeadingTriangle(_ctx, px, py, headingOf(player), 6, '#a8ffb8', '#ffffff');
  }
}

/** Derive a 2D top-down heading angle from a plane's body rotation. */
const _headingQ = new THREE.Quaternion();
const _headingF = new THREE.Vector3();
function headingOf(plane) {
  const r = plane.body.rotation();
  _headingQ.set(r.x, r.y, r.z, r.w);
  _headingF.set(0, 0, -1).applyQuaternion(_headingQ);
  return Math.atan2(-_headingF.x, -_headingF.z);
}

/**
 * Draw a triangle at (x,y) with its tip pointing in the plane's heading
 * direction. Heading 0 = facing -Z (up on the top-down minimap).
 */
function drawHeadingTriangle(ctx, x, y, headingRad, size, color, outline = null) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-headingRad);  // canvas rotation is opposite of math heading
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);             // tip (up)
  ctx.lineTo(-size * 0.65, size * 0.55);
  ctx.lineTo( size * 0.65, size * 0.55);
  ctx.closePath();
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

function _resizeReticle() {
  if (!_reticle) return;
  _reticle.width = window.innerWidth;
  _reticle.height = window.innerHeight;
}

const _projVec = new THREE.Vector3();
function _project(pos, camera) {
  _projVec.copy(pos).project(camera);
  return {
    x: (_projVec.x * 0.5 + 0.5) * window.innerWidth,
    y: (-_projVec.y * 0.5 + 0.5) * window.innerHeight,
    visible: _projVec.z < 1 && _projVec.z > -1,
  };
}

const _noseTmp = new THREE.Vector3();
const _qTmp = new THREE.Quaternion();
const _fwdTmp = new THREE.Vector3();
/**
 * Draw the targeting overlay + enemy health bars.
 * @param {THREE.Camera} camera
 * @param {Object} player
 * @param {Array}  enemies  - all enemy planes (for floating health bars)
 * @param {Object|null} softLock     - gun aim-assist target (yellow bracket)
 * @param {Object|null} missileLock  - missile lock target (red bracket)
 * @param {number}      lockConfidence - 0..1 from weapon state
 */
export function updateReticle(camera, player, enemies, softLock, missileLock, lockConfidence = 0, incomingMissiles = []) {
  if (!_rctx) return;
  _rctx.clearRect(0, 0, _reticle.width, _reticle.height);
  if (!player || !player.alive) return;

  // 1) Floating health bars above each living enemy.
  const camPos = camera.position;
  for (const e of enemies) {
    if (!e.alive) continue;
    const ep = e.body.translation();
    const dx = ep.x - camPos.x, dy = ep.y - camPos.y, dz = ep.z - camPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > 1500) continue;
    // Lift bar a bit above the plane based on its size.
    const lift = (e.stats?.colliderHalf?.y ?? 0.5) + 3.0;
    const above = _noseTmp.set(ep.x, ep.y + lift, ep.z);
    const proj = _project(above, camera);
    if (!proj.visible) continue;
    drawHealthBar(_rctx, proj.x, proj.y, e.HP / e.maxHP, e.team, dist);
  }

  // 2) Center crosshair = projection of "where the nose points" 80m ahead.
  const r = player.body.rotation();
  _qTmp.set(r.x, r.y, r.z, r.w);
  _fwdTmp.set(0, 0, -1).applyQuaternion(_qTmp);
  const t = player.body.translation();
  _noseTmp.set(t.x + _fwdTmp.x * 80, t.y + _fwdTmp.y * 80, t.z + _fwdTmp.z * 80);
  const nose = _project(_noseTmp, camera);
  if (nose.visible) drawCrosshair(_rctx, nose.x, nose.y, '#a8ffb8');

  // 3) Soft-lock bracket (gun aim assist target). Color and ring fill
  //    reflect lock confidence so the player can see when assist is maxed.
  if (softLock && softLock.alive) {
    const sp = softLock.body.translation();
    const proj = _project(_noseTmp.set(sp.x, sp.y, sp.z), camera);
    if (proj.visible) {
      const c = THREE.MathUtils.clamp(lockConfidence, 0, 1);
      const color = c < 0.5
        ? `rgb(255, ${Math.round(224 - c * 200)}, ${Math.round(102 - c * 200)})`
        : `rgb(255, ${Math.round(124 - (c - 0.5) * 200)}, ${Math.round(0)})`;
      const size = 22 + c * 6;
      drawBracket(_rctx, proj.x, proj.y, size, color);
      _rctx.strokeStyle = color;
      _rctx.lineWidth = 2;
      _rctx.beginPath();
      _rctx.arc(proj.x, proj.y, size + 6, -Math.PI / 2, -Math.PI / 2 + c * Math.PI * 2);
      _rctx.stroke();
      if (c >= 0.999) {
        _rctx.font = 'bold 10px monospace';
        _rctx.fillStyle = color;
        _rctx.textAlign = 'center';
        _rctx.fillText('LOCKED', proj.x, proj.y - size - 12);
      }

      // Lead reticle — small yellow diamond at the target's predicted future
      // position. Helps the player aim manually and shows missile lead.
      const sv = softLock.body.linvel();
      const pp = player.body.translation();
      const dx = sp.x - pp.x, dy = sp.y - pp.y, dz = sp.z - pp.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const APPARENT_BULLET_SPEED = 500; // m/s — visual lead time only
      const leadTime = THREE.MathUtils.clamp(dist / APPARENT_BULLET_SPEED, 0.05, 1.0);
      const leadPos = _noseTmp.set(
        sp.x + sv.x * leadTime,
        sp.y + sv.y * leadTime,
        sp.z + sv.z * leadTime,
      );
      const leadProj = _project(leadPos, camera);
      if (leadProj.visible) drawLeadMarker(_rctx, leadProj.x, leadProj.y, color);
    }
  }

  // 3.5) Off-screen enemy indicators (arrows at screen edge).
  drawOffScreenIndicators(_rctx, camera, enemies, _reticle.width, _reticle.height);

  // 3.7) Incoming-missile warnings — pulsing red arrows at screen edge for
  //      every missile currently homing on the player.
  drawIncomingMissiles(_rctx, camera, incomingMissiles, player, _reticle.width, _reticle.height);

  // 4) Missile lock bracket (red, with corners).
  if (missileLock && missileLock.alive) {
    const mp = missileLock.body.translation();
    const proj = _project(_noseTmp.set(mp.x, mp.y, mp.z), camera);
    if (proj.visible) {
      drawLockBracket(_rctx, proj.x, proj.y, 32, '#ff4d4d');
      _rctx.font = 'bold 11px monospace';
      _rctx.fillStyle = '#ff4d4d';
      _rctx.textAlign = 'center';
      _rctx.fillText('LOCK · Q TO FIRE', proj.x, proj.y + 50);
    }
  }
}

/**
 * For each enemy that's off-screen but within the alert range, draw an arrow
 * at the screen edge pointing in their direction.
 */
const _projTmp = new THREE.Vector3();
const OFFSCREEN_RANGE = 1500; // m — beyond this, no indicator
function drawOffScreenIndicators(ctx, camera, enemies, w, h) {
  const cx = w / 2, cy = h / 2;
  const margin = 70;
  const radius = Math.min(w, h) / 2 - margin;

  for (const e of enemies) {
    if (!e.alive) continue;
    const ep = e.body.translation();
    const dx = ep.x - camera.position.x;
    const dy = ep.y - camera.position.y;
    const dz = ep.z - camera.position.z;
    if (dx * dx + dy * dy + dz * dz > OFFSCREEN_RANGE * OFFSCREEN_RANGE) continue;

    _projTmp.set(ep.x, ep.y, ep.z);
    _projTmp.project(camera);
    const behind = _projTmp.z > 1;
    const onScreen = !behind && Math.abs(_projTmp.x) <= 1 && Math.abs(_projTmp.y) <= 1;
    if (onScreen) continue;

    // For behind-camera, the projection flips; invert so the angle is correct.
    let nx = _projTmp.x, ny = _projTmp.y;
    if (behind) { nx = -nx; ny = -ny; }

    // Convert NDC direction to canvas angle (canvas Y is inverted from NDC).
    const canvasAngle = Math.atan2(-ny, nx);
    const ex = cx + Math.cos(canvasAngle) * radius;
    const ey = cy + Math.sin(canvasAngle) * radius;

    const color = (e.team === 'ufo' || e.isUfo) ? '#44ff77'
                : e.team === 'blue'              ? '#4caaff'
                                                 : '#ff7b6e';
    drawScreenEdgeArrow(ctx, ex, ey, canvasAngle, color);
  }
}

/** Pulsing red arrows + distance labels for missiles homing on the player. */
const _missVec = new THREE.Vector3();
function drawIncomingMissiles(ctx, camera, missiles, player, w, h) {
  if (!missiles || missiles.length === 0) return;
  const cx = w / 2, cy = h / 2;
  const margin = 90;
  const radius = Math.min(w, h) / 2 - margin;
  const pulse = 0.6 + 0.4 * Math.sin(performance.now() * 0.012);
  for (const m of missiles) {
    if (!m.alive) continue;
    if (player) {
      const pp = player.body.translation();
      const dx = m.pos.x - pp.x, dy = m.pos.y - pp.y, dz = m.pos.z - pp.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      _missVec.set(m.pos.x, m.pos.y, m.pos.z);
      const proj = _project(_missVec, camera);
      const behind = proj && (m.pos.clone ? false : false); // proj already returns visible
      let nx = proj.visible ? (proj.x - cx) : 0;
      let ny = proj.visible ? (proj.y - cy) : 0;
      // If projection failed/behind, fall back to direction in world space.
      if (!proj.visible || (Math.abs(nx) < 1 && Math.abs(ny) < 1)) {
        const r = camera.matrixWorldInverse.elements;
        // Transform missile position to camera space → use sign for direction.
        // Simpler: use horizontal direction relative to camera.
        const rel = _missVec.clone().sub(camera.position);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        const dotFwd = rel.dot(fwd);
        const dotRight = rel.dot(right);
        const dotUp = rel.dot(up);
        nx = dotRight;
        ny = -dotUp; // canvas Y inverted
        // If behind (dotFwd < 0), invert direction so arrow points behind.
        if (dotFwd < 0) { nx = -nx; ny = -ny; }
      }
      const angle = Math.atan2(ny, nx);
      const ex = cx + Math.cos(angle) * radius;
      const ey = cy + Math.sin(angle) * radius;
      const color = `rgba(255, ${Math.round(40 + 60 * (1 - pulse))}, 40, ${0.7 + 0.3 * pulse})`;
      drawScreenEdgeArrow(ctx, ex, ey, angle, color);
      // Distance label
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#ff5555';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 2;
      ctx.fillText(`MISSILE ${Math.round(dist)}m`, ex, ey + 24);
      ctx.shadowBlur = 0;
    }
  }
}

function drawScreenEdgeArrow(ctx, x, y, canvasAngle, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(canvasAngle); // default triangle points "right" (+X), align with angle
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(-8, -11);
  ctx.lineTo(-8,  11);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();
  ctx.restore();
}

function drawHealthBar(ctx, x, y, ratio, team, dist) {
  // Shrink slightly with distance so far enemies don't dominate the screen.
  const scale = THREE.MathUtils.clamp(1 - (dist - 200) / 1500, 0.55, 1);
  const w = 46 * scale;
  const h = 6 * scale;
  const x0 = x - w / 2;
  const y0 = y - h / 2;

  ratio = THREE.MathUtils.clamp(ratio, 0, 1);
  let fillColor = '#3ddc84';
  if (ratio < 0.6) fillColor = '#ffd34a';
  if (ratio < 0.3) fillColor = '#ff5a4a';

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x0, y0, w, h);
  // Fill
  ctx.fillStyle = fillColor;
  ctx.fillRect(x0 + 1, y0 + 1, (w - 2) * ratio, h - 2);
  // Team-tinted outline
  ctx.strokeStyle = team === 'blue' ? '#4caaff' : '#ff7b6e';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
}

function drawCrosshair(ctx, x, y, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.moveTo(x - 12, y); ctx.lineTo(x - 6, y);
  ctx.moveTo(x + 6, y);  ctx.lineTo(x + 12, y);
  ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 6);
  ctx.moveTo(x, y + 6);  ctx.lineTo(x, y + 12);
  ctx.stroke();
}

function drawBracket(ctx, x, y, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  const s = size, c = 6;
  ctx.beginPath();
  // four L-shaped corners
  ctx.moveTo(x - s, y - s + c); ctx.lineTo(x - s, y - s); ctx.lineTo(x - s + c, y - s);
  ctx.moveTo(x + s - c, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y - s + c);
  ctx.moveTo(x - s, y + s - c); ctx.lineTo(x - s, y + s); ctx.lineTo(x - s + c, y + s);
  ctx.moveTo(x + s - c, y + s); ctx.lineTo(x + s, y + s); ctx.lineTo(x + s, y + s - c);
  ctx.stroke();
}

/** Small diamond marker indicating the lead point ahead of a moving target. */
function drawLeadMarker(ctx, x, y, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x + 5, y);
  ctx.lineTo(x, y + 5);
  ctx.lineTo(x - 5, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLockBracket(ctx, x, y, size, color) {
  drawBracket(ctx, x, y, size, color);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, size + 4, 0, Math.PI * 2);
  ctx.stroke();
}

export function hideLoading() {
  const el = document.getElementById('loading');
  if (el) el.classList.add('hidden');
}
