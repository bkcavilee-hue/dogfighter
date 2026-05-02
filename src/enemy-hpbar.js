// Billboarded HP bar that hovers above an enemy mesh. Used by UFOs and
// drones so the player can see how much damage a UFO has taken.
//
// Implementation: two stacked PlaneGeometry meshes (background + fill)
// added as children of the enemy mesh, lifted above it on +Y. Each frame
// we manually orient the bar group toward the camera (billboarding) and
// rescale the fill to match HP / maxHP. Color shifts red as HP drops.
import * as THREE from 'three';

const _camPos = new THREE.Vector3();
const _barPos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _color = new THREE.Color();

const FULL_COLOR = new THREE.Color(0x44ff77);  // green
const LOW_COLOR  = new THREE.Color(0xff4444);  // red

/**
 * Create an HP bar and attach it to `parentMesh` (added as child).
 * Returns an object with an `update(camera, hp, maxHP)` method.
 *
 *   width / height — plane dimensions in world units
 *   yOffset        — meters above the parent mesh's local origin
 */
export function attachHpBar(parentMesh, { width = 14, height = 1.2, yOffset = 12 } = {}) {
  const group = new THREE.Group();
  group.position.y = yOffset;
  group.renderOrder = 999; // render on top of other geometry

  // Background — dim grey/red, slightly larger to act as a frame.
  const bgGeom = new THREE.PlaneGeometry(width + 0.6, height + 0.4);
  const bgMat = new THREE.MeshBasicMaterial({
    color: 0x110a0a, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
    depthTest: false, depthWrite: false,
  });
  const bg = new THREE.Mesh(bgGeom, bgMat);
  bg.renderOrder = 999;
  group.add(bg);

  // Fill — colored, scales with HP. Anchored at left edge by translating
  // the geometry so the pivot is x=-width/2; that way scale.x shrinks
  // toward the left edge instead of the center.
  const fillGeom = new THREE.PlaneGeometry(width, height);
  fillGeom.translate(width / 2, 0, 0); // pivot to left edge
  const fillMat = new THREE.MeshBasicMaterial({
    color: FULL_COLOR.getHex(), side: THREE.DoubleSide, transparent: true,
    depthTest: false, depthWrite: false, opacity: 1,
  });
  const fill = new THREE.Mesh(fillGeom, fillMat);
  fill.position.x = -width / 2;
  fill.position.z = 0.02; // sit slightly in front of the background
  fill.renderOrder = 1000;
  group.add(fill);

  parentMesh.add(group);

  return {
    group,
    bg,
    fill,
    width,
    update(camera, hp, maxHP) {
      const ratio = THREE.MathUtils.clamp(hp / Math.max(1, maxHP), 0, 1);
      fill.scale.x = ratio;
      // Red→green gradient.
      _color.copy(LOW_COLOR).lerp(FULL_COLOR, ratio);
      fillMat.color.copy(_color);
      // Hide entirely when full HP — only show after first damage.
      const visible = ratio < 0.999 && ratio > 0;
      group.visible = visible;
      if (!visible) return;
      // Billboard toward camera (rotate group so its forward faces camera).
      camera.getWorldPosition(_camPos);
      group.getWorldPosition(_barPos);
      _quat.setFromRotationMatrix(
        new THREE.Matrix4().lookAt(_barPos, _camPos, camera.up),
      );
      // The lookAt above gives world rotation; convert to local by removing
      // the parent's rotation.
      if (group.parent) {
        const parentQuat = new THREE.Quaternion();
        group.parent.getWorldQuaternion(parentQuat);
        parentQuat.invert();
        group.quaternion.copy(parentQuat).multiply(_quat);
      } else {
        group.quaternion.copy(_quat);
      }
    },
    dispose() {
      bgGeom.dispose(); bgMat.dispose();
      fillGeom.dispose(); fillMat.dispose();
      if (group.parent) group.parent.remove(group);
    },
  };
}
