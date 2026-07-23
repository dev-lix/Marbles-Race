import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { composePart, type Anchor } from "./anchor";
import { addFixedBox, type TrackModule } from "./part";
import { buildFloorSegment } from "./segment";

export interface BumperPitOptions {
  length?: number;
  width?: number;
  thickness?: number;
  angleDeg?: number;
  rows?: number;
  cols?: number;
  bumperRadius?: number;
  bumperHeight?: number;
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const WALL_HEIGHT = 0.7;
const WALL_THICKNESS = 0.15;
const WALL_OVERLAP = 0.3;
/** How much wider the pit's middle section is than the track it drops back
 * onto. A grid of pegs squeezed into the plain track width left gaps
 * smaller than a marble's diameter between adjacent pegs, so marbles could
 * only pass at the tight edges next to the rails — where they'd wedge
 * between a peg and the wall and stall indefinitely (confirmed live). */
const PIT_WIDTH_MULTIPLIER = 1.7;
const TRANSITION_LENGTH = 1.1;

const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x3d5a80,
  roughness: 0.6,
});
const wallMaterial = new THREE.MeshStandardMaterial({
  color: 0x293241,
  roughness: 0.7,
});
const bumperMaterial = new THREE.MeshStandardMaterial({
  color: 0xffcc33,
  roughness: 0.3,
  metalness: 0.4,
});

/** One wall segment between two (width, z) points, following the floor's
 * tilt. Handles both taper sections (different widths) and the straight
 * mid-pit run (same width at both ends) via the same orthonormal-basis
 * technique as the funnel's panels / start platform's tapered walls. */
function addWallSegment(
  scene: THREE.Scene,
  world: RAPIER.World,
  placement: Anchor,
  side: -1 | 1,
  nearWidth: number,
  nearZ: number,
  farWidth: number,
  farZ: number,
  pitchQuat: THREE.Quaternion,
) {
  const nearPoint = new THREE.Vector3((side * nearWidth) / 2, 0, nearZ).applyQuaternion(
    pitchQuat,
  );
  const farPoint = new THREE.Vector3((side * farWidth) / 2, 0, farZ).applyQuaternion(pitchQuat);

  const mid = nearPoint.clone().add(farPoint).multiplyScalar(0.5);
  const dir = farPoint.clone().sub(nearPoint);
  const segLength = dir.length() + WALL_OVERLAP;

  const axisZ = dir.normalize();
  const axisX = new THREE.Vector3().crossVectors(WORLD_UP, axisZ).normalize();
  const axisY = new THREE.Vector3().crossVectors(axisZ, axisX).normalize();
  const basis = new THREE.Matrix4().makeBasis(axisX, axisY, axisZ);
  const localQuat = new THREE.Quaternion().setFromRotationMatrix(basis);

  const centerLocal = mid.add(new THREE.Vector3(0, WALL_HEIGHT / 2, 0));
  const part = composePart(placement, centerLocal, localQuat);
  return addFixedBox(
    scene,
    world,
    part,
    new THREE.Vector3(WALL_THICKNESS, WALL_HEIGHT, segLength),
    wallMaterial,
  );
}

/** A flat pass-through floor, widened in the middle, with a regular grid of
 * fixed high-restitution peg bumpers standing on it — marbles bounce
 * unpredictably between them on the way through, pinball-style. Tapered
 * entrance/exit walls funnel back to the plain track width on both ends. */
export function createBumperPit(
  scene: THREE.Scene,
  world: RAPIER.World,
  placement: Anchor,
  opts: BumperPitOptions = {},
): TrackModule {
  const length = opts.length ?? 5;
  const width = opts.width ?? 3;
  const thickness = opts.thickness ?? 0.3;
  const angleDeg = opts.angleDeg ?? 8;
  const rows = opts.rows ?? 3;
  const cols = opts.cols ?? 3;
  const bumperRadius = opts.bumperRadius ?? 0.22;
  const bumperHeight = opts.bumperHeight ?? 0.6;

  const pitWidth = width * PIT_WIDTH_MULTIPLIER;
  const pitStartZ = -TRANSITION_LENGTH;
  const pitEndZ = -(length - TRANSITION_LENGTH);

  const floorSeg = buildFloorSegment(
    scene,
    world,
    placement,
    length,
    pitWidth,
    thickness,
    angleDeg,
    floorMaterial,
  );
  const meshes = [...floorSeg.meshes];
  const bodies = [...floorSeg.bodies];
  const colliders = [...floorSeg.colliders];

  const pitchQuat = new THREE.Quaternion().setFromAxisAngle(
    X_AXIS,
    -THREE.MathUtils.degToRad(angleDeg),
  );

  for (const side of [-1, 1] as const) {
    const entranceWall = addWallSegment(
      scene,
      world,
      placement,
      side,
      width,
      0,
      pitWidth,
      pitStartZ,
      pitchQuat,
    );
    const midWall = addWallSegment(
      scene,
      world,
      placement,
      side,
      pitWidth,
      pitStartZ,
      pitWidth,
      pitEndZ,
      pitchQuat,
    );
    const exitWall = addWallSegment(
      scene,
      world,
      placement,
      side,
      pitWidth,
      pitEndZ,
      width,
      -length,
      pitchQuat,
    );
    for (const wall of [entranceWall, midWall, exitWall]) {
      meshes.push(wall.mesh);
      bodies.push(wall.body);
      colliders.push(wall.collider);
    }
  }

  const marginX = pitWidth * 0.15;
  const marginZ = Math.abs(pitEndZ - pitStartZ) * 0.15;
  const usableWidth = pitWidth - marginX * 2;
  const usableLength = Math.abs(pitEndZ - pitStartZ) - marginZ * 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const fx = cols === 1 ? 0.5 : c / (cols - 1);
      const fz = rows === 1 ? 0.5 : r / (rows - 1);
      const x = -usableWidth / 2 + fx * usableWidth;
      const z = pitStartZ - marginZ - fz * usableLength;
      const centerLocal = new THREE.Vector3(x, bumperHeight / 2, z).applyQuaternion(pitchQuat);
      const part = composePart(placement, centerLocal, pitchQuat);

      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(bumperRadius, bumperRadius, bumperHeight, 12),
        bumperMaterial,
      );
      mesh.position.copy(part.position);
      mesh.quaternion.copy(part.quaternion);
      mesh.castShadow = true;
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
        RAPIER.ColliderDesc.cylinder(bumperHeight / 2, bumperRadius)
          .setRestitution(0.75)
          .setFriction(0.2),
        body,
      );

      meshes.push(mesh);
      bodies.push(body);
      colliders.push(collider);
    }
  }

  return {
    meshes,
    bodies,
    colliders,
    start: placement,
    end: floorSeg.end,
    floorSamples: floorSeg.floorSamples,
  };
}
