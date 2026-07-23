import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Anchor } from "./anchor";
import type { TrackModule } from "./part";
import { buildFloorSegment, buildSideRails } from "./segment";

export interface StraightRampOptions {
  length?: number;
  width?: number;
  thickness?: number;
  angleDeg?: number;
}

const rampMaterial = new THREE.MeshStandardMaterial({
  color: 0x3d5a80,
  roughness: 0.6,
});

/** A flat ramp descending from `placement`, tilted down about the local X
 * axis by `angleDeg`. Ends level-yawed at the bottom of the slope so the
 * next module can be chained on directly. */
export function createStraightRamp(
  scene: THREE.Scene,
  world: RAPIER.World,
  placement: Anchor,
  opts: StraightRampOptions = {},
): TrackModule {
  const length = opts.length ?? 6;
  const width = opts.width ?? 3;
  const thickness = opts.thickness ?? 0.3;
  const angleDeg = opts.angleDeg ?? 20;

  const seg = buildFloorSegment(
    scene,
    world,
    placement,
    length,
    width,
    thickness,
    angleDeg,
    rampMaterial,
  );
  const rails = buildSideRails(scene, world, placement, length, width, angleDeg);

  return {
    meshes: [...seg.meshes, ...rails.meshes],
    bodies: [...seg.bodies, ...rails.bodies],
    colliders: [...seg.colliders, ...rails.colliders],
    start: placement,
    end: seg.end,
    floorSamples: seg.floorSamples,
  };
}
