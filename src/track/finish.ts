import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { composePart, type Anchor } from "./anchor";

export interface FinishLine {
  mesh: THREE.Object3D;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

const finishMaterial = new THREE.MeshBasicMaterial({
  color: 0xffee55,
  transparent: true,
  opacity: 0.25,
  side: THREE.DoubleSide,
});

const FINISH_HEIGHT = 3;
const DEFAULT_FINISH_DEPTH = 0.4;

/** A sensor volume spanning the track width. Detect crossings by watching
 * this collider's handle in the physics event queue (see main.ts). `depth`
 * (along the anchor's forward axis) defaults to a thin line for a flat
 * finish straightaway; widen it when placing this right under a funnel or
 * other exit whose marbles may land anywhere within a larger area. */
export function createFinishLine(
  scene: THREE.Scene,
  world: RAPIER.World,
  anchor: Anchor,
  width: number,
  depth: number = DEFAULT_FINISH_DEPTH,
): FinishLine {
  const localQuat = new THREE.Quaternion();
  const localPos = new THREE.Vector3(0, FINISH_HEIGHT / 2, 0);
  const part = composePart(anchor, localPos, localQuat);

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, FINISH_HEIGHT, depth),
    finishMaterial,
  );
  mesh.position.copy(part.position);
  mesh.quaternion.copy(part.quaternion);
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
    RAPIER.ColliderDesc.cuboid(width / 2, FINISH_HEIGHT / 2, depth / 2)
      .setSensor(true)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );

  return { mesh, body, collider };
}
