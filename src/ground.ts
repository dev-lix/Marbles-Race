import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

const GROUND_SIZE = 800;
const GROUND_THICKNESS = 0.5;

export function createGround(scene: THREE.Scene, world: RAPIER.World) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(GROUND_SIZE, GROUND_THICKNESS, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x2b2b35, roughness: 0.9 }),
  );
  mesh.position.y = -GROUND_THICKNESS / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -GROUND_THICKNESS / 2, 0),
  );
  // Active events so a marble touching down here (having bounced off the
  // track somewhere) can be detected as a DNF — see main.ts.
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(
      GROUND_SIZE / 2,
      GROUND_THICKNESS / 2,
      GROUND_SIZE / 2,
    ).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );

  return { mesh, body, collider };
}
