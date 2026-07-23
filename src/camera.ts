import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Marble } from "./marble";

export type CameraMode = "overview" | "leader" | "player";

export interface CameraControllerOptions {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  overviewPosition: THREE.Vector3;
  overviewTarget: THREE.Vector3;
  /** The track's known "downhill" direction at the start — used as the
   * initial follow direction and whatever resetFollowDirection() is called
   * with, so the chase cam starts each race already sitting behind/uphill
   * of the marble instead of guessing from noisy low-speed velocity. */
  initialFollowDirection: THREE.Vector3;
}

// Pulled back and raised further than a typical close chase cam on purpose:
// marbles jostling at low speed on the start platform (or bouncing inside a
// spinner/bumper pit) only produce a small angular swing in the camera when
// it's already this far uphill/back, versus a big, spinny-looking swing from
// close up.
const FOLLOW_DISTANCE = 5.5;
const FOLLOW_HEIGHT = 3.4;

// Time constants (seconds) for exponential smoothing — framerate-independent
// via `1 - exp(-dt / tau)` rather than a fixed per-frame lerp weight, so the
// camera feels the same regardless of frame rate (a fixed weight effectively
// gets stronger/weaker as frame rate changes).
const POSITION_TAU = 0.18;
const LOOK_TAU = 0.1;
// Much slower than position/look on purpose — this is what actually fixes
// the shakiness. A marble bouncing inside a spinner or bumper pit reverses
// its instantaneous velocity several times a second; chasing that raw
// direction every frame is what caused the jitter. Smoothing the *direction*
// itself with a slow time constant means only a sustained heading change
// (actually moving a new way down the track) shifts where the camera sits
// behind the marble — a bounce blips through and is damped out before it
// visibly affects anything, acting like a delay/buffer on facing changes.
const DIRECTION_TAU = 0.7;
// Below this horizontal speed, velocity direction is mostly noise (e.g. a
// marble jostling against neighbors/walls on the start platform, or nearly
// at rest against a peg) — hold the last smoothed direction instead of
// chasing it. Set well above typical pre-race jostle speed so the camera
// doesn't spin trying to resolve a direction out of that noise; it only
// starts turning once the marble has committed to actually moving somewhere.
const MIN_DIRECTION_SPEED = 1.2;
// Guards against a huge one-off dt (e.g. a dropped frame or tab coming back
// into focus) causing smoothing to jump/snap instead of easing.
const MAX_DT = 0.1;

/** Exponential smoothing toward `target`, framerate-independent via `tau`
 * (seconds to close ~63% of the remaining gap). */
function damp(current: THREE.Vector3, target: THREE.Vector3, tau: number, dt: number): void {
  current.lerp(target, 1 - Math.exp(-dt / tau));
}

/** Toggles between free-orbit overview and a smooth chase cam that trails a
 * marble from behind its direction of travel. In chase modes OrbitControls
 * is disabled so it doesn't fight with the follow position every frame. */
export class CameraController {
  mode: CameraMode = "overview";

  private opts: CameraControllerOptions;
  private smoothedDir: THREE.Vector3;
  private lookTarget: THREE.Vector3;

  constructor(opts: CameraControllerOptions) {
    this.opts = opts;
    this.lookTarget = opts.overviewTarget.clone();
    this.smoothedDir = opts.initialFollowDirection.clone().normalize();
  }

  /** Snaps the follow direction straight to `dir`, no easing — call this the
   * moment marbles are released so each race starts with the camera already
   * sitting behind/uphill of the marble along the track's actual direction,
   * instead of spinning to catch up from wherever the last race (or pre-race
   * jostling) left it facing. */
  resetFollowDirection(dir: THREE.Vector3): void {
    this.smoothedDir.copy(dir).normalize();
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.opts.controls.enabled = mode === "overview";
    if (mode === "overview") {
      this.opts.camera.position.copy(this.opts.overviewPosition);
      this.opts.controls.target.copy(this.opts.overviewTarget);
      this.opts.controls.update();
    }
  }

  /** Call every frame with whichever marble the current mode should follow
   * (leader or player pick) — resolving which marble that is is main.ts's
   * job, since it owns race/leaderboard state. No-op in overview mode.
   * `dt` is the real seconds elapsed since the last frame (see main.ts's
   * THREE.Clock), used to keep smoothing framerate-independent. */
  followMarble(marble: Marble | null, dt: number): void {
    if (this.mode === "overview" || !marble) return;
    const clampedDt = Math.min(dt, MAX_DT);

    const pos = marble.body.translation();
    const vel = marble.body.linvel();
    const marblePos = new THREE.Vector3(pos.x, pos.y, pos.z);

    // Horizontal velocity only: a bounce off a peg or spinner paddle mostly
    // shows up as a vertical velocity spike, which shouldn't yank the
    // camera's facing around — FOLLOW_HEIGHT already handles vertical offset
    // as a fixed amount, not something derived from velocity.
    const horizontalVel = new THREE.Vector3(vel.x, 0, vel.z);
    if (horizontalVel.length() > MIN_DIRECTION_SPEED) {
      const instantDir = horizontalVel.normalize();
      const blended = this.smoothedDir
        .clone()
        .lerp(instantDir, 1 - Math.exp(-clampedDt / DIRECTION_TAU));
      // Guard against the rare case where smoothedDir and instantDir are
      // nearly opposite, which can lerp through a near-zero-length vector.
      if (blended.lengthSq() > 1e-6) this.smoothedDir.copy(blended.normalize());
    }

    const desiredPos = marblePos
      .clone()
      .addScaledVector(this.smoothedDir, -FOLLOW_DISTANCE)
      .add(new THREE.Vector3(0, FOLLOW_HEIGHT, 0));

    damp(this.opts.camera.position, desiredPos, POSITION_TAU, clampedDt);
    damp(this.lookTarget, marblePos, LOOK_TAU, clampedDt);
    this.opts.camera.lookAt(this.lookTarget);
  }
}
