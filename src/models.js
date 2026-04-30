// GLB plane model loader + cache.
// Models are auto-scaled to a target length and centered on origin so they
// fit the existing colliders. If a model fails to load, the caller falls
// back to the placeholder geometry from aircraft.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// (three-mesh-bvh removed — its prototype patches were causing a TDZ in the
// production bundle. The heightmap bake guards against very high-poly meshes
// instead so the page stays responsive without the BVH acceleration.)

const MODEL_PATHS = {
  interceptor: '/assets/models/interceptor.glb',
  striker:     '/assets/models/striker.glb',
  bruiser:     '/assets/models/bruiser.glb',
};

// How long each plane should be (longest axis, in meters).
const TARGET_LENGTH = {
  interceptor: 4.0,
  striker:     4.6,
  bruiser:     5.4,
};

// Missile mesh — single shared prototype, cloned per shot.
const MISSILE_PATH = '/assets/models/missile.glb';
const MISSILE_TARGET_LENGTH = 1.4;
let _missilePrototype = null;

// UFO boss mesh — large, single prototype.
const UFO_PATH = '/assets/models/ufo.glb';
const UFO_TARGET_LENGTH = 14;
let _ufoPrototype = null;

// UFO2 drone mesh — smaller saucer.
const UFO2_PATH = '/assets/models/ufo2.glb';
const UFO2_TARGET_LENGTH = 5.5;
let _ufo2Prototype = null;

// Per-model orientation correction. Start with 180° flip (assuming the
// GLBs face +Z by default). If still wrong, try ±Math.PI/2 for sideways.
const ORIENTATION = {
  interceptor: { rotateY: -Math.PI / 2 },
  striker:     { rotateY: -Math.PI / 2 },
  bruiser:     { rotateY: -Math.PI / 2 },
};

const cache = new Map();
const arenaCache = new Map();
const loader = new GLTFLoader();

// Map registry. Each entry has its own ground GLB, optional ocean GLB, and
// horizontal-fit length so they all align to ARENA dimensions. The active
// map id is set by the lobby and consumed by the engine on load.
export const MAPS = {
  desert: {
    label: 'Desert',
    paths: {
      island: '/assets/maps/island.glb',
      ocean:  '/assets/maps/ocean.glb', // kept loadable but engine omits it
    },
    fit: {
      island: { length: 2800, lift: 0 },
      ocean:  { length: 4000, lift: -1.0 },
    },
    hasOcean: false,                    // desert: ocean stripped
    hasUfoBoss: true,
    hasUfoDrones: true,
  },
  mountains: {
    label: 'Mountains',
    paths: {
      island: '/assets/maps/mountains.glb',
    },
    fit: {
      island: { length: 2800, lift: 0 },
    },
    hasOcean: false,
    hasUfoBoss: false,
    hasUfoDrones: false,
  },
};
let activeMapId = 'desert';
export function setActiveMap(id) {
  if (MAPS[id]) activeMapId = id;
}
export function getActiveMap() { return MAPS[activeMapId]; }

export async function preloadPlaneModels() {
  await Promise.all(Object.entries(MODEL_PATHS).map(async ([key, path]) => {
    try {
      const gltf = await loader.loadAsync(path);
      const wrapper = prepareModel(gltf.scene, key);
      cache.set(key, wrapper);
    } catch (err) {
      console.warn(`[models] failed to load ${key} from ${path}:`, err);
    }
  }));
}

function prepareModel(scene, key) {
  // 1. Apply orientation rotation FIRST (on the inner scene). The wrapper's
  //    transform is overwritten every frame by syncMesh, so the orientation
  //    correction MUST live on a child object that syncMesh doesn't touch.
  const o = ORIENTATION[key] || { rotateY: 0 };
  if (o.rotateY) scene.rotation.y = o.rotateY;
  scene.updateMatrixWorld(true);

  // 2. Compute bounding box (reflects the rotated geometry).
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const scale = (TARGET_LENGTH[key] || 4) / longest;
  scene.scale.setScalar(scale);
  scene.updateMatrixWorld(true);

  // 3. Recompute box after scaling, then offset so the pivot is the
  //    geometric center.
  const newBox = new THREE.Box3().setFromObject(scene);
  const center = new THREE.Vector3();
  newBox.getCenter(center);
  scene.position.sub(center);

  // 4. Wrap (no rotation on the wrapper — it'd be wiped by syncMesh).
  const wrapper = new THREE.Group();
  wrapper.add(scene);
  wrapper.userData.modelKey = key;
  return wrapper;
}

/** Return a clone of the cached model, or null if not loaded. */
export function getPlaneMesh(type) {
  const proto = cache.get(type);
  if (!proto) return null;
  return proto.clone(true);
}

/* -----------------------------------------------------------------------
 * Missile mesh
 * --------------------------------------------------------------------- */
export async function preloadMissileModel() {
  try {
    const gltf = await loader.loadAsync(MISSILE_PATH);
    const root = gltf.scene;
    // Scale so longest axis matches the target missile length.
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const longest = Math.max(size.x, size.y, size.z) || 1;
    root.scale.setScalar(MISSILE_TARGET_LENGTH / longest);
    // Center on origin so the rotated cloned mesh sits where we put it.
    const newBox = new THREE.Box3().setFromObject(root);
    const center = new THREE.Vector3();
    newBox.getCenter(center);
    root.position.sub(center);
    const wrapper = new THREE.Group();
    wrapper.add(root);
    _missilePrototype = wrapper;
  } catch (err) {
    console.warn('[models] missile load failed:', err);
  }
}

/** Return a clone of the missile mesh, or null if not loaded. */
export function getMissileMesh() {
  if (!_missilePrototype) return null;
  return _missilePrototype.clone(true);
}

/* -----------------------------------------------------------------------
 * UFO boss mesh
 * --------------------------------------------------------------------- */
export async function preloadUfoModel() {
  try {
    const gltf = await loader.loadAsync(UFO_PATH);
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const widest = Math.max(size.x, size.z) || 1;
    root.scale.setScalar(UFO_TARGET_LENGTH / widest);
    const newBox = new THREE.Box3().setFromObject(root);
    const center = new THREE.Vector3();
    newBox.getCenter(center);
    root.position.sub(center);
    const wrapper = new THREE.Group();
    wrapper.add(root);
    _ufoPrototype = wrapper;
  } catch (err) {
    console.warn('[models] UFO load failed:', err);
  }
}

export function getUfoMesh() {
  if (!_ufoPrototype) return null;
  return _ufoPrototype.clone(true);
}

/* UFO2 drone mesh */
export async function preloadUfo2Model() {
  try {
    const gltf = await loader.loadAsync(UFO2_PATH);
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const widest = Math.max(size.x, size.z) || 1;
    root.scale.setScalar(UFO2_TARGET_LENGTH / widest);
    const newBox = new THREE.Box3().setFromObject(root);
    const center = new THREE.Vector3();
    newBox.getCenter(center);
    root.position.sub(center);
    const wrapper = new THREE.Group();
    wrapper.add(root);
    _ufo2Prototype = wrapper;
  } catch (err) {
    console.warn('[models] UFO2 load failed:', err);
  }
}

export function getUfo2Mesh() {
  if (!_ufo2Prototype) return null;
  return _ufo2Prototype.clone(true);
}

/* -----------------------------------------------------------------------
 * Arena GLBs (island, ocean) — loaded based on the active map.
 * --------------------------------------------------------------------- */
export async function preloadArenaModels() {
  const map = MAPS[activeMapId];
  arenaCache.clear();
  const entries = Object.entries(map.paths);
  await Promise.all(entries.map(async ([key, path]) => {
    try {
      const gltf = await loader.loadAsync(path);
      const root = gltf.scene;
      const cfg = map.fit[key];
      // Scale by HORIZONTAL extent (X/Z) so the height isn't accidentally
      // dominant — otherwise a tall mountain peak makes the whole island
      // shrink horizontally to fit.
      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      box.getSize(size);
      const widest = Math.max(size.x, size.z) || 1;
      root.scale.setScalar(cfg.length / widest);
      // Re-center horizontally on origin; raise/lower per cfg.lift.
      const newBox = new THREE.Box3().setFromObject(root);
      const center = new THREE.Vector3();
      newBox.getCenter(center);
      root.position.x -= center.x;
      root.position.z -= center.z;
      // For the island, drop it so its base sits roughly at sea level (y=0)
      // rather than its center.
      if (key === 'island') {
        const baseY = newBox.min.y;
        root.position.y -= baseY;
      } else {
        root.position.y = cfg.lift;
      }
      arenaCache.set(key, root);
    } catch (err) {
      console.warn(`[models] failed to load arena ${key} from ${ARENA_PATHS[key]}:`, err);
    }
  }));
}

export function getArenaModel(key) {
  return arenaCache.get(key) || null;
}

/**
 * Sample heights from the loaded island GLB by raycasting downward at each
 * grid point. Returns a Float32Array suitable for plugging into the existing
 * heightmap structure used by gamestate.checkTerrainCollision.
 *
 * The island GLB must already have its world matrix updated (i.e., be added
 * to the scene with at least one renderer.render call OR call
 * `island.updateMatrixWorld(true)` first).
 */
const _ray = new THREE.Raycaster();
const _origin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
export function bakeIslandHeightmap(width, depth, segments, maxRayHeight = 2000) {
  const island = arenaCache.get('island');
  if (!island) return null;
  island.updateMatrixWorld(true);

  // Collect leaf meshes once.
  const meshes = [];
  island.traverse((obj) => { if (obj.isMesh) meshes.push(obj); });
  if (meshes.length === 0) return null;

  // High-poly bail: synchronous raycasts against very dense meshes (city
  // skylines, etc.) would freeze the page for seconds. The procedural
  // heightmap from arena.js stays in place if we skip the bake.
  let triCount = 0;
  for (const m of meshes) {
    const geom = m.geometry;
    if (!geom) continue;
    if (geom.index) triCount += geom.index.count / 3;
    else if (geom.attributes?.position) triCount += geom.attributes.position.count / 3;
  }
  if (triCount > 60000) {
    console.warn(`[island] heightmap bake skipped (${Math.round(triCount)} triangles); using procedural collision.`);
    return null;
  }

  // Compute the island's horizontal bounding circle so we only raycast
  // grid points inside it; outside is sea level (0).
  const box = new THREE.Box3().setFromObject(island);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const horizSize = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const islandR = horizSize / 2 + 50; // small buffer

  const N = segments + 1;
  const data = new Float32Array(N * N);
  let raycasts = 0;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const wx = (x / (N - 1) - 0.5) * width;
      const wz = (z / (N - 1) - 0.5) * depth;
      const dx = wx - center.x, dz = wz - center.z;
      if (dx * dx + dz * dz > islandR * islandR) {
        data[z * N + x] = 0;
        continue;
      }
      _origin.set(wx, maxRayHeight, wz);
      _ray.set(_origin, _down);
      const hits = _ray.intersectObjects(meshes, false);
      data[z * N + x] = hits.length > 0 ? Math.max(0, hits[0].point.y) : 0;
      raycasts++;
    }
  }
  console.log(`[island] baked heightmap: ${raycasts} raycasts inside ${islandR.toFixed(0)}m radius`);
  return { data, size: N };
}
