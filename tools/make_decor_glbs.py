# Blender Python script — generates bird.glb and cloud.glb decor assets.
#
# How to run:
#   1. Open Blender (any recent 3.x / 4.x).
#   2. Open the "Scripting" workspace (top tabs).
#   3. Click "Open" and load this file (or paste its contents into a new script).
#   4. Edit OUTPUT_DIR below if your worktree path differs.
#   5. Press "Run Script" (or Alt+P).
#
# Output:
#   <repo>/public/assets/models/bird.glb
#   <repo>/public/assets/models/cloud.glb
#
# These are intentionally low-poly — birds are silhouettes seen from
# distance, clouds are billboard-ish blobs. The engine clones them and
# scatters multiple instances across the arena.

import bpy
import bmesh
import os
import math

# ---------------------------------------------------------------------------
# CONFIG — adjust if your repo lives elsewhere.
# ---------------------------------------------------------------------------
OUTPUT_DIR = os.path.expanduser(
    "~/Desktop/DogFighter/.claude/worktrees/gracious-goldwasser/public/assets/models"
)


def clear_scene():
    """Wipe everything so each export starts from an empty .blend state."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Also remove orphaned meshes / materials so re-runs don't accumulate.
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)


def make_material(name, base_color, emission=None):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    # Principled BSDF is always at index 0 in a new node-based material.
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = base_color
        # Older / newer Blender versions name these slightly differently —
        # silently skip any input that's missing.
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = 0.85
        if "Specular" in bsdf.inputs:
            bsdf.inputs["Specular"].default_value = 0.1
        elif "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.1
        if emission and "Emission" in bsdf.inputs:
            bsdf.inputs["Emission"].default_value = emission
        elif emission and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = emission
    return mat


# ---------------------------------------------------------------------------
# BIRD — simple silhouette: tiny body + two flat wings forming a shallow V.
#        Wingspan ~1.6m so a flock reads from distance.
# ---------------------------------------------------------------------------
def build_bird():
    mesh = bpy.data.meshes.new("Bird")
    bm = bmesh.new()

    # Body (a thin elongated diamond, points along +X).
    body_verts = [
        bm.verts.new((0.5, 0, 0)),    # nose
        bm.verts.new((-0.4, 0, 0)),   # tail
        bm.verts.new((0, 0.08, 0.04)),  # top
        bm.verts.new((0, -0.08, 0.04)), # bottom-ish (slight)
        bm.verts.new((0, 0, -0.04)),    # belly
    ]
    bm.faces.new([body_verts[0], body_verts[2], body_verts[1]])
    bm.faces.new([body_verts[0], body_verts[1], body_verts[3]])
    bm.faces.new([body_verts[0], body_verts[3], body_verts[4]])
    bm.faces.new([body_verts[0], body_verts[4], body_verts[2]])
    bm.faces.new([body_verts[1], body_verts[2], body_verts[4]])
    bm.faces.new([body_verts[1], body_verts[4], body_verts[3]])

    # Wings — two flat triangles, swept back, slight V dihedral.
    # Right wing.
    rw_root_f = bm.verts.new((0.05, 0, 0.02))
    rw_root_b = bm.verts.new((-0.15, 0, 0.02))
    rw_tip = bm.verts.new((-0.05, 0.8, 0.12))
    bm.faces.new([rw_root_f, rw_tip, rw_root_b])
    # Left wing (mirror).
    lw_root_f = bm.verts.new((0.05, 0, 0.02))
    lw_root_b = bm.verts.new((-0.15, 0, 0.02))
    lw_tip = bm.verts.new((-0.05, -0.8, 0.12))
    bm.faces.new([lw_root_f, lw_root_b, lw_tip])

    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("Bird", mesh)
    bpy.context.collection.objects.link(obj)

    mat = make_material("BirdMat", (0.07, 0.07, 0.08, 1))
    obj.data.materials.append(mat)

    # Rotate so forward is -Y (Blender) -> -Z after GLB export.
    # GLTF exports with Y-up. The engine treats -Z as forward.
    # Default Blender forward is -Y; the Three.js convention after gltf
    # export will be -Z. Leave the bird pointing along +X here — the
    # engine spawner can rotate it to its travel direction.
    return obj


# ---------------------------------------------------------------------------
# CLOUD — a few overlapping flattened spheres (ico, low subdiv) merged
#         into one mesh. Soft-looking but very low poly.
# ---------------------------------------------------------------------------
def build_cloud():
    # Lay down 5 ico-spheres at varied scales / positions, then JOIN them.
    blobs = []
    placements = [
        (0.0,  0.0, 0.0,  1.30),
        (1.6,  0.2, 0.0,  0.95),
        (-1.5, 0.0, 0.1,  1.05),
        (0.5,  0.4, 0.6,  0.85),
        (-0.6, 0.3, -0.7, 0.80),
    ]
    for (x, y, z, s) in placements:
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=2, radius=s, location=(x, y, z)
        )
        ob = bpy.context.active_object
        # Flatten vertically so clouds aren't perfect spheres.
        ob.scale.z = 0.55
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        blobs.append(ob)

    # Join into one object.
    bpy.ops.object.select_all(action="DESELECT")
    for ob in blobs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = blobs[0]
    bpy.ops.object.join()
    cloud = bpy.context.active_object
    cloud.name = "Cloud"

    # Smooth shading + recompute normals.
    bpy.ops.object.select_all(action="DESELECT")
    cloud.select_set(True)
    bpy.context.view_layer.objects.active = cloud
    bpy.ops.object.shade_smooth()

    mat = make_material("CloudMat", (1.0, 1.0, 1.0, 1.0))
    # Slight emission so clouds don't go dim under low ambient.
    if cloud.data.materials:
        cloud.data.materials[0] = mat
    else:
        cloud.data.materials.append(mat)
    return cloud


# ---------------------------------------------------------------------------
# Export helper.
# ---------------------------------------------------------------------------
def export_glb(obj, filename):
    out_path = os.path.join(OUTPUT_DIR, filename)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    # Select only the target object so we export just it.
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )
    print(f"[decor] wrote {out_path}")


# ---------------------------------------------------------------------------
# Main.
# ---------------------------------------------------------------------------
def main():
    clear_scene()
    bird = build_bird()
    export_glb(bird, "bird.glb")

    clear_scene()
    cloud = build_cloud()
    export_glb(cloud, "cloud.glb")

    print("[decor] done. drop into the game by reloading the dev server.")


if __name__ == "__main__":
    main()
