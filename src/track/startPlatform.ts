import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { composePart, type Anchor } from "./anchor";
import { addFixedBox, type FloorSample } from "./part";

export interface StartPlatformOptions {
  length?: number;
  backWidthMultiplier?: number;
  tiltDeg?: number;
}

export interface StartPlatform {
  meshes: THREE.Object3D[];
  bodies: RAPIER.RigidBody[];
  colliders: RAPIER.Collider[];
  floorSamples: FloorSample[];
  backWidth: number;
  length: number;
}

const platformMaterial = new THREE.MeshStandardMaterial({
  color: 0x4a4a55,
  roughness: 0.8,
});

const WALL_HEIGHT = 1.1;
const WALL_THICKNESS = 0.15;
const PLATFORM_THICKNESS = 0.3;
/** Padding past each wall's nominal endpoints so it always overlaps the back
 * wall / ramp corner, closing any seam (same idea as SEGMENT_OVERLAP). */
const WALL_OVERLAP = 0.3;

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** One tapered side wall from a wide point at the back to a narrow point at
 * the front (matching the track width), following the platform's tilt. Built
 * from an orthonormal basis of the back->front direction, same technique as
 * the funnel's panels, since the wall isn't aligned with either the X or Z axis. */
function addTaperedWall(
  scene: THREE.Scene,
  world: RAPIER.World,
  anchor: Anchor,
  side: -1 | 1,
  frontWidth: number,
  backWidth: number,
  length: number,
  tiltQuat: THREE.Quaternion,
) {
  const backPoint = new THREE.Vector3((side * backWidth) / 2, 0, length).applyQuaternion(
    tiltQuat,
  );
  const frontPoint = new THREE.Vector3(
    (side * (frontWidth + WALL_THICKNESS)) / 2,
    0,
    0,
  ).applyQuaternion(tiltQuat);

  const mid = backPoint.clone().add(frontPoint).multiplyScalar(0.5);
  const dir = frontPoint.clone().sub(backPoint);
  const wallLength = dir.length() + WALL_OVERLAP;

  const axisZ = dir.normalize();
  const axisX = new THREE.Vector3().crossVectors(WORLD_UP, axisZ).normalize();
  const axisY = new THREE.Vector3().crossVectors(axisZ, axisX).normalize();
  const basis = new THREE.Matrix4().makeBasis(axisX, axisY, axisZ);
  const localQuat = new THREE.Quaternion().setFromRotationMatrix(basis);

  const centerLocal = mid.add(new THREE.Vector3(0, WALL_HEIGHT / 2, 0));
  const part = composePart(anchor, centerLocal, localQuat);
  return addFixedBox(
    scene,
    world,
    part,
    new THREE.Vector3(WALL_THICKNESS, WALL_HEIGHT, wallLength),
    platformMaterial,
  );
}

/** A flat, walled trapezoid platform bolted onto the track's entrance: wide
 * at the back (where marbles are dropped from above) narrowing down to the
 * track's own width at the front, tilted so marbles that land on it roll
 * forward into the ramp on their own. Doesn't extend the anchor chain — it
 * shares the same `anchor` the ramp itself starts from, since it's a holding
 * area bolted on rather than a new track segment. */
export function createStartPlatform(
  scene: THREE.Scene,
  world: RAPIER.World,
  anchor: Anchor,
  frontWidth: number,
  opts: StartPlatformOptions = {},
): StartPlatform {
  const length = opts.length ?? 7;
  const backWidth = frontWidth * (opts.backWidthMultiplier ?? 2.6);
  // Steep enough to avoid silo/hopper "arching": several marbles dropped from
  // above land close together and converge toward the narrow front by
  // construction (it's a hopper), and at a gentle tilt they can wedge against
  // each other and the tapered walls and stall there indefinitely — confirmed
  // live (3 of 4 marbles jammed motionless against a side wall for an entire
  // race). A steeper slope plus lower floor friction (below) gives gravity a
  // reliable edge over that friction/geometry lock.
  const tiltDeg = opts.tiltDeg ?? 16;

  const tiltQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    -THREE.MathUtils.degToRad(tiltDeg),
  );

  const meshes: THREE.Object3D[] = [];
  const bodies: RAPIER.RigidBody[] = [];
  const colliders: RAPIER.Collider[] = [];

  const floorCenterLocal = new THREE.Vector3(
    0,
    -PLATFORM_THICKNESS / 2,
    length / 2,
  ).applyQuaternion(tiltQuat);
  const floorPart = composePart(anchor, floorCenterLocal, tiltQuat);
  const floor = addFixedBox(
    scene,
    world,
    floorPart,
    new THREE.Vector3(backWidth, PLATFORM_THICKNESS, length),
    platformMaterial,
    0.35,
  );
  meshes.push(floor.mesh);
  bodies.push(floor.body);
  colliders.push(floor.collider);

  const leftWall = addTaperedWall(scene, world, anchor, -1, frontWidth, backWidth, length, tiltQuat);
  const rightWall = addTaperedWall(scene, world, anchor, 1, frontWidth, backWidth, length, tiltQuat);

  const backCenterLocal = new THREE.Vector3(0, WALL_HEIGHT / 2, length).applyQuaternion(
    tiltQuat,
  );
  const backPart = composePart(anchor, backCenterLocal, tiltQuat);
  const backWall = addFixedBox(
    scene,
    world,
    backPart,
    new THREE.Vector3(backWidth + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS),
    platformMaterial,
  );

  for (const wall of [leftWall, rightWall, backWall]) {
    meshes.push(wall.mesh);
    bodies.push(wall.body);
    colliders.push(wall.collider);
  }

  const floorSamples: FloorSample[] = [];
  const stepsAlong = Math.max(1, Math.round(length / 0.5));
  for (let i = 0; i <= stepsAlong; i++) {
    const t = i / stepsAlong;
    const z = length * t;
    const localWidth = frontWidth + (backWidth - frontWidth) * t;
    for (const s of [-0.4, 0, 0.4]) {
      const local = new THREE.Vector3(s * localWidth, 0.15, z).applyQuaternion(tiltQuat);
      const part = composePart(anchor, local, new THREE.Quaternion());
      floorSamples.push({ origin: part.position, direction: new THREE.Vector3(0, -1, 0) });
    }
  }

  return { meshes, bodies, colliders, floorSamples, backWidth, length };
}
