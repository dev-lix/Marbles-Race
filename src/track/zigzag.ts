import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Anchor } from "./anchor";
import type { FloorSample, TrackModule } from "./part";
import { buildFloorSegment, buildSideRails } from "./segment";
import { createCurveRamp } from "./curve";

export interface ZigzagRampOptions {
  bends?: number;
  segmentLength?: number;
  width?: number;
  thickness?: number;
  angleDeg?: number;
  turnDeg?: number;
  curveRadius?: number;
}

const rampMaterial = new THREE.MeshStandardMaterial({
  color: 0x3d5a80,
  roughness: 0.6,
});

/** A switchback: straight segments joined by curved bends that alternate
 * left/right (via createCurveRamp), so marbles are guided smoothly through
 * each turn instead of jumping across a sharp, gap-prone yaw. */
export function createZigzagRamp(
  scene: THREE.Scene,
  world: RAPIER.World,
  placement: Anchor,
  opts: ZigzagRampOptions = {},
): TrackModule {
  const bends = opts.bends ?? 3;
  const segmentLength = opts.segmentLength ?? 3;
  const width = opts.width ?? 3;
  const thickness = opts.thickness ?? 0.3;
  const angleDeg = opts.angleDeg ?? 14;
  const turnDeg = opts.turnDeg ?? 60;
  const curveRadius = opts.curveRadius ?? 2.5;

  const meshes: THREE.Object3D[] = [];
  const bodies: RAPIER.RigidBody[] = [];
  const colliders: RAPIER.Collider[] = [];
  const floorSamples: FloorSample[] = [];

  function addStraight(at: Anchor): Anchor {
    const seg = buildFloorSegment(
      scene,
      world,
      at,
      segmentLength,
      width,
      thickness,
      angleDeg,
      rampMaterial,
    );
    meshes.push(...seg.meshes);
    bodies.push(...seg.bodies);
    colliders.push(...seg.colliders);
    floorSamples.push(...seg.floorSamples);

    const rails = buildSideRails(scene, world, at, segmentLength, width, angleDeg);
    meshes.push(...rails.meshes);
    bodies.push(...rails.bodies);
    colliders.push(...rails.colliders);

    return seg.end;
  }

  let current = addStraight(placement);
  for (let i = 0; i < bends; i++) {
    const direction = i % 2 === 0 ? "right" : "left";
    const curve = createCurveRamp(scene, world, current, {
      radius: curveRadius,
      arcDeg: turnDeg,
      direction,
      width,
      thickness,
      angleDeg,
    });
    meshes.push(...curve.meshes);
    bodies.push(...curve.bodies);
    colliders.push(...curve.colliders);
    floorSamples.push(...curve.floorSamples);

    current = addStraight(curve.end);
  }

  return { meshes, bodies, colliders, start: placement, end: current, floorSamples };
}
