import * as THREE from "three";

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** A chain point: a world position plus a heading (yaw around Y). Every
 * track module is built assuming it starts level at its anchor's yaw, and
 * hands off the next module's placement via its own `end` anchor. */
export interface Anchor {
  position: THREE.Vector3;
  yaw: number;
}

export interface WorldPart {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** Resolve a point + orientation defined in `base`'s local frame into world space. */
export function composePart(
  base: Anchor,
  localPos: THREE.Vector3,
  localQuat: THREE.Quaternion,
): WorldPart {
  const yawQuat = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, base.yaw);
  const position = localPos.clone().applyQuaternion(yawQuat).add(base.position);
  const quaternion = yawQuat.clone().multiply(localQuat);
  return { position, quaternion };
}

/** Resolve a local offset + yaw delta into a new world-space anchor for chaining. */
export function composeAnchor(
  base: Anchor,
  localPos: THREE.Vector3,
  localYawDelta: number,
): Anchor {
  const yawQuat = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, base.yaw);
  const position = localPos.clone().applyQuaternion(yawQuat).add(base.position);
  return { position, yaw: base.yaw + localYawDelta };
}

/** Rotate a local direction vector (no translation) into world space. */
export function composeDirection(base: Anchor, localDir: THREE.Vector3): THREE.Vector3 {
  return localDir.clone().applyAxisAngle(Y_AXIS, base.yaw);
}
