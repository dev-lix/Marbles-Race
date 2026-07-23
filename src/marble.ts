import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

export interface Marble {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
}

export function createMarble(
  scene: THREE.Scene,
  world: RAPIER.World,
  radius: number,
  position: THREE.Vector3,
  color: number,
): Marble {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 16, 16),
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.15,
      metalness: 0.5,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    }),
  );
  mesh.castShadow = true;
  scene.add(mesh);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      // Held frozen in mid-air until the race releases it (see releaseMarble).
      .setGravityScale(0),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(radius).setRestitution(0.4).setFriction(0.7),
    body,
  );

  return { mesh, body };
}

export function syncMarble(marble: Marble): void {
  const t = marble.body.translation();
  const r = marble.body.rotation();
  marble.mesh.position.set(t.x, t.y, t.z);
  marble.mesh.quaternion.set(r.x, r.y, r.z, r.w);
}

/** Put a marble back at its (new, randomized) start position, held frozen in
 * mid-air — no gate to hold it back, gravity itself is switched off until
 * `releaseMarble` lets it drop. */
export function resetMarble(marble: Marble, position: THREE.Vector3): void {
  marble.body.setTranslation(position, true);
  marble.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  marble.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  marble.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  marble.body.setGravityScale(0, true);
  syncMarble(marble);
}

/** Switch gravity back on so a held marble falls onto the track. A body that
 * hasn't moved in a while falls asleep, and Rapier only actually honors the
 * `wakeUp` flag on some setters — `setGravityScale(1, true)` alone leaves it
 * asleep (and thus still frozen) here, so `wakeUp()` must be called explicitly. */
export function releaseMarble(marble: Marble): void {
  marble.body.setGravityScale(1, true);
  marble.body.wakeUp();
}
