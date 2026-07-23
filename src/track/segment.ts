import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { composeAnchor, composePart, type Anchor } from "./anchor";
import { addFixedBox, type FloorSample } from "./part";

const X_AXIS = new THREE.Vector3(1, 0, 0);

/** Every ramp-like segment extends this far past its own nominal start,
 * biting backward into whatever placed it there. Two segments meeting at a
 * yaw joint (e.g. between sub-segments of a curve) would otherwise leave a
 * sliver-shaped gap on the outside of the turn; overlapping guarantees they
 * always intersect instead, at the cost of a harmless sliver of
 * double-thickness floor/rail at the joint. */
export const SEGMENT_OVERLAP = 0.15;

const RAIL_HEIGHT = 0.6;
const RAIL_THICKNESS = 0.15;
const railMaterial = new THREE.MeshStandardMaterial({
  color: 0x293241,
  roughness: 0.7,
});

export interface SegmentResult {
  meshes: THREE.Object3D[];
  bodies: RAPIER.RigidBody[];
  colliders: RAPIER.Collider[];
  end: Anchor;
  floorSamples: FloorSample[];
}

function sampleFloor(
  placement: Anchor,
  pitchQuat: THREE.Quaternion,
  length: number,
  width: number,
): FloorSample[] {
  const samples: FloorSample[] = [];
  const stepsAlong = Math.max(1, Math.round(length / 0.5));
  const across = [-0.4, 0, 0.4];
  for (let i = 0; i <= stepsAlong; i++) {
    const t = i / stepsAlong;
    for (const s of across) {
      const local = new THREE.Vector3(s * width, 0.15, -t * length).applyQuaternion(
        pitchQuat,
      );
      const part = composePart(placement, local, new THREE.Quaternion());
      samples.push({ origin: part.position, direction: new THREE.Vector3(0, -1, 0) });
    }
  }
  return samples;
}

/** One tilted floor slab descending from `placement` by `angleDeg`, extended
 * `overlapBack` past its own start (see SEGMENT_OVERLAP). Its `end` anchor is
 * still based on the nominal `length`, so chaining stays geometrically exact
 * regardless of the collision padding. */
export function buildFloorSegment(
  scene: THREE.Scene,
  world: RAPIER.World,
  placement: Anchor,
  length: number,
  width: number,
  thickness: number,
  angleDeg: number,
  material: THREE.Material,
  overlapBack: number = SEGMENT_OVERLAP,
): SegmentResult {
  const angle = THREE.MathUtils.degToRad(angleDeg);
  const pitchQuat = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -angle);
  const boxLength = length + overlapBack;

  const centerLocal = new THREE.Vector3(
    0,
    -thickness / 2,
    (overlapBack - length) / 2,
  ).applyQuaternion(pitchQuat);
  const part = composePart(placement, centerLocal, pitchQuat);
  const { mesh, body, collider } = addFixedBox(
    scene,
    world,
    part,
    new THREE.Vector3(width, thickness, boxLength),
    material,
  );

  const endLocal = new THREE.Vector3(0, 0, -length).applyQuaternion(pitchQuat);
  const end = composeAnchor(placement, endLocal, 0);
  const floorSamples = sampleFloor(placement, pitchQuat, length, width);

  return {
    meshes: [mesh],
    bodies: [body],
    colliders: [collider],
    end,
    floorSamples,
  };
}

/** Side rails matching one floor segment's footprint (same overlap rule),
 * for containment on ramps/curves marbles could otherwise bounce off of. */
export function buildSideRails(
  scene: THREE.Scene,
  world: RAPIER.World,
  placement: Anchor,
  length: number,
  width: number,
  angleDeg: number,
  overlapBack: number = SEGMENT_OVERLAP,
): { meshes: THREE.Object3D[]; bodies: RAPIER.RigidBody[]; colliders: RAPIER.Collider[] } {
  const angle = THREE.MathUtils.degToRad(angleDeg);
  const pitchQuat = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -angle);
  const boxLength = length + overlapBack;

  const meshes: THREE.Object3D[] = [];
  const bodies: RAPIER.RigidBody[] = [];
  const colliders: RAPIER.Collider[] = [];

  for (const side of [-1, 1]) {
    const xOffset = (side * (width + RAIL_THICKNESS)) / 2;
    const centerLocal = new THREE.Vector3(
      xOffset,
      RAIL_HEIGHT / 2,
      (overlapBack - length) / 2,
    ).applyQuaternion(pitchQuat);
    const part = composePart(placement, centerLocal, pitchQuat);
    const rail = addFixedBox(
      scene,
      world,
      part,
      new THREE.Vector3(RAIL_THICKNESS, RAIL_HEIGHT, boxLength),
      railMaterial,
    );
    meshes.push(rail.mesh);
    bodies.push(rail.body);
    colliders.push(rail.collider);
  }

  return { meshes, bodies, colliders };
}
