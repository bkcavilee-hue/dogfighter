// Arena: procedural heightmap terrain, animated ocean shader, basic sky.
// No external assets required — swap in a real heightmap texture later by
// replacing `generateNoiseHeightmap` with a TextureLoader read.
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { RAPIER, createRigidBody, createCollider } from './physics.js';

export const ARENA = {
  width: 3000,           // intimate dogfighting arena
  depth: 3000,
  segments: 96,
  maxHeight: 280,
  seaLevel: 0,
  maxAltitude: 1200,     // playable ceiling — room to climb but not cosmic
};

/* -----------------------------------------------------------------------
 * Heightmap
 * --------------------------------------------------------------------- */
export function generateHeightmap(seed = 1337) {
  // Deterministic-ish: simplex-noise needs a seeded PRNG; cheap LCG works.
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const n2 = createNoise2D(rand);

  const N = ARENA.segments + 1;
  const data = new Float32Array(N * N);
  // Central island: strong gaussian falloff from the middle so the
  // collision footprint matches the visible island GLB. Outside the island
  // the heightmap is at sea level (no random invisible mountains).
  const ISLAND_RADIUS = 0.14; // fraction of arena half-width (matches ~1100m visual)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      // Multi-octave fbm for terrain variety.
      let h = 0, amp = 1, freq = 2.5, norm = 0;
      for (let o = 0; o < 5; o++) {
        h += amp * n2(u * freq, v * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2.05;
      }
      h /= norm;                                  // -1..1
      // Bell curve mask centered at (0.5, 0.5).
      const cx = u - 0.5, cy = v - 0.5;
      const r2 = (cx * cx + cy * cy) / (ISLAND_RADIUS * ISLAND_RADIUS);
      const islandMask = Math.exp(-r2 * 1.3);     // tight central bump
      h = (h * 0.5 + 0.5) * islandMask;           // 0..1
      h = Math.pow(h, 1.4) * ARENA.maxHeight;
      data[y * N + x] = h;
    }
  }
  return { data, size: N };
}

/* -----------------------------------------------------------------------
 * Terrain mesh + Rapier heightfield collider
 * --------------------------------------------------------------------- */
export function createTerrain(heightmap) {
  const { data, size } = heightmap;
  const geom = new THREE.PlaneGeometry(
    ARENA.width, ARENA.depth, size - 1, size - 1
  );
  geom.rotateX(-Math.PI / 2);

  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, data[i]);
  }
  geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x4d6b3a,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: false,
    vertexColors: false,
  });

  // Vertex coloring by altitude for cheap visual variety.
  const colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xc8b890);
  const grass = new THREE.Color(0x4d6b3a);
  const rock = new THREE.Color(0x6e6960);
  const snow = new THREE.Color(0xf0f4ff);
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / ARENA.maxHeight;
    let c;
    if (h < 0.04) c = sand;
    else if (h < 0.45) c = grass.clone().lerp(rock, (h - 0.04) / 0.41);
    else if (h < 0.78) c = rock.clone().lerp(snow, (h - 0.45) / 0.33);
    else c = snow;
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  mat.vertexColors = true;

  const mesh = new THREE.Mesh(geom, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  // Rapier heightfield collider. Rapier expects an n*n Float32Array of heights
  // mapped to a unit square scaled by `scale`.
  const body = createRigidBody({ x: 0, y: 0, z: 0 }, null, 'static');
  const heights = new Float32Array(size * size);
  // Rapier indexes heights row-major in (x,z). Our data is already row-major (y=row, x=col).
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      heights[x * size + z] = data[z * size + x];
    }
  }
  const colliderDesc = RAPIER.ColliderDesc.heightfield(
    size - 1,
    size - 1,
    heights,
    { x: ARENA.width, y: 1.0, z: ARENA.depth }
  ).setFriction(0.9);
  createCollider(body, colliderDesc);

  return { mesh, body, heightmap };
}

/** Sample the heightmap at world (x,z) in meters. */
export function sampleHeight(heightmap, x, z) {
  const { data, size } = heightmap;
  const u = (x + ARENA.width / 2) / ARENA.width;
  const v = (z + ARENA.depth / 2) / ARENA.depth;
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const fx = u * (size - 1);
  const fy = v * (size - 1);
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const i = (xx, yy) => data[Math.min(size - 1, yy) * size + Math.min(size - 1, xx)];
  const h00 = i(ix, iy), h10 = i(ix + 1, iy);
  const h01 = i(ix, iy + 1), h11 = i(ix + 1, iy + 1);
  const a = h00 * (1 - tx) + h10 * tx;
  const b = h01 * (1 - tx) + h11 * tx;
  return a * (1 - ty) + b * ty;
}

/* -----------------------------------------------------------------------
 * Ocean (animated shader plane)
 * --------------------------------------------------------------------- */
export function createOcean() {
  const geom = new THREE.PlaneGeometry(ARENA.width * 1.3, ARENA.depth * 1.3, 1, 1);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0x3aa6c8) },
      uDeep:    { value: new THREE.Color(0x05283f) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      varying vec3 vWorld;
      // Cheap stylized waves via summed sines.
      float wave(vec2 p, float t) {
        float w = 0.0;
        w += sin(p.x * 0.012 + t * 0.6) * 0.5;
        w += sin(p.y * 0.018 - t * 0.4) * 0.4;
        w += sin((p.x + p.y) * 0.026 + t * 0.9) * 0.3;
        return w;
      }
      void main() {
        float w = wave(vWorld.xz, uTime);
        float foam = smoothstep(0.6, 1.1, w);
        vec3 col = mix(uDeep, uShallow, smoothstep(-0.3, 0.8, w));
        col = mix(col, vec3(1.0), foam * 0.55);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = ARENA.seaLevel;
  mesh.name = 'ocean';
  return { mesh, material: mat };
}

/* -----------------------------------------------------------------------
 * Sky (gradient dome — cheap and asset-free)
 * --------------------------------------------------------------------- */
export function createSky() {
  const geom = new THREE.SphereGeometry(8000, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTop:    { value: new THREE.Color(0x0b3a66) },
      uMid:    { value: new THREE.Color(0x4096c4) },
      uHorizon:{ value: new THREE.Color(0xb6d8e8) },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      varying vec3 vWorld;
      void main() {
        float h = normalize(vWorld).y * 0.5 + 0.5;
        vec3 c = mix(uHorizon, uMid, smoothstep(0.45, 0.7, h));
        c = mix(c, uTop, smoothstep(0.7, 1.0, h));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geom, mat);
}

/* -----------------------------------------------------------------------
 * Lights
 * --------------------------------------------------------------------- */
export function setupLights(scene) {
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
  sun.position.set(800, 1400, 500);
  sun.castShadow = false; // shadows over 4km terrain are too costly for MVP
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x6a88a8, 0.55));
  scene.add(new THREE.HemisphereLight(0xb8d8ff, 0x4d6b3a, 0.4));
  return { sun };
}
