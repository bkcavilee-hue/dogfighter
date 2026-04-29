// Visual effects: muzzle flash, hit sparks, particle explosions, boost
// contrails. Effects are pooled-ish by virtue of being short-lived; each
// frame we tick all active and remove the dead.
import * as THREE from 'three';

const _vec = new THREE.Vector3();
const _q   = new THREE.Quaternion();

/* -----------------------------------------------------------------------
 * Module state — exported via tickFX so engine doesn't need to know
 * --------------------------------------------------------------------- */
const muzzleFlashes = [];   // { mesh, ttl }
const hitSparks    = [];   // { points, vel, ttl, mat }
const explosions    = [];   // { points, vel, ttl, mat, light? }
const contrails     = new Map(); // plane.id → { line, points, lastSampleT }

/** Call once per frame from engine. dt in seconds. */
export function tickFX(dt) {
  // Muzzle flashes — quick fade
  for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
    const m = muzzleFlashes[i];
    m.ttl -= dt;
    const k = Math.max(0, m.ttl / m.maxTtl);
    m.mesh.material.opacity = k;
    m.mesh.scale.setScalar(0.6 + (1 - k) * 1.4);
    if (m.ttl <= 0) {
      m.mesh.parent?.remove(m.mesh);
      m.mesh.geometry.dispose();
      m.mesh.material.dispose();
      muzzleFlashes.splice(i, 1);
    }
  }
  // Hit sparks — particles fly outward then fade
  for (let i = hitSparks.length - 1; i >= 0; i--) {
    const s = hitSparks[i];
    s.ttl -= dt;
    const arr = s.points.geometry.attributes.position.array;
    for (let p = 0; p < s.vel.length; p++) {
      arr[p * 3]     += s.vel[p].x * dt;
      arr[p * 3 + 1] += s.vel[p].y * dt;
      arr[p * 3 + 2] += s.vel[p].z * dt;
      s.vel[p].multiplyScalar(0.93); // damp
    }
    s.points.geometry.attributes.position.needsUpdate = true;
    s.mat.opacity = Math.max(0, s.ttl / s.maxTtl);
    if (s.ttl <= 0) {
      s.points.parent?.remove(s.points);
      s.points.geometry.dispose();
      s.mat.dispose();
      hitSparks.splice(i, 1);
    }
  }
  // Explosions
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    e.ttl -= dt;
    const arr = e.points.geometry.attributes.position.array;
    for (let p = 0; p < e.vel.length; p++) {
      arr[p * 3]     += e.vel[p].x * dt;
      arr[p * 3 + 1] += e.vel[p].y * dt - 4 * dt; // mild gravity
      arr[p * 3 + 2] += e.vel[p].z * dt;
      e.vel[p].multiplyScalar(0.96);
    }
    e.points.geometry.attributes.position.needsUpdate = true;
    const k = e.ttl / e.maxTtl;
    e.mat.opacity = Math.max(0, k);
    e.mat.size = 1.2 + (1 - k) * 1.5;
    if (e.ttl <= 0) {
      e.points.parent?.remove(e.points);
      e.points.geometry.dispose();
      e.mat.dispose();
      explosions.splice(i, 1);
    }
  }
}

/* -----------------------------------------------------------------------
 * Spawners
 * --------------------------------------------------------------------- */

/** Bright sphere flash at the gun barrel. */
export function spawnMuzzleFlash(scene, plane) {
  const r = plane.body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  const fwd = _vec.set(0, 0, -1).applyQuaternion(_q);
  const t = plane.body.translation();
  const pos = new THREE.Vector3(t.x + fwd.x * 2.4, t.y + fwd.y * 2.4, t.z + fwd.z * 2.4);

  const geom = new THREE.SphereGeometry(0.5, 6, 4);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xfff2a8, transparent: true, opacity: 1.0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(pos);
  scene.add(mesh);
  muzzleFlashes.push({ mesh, ttl: 0.06, maxTtl: 0.06 });
}

/** Small spray of orange points where a bullet hits. */
export function spawnHitSpark(scene, position) {
  const COUNT = 8;
  const positions = new Float32Array(COUNT * 3);
  const vel = [];
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3]     = position.x;
    positions[i * 3 + 1] = position.y;
    positions[i * 3 + 2] = position.z;
    vel.push(new THREE.Vector3(
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
    ));
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffaa44, size: 0.9, transparent: true, opacity: 1.0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geom, mat);
  scene.add(points);
  hitSparks.push({ points, vel, ttl: 0.35, maxTtl: 0.35, mat });
}

/** Particle explosion (used for plane death + missile detonation). */
export function spawnExplosion(scene, position, opts = {}) {
  const COUNT = opts.count || 28;
  const radius = opts.radius || 8;
  const positions = new Float32Array(COUNT * 3);
  const vel = [];
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3]     = position.x;
    positions[i * 3 + 1] = position.y;
    positions[i * 3 + 2] = position.z;
    const dir = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() * 0.6 + 0.1, // bias upward
      Math.random() - 0.5,
    ).normalize();
    vel.push(dir.multiplyScalar(radius * (0.5 + Math.random() * 0.7)));
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: opts.color || 0xff7733, size: 1.4, transparent: true, opacity: 1.0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geom, mat);
  scene.add(points);
  explosions.push({ points, vel, ttl: opts.ttl || 1.0, maxTtl: opts.ttl || 1.0, mat });
}

/* -----------------------------------------------------------------------
 * Boost contrails
 * --------------------------------------------------------------------- */
const TRAIL_MAX = 50;

export function tickContrail(scene, plane, dt) {
  let c = contrails.get(plane.id);
  if (!c) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
    geom.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      color: 0xddeeff, transparent: true, opacity: 0.0,
    });
    const line = new THREE.Line(geom, mat);
    scene.add(line);
    c = { line, points: [], lastSampleT: 0, opacity: 0 };
    contrails.set(plane.id, c);
  }
  // Sample position at fixed interval while alive.
  c.lastSampleT -= dt;
  if (plane.alive && c.lastSampleT <= 0) {
    c.lastSampleT = 0.025;
    const t = plane.body.translation();
    c.points.push(new THREE.Vector3(t.x, t.y, t.z));
    if (c.points.length > TRAIL_MAX) c.points.shift();
  }
  // Update buffer.
  const arr = c.line.geometry.attributes.position.array;
  for (let i = 0; i < c.points.length; i++) {
    arr[i * 3]     = c.points[i].x;
    arr[i * 3 + 1] = c.points[i].y;
    arr[i * 3 + 2] = c.points[i].z;
  }
  c.line.geometry.attributes.position.needsUpdate = true;
  c.line.geometry.setDrawRange(0, c.points.length);
  // Fade in when boosting, fade out otherwise.
  const target = plane.alive && plane.boostActive ? 0.85 : 0.0;
  c.opacity += (target - c.opacity) * Math.min(1, dt * 6);
  c.line.material.opacity = c.opacity;
  // When fully faded out and not boosting, drop sample buffer to clear the trail.
  if (c.opacity < 0.02 && !plane.boostActive) {
    c.points.length = 0;
  }
}

/** Remove a plane's contrail entirely (e.g. on plane removal). */
export function removeContrail(scene, plane) {
  const c = contrails.get(plane.id);
  if (!c) return;
  scene.remove(c.line);
  c.line.geometry.dispose();
  c.line.material.dispose();
  contrails.delete(plane.id);
}
