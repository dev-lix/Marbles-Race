import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { composeAnchor, composeDirection, composePart, type Anchor } from "./anchor";
import { addFixedBox, type FloorSample, type TrackModule } from "./part";

export interface FunnelOptions {
  topRadius?: number;
  bottomRadius?: number;
  height?: number;
  sides?: number;
}

const funnelMaterial = new THREE.MeshStandardMaterial({
  color: 0xee6c4d,
  roughness: 0.35,
  metalness: 0.2,
});

/** A hopper made of flat trapezoidal panels arranged in a ring, tilting
 * inward from `topRadius` down to `bottomRadius`. Concave shapes can't be
 * represented by a single convex collider, so each panel gets its own
 * cuboid collider rather than one trimesh/hull for the whole cone. */
export function createFunnel(
  scene: THREE.Scene,
  world: RAPIER.World,
  placement: Anchor,
  opts: FunnelOptions = {},
): TrackModule {
  const topRadius = opts.topRadius ?? 3;
  const bottomRadius = opts.bottomRadius ?? 0.6;
  const height = opts.height ?? 2.5;
  const sides = opts.sides ?? 8;

  const wallThickness = 0.2;
  const overlapFactor = 1.15;
  // Sized to the top (widest) chord, not the average: undersizing here would
  // leave gaps at the rim wide enough for a marble to slip past the funnel
  // mouth entirely instead of hitting a wall and sliding down.
  const panelWidth = 2 * topRadius * Math.sin(Math.PI / sides) * overlapFactor;

  const meshes: THREE.Object3D[] = [];
  const bodies: RAPIER.RigidBody[] = [];
  const colliders: RAPIER.Collider[] = [];
  const floorSamples: FloorSample[] = [];

  for (let i = 0; i < sides; i++) {
    const theta = i * ((2 * Math.PI) / sides);
    const topPoint = new THREE.Vector3(
      topRadius * Math.cos(theta),
      0,
      topRadius * Math.sin(theta),
    );
    const bottomPoint = new THREE.Vector3(
      bottomRadius * Math.cos(theta),
      -height,
      bottomRadius * Math.sin(theta),
    );
    const mid = topPoint.clone().add(bottomPoint).multiplyScalar(0.5);
    const dir = bottomPoint.clone().sub(topPoint);
    const slantLength = dir.length();

    // Orthonormal basis: axisX = tangent (panel width), axisY = slant
    // (top->bottom), axisZ = radial-ish (panel thickness).
    const axisY = dir.clone().normalize();
    const axisX = new THREE.Vector3(-Math.sin(theta), 0, Math.cos(theta));
    const axisZ = new THREE.Vector3().crossVectors(axisX, axisY).normalize();
    const basis = new THREE.Matrix4().makeBasis(axisX, axisY, axisZ);
    const localQuat = new THREE.Quaternion().setFromRotationMatrix(basis);

    const part = composePart(placement, mid, localQuat);
    const panel = addFixedBox(
      scene,
      world,
      part,
      new THREE.Vector3(panelWidth, slantLength, wallThickness),
      funnelMaterial,
    );
    meshes.push(panel.mesh);
    bodies.push(panel.body);
    colliders.push(panel.collider);

    // Sample each panel's interior surface at a few heights and tangential
    // offsets (including near its edges, where the original rim-gap bug
    // lived) and check inward-to-outward that the wall is really there.
    const inwardLocal = new THREE.Vector3(-Math.cos(theta), 0, -Math.sin(theta));
    const outwardLocal = inwardLocal.clone().negate();
    for (let hi = 0; hi < 3; hi++) {
      const t = 0.2 + hi * 0.3;
      const centerPoint = topPoint.clone().lerp(bottomPoint, t);
      for (const wFrac of [-0.35, 0, 0.35]) {
        const tangentOffset = axisX.clone().multiplyScalar(wFrac * panelWidth);
        const surfaceLocal = centerPoint.clone().add(tangentOffset);
        const originLocal = surfaceLocal.clone().add(inwardLocal.clone().multiplyScalar(0.15));
        const origin = composePart(placement, originLocal, new THREE.Quaternion()).position;
        const direction = composeDirection(placement, outwardLocal);
        floorSamples.push({ origin, direction });
      }
    }
  }

  const end = composeAnchor(placement, new THREE.Vector3(0, -height, 0), 0);

  return { meshes, bodies, colliders, start: placement, end, floorSamples };
}
