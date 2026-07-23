import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Anchor } from "./anchor";
import type { FloorSample, TrackModule } from "./part";
import { createStraightRamp } from "./ramp";
import { createZigzagRamp } from "./zigzag";
import { createSpinner, type SpinnerModule } from "./spinner";
import { createBumperPit } from "./bumperPit";
import { createFunnel } from "./funnel";
import { createFinishLine, type FinishLine } from "./finish";

export interface GeneratedTrack {
  meshes: THREE.Object3D[];
  bodies: RAPIER.RigidBody[];
  floorSamples: FloorSample[];
  spinners: SpinnerModule[];
  finish: FinishLine;
}

const FUNNEL_TOP_RADIUS = 4;
const FUNNEL_HEIGHT = 2.5;
/** A fixed straight segment always inserted right before the funnel. The
 * funnel's rim panels extend `FUNNEL_TOP_RADIUS` out from its anchor in
 * every horizontal direction, including backward toward whatever module
 * precedes it — with no buffer, a short last module (e.g. a spinner) can
 * end up close enough for its geometry to overlap the funnel's rim. A
 * spinner's rotating paddle sweeping into that overlap can physically pin a
 * marble between the paddle and the fixed rim wall (confirmed live: a race
 * stalled indefinitely with a marble wedged exactly there). The buffer's
 * length exceeds the rim radius so this can't happen regardless of which
 * random module ends up last. */
const BUFFER_LENGTH = FUNNEL_TOP_RADIUS + 0.6;
const BUFFER_ANGLE_DEG = 14;
/** Reserved headroom (beyond the funnel + buffer's own height) that the
 * random middle sequence must never eat into, so the funnel always ends up
 * safely above ground level regardless of which random modules got picked. */
const SAFETY_BUFFER = 1.6;
/** Stop adding middle modules once less than this much budget remains —
 * smaller than the buffer so one "unlucky" last module (e.g. a steep zigzag)
 * can still eat into the buffer without ever going below ground. */
const MIN_BUDGET_FOR_ANOTHER_MODULE = 1.2;
const RESERVED_HEIGHT =
  FUNNEL_HEIGHT + BUFFER_LENGTH * Math.sin(THREE.MathUtils.degToRad(BUFFER_ANGLE_DEG)) +
  SAFETY_BUFFER;

type ModuleKind = "straight" | "zigzag" | "spinner" | "bumper";
const MODULE_POOL: ModuleKind[] = ["straight", "zigzag", "spinner", "bumper"];

function buildRandomModule(
  kind: ModuleKind,
  scene: THREE.Scene,
  world: RAPIER.World,
  anchor: Anchor,
  width: number,
): { module: TrackModule; spinner?: SpinnerModule } {
  switch (kind) {
    case "straight": {
      const module = createStraightRamp(scene, world, anchor, {
        length: 4 + Math.random() * 2.5,
        width,
        angleDeg: 14 + Math.random() * 8,
      });
      return { module };
    }
    case "zigzag": {
      const module = createZigzagRamp(scene, world, anchor, {
        bends: 2 + Math.floor(Math.random() * 2),
        segmentLength: 2.5 + Math.random(),
        angleDeg: 10 + Math.random() * 6,
        turnDeg: 40 + Math.random() * 25,
        width,
      });
      return { module };
    }
    case "spinner": {
      const module = createSpinner(scene, world, anchor, {
        width,
        length: 4.5 + Math.random(),
        angleDeg: 5 + Math.random() * 3,
        paddleCount: 3 + Math.floor(Math.random() * 2),
        spinSpeed: 0.008 + Math.random() * 0.014,
      });
      return { module, spinner: module };
    }
    case "bumper": {
      const module = createBumperPit(scene, world, anchor, {
        width,
        length: 4.5 + Math.random(),
        // Steep enough that gravity reliably beats friction + high-restitution
        // bounce chaos — too gentle and a marble that loses momentum bouncing
        // between pegs can stall indefinitely instead of rolling through.
        angleDeg: 11 + Math.random() * 4,
      });
      return { module };
    }
  }
}

/** Assembles a randomized track: a fixed entrance ramp, then a random-order,
 * random-length sequence of ramps/zigzags/spinners/bumper pits, then a fixed
 * funnel + finish line. The middle sequence's length is capped by a running
 * vertical "budget" (rather than a fixed module count), so an unlucky run of
 * steep random picks can never push the funnel below ground level — it just
 * ends the random sequence a little early instead. */
export function generateTrack(
  scene: THREE.Scene,
  world: RAPIER.World,
  trackStart: Anchor,
  trackWidth: number,
): GeneratedTrack {
  const meshes: THREE.Object3D[] = [];
  const bodies: RAPIER.RigidBody[] = [];
  const floorSamples: FloorSample[] = [];
  const spinners: SpinnerModule[] = [];

  const entrance = createStraightRamp(scene, world, trackStart, {
    length: 6,
    width: trackWidth,
    angleDeg: 20,
  });
  meshes.push(...entrance.meshes);
  bodies.push(...entrance.bodies);
  floorSamples.push(...entrance.floorSamples);

  let current = entrance.end;
  let budget = current.position.y - RESERVED_HEIGHT;

  // A minimum count as well as a target: a track that's "1 linear ramp and
  // done" reads as barely a race. The height budget (from the loop condition
  // below) is still the hard backstop against going below ground — this only
  // controls how many obstacles a *tall enough* start aims for.
  const targetCount = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < targetCount && budget > MIN_BUDGET_FOR_ANOTHER_MODULE; i++) {
    const kind = MODULE_POOL[Math.floor(Math.random() * MODULE_POOL.length)];
    const { module, spinner } = buildRandomModule(kind, scene, world, current, trackWidth);
    meshes.push(...module.meshes);
    bodies.push(...module.bodies);
    floorSamples.push(...module.floorSamples);
    if (spinner) spinners.push(spinner);
    current = module.end;
    budget = current.position.y - RESERVED_HEIGHT;
  }

  const buffer = createStraightRamp(scene, world, current, {
    length: BUFFER_LENGTH,
    width: trackWidth,
    angleDeg: BUFFER_ANGLE_DEG,
  });
  meshes.push(...buffer.meshes);
  bodies.push(...buffer.bodies);
  floorSamples.push(...buffer.floorSamples);

  const funnel = createFunnel(scene, world, buffer.end, {
    topRadius: FUNNEL_TOP_RADIUS,
    bottomRadius: 0.6,
    height: FUNNEL_HEIGHT,
    sides: 10,
  });
  meshes.push(...funnel.meshes);
  bodies.push(...funnel.bodies);
  floorSamples.push(...funnel.floorSamples);

  const finish = createFinishLine(scene, world, funnel.end, 2.5, 2);
  meshes.push(finish.mesh);
  bodies.push(finish.body);

  return { meshes, bodies, floorSamples, spinners, finish };
}
