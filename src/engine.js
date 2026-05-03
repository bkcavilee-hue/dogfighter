// Engine: scene/renderer/loop wiring. Single-player MVP — adds one player
// plane and a couple of stationary AI dummies as targets.
import * as THREE from 'three';
import { initPhysics, world, syncMesh } from './physics.js';
import {
  input, initInput, consumeMissileTap,
  consumeLoopTap, consumeRollLeftTap, consumeRollRightTap, consumeFlareTap,
  consumeTabTap, consumeShiftTap, consumeCameraToggle,
  consumeCam1, consumeCam2, consumeCam3,
} from './input.js';
import {
  ARENA, generateHeightmap, createTerrain, createOcean, createSky, setupLights,
} from './arena.js';
import { createAircraft, updateAircraft, PLANE_STATS } from './aircraft.js';
import {
  createCamera, updateChaseCamera, attachZoom, onResize,
  cycleCameraMode, getCameraMode, setCameraMode,
} from './camera.js';
import { createWeaponState, updateWeapons, findSoftLock } from './weapons.js';
import { createAIBrain, updateAI } from './ai.js';
import { findMissileLock, fireMissile, updateMissiles, MISSILE_SLOW } from './missiles.js';
import { deployFlares, updateFlares, nearestFlare } from './flares.js';
import {
  checkTerrainCollision, checkAircraftCollisions, tickRespawns, tickExplosions,
  respawnPlane, applyDamage, checkBounds,
} from './gamestate.js';
import {
  createHUD, updateHUD, updateMinimap, updateReticle, updateMatchHUD,
  onRestartClick, hideLoading, showClassSelect,
} from './ui.js';
import { createMatchState, startMatch, tickMatch } from './match.js';
import {
  preloadPlaneModels, preloadArenaModels, preloadMissileModel, preloadUfoModel,
  preloadUfo2Model, getArenaModel, bakeIslandHeightmap, getUfoMesh, getUfo2Mesh,
  setActiveMap, getActiveMap, preloadDecorModels,
} from './models.js';
import { spawnDecor, tickDecor } from './decor.js';
import { createUfoBoss, updateUfoBoss } from './ufo.js';
import { createDrones, updateDrones } from './drones.js';
import { tickFX, tickContrail, removeContrail } from './fx.js';
import { spawnDeathTumble, tickDeathTumbles } from './death-fx.js';
import {
  initAudio, unlockAudio, sfxFlare, sfxManeuver, sfxLockWarning,
} from './audio.js';
import { network } from './networking.js';
import { createRemotePlane, applyRemoteState, tickRemotePlane, buildLocalState } from './remote-plane.js';

const FIXED_DT = 1 / 60;
const _maneuverQ = new THREE.Quaternion();
const _axisZ = new THREE.Vector3(0, 0, 1);
// Hybrid mesh-strip temporaries (avoid per-frame allocation).
const _hybridFwd = new THREE.Vector3();
const _hybridEuler = new THREE.Euler(0, 0, 0, 'YXZ');

// Spawn slot table for the 3000m arena. Mid-altitude (~400m), inside the
// 1200m ceiling, well within the X/Z bounds.
// Spawns scaled to the 1800m arena (was 3000m). Closer = teams find each
// other within seconds of match start.
const SPAWNS = {
  red:  [
    { x:    0, y: 400, z:  500 },
    { x:  300, y: 420, z:  400 },
    { x: -300, y: 420, z:  400 },
    { x:    0, y: 450, z:  700 },
  ],
  blue: [
    { x:    0, y: 400, z: -500 },
    { x:  300, y: 420, z: -400 },
    { x: -300, y: 420, z: -400 },
    { x:    0, y: 450, z: -700 },
  ],
};

export async function startEngine() {
  // --- Physics ---------------------------------------------------------
  await initPhysics();

  // --- Renderer + Scene -----------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb6d8e8, 1200, 5500);

  const camera = createCamera();
  attachZoom(camera);
  onResize(camera, renderer);

  setupLights(scene);
  scene.add(createSky());

  // --- Arena -----------------------------------------------------------
  const heightmap = generateHeightmap(20260428);
  const terrain = createTerrain(heightmap);
  scene.add(terrain.mesh);

  const ocean = createOcean();
  scene.add(ocean.mesh);

  // --- Input -----------------------------------------------------------
  initInput();

  // --- Audio (suspended until user interaction; LAUNCH click unlocks it)
  initAudio();

  // --- HUD (creates the intro overlay too) ----------------------------
  createHUD();
  hideLoading();

  // Plane / missile / UFO models load now (independent of map choice).
  const commonLoadPromise = Promise.all([
    preloadPlaneModels(),
    preloadMissileModel(),
    preloadUfoModel(),
    preloadUfo2Model(),
    preloadDecorModels(),
  ]);

  // --- Class select + lobby -------------------------------------------
  const lobbyResult = await showClassSelect([
    {
      key: 'interceptor', label: 'Interceptor', color: '#4cb1ff',
      tagline: 'Fast · Fragile · Razor turn',
      stats: { hp: 0.55, speed: 0.95, agility: 0.95, payload: 0.4 },
    },
    {
      key: 'striker', label: 'Striker', color: '#ffaa3a',
      tagline: 'Balanced all-rounder',
      stats: { hp: 0.7, speed: 0.7, agility: 0.7, payload: 0.6 },
    },
    {
      key: 'bruiser', label: 'Bruiser', color: '#c04848',
      tagline: 'Tank · Slow · Heavy payload',
      stats: { hp: 1.0, speed: 0.5, agility: 0.45, payload: 0.85 },
    },
  ], network);
  const playerClass = lobbyResult.plane;
  const isMultiplayer = lobbyResult.mode === 'mp';
  const matchModeKey = isMultiplayer ? (lobbyResult.matchMode || 'ffa') : 'ffa';
  // Apply selected map BEFORE the arena preload so models.js loads the right GLBs.
  setActiveMap(lobbyResult.map || 'desert');
  const mapCfg = getActiveMap();

  // Now that we know the map, start the arena preload + finish the common preload.
  await Promise.all([commonLoadPromise, preloadArenaModels()]);
  unlockAudio();

  // Decor — clouds + bird flocks. No-ops if the GLB prototypes weren't
  // loaded (Blender script not run yet).
  spawnDecor(scene);

  // Swap procedural arena visuals for the GLBs.
  const islandModel = getArenaModel('island');
  if (islandModel) {
    terrain.mesh.visible = false;
    scene.add(islandModel);
    // Bake collision heightmap from the GLB so "solid island" damage matches
    // exactly what's visible. Mutate heightmap.data in place — gamestate's
    // checkTerrainCollision reads from this same array.
    const baked = bakeIslandHeightmap(ARENA.width, ARENA.depth, ARENA.segments);
    if (baked) {
      heightmap.data.set(baked.data);
    }
  }
  // Ocean is per-map (desert omits it). Hide the procedural
  // shader plane regardless; only add the GLB ocean if the map declares it.
  ocean.mesh.visible = false;
  if (mapCfg.hasOcean) {
    const oceanModel = getArenaModel('ocean');
    if (oceanModel) scene.add(oceanModel);
  }

  // --- Aircraft --------------------------------------------------------
  const playerTeam = isMultiplayer ? (network.you?.team || 'red') : 'red';
  const player = createAircraft({
    type: playerClass,
    position: { x: 0, y: 400, z: 500 },
    team: playerTeam,
    isPlayer: true,
  });
  scene.add(player.mesh);
  player.body.setLinvel({ x: 0, y: 0, z: -player.stats.minSpeed }, true);
  player.name = isMultiplayer ? (network.you?.name || 'You') : 'You';

  // SOLO = FFA. Each AI is on its OWN team so they fight each other AND
  // the player. 8 enemies spawned in a ring around the origin so the
  // 4k-arena fights kick off from spread starting positions instead of
  // bunching up in one cluster.
  const FFA_RING_COUNT = 8;
  const FFA_RING_RADIUS = 700;          // m from origin
  const FFA_TYPES = ['interceptor', 'striker', 'bruiser'];
  const enemies = isMultiplayer ? [] : Array.from({ length: FFA_RING_COUNT }, (_, i) => {
    const angle = (i / FFA_RING_COUNT) * Math.PI * 2;
    const x = Math.cos(angle) * FFA_RING_RADIUS;
    const z = Math.sin(angle) * FFA_RING_RADIUS;
    const y = 380 + ((i * 37) % 90);    // stagger altitude 380-470
    const type = FFA_TYPES[i % FFA_TYPES.length];
    // Each AI gets a unique team string → FFA: no team filtering between AIs.
    return createAircraft({ type, position: { x, y, z }, team: `ffa-${i}` });
  });
  for (const e of enemies) {
    scene.add(e.mesh);
    e.body.setLinvel({ x: 0, y: 0, z: -e.stats.maxSpeed }, true);
  }

  // Remote-player proxies (MP only). Map keyed by socket id.
  /** @type {Map<string, ReturnType<typeof createRemotePlane>>} */
  const remotePlanes = new Map();

  // Host-owned AI bots (MP only). Each has { plane, brain, weapon }.
  const bots = [];

  // UFO boss — spawned ahead of the player but BEHIND the enemy cluster
  // (enemies at z=-150 to z=150, UFO at z=-400) so the player flies
  // through the dogfight first and then meets the boss. Player at z=500.
  let ufoBoss = null;
  if (mapCfg.hasUfoBoss) {
    ufoBoss = createUfoBoss({
      scene,
      // Closer + lower so the UFO is visible from spawn (was 0,520,-400 —
      // up at the ceiling and far behind the enemy cluster, easy to miss).
      position: new THREE.Vector3(0, 380, -200),
      getMeshFn: getUfoMesh,
    });
  }

  // UFO2 drones — three orbiting around the UFO boss area.
  let drones = [];
  if (mapCfg.hasUfoDrones) {
    drones = createDrones({ scene, getMeshFn: getUfo2Mesh });
  }

  // allPlanes is rebuilt each tick — see refreshAllPlanes() called below.
  const allPlanes = [player];
  function refreshAllPlanes() {
    allPlanes.length = 0;
    allPlanes.push(player);
    if (isMultiplayer) {
      for (const r of remotePlanes.values()) allPlanes.push(r);
      for (const b of bots) allPlanes.push(b.plane);
    } else {
      for (const e of enemies) allPlanes.push(e);
    }
    // UFOs are local-simulated in every mode, so include them regardless.
    if (ufoBoss && ufoBoss.alive) allPlanes.push(ufoBoss);
    for (const d of drones) if (d.alive) allPlanes.push(d);
  }
  refreshAllPlanes();

  const playerWeapon = createWeaponState();
  // Mixed difficulty roster for solo FFA. One brain per enemy — the array
  // length must match enemies.length. Repeat the pattern as we add more
  // bots so each plane always gets a brain.
  const FFA_DIFFICULTIES = ['rookie', 'rookie', 'veteran', 'veteran', 'veteran', 'ace', 'ace', 'rookie'];
  const aiBrains = isMultiplayer ? [] : enemies.map((_, i) => createAIBrain(FFA_DIFFICULTIES[i % FFA_DIFFICULTIES.length]));
  const aiWeapons = enemies.map(() => createWeaponState());
  const missiles = []; // active missiles in flight
  const flares = [];   // active decoy flares
  let playerSoftLock = null;
  let playerMissileLock = null;
  // Manual targeting (Tab cycles, Shift commits). When committed, overrides
  // both auto soft-lock and auto missile-lock.
  let manualLockTarget = null;
  let manualLockCommitted = false;

  // --- Multiplayer wiring ---------------------------------------------
  if (isMultiplayer) {
    console.log(`[MP] entering match with ${network.players.length} other player(s)`);
    // Pick a random spawn slot so multiple players don't overlap at slot 0.
    const slotIdx = Math.floor(Math.random() * 4);
    const teamSlots = SPAWNS[player.team] || SPAWNS.red;
    const spawn = teamSlots[slotIdx];
    player.body.setTranslation(spawn, true);
    // Spawn proxies for players already in the room.
    for (const remotePlayer of network.players) {
      console.log('[MP] spawning proxy for', remotePlayer.name, remotePlayer.id);
      const proxy = createRemotePlane(remotePlayer);
      remotePlanes.set(remotePlayer.id, proxy);
      scene.add(proxy.mesh);
    }
    // New players joining mid-session.
    network.on('playerJoined', (p) => {
      if (remotePlanes.has(p.id) || p.id === network.you?.id) return;
      console.log('[MP] spawning proxy for new player', p.name, p.id);
      const proxy = createRemotePlane(p);
      remotePlanes.set(p.id, proxy);
      scene.add(proxy.mesh);
    });
    network.on('playerLeft', (id) => {
      const proxy = remotePlanes.get(id);
      if (!proxy) return;
      scene.remove(proxy.mesh);
      // Dispose all geometries/materials hanging off the cloned mesh tree
      // (cloned plane mesh + ring) so the GPU buffers are freed.
      proxy.mesh.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      removeContrail(scene, proxy);
      remotePlanes.delete(id);
    });
    // Apply state snapshots to the matching proxy. If we receive state for
    // an unknown id (e.g. an AI bot owned by the host), lazy-spawn a proxy
    // using the metadata embedded in the state itself.
    network.on('remoteState', (id, state) => {
      let proxy = remotePlanes.get(id);
      if (!proxy && id !== network.you?.id) {
        const fakePlayer = {
          id,
          name: state.name || (id.startsWith('bot-') ? 'Bot' : 'Pilot'),
          plane: state.plane || 'striker',
          team: state.team || 'red',
        };
        proxy = createRemotePlane(fakePlayer);
        remotePlanes.set(id, proxy);
        scene.add(proxy.mesh);
      }
      if (proxy) applyRemoteState(proxy, state);
    });

    // Combat events from other players.
    network.on('remoteEvent', (sourceId, event) => {
      if (event.type === 'hit') {
        // Look up the attacker so kill credit lands on them.
        const attacker = remotePlanes.get(sourceId) || null;
        if (event.targetId === network.you?.id) {
          // We were hit — apply damage; attacker gets the kill on death.
          applyDamage(player, event.damage, attacker);
        } else {
          // Damage another remote plane (visual/HP only).
          const proxy = remotePlanes.get(event.targetId);
          if (proxy && proxy.alive) {
            proxy.HP = Math.max(0, proxy.HP - event.damage);
            if (proxy.HP === 0) proxy.alive = false;
          }
        }
      } else if (event.type === 'missile-fire') {
        // Spawn a ghost missile so we see incoming missiles. No hit detection
        // here — only the shooter's client owns the authoritative missile.
        const shooterPlane = remotePlanes.get(sourceId);
        if (!shooterPlane) return;
        let target = null;
        if (event.targetId === network.you?.id) target = player;
        else target = remotePlanes.get(event.targetId);
        if (!target) return;
        const ghost = fireMissile({ shooter: shooterPlane, target, scene });
        ghost.isGhost = true;
        missiles.push(ghost);
      } else if (event.type === 'death') {
        // Remote announced their death — handled via state push, but play
        // explosion here for visual punch.
        const proxy = remotePlanes.get(sourceId);
        if (proxy) {
          proxy.alive = false;
          proxy.HP = 0;
        }
      }
    });

    // Start broadcasting our own state.
    network.startStateLoop(() => buildLocalState(player));

    // ---- Bot fill: host spawns AI bots to fill empty slots. -------
    // Host = first player in JOIN ORDER (the room creator). If the host
    // leaves, the next player becomes host automatically because everyone
    // reads the same ordered roster from network.getHost().
    if (network.isHost()) {
      const targetCount = 4;
      const allPlayersHere = [network.you, ...network.players];
      const redCount  = allPlayersHere.filter((p) => p.team === 'red').length;
      const blueCount = allPlayersHere.filter((p) => p.team === 'blue').length;
      let needRed  = matchModeKey === 'team2v2' ? Math.max(0, 2 - redCount)  : 0;
      let needBlue = matchModeKey === 'team2v2' ? Math.max(0, 2 - blueCount) : 0;
      // FFA: just fill to targetCount with unique-team bots.
      let ffaNeed = matchModeKey === 'team2v2' ? 0 : Math.max(0, targetCount - allPlayersHere.length);

      const PLANE_TYPES = ['interceptor', 'striker', 'bruiser'];
      const DIFFICULTIES = ['rookie', 'rookie', 'veteran', 'ace'];
      let botIndex = 0;
      const spawnBot = (team) => {
        const id = `bot-${network.you.id}-${botIndex++}`;
        const planeType = PLANE_TYPES[botIndex % PLANE_TYPES.length];
        const slots = SPAWNS[team] || SPAWNS.red;
        const slot = slots[botIndex % slots.length];
        const bot = createAircraft({ id, type: planeType, position: slot, team, isPlayer: false });
        bot.name = (team === 'red' ? 'BOT-R' : team === 'blue' ? 'BOT-B' : 'BOT') + botIndex;
        bot.body.setLinvel({ x: 0, y: 0, z: -bot.stats.maxSpeed }, true);
        scene.add(bot.mesh);
        bots.push({
          plane: bot,
          brain: createAIBrain(DIFFICULTIES[botIndex % DIFFICULTIES.length]),
          weapon: createWeaponState(),
        });
      };
      while (needRed-- > 0)  spawnBot('red');
      while (needBlue-- > 0) spawnBot('blue');
      while (ffaNeed-- > 0)  spawnBot(`ffa-${botIndex}`); // unique team id per bot
      console.log(`[MP] host spawned ${bots.length} bot(s)`);

      // Broadcast bot states alongside our own at 20 Hz.
      const sendBots = () => {
        if (bots.length === 0) return;
        const out = [];
        for (const b of bots) {
          out.push({ id: b.plane.id, state: { ...buildLocalState(b.plane), name: b.plane.name } });
        }
        network.sendBotStates(out);
      };
      setInterval(sendBots, 50);
    }
  }

  // --- Match state -----------------------------------------------------
  // In MP, the host picks ffa or team2v2 from the lobby. Solo defaults to ffa.
  // (matchModeKey is hoisted to the top of startEngine so the MP setup above
  // can reference it.)
  const match = createMatchState(matchModeKey);
  startMatch(match);

  function resetMatch() {
    // Reset every plane: full HP, score 0, alive, fresh flares, missile
    // cooldown ready, neutral pose.
    for (const p of allPlanes) {
      p.score = 0;
      p.HP = p.maxHP;
      p.boost = p.maxBoost;
      p.heat = 0;
      p.missileCD = 0;
      p.flares = p.maxFlares;
      p.alive = true;
      if (p.mesh) p.mesh.visible = true;
      respawnPlane(p, spawnFor(p));
    }
    for (const m of missiles) m.alive = false;
    for (const f of flares) f.alive = false;
    startMatch(match);
  }
  onRestartClick(resetMatch);

  // Spawn points: candidate slots per team, pick whichever is farthest from
  // any living enemy. Prevents respawning straight into the action.
  // (SPAWNS table is at module scope so the MP block above can use it too.)
  const spawnFor = (plane) => {
    const slots = SPAWNS[plane.team] || SPAWNS.red;
    const enemiesAlive = allPlanes.filter((p) => p !== plane && p.alive && p.team !== plane.team);
    let bestPos = slots[0];
    let bestScore = -Infinity;
    for (const slot of slots) {
      let minDistSq = Infinity;
      for (const e of enemiesAlive) {
        const ep = e.body.translation();
        const dx = slot.x - ep.x, dy = slot.y - ep.y, dz = slot.z - ep.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < minDistSq) minDistSq = d;
      }
      if (minDistSq > bestScore) {
        bestScore = minDistSq;
        bestPos = slot;
      }
    }
    return bestPos;
  };

  // --- Loop ------------------------------------------------------------
  let lastT = performance.now();
  let acc = 0;
  let elapsed = 0;

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    acc += dt;
    elapsed += dt;

    // Camera-mode toggles run BEFORE the fixed-step loop, so they fire even
    // when the match is in 'intro' / 'ended' state (gameplay is gated, view
    // preference shouldn't be).
    const updateCamBadge = (m) => {
      const el = document.getElementById('camBadge');
      if (el) el.textContent = `CAM: ${m}  ·  1 cockpit · 2 hybrid · 3 classic`;
    };
    if (consumeCameraToggle()) {
      const newMode = cycleCameraMode();
      console.log(`[camera] mode: ${newMode}`);
      updateCamBadge(newMode);
    }
    if (consumeCam1()) { setCameraMode('cockpit'); console.log('[camera] mode: cockpit'); updateCamBadge('cockpit'); }
    if (consumeCam2()) { setCameraMode('hybrid');  console.log('[camera] mode: hybrid');  updateCamBadge('hybrid'); }
    if (consumeCam3()) { setCameraMode('classic'); console.log('[camera] mode: classic'); updateCamBadge('classic'); }

    // Fixed-step physics & game logic.
    while (acc >= FIXED_DT) {
      acc -= FIXED_DT;

      // Gameplay frozen unless match is actively playing.
      if (match.state !== 'playing') continue;

      // Keep allPlanes in sync — solo needs it too (drones die / spawn).
      refreshAllPlanes();

      // --- Player intent (keyboard → flight model) -----------------
      // Controls 1: real flight + auto-bank coordinated turn.
      const playerIntent = {
        yaw:   (input.left ? 1 : 0) - (input.right ? 1 : 0),
        pitch: (input.climb ? 1 : 0) - (input.dive   ? 1 : 0),
        boost: input.boost,
        fire:  input.fire,
        loopTap:      consumeLoopTap(),
        rollLeftTap:  consumeRollLeftTap(),
        rollRightTap: consumeRollRightTap(),
      };
      const flareTap = consumeFlareTap();

      // Manual targeting: Tab cycles through hostile candidates, Shift
      // commits / unlocks. When a manual lock is held it overrides the
      // auto soft-lock + missile-lock.
      const tabbed = consumeTabTap();
      const shifted = consumeShiftTap();
      // (Camera-mode toggles moved OUT of this loop — see below — so
      // the player can switch view during intro/end-of-match too.)
      if (tabbed) {
        // Build candidate list (hostile, alive, in front cone, in range).
        const r = player.body.rotation();
        const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const pp = player.body.translation();
        const cosCone = Math.cos(THREE.MathUtils.degToRad(45));
        const candidates = [];
        for (const o of allPlanes) {
          if (o === player || !o.alive || o.team === player.team) continue;
          const op = o.body.translation();
          const dx = op.x - pp.x, dy = op.y - pp.y, dz = op.z - pp.z;
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (dist > 800) continue;
          const dot = (dx*fwd.x + dy*fwd.y + dz*fwd.z) / Math.max(dist, 1e-3);
          if (dot < cosCone) continue;
          candidates.push({ plane: o, dist });
        }
        candidates.sort((a, b) => a.dist - b.dist);
        if (candidates.length) {
          let idx = -1;
          if (manualLockTarget) idx = candidates.findIndex((c) => c.plane === manualLockTarget);
          const next = candidates[(idx + 1) % candidates.length];
          manualLockTarget = next.plane;
          manualLockCommitted = false;
        }
      }
      if (shifted) {
        if (manualLockTarget) {
          manualLockCommitted = !manualLockCommitted;
        }
      }
      // If the manual target died or escaped, drop it.
      if (manualLockTarget && (!manualLockTarget.alive ||
          manualLockTarget.team === player.team)) {
        manualLockTarget = null;
        manualLockCommitted = false;
      }
      playerSoftLock = manualLockCommitted && manualLockTarget
        ? manualLockTarget
        : findSoftLock(player, allPlanes);
      playerMissileLock = manualLockCommitted && manualLockTarget
        ? manualLockTarget
        : findMissileLock(player, allPlanes);

      // Stickiness: if we lost the soft lock but still have built-up confidence
      // on the previous target, keep aiming at it (within 600m). Lets the
      // assist "follow for a second" while the target jukes out of the cone.
      if (!playerSoftLock && playerWeapon.lockConfidence > 0.25 && playerWeapon.lockTargetId) {
        const prev = allPlanes.find((p) => p.id === playerWeapon.lockTargetId);
        if (prev && prev.alive) {
          const pp = player.body.translation();
          const ep = prev.body.translation();
          const dx = ep.x - pp.x, dy = ep.y - pp.y, dz = ep.z - pp.z;
          if (dx * dx + dy * dy + dz * dz < 600 * 600) {
            playerSoftLock = prev;
          }
        }
      }

      // Soft turn assist: when soft-locked AND the player isn't actively
      // steering, gently bias the plane toward the target. Computed in the
      // player's local frame so it works at any orientation (even inverted).
      if (playerSoftLock && Math.abs(playerIntent.yaw) < 0.1 && Math.abs(playerIntent.pitch) < 0.1) {
        const tp = playerSoftLock.body.translation();
        const pp = player.body.translation();
        const r  = player.body.rotation();
        const q  = new THREE.Quaternion(r.x, r.y, r.z, r.w).invert();
        const localAim = new THREE.Vector3(tp.x - pp.x, tp.y - pp.y, tp.z - pp.z).normalize();
        localAim.applyQuaternion(q);
        const assistStrength = 0.35 + 0.45 * playerWeapon.lockConfidence; // 0.35 → 0.8
        const cap = 0.18 + 0.20 * playerWeapon.lockConfidence;             // 0.18 → 0.38
        playerIntent.yaw   = THREE.MathUtils.clamp(-localAim.x * assistStrength, -cap, cap);
        playerIntent.pitch = THREE.MathUtils.clamp( localAim.y * assistStrength, -cap, cap);
      }

      updateAircraft(player, playerIntent, FIXED_DT);

      // In MP, gun hits are broadcast so target's HP updates everywhere.
      // In 2v2, friendly fire is off (skip damage when same team).
      const playerOnHit = isMultiplayer
        ? (target, damage, weapon) => {
            if (matchModeKey === 'team2v2' && target.team === player.team) return;
            // Apply locally for instant feedback (target proxy HP visual).
            if (target === player) applyDamage(player, damage, null);
            else {
              applyDamage(target, damage, player); // increments score on kill
            }
            network.sendEvent({ type: 'hit', targetId: target.id, damage, weapon });
          }
        : null;

      // `allPlanes` already excludes nothing harmful for the player's own gun;
      // re-use it instead of allocating a new array each tick.
      const playerTargets = isMultiplayer ? allPlanes.filter((p) => p !== player) : enemies;
      updateWeapons(
        player, playerWeapon, playerIntent.fire,
        playerTargets, scene, FIXED_DT, playerSoftLock, playerOnHit
      );

      // Missile fire on Q tap (unlimited ammo, gated by reload cooldown).
      if (consumeMissileTap() && player.missileCD <= 0 && playerMissileLock) {
        if (matchModeKey === 'team2v2' && playerMissileLock.team === player.team) {
          // Refuse friendly missile lock.
        } else {
          player.missileCD = player.missileReloadSec;
          missiles.push(fireMissile({ shooter: player, target: playerMissileLock, scene }));
          if (isMultiplayer) {
            network.sendEvent({
              type: 'missile-fire',
              targetId: playerMissileLock.id,
            });
          }
        }
      }

      // Flare drop on S double-tap. Pulls any missiles homing on the player.
      if (flareTap && player.flares > 0) {
        player.flares -= 1;
        const newFlares = deployFlares(player, scene);
        flares.push(...newFlares);
        for (const m of missiles) {
          if (m.alive && m.target === player) {
            const decoy = nearestFlare(m.pos, newFlares);
            if (decoy) m.target = decoy;
          }
        }
        sfxFlare();
      }

      // Maneuver SFX (only when one will actually fire — i.e. no cooldown).
      const aboutToManeuver = playerIntent.loopTap || playerIntent.rollLeftTap || playerIntent.rollRightTap;
      if (aboutToManeuver && !player._maneuver && (player._maneuverCD ?? 0) <= 0) {
        sfxManeuver();
      }

      // --- MP host bots: tick AI + weapons. Bots fire missiles (slow profile)
      // so MP feels like solo — every hostile in the air is a real threat.
      if (isMultiplayer && bots.length > 0) {
        for (const b of bots) {
          const aiIntent = updateAI(b.plane, b.brain, allPlanes, FIXED_DT);
          updateAircraft(b.plane, aiIntent, FIXED_DT);
          const targets = allPlanes.filter((p) => p.team !== b.plane.team);
          updateWeapons(b.plane, b.weapon, aiIntent.fire, targets, scene, FIXED_DT, null,
            (target, damage, weapon) => {
              if (target === player) applyDamage(player, damage, b.plane);
              else applyDamage(target, damage, b.plane);
              network.sendEvent({ type: 'hit', targetId: target.id, damage, weapon });
            });
          // MP bot missile launch — same slow profile + lock cadence as solo AI.
          if (aiIntent.missileFire && aiIntent.missileTarget) {
            missiles.push(fireMissile({
              shooter: b.plane,
              target: aiIntent.missileTarget,
              scene,
              profile: MISSILE_SLOW,
            }));
            if (aiIntent.missileTarget === player) sfxLockWarning();
          }
          // Bot terrain crash + respawn
          checkTerrainCollision(b.plane, heightmap);
        }
        tickRespawns(bots.map((b) => b.plane), FIXED_DT, spawnFor);
      }

      // --- Solo AI: build intent per enemy and drive it -----------------
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        const aiIntent = updateAI(e, aiBrains[i], allPlanes, FIXED_DT);
        updateAircraft(e, aiIntent, FIXED_DT);
        // AI fires only at non-team planes.
        const targets = allPlanes.filter((p) => p.team !== e.team);
        // AI gun does 60% of base damage so enemy hits are less punishing.
        const aiOnHit = (target, damage, weapon) => applyDamage(target, damage * 0.6, e);
        updateWeapons(e, aiWeapons[i], aiIntent.fire, targets, scene, FIXED_DT, null, aiOnHit);
        // AI missile launch (solo only — bots in MP don't fire missiles).
        // AI missiles use the SLOW profile so the player has time to react.
        // AI's per-brain missileCD already throttles the rate — no ammo count.
        if (!isMultiplayer && aiIntent.missileFire && aiIntent.missileTarget) {
          missiles.push(fireMissile({
            shooter: e,
            target: aiIntent.missileTarget,
            scene,
            profile: MISSILE_SLOW,
          }));
          if (aiIntent.missileTarget === player) sfxLockWarning();
        }
      }

      world.step();

      // Missile hit handler: applies damage + broadcasts in MP.
      // Friendly fire is suppressed in 2v2 mode.
      const missileOnHit = (target, damage, weapon, shooter) => {
        if (matchModeKey === 'team2v2' && target.team === shooter?.team) return;
        applyDamage(target, damage, shooter);
        if (isMultiplayer && shooter === player) {
          network.sendEvent({ type: 'hit', targetId: target.id, damage, weapon });
        }
      };
      // Split missiles: only OURS run hit detection (ghosts are visual-only).
      const ours = [];
      const ghosts = [];
      for (const m of missiles) (m.isGhost ? ghosts : ours).push(m);
      updateMissiles(ours, allPlanes, scene, FIXED_DT, missileOnHit);
      updateMissiles(ghosts, [], scene, FIXED_DT, () => {});
      missiles.length = 0;
      for (const m of ours)   if (m.alive) missiles.push(m);
      for (const m of ghosts) if (m.alive) missiles.push(m);

      // UFO boss + drones.
      if (ufoBoss) updateUfoBoss(ufoBoss, allPlanes, scene, FIXED_DT, camera, missiles);
      if (drones.length) updateDrones(drones, allPlanes, scene, FIXED_DT, camera);

      updateFlares(flares, scene, FIXED_DT);

      checkTerrainCollision(player, heightmap);
      checkBounds(player, FIXED_DT);
      for (const e of enemies) checkTerrainCollision(e, heightmap);
      // In MP, collisions/respawns for remote players are owned by their
      // own client. We only tick the local player here.
      if (isMultiplayer) {
        tickRespawns([player], FIXED_DT, spawnFor);
      } else {
        checkAircraftCollisions(allPlanes);
        tickRespawns(allPlanes, FIXED_DT, spawnFor);
      }
      tickExplosions(FIXED_DT);

      tickMatch(match, FIXED_DT, allPlanes);
    }

    // Sync render meshes to physics bodies. Apply maneuver visual offset
    // AND a banking tilt while turning (mesh-only — body stays auto-flat).
    for (const p of allPlanes) {
      // Death detection: alive flipped from true → false this frame? Spawn
      // a wreckage tumble before we hide the source mesh.
      if (p._wasAlive === undefined) p._wasAlive = p.alive;
      if (p._wasAlive && !p.alive && !p.isUfo) {
        spawnDeathTumble(scene, p);
      }
      p._wasAlive = p.alive;

      // Defensive: a UFO/drone that died THIS tick has its mesh
      // cleared by its update fn before allPlanes is rebuilt. Skip those.
      if (!p.mesh) continue;

      syncMesh(p.mesh, p.body);
      // Hybrid camera mode: strip pitch from the visible mesh so the model
      // stays "level". Body still pitches mechanically (velocity goes the
      // right direction) — only the visual is flattened. Banking into yaw
      // input gives turning feedback. Maneuvers (loop/roll) are still
      // applied below as a visual overlay, so dodge-rolls remain visible.
      if (getCameraMode() === 'hybrid' && !p._maneuver) {
        _hybridFwd.set(0, 0, -1).applyQuaternion(p.mesh.quaternion);
        const yawAngle = Math.atan2(-_hybridFwd.x, -_hybridFwd.z);
        const bankAngle = -(p._yawSmoothed || 0) * 0.26; // ~15° lean into turn
        _hybridEuler.set(0, yawAngle, bankAngle);
        p.mesh.quaternion.setFromEuler(_hybridEuler);
      }
      if (p._maneuver) {
        _maneuverQ.setFromAxisAngle(p._maneuver.visualAxis, p._maneuver.visualAngle);
        p.mesh.quaternion.multiply(_maneuverQ);
      }
      if (p.alive && p.invincibleTimer > 0) {
        p.mesh.visible = (Math.floor(p.invincibleTimer * 8) % 2) === 0;
      } else if (p.alive) {
        p.mesh.visible = true;
      }
      // Afterburner scale: boostActive → big plume, otherwise nothing.
      if (p.mesh) {
        const burner = p.mesh.children.find((c) => c.userData?.isAfterburner);
        if (burner) {
          const target = p.boostActive ? 1.0 : 0.001;
          const scale = (burner._scaleSmooth || 0.001);
          const next = scale + (target - scale) * Math.min(1, 12 * dt);
          burner._scaleSmooth = next;
          burner.scale.setScalar(next);
          burner.visible = next > 0.05;
        }
      }
    }

    // Tick remote-plane interpolation (MP only).
    if (isMultiplayer) {
      for (const proxy of remotePlanes.values()) tickRemotePlane(proxy, dt);
    }

    // Visuals
    ocean.material.uniforms.uTime.value = elapsed;
    tickFX(dt);
    tickDeathTumbles(scene, dt);
    tickDecor(dt);
    for (const p of allPlanes) tickContrail(scene, p, dt);
    updateChaseCamera(camera, player);
    updateHUD(player);
    // Minimap: show every plane in the world (AI enemies in solo, remote
    // players in MP). Color is decided per-plane by team relationship.
    updateMinimap(player, allPlanes.filter((p) => p !== player));
    // Incoming missiles for HUD warning: any live missile whose target is us,
    // or who's getting close to us regardless of original target.
    const incoming = missiles.filter((m) => m.alive && (
      m.target === player ||
      (m.pos.distanceTo
        ? m.pos.distanceTo(new THREE.Vector3(
            player.body.translation().x,
            player.body.translation().y,
            player.body.translation().z,
          )) < 250
        : false)
    ));
    updateReticle(
      camera, player, enemies, playerSoftLock, playerMissileLock,
      playerWeapon.lockConfidence, incoming,
      manualLockTarget, manualLockCommitted,
    );
    updateMatchHUD(match);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
