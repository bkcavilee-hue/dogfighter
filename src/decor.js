// Ambient decor: scattered clouds + small flocks of birds.
// Both are purely visual — no collision, no interaction. If the GLB
// prototypes aren't loaded (because the user hasn't run the Blender
// generator yet) the spawn functions silently no-op.
import * as THREE from 'three';
import { getBirdMesh, getCloudMesh } from './models.js';
import { ARENA } from './arena.js';

// Counts scaled for the 4k arena (was sized for 1800m). Decor density stays
// roughly constant — area is now ~5× larger.
const CLOUD_COUNT = 32;
const CLOUD_ALT_MIN = 600;
const CLOUD_ALT_MAX = 1000;

const FLOCK_COUNT = 10;         // number of flocks scattered across the arena
const BIRDS_PER_FLOCK = 7;
const BIRD_ALT_MIN = 60;
const BIRD_ALT_MAX = 220;
const BIRD_SPEED = 8;           // m/s
const BIRD_TURN_PERIOD = 12;    // seconds between heading changes

const _clouds = [];   // { mesh, drift } — drift is m/s along x
const _birds  = [];   // { mesh, vel, headingTimer }

/** Scatter clouds + bird flocks across the arena. */
export function spawnDecor(scene) {
  spawnClouds(scene);
  spawnBirds(scene);
}

/** Build a soft puffy-cloud group from 4-6 overlapping flattened spheres.
 *  Pure procedural — always available, no GLB needed. */
function buildProceduralCloud() {
  const group = new THREE.Group();
  const blobCount = 4 + Math.floor(Math.random() * 3);
  // Share one material across all blobs of the cloud — fewer draw calls
  // and consistent shading. depthWrite=false so clouds don't z-fight when
  // they overlap; transparent blending gives a soft volumetric look.
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  for (let i = 0; i < blobCount; i++) {
    const r = 8 + Math.random() * 14;       // 8-22m blob radius
    const blob = new THREE.Mesh(
      new THREE.SphereGeometry(r, 10, 8),
      material,
    );
    // Stagger positions so the blobs overlap into a single puff.
    blob.position.set(
      (Math.random() - 0.5) * 22,
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 22,
    );
    group.add(blob);
  }
  // Squash vertically into a flattened disk shape (looks like a cumulus
  // pancake rather than a cluster of balls).
  group.scale.y = 0.5;
  return group;
}

function spawnClouds(scene) {
  // Procedural clouds first — always available. If GLB cloud is loaded,
  // mix some in for variety. Result either way: clouds populate the sky.
  const usingGlb = !!getCloudMesh();
  for (let i = 0; i < CLOUD_COUNT; i++) {
    // 1-in-4 use the GLB if available; rest are procedural.
    const useGlb = usingGlb && (i % 4 === 0);
    const mesh = useGlb ? getCloudMesh() : buildProceduralCloud();
    const x = (Math.random() - 0.5) * ARENA.width * 0.95;
    const z = (Math.random() - 0.5) * ARENA.depth * 0.95;
    const y = CLOUD_ALT_MIN + Math.random() * (CLOUD_ALT_MAX - CLOUD_ALT_MIN);
    mesh.position.set(x, y, z);
    // Random horizontal scale variation so clouds don't look identical.
    const s = 0.7 + Math.random() * 1.6;
    mesh.scale.set(s, mesh.scale.y * (0.6 + Math.random() * 0.4), s);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    // Soft pseudo-translucency on GLB clouds (procedural already set).
    if (useGlb) {
      mesh.traverse((o) => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            m.transparent = true;
            m.opacity = 0.85;
            m.depthWrite = false;
          }
        }
      });
    }
    scene.add(mesh);
    _clouds.push({ mesh, drift: (Math.random() - 0.5) * 1.5 });
  }
}

function spawnBirds(scene) {
  const proto = getBirdMesh();
  if (!proto) return;
  for (let f = 0; f < FLOCK_COUNT; f++) {
    const cx = (Math.random() - 0.5) * ARENA.width * 0.7;
    const cz = (Math.random() - 0.5) * ARENA.depth * 0.7;
    const cy = BIRD_ALT_MIN + Math.random() * (BIRD_ALT_MAX - BIRD_ALT_MIN);
    const heading = Math.random() * Math.PI * 2;
    for (let i = 0; i < BIRDS_PER_FLOCK; i++) {
      const mesh = (f === 0 && i === 0) ? proto : getBirdMesh();
      const ox = (Math.random() - 0.5) * 30;
      const oy = (Math.random() - 0.5) * 8;
      const oz = (Math.random() - 0.5) * 30;
      mesh.position.set(cx + ox, cy + oy, cz + oz);
      mesh.rotation.y = heading;
      const vel = new THREE.Vector3(
        Math.sin(heading) * BIRD_SPEED,
        0,
        Math.cos(heading) * BIRD_SPEED,
      );
      scene.add(mesh);
      _birds.push({ mesh, vel, headingTimer: BIRD_TURN_PERIOD * Math.random() });
    }
  }
}

/** Tick decor each frame — cloud drift + bird wandering + boundary wrap. */
export function tickDecor(dt) {
  const halfW = ARENA.width / 2;
  const halfD = ARENA.depth / 2;

  for (const c of _clouds) {
    c.mesh.position.x += c.drift * dt;
    if (c.mesh.position.x > halfW) c.mesh.position.x = -halfW;
    else if (c.mesh.position.x < -halfW) c.mesh.position.x = halfW;
  }

  for (const b of _birds) {
    b.headingTimer -= dt;
    if (b.headingTimer <= 0) {
      // Pick a new gentle heading change (±25°).
      const cur = Math.atan2(b.vel.x, b.vel.z);
      const next = cur + (Math.random() - 0.5) * (Math.PI / 3.5);
      b.vel.x = Math.sin(next) * BIRD_SPEED;
      b.vel.z = Math.cos(next) * BIRD_SPEED;
      b.headingTimer = BIRD_TURN_PERIOD * (0.7 + Math.random() * 0.6);
      b.mesh.rotation.y = next;
    }
    b.mesh.position.addScaledVector(b.vel, dt);
    // Wing-flap shimmer — small Y-axis wobble fakes wing animation cheaply.
    b.mesh.rotation.z = Math.sin(performance.now() * 0.012 + b.mesh.position.x) * 0.18;
    // Wrap around arena bounds so the flock never strays out of play.
    if (b.mesh.position.x >  halfW) b.mesh.position.x = -halfW;
    if (b.mesh.position.x < -halfW) b.mesh.position.x =  halfW;
    if (b.mesh.position.z >  halfD) b.mesh.position.z = -halfD;
    if (b.mesh.position.z < -halfD) b.mesh.position.z =  halfD;
  }
}
