import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { composePart, type Anchor } from "./anchor";
import type { TrackModule } from "./part";
import { buildFloorSegment, buildSideRails } from "./segment";

export interface SpinnerOptions {
  length?: number;
  width?: number;
  thickness?: number;
  /** Gentle tilt so marbles keep drifting through rather than stalling. */
  angleDeg?: number;
  paddleCount?: number;
  paddleLength?: number;
  paddleHeight?: number;
  /** Radians advanced per physics step (see `update`). */
  spinSpeed?: number;
}

export interface SpinnerModule extends TrackModule {
  /** Advance the paddle rotation by one physics step. Call once per frame,
   * before `world.step()`, so the kinematic body's next-step rotation is set
   * in time (see track/spinner.ts's comment on setNextKinematicRotation). */
  update: () => void;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
/** Hard ceiling on radians advanced per physics step, regardless of what a
 * caller (e.g. the randomized generator) asks for — a paddle wheel spinning
 * too fast reads as janky/unfair rather than a fun obstacle. */
const MAX_SPIN_SPEED = 0.025;

const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x3d5a80,
  roughness: 0.6,
});
const paddleMaterial = new THREE.MeshStandardMaterial({
  color: 0xdd4444,
  roughness: 0.35,
  metalness: 0.3,
});

/** A flat pass-through floor with a horizontal paddle wheel spinning above
 * it on a vertical axis — marbles rolling through get knocked sideways by
 * whichever paddle sweeps past. The hub is one kinematic rigid body with all
 * paddles as its (locally offset) colliders, so they always rotate together
 * without per-paddle bookkeeping. */
export function createSpinner(
  scene: THREE.Scene,
  world: RAPIER.World,
  placement: Anchor,
  opts: SpinnerOptions = {},
): SpinnerModule {
  const length = opts.length ?? 5;
  const width = opts.width ?? 3;
  const thickness = opts.thickness ?? 0.3;
  const angleDeg = opts.angleDeg ?? 6;
  const paddleCount = opts.paddleCount ?? 3;
  const paddleLength = opts.paddleLength ?? Math.min(width, length) * 0.42;
  const paddleHeight = opts.paddleHeight ?? 0.55;
  const spinSpeed = Math.min(opts.spinSpeed ?? 0.016, MAX_SPIN_SPEED);
  const paddleThickness = 0.15;

  const floorSeg = buildFloorSegment(
    scene,
    world,
    placement,
    length,
    width,
    thickness,
    angleDeg,
    floorMaterial,
  );
  const rails = buildSideRails(scene, world, placement, length, width, angleDeg);

  const meshes = [...floorSeg.meshes, ...rails.meshes];
  const bodies = [...floorSeg.bodies, ...rails.bodies];
  const colliders = [...floorSeg.colliders, ...rails.colliders];

  // Hub sits at the segment's midpoint, just above the (tilted) floor.
  const pitchQuat = new THREE.Quaternion().setFromAxisAngle(
    X_AXIS,
    -THREE.MathUtils.degToRad(angleDeg),
  );
  const hubLocal = new THREE.Vector3(0, paddleHeight / 2 + 0.05, -length / 2).applyQuaternion(
    pitchQuat,
  );
  const baseYawQuat = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, placement.yaw);
  const hubPart = composePart(placement, hubLocal, new THREE.Quaternion());

  const hubBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(hubPart.position.x, hubPart.position.y, hubPart.position.z)
      .setRotation({ x: baseYawQuat.x, y: baseYawQuat.y, z: baseYawQuat.z, w: baseYawQuat.w }),
  );
  bodies.push(hubBody);

  const hubGroup = new THREE.Group();
  hubGroup.position.copy(hubPart.position);
  hubGroup.quaternion.copy(baseYawQuat);
  scene.add(hubGroup);
  meshes.push(hubGroup);

  for (let i = 0; i < paddleCount; i++) {
    const angle = (i * 2 * Math.PI) / paddleCount;
    const offsetQuat = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, angle);
    const localOffset = new THREE.Vector3(paddleLength / 2, 0, 0).applyQuaternion(offsetQuat);

    const paddleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(paddleLength, paddleHeight, paddleThickness),
      paddleMaterial,
    );
    paddleMesh.position.copy(localOffset);
    paddleMesh.quaternion.copy(offsetQuat);
    paddleMesh.castShadow = true;
    hubGroup.add(paddleMesh);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      paddleLength / 2,
      paddleHeight / 2,
      paddleThickness / 2,
    )
      .setTranslation(localOffset.x, localOffset.y, localOffset.z)
      .setRotation({ x: offsetQuat.x, y: offsetQuat.y, z: offsetQuat.z, w: offsetQuat.w })
      .setFriction(0.2);
    colliders.push(world.createCollider(colliderDesc, hubBody));
  }

  let currentAngle = 0;
  function update(): void {
    currentAngle += spinSpeed;
    const spinQuat = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, currentAngle);
    const combined = baseYawQuat.clone().multiply(spinQuat);
    // setNextKinematicRotation takes effect on the *next* world.step(), so the
    // mesh is set directly from the same quaternion rather than reading
    // hubBody.rotation() back (which would still show last step's value and
    // visually lag a frame behind).
    hubBody.setNextKinematicRotation({
      x: combined.x,
      y: combined.y,
      z: combined.z,
      w: combined.w,
    });
    hubGroup.quaternion.copy(combined);
  }

  return {
    meshes,
    bodies,
    colliders,
    start: placement,
    end: floorSeg.end,
    floorSamples: floorSeg.floorSamples,
    update,
  };
}
