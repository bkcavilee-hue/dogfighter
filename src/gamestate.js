// Damage, death, respawn, and scoring.
// Visual effects (explosions, screen flash) live here too — they're light DOM
// or scene primitives and don't justify a separate module yet.
import * as THREE from 'three';
import { sampleHeight, ARENA } from './arena.js';
import { spawnExplosion as fxExplosion } from './fx.js';
import { sfxHit, sfxExplosion } from './audio.js';


/**
 * Apply damage to `target`. `source` is the attacker (or null/env).
 * Respects invincibility windows. Triggers death + respawn timer.
 */
export function applyDamage(target, amount, source = null) {
  if (!target.alive) return;
  if (target.invincibleTimer > 0) return;

  target.HP = Math.max(0, target.HP - amount);
  spawnDamageFlash(target);
  if (target.isPlayer) sfxHit();

  if (target.HP <= 0) {
    target.alive = false;
    target.respawnTimer = 4.0;
    if (source && source !== target && source.team !== target.team) {
      source.score += 1;
    }
    if (target.mesh && target.mesh.parent) {
      const wp = new THREE.Vector3();
      target.mesh.getWorldPosition(wp);
      fxExplosion(target.mesh.parent, wp, { count: 40, radius: 12, ttl: 1.4 });
      sfxExplosion();
      target.mesh.visible = false;
    }
  }
}

/** Per-frame: terrain proximity → scrape/crash damage. */
export function checkTerrainCollision(plane, heightmap) {
  if (!plane.alive) return;
  const t = plane.body.translation();
  const ground = sampleHeight(heightmap, t.x, t.z);
  const altitude = t.y - ground;

  if (altitude <= 0.5) {
    applyDamage(plane, 40, null);
  } else if (altitude < 3.5) {
    // light scrape — limit to once per ~0.5s by gating with a tiny timer
    plane._scrapeTimer = (plane._scrapeTimer || 0) - 1 / 60;
    if (plane._scrapeTimer <= 0) {
      applyDamage(plane, 5, null);
      plane._scrapeTimer = 0.5;
    }
  }

  // Out-of-bounds (off the arena) → crash.
  const halfW = ARENA.width / 2;
  const halfD = ARENA.depth / 2;
  if (t.x < -halfW || t.x > halfW || t.z < -halfD || t.z > halfD) {
    applyDamage(plane, 40, null);
  }
}

/** Plane-vs-plane collision: both take 30 HP. Call once per pair per frame. */
export function checkAircraftCollisions(planes) {
  for (let i = 0; i < planes.length; i++) {
    const a = planes[i];
    if (!a.alive) continue;
    const ta = a.body.translation();
    for (let j = i + 1; j < planes.length; j++) {
      const b = planes[j];
      if (!b.alive) continue;
      const tb = b.body.translation();
      const dx = ta.x - tb.x, dy = ta.y - tb.y, dz = ta.z - tb.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const r = (a.stats.colliderHalf.x + b.stats.colliderHalf.x) * 0.9;
      if (distSq < r * r) {
        applyDamage(a, 30, b);
        applyDamage(b, 30, a);
      }
    }
  }
}

/** Reset a plane to a spawn position. */
export function respawnPlane(plane, spawnPos) {
  plane.HP = plane.maxHP;
  plane.boost = plane.maxBoost;
  plane.heat = 0;
  plane.missiles = plane.maxMissiles;
  plane.respawnTimer = 0;
  plane.invincibleTimer = 2.0;
  plane.alive = true;
  if (plane.mesh) plane.mesh.visible = true;

  plane.body.setTranslation({ x: spawnPos.x, y: spawnPos.y, z: spawnPos.z }, true);
  plane.body.setLinvel({ x: 0, y: 0, z: -plane.stats.minSpeed }, true);
  plane.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  plane.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
}

export function tickRespawns(planes, dt, getSpawn) {
  for (const p of planes) {
    if (!p.alive) {
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) {
        respawnPlane(p, getSpawn(p));
      }
    }
  }
}

/* -----------------------------------------------------------------------
 * Visual effects
 * --------------------------------------------------------------------- */
// Old sphere-explosion replaced by particle system in fx.js. Kept as a
// no-op stub so engine.js's existing call sites stay compatible.
export function tickExplosions(_dt) { /* no-op — see fx.tickFX */ }

let _flashEl = null;
export function spawnDamageFlash(target) {
  if (!target.isPlayer) return;
  if (!_flashEl) {
    _flashEl = document.createElement('div');
    _flashEl.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 500;
      background: radial-gradient(circle at center, transparent 40%, rgba(255,40,40,0.55));
      opacity: 0; transition: opacity 0.18s;
    `;
    document.body.appendChild(_flashEl);
  }
  _flashEl.style.opacity = '1';
  setTimeout(() => { if (_flashEl) _flashEl.style.opacity = '0'; }, 80);
}
