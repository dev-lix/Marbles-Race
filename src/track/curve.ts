import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { composeAnchor, type Anchor } from "./anchor";
import type { FloorSample, TrackModule } from "./part";
import { buildFloorSegment, buildSideRails } from "./segment";

export interface CurveRampOptions {
  radius?: number;
  arcDeg?: number;
  direction?: "left" | "right";
  width?: number;
  thickness?: number;
  angleDeg?: number;
  /** Sub-segment size; smaller = smoother curve and smaller per-joint gaps. */
  degPerSegment?: number;
}

const curveMaterial = new THREE.MeshStandardMaterial({
  color: 0x3d5a80,
  roughness: 0.6,
});

/** A ramp that curves through `arcDeg` on a horizontal arc of `radius` while
 * descending at a constant `angleDeg` slope, same convention as a straight
 * ramp. Built from many small straight sub-segments (each turning only a few
 * degrees) rather than one sharp yaw, so consecutive sub-segments overlap
 * (see SEGMENT_OVERLAP) instead of leaving a gap on the outside of the turn.
 * Ends level-yawed like every other module, so straight ramps chain onto
 * either end with no special-casing. */
export function createCurveRamp(
  scene: THREE.Scene,
  world: RAPIER.World,
  placement: Anchor,
  opts: CurveRampOptions = {},
): TrackModule {
  const radius = opts.radius ?? 5;
  const arcDeg = opts.arcDeg ?? 60;
  const direction = opts.direction ?? "right";
  const width = opts.width ?? 3;
  const thickness = opts.thickness ?? 0.3;
  const angleDeg = opts.angleDeg ?? 15;
  const degPerSegment = opts.degPerSegment ?? 7.5;
  const sign = direction === "right" ? 1 : -1;

  const segments = Math.max(2, Math.ceil(arcDeg / degPerSegment));
  const arcLength = THREE.MathUtils.degToRad(arcDeg) * radius;
  const segmentLength = arcLength / segments;
  const yawPerSegment = THREE.MathUtils.degToRad(arcDeg / segments) * sign;

  const meshes: THREE.Object3D[] = [];
  const bodies: RAPIER.RigidBody[] = [];
  const colliders: RAPIER.Collider[] = [];
  const floorSamples: FloorSample[] = [];

  let current = placement;
  for (let i = 0; i < segments; i++) {
    current = composeAnchor(current, new THREE.Vector3(0, 0, 0), yawPerSegment);

    const seg = buildFloorSegment(
      scene,
      world,
      current,
      segmentLength,
      width,
      thickness,
      angleDeg,
      curveMaterial,
    );
    meshes.push(...seg.meshes);
    bodies.push(...seg.bodies);
    colliders.push(...seg.colliders);
    floorSamples.push(...seg.floorSamples);

    const rails = buildSideRails(scene, world, current, segmentLength, width, angleDeg);
    meshes.push(...rails.meshes);
    bodies.push(...rails.bodies);
    colliders.push(...rails.colliders);

    current = seg.end;
  }

  return { meshes, bodies, colliders, start: placement, end: current, floorSamples };
}
