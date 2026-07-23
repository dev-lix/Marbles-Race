import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Anchor, WorldPart } from "./anchor";

/** A point where a marble is expected to find a solid surface, used by the
 * gap validator: cast a short ray from `origin` along `direction` and expect
 * a hit within a small distance (see track/validate.ts). */
export interface FloorSample {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
}

export interface TrackModule {
  meshes: THREE.Object3D[];
  bodies: RAPIER.RigidBody[];
  colliders: RAPIER.Collider[];
  start: Anchor;
  end: Anchor;
  floorSamples: FloorSample[];
}

/** Add a fixed box mesh + matching cuboid collider at a resolved world transform. */
export function addFixedBox(
  scene: THREE.Scene,
  world: RAPIER.World,
  part: WorldPart,
  size: THREE.Vector3,
  material: THREE.Material,
  friction: number = 0.7,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    material,
  );
  mesh.position.copy(part.position);
  mesh.quaternion.copy(part.quaternion);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(part.position.x, part.position.y, part.position.z)
      .setRotation({
        x: part.quaternion.x,
        y: part.quaternion.y,
        z: part.quaternion.z,
        w: part.quaternion.w,
      }),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setFriction(friction),
    body,
  );

  return { mesh, body, collider };
}
