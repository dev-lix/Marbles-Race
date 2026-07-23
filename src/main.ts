import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createSceneRig } from "./scene";
import { createPhysicsWorld } from "./physics";
import { createGround } from "./ground";
import { createMarble, releaseMarble, resetMarble, syncMarble, type Marble } from "./marble";
import { createStartPlatform } from "./track/startPlatform";
import { generateTrack } from "./track/generate";
import { checkForGaps } from "./track/validate";
import { RaceController, type RaceState } from "./race";
import { CameraController, type CameraMode } from "./camera";
import { createHud, type RankingEntry } from "./ui/hud";
import { composeDirection, type Anchor } from "./track/anchor";
import type { FloorSample } from "./track/part";
import "./style.css";

const MARBLE_COLORS = [0xff5533, 0x33aaff, 0xffcc33, 0xcc33ff, 0xccff33, 0xffffff];

/** Marbles start held frozen in mid-air (gravity switched off, see
 * marble.ts) above the wide back of the start platform, in a shuffled,
 * randomized layout, then simply drop onto it when released — no physical
 * gate needed. Each marble's safe X range is derived from the platform's
 * actual (tapered) width at that marble's own Z depth, since a fixed range
 * would put marbles outside the walls near the narrow front.
 *
 * Z-depth and height are kept independent of each other and only mildly
 * staggered by shuffle order. An earlier version scaled *both* off the same
 * index (deepest AND highest for the last-shuffled slot), which stacked a
 * real, compounding handicap — extra fall time plus ~2 extra units of
 * rolling distance — onto whichever marble landed there. Confirmed live: on
 * long generated tracks that marble consistently fell behind and never
 * finished, timing out as a DNF in every single test race regardless of
 * track layout, even though it kept moving at healthy speed the whole time
 * (i.e. it wasn't stuck — it just never had a fair start).
 *
 * Positions are assigned from a grid (sized to the marble count) rather than
 * picked independently at random: gravityScale 0 stops gravity but not
 * collision response, so two marbles resting close enough to touch keep
 * shoving each other apart every physics step even while "frozen" — visible
 * live as marbles drifting/sliding around (or getting shoved to odd
 * positions) before the race even starts. An earlier version rejection-
 * sampled random positions against a minimum separation, which worked for a
 * few marbles but silently failed (accepted an overlapping spot anyway once
 * its retry budget ran out) once more marbles were added and the same fixed
 * spawn area got crowded — a grid's cell spacing scales with count instead,
 * so it can't run out of room the same way. */
const CELL_JITTER_FRACTION = 0.18;

function generateSpawnPositions(
  names: string[],
  trackStartPosition: THREE.Vector3,
  frontWidth: number,
  backWidth: number,
  platformLength: number,
): Map<string, THREE.Vector3> {
  const shuffled = [...names];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const count = shuffled.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / cols));

  const zStart = platformLength * 0.45;
  const zEnd = platformLength * 0.85;
  const margin = 0.6;

  const positions = new Map<string, THREE.Vector3>();
  shuffled.forEach((name, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);

    const rowFrac = rows === 1 ? 0.5 : row / (rows - 1);
    const rowStep = rows === 1 ? zEnd - zStart : (zEnd - zStart) / (rows - 1);
    const z =
      zStart + rowFrac * (zEnd - zStart) + (Math.random() - 0.5) * CELL_JITTER_FRACTION * rowStep;

    const depthFrac = z / platformLength;
    const localWidth = frontWidth + (backWidth - frontWidth) * depthFrac;
    const usableHalf = localWidth / 2 - margin;

    const colFrac = cols === 1 ? 0.5 : col / (cols - 1);
    const colStep = cols === 1 ? usableHalf * 2 : (usableHalf * 2) / (cols - 1);
    const x =
      -usableHalf + colFrac * usableHalf * 2 + (Math.random() - 0.5) * CELL_JITTER_FRACTION * colStep;

    const y = 1.4 + Math.random() * 1.8;
    positions.set(name, trackStartPosition.clone().add(new THREE.Vector3(x, y, z)));
  });
  return positions;
}

async function main() {
  const container = document.getElementById("app")!;
  const { scene, camera, renderer, controls, composer } = createSceneRig(container);
  camera.position.set(6, 84, 40);
  controls.target.set(0, 12, -8);
  controls.update();

  const world = await createPhysicsWorld();
  const eventQueue = new RAPIER.EventQueue(true);

  const ground = createGround(scene, world);

  const trackStart: Anchor = { position: new THREE.Vector3(0, 26, 6), yaw: 0 };
  const trackWidth = 3;
  // Every track module extends along local -Z from its anchor (see
  // segment.ts), so this is the actual "downhill" direction the marbles
  // funnel into right after the start platform.
  const trackForwardDirection = composeDirection(trackStart, new THREE.Vector3(0, 0, -1));

  // Mutable: "New Track" tears both of these down and rebuilds fresh ones
  // (see clearTrack/buildTrack below), unlike "Race Again" which just resets
  // marbles onto the existing track.
  let startPlatform = createStartPlatform(scene, world, trackStart, trackWidth);
  let track = generateTrack(scene, world, trackStart, trackWidth);
  let gapMarkers: THREE.Object3D[] = [];

  function validateTrack(): void {
    // Rapier's query structures (used by castRay below) aren't populated
    // until a step runs, including for colliders created moments ago in
    // this same synchronous call — so this always needs a step right before it.
    world.step();
    const floorSamples: FloorSample[] = [...startPlatform.floorSamples, ...track.floorSamples];
    const gapCheck = checkForGaps(world, floorSamples);
    if (gapCheck.ok) {
      console.log(`Track validated: no gaps across ${gapCheck.checked} sample points`);
    } else {
      console.warn(
        `Track validation found ${gapCheck.failures.length}/${gapCheck.checked} gaps`,
        gapCheck.failures,
      );
      const markerGeometry = new THREE.SphereGeometry(0.15, 8, 8);
      const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      for (const failure of gapCheck.failures) {
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        marker.position.copy(failure);
        scene.add(marker);
        gapMarkers.push(marker);
      }
    }
  }

  /** Removes every body/mesh belonging to the current start platform + track
   * (and any leftover gap markers), freeing their GPU geometry buffers too. */
  function clearTrack(): void {
    for (const body of [...startPlatform.bodies, ...track.bodies]) {
      world.removeRigidBody(body);
    }
    for (const obj of [...startPlatform.meshes, ...track.meshes, ...gapMarkers]) {
      scene.remove(obj);
      obj.traverse((child) => {
        const geometry = (child as THREE.Mesh).geometry;
        geometry?.dispose();
      });
    }
    gapMarkers = [];
  }

  function buildTrack(): void {
    startPlatform = createStartPlatform(scene, world, trackStart, trackWidth);
    track = generateTrack(scene, world, trackStart, trackWidth);
    validateTrack();
  }

  validateTrack();

  const marbleInfoList = MARBLE_COLORS.map((color, i) => ({ name: `marble-${i}`, color }));
  let spawnPositions = generateSpawnPositions(
    marbleInfoList.map((m) => m.name),
    trackStart.position,
    trackWidth,
    startPlatform.backWidth,
    startPlatform.length,
  );

  const marbleNames = new Map<number, string>();
  const marbleColors = new Map<string, number>();
  const marblesByName = new Map<string, Marble>();
  const marbles: Marble[] = marbleInfoList.map(({ name, color }) => {
    const marble = createMarble(scene, world, 0.4, spawnPositions.get(name)!, color);
    marbleNames.set(marble.body.collider(0).handle, name);
    marbleColors.set(name, color);
    marblesByName.set(name, marble);
    return marble;
  });

  /** Leader is the lowest (furthest-descended) marble still actually racing —
   * a DNF'd marble can end up resting lower than the track itself (rolling
   * around on the ground plane), which would otherwise win the "lowest y"
   * comparison forever even though it's out of the race. */
  function getLeaderMarble(): Marble | null {
    const pendingNames = race.getPendingNames();
    const candidates =
      pendingNames.length > 0
        ? pendingNames.map((name) => marblesByName.get(name)!)
        : marbles;
    if (candidates.length === 0) return null;
    return candidates.reduce((leader, m) =>
      m.body.translation().y < leader.body.translation().y ? m : leader,
    );
  }

  const overviewPosition = camera.position.clone();
  const overviewTarget = controls.target.clone();
  const cameraController = new CameraController({
    camera,
    controls,
    overviewPosition,
    overviewTarget,
    initialFollowDirection: trackForwardDirection,
  });

  let playerMarbleName = "marble-0";

  const hud = createHud(
    Array.from(marbleColors, ([name, color]) => ({ name, color })),
    {
      onStartClick: () => race.handleButtonClick(),
      onCameraMode: (mode: CameraMode) => {
        cameraController.setMode(mode);
        hud.setCameraMode(mode);
      },
      onSelectMarble: (name: string) => {
        playerMarbleName = name;
        cameraController.setMode("player");
        hud.setCameraMode("player");
        hud.setSelectedMarble(name);
      },
    },
  );
  hud.setCameraMode("overview");
  hud.setSelectedMarble(playerMarbleName);

  const newTrackButton = document.getElementById("new-track-button") as HTMLButtonElement;

  // Stillness watchdog: a marble is DNF'd if it hasn't moved in a while —
  // this (plus ground contact + finishing) is what actually ends a race now,
  // replacing an earlier fixed race-length timeout that force-DNF'd marbles
  // still healthily racing on long generated tracks. See race.ts.
  const STILLNESS_SPEED_THRESHOLD = 0.15;
  const STILLNESS_DNF_MS = 4000;
  const stillSince = new Map<string, number>();

  const race = new RaceController(Array.from(marbleNames.values()), {
    onStateChange: (state: RaceState) => {
      if (state === "idle") {
        hud.setButtonState("Start Race", true);
        hud.showCountdown(null);
        hud.hideResults();
      } else if (state === "racing") {
        hud.setButtonState("Racing...", false);
        hud.showCountdown(null);
      } else if (state === "finished") {
        hud.setButtonState("Race Again", true);
        hud.showResults(race.getResults());
      }
    },
    onCountdownTick: (value) => {
      hud.setButtonState(value === "GO" ? "Go!" : String(value), false);
      hud.showCountdown(value);
    },
    onResultsChange: (results) => hud.setRanking(buildRankingEntries(results)),
    releaseMarbles: () => {
      stillSince.clear();
      cameraController.resetFollowDirection(trackForwardDirection);
      for (const marble of marbles) releaseMarble(marble);
    },
    resetMarbles: () => {
      spawnPositions = generateSpawnPositions(
        Array.from(marblesByName.keys()),
        trackStart.position,
        trackWidth,
        startPlatform.backWidth,
        startPlatform.length,
      );
      for (const [name, marble] of marblesByName) {
        resetMarble(marble, spawnPositions.get(name)!);
      }
    },
  });

  newTrackButton.addEventListener("click", () => {
    // Always allowed, even mid-race — an escape hatch for a race that's
    // stuck (e.g. all marbles wedged somewhere) rather than waiting out the
    // full DNF timeout.
    race.resetToIdle();
    clearTrack();
    buildTrack();
    spawnPositions = generateSpawnPositions(
      marbleInfoList.map((m) => m.name),
      trackStart.position,
      trackWidth,
      startPlatform.backWidth,
      startPlatform.length,
    );
    for (const [name, marble] of marblesByName) {
      resetMarble(marble, spawnPositions.get(name)!);
    }
  });

  function buildRankingEntries(finishedAndDnf: ReturnType<RaceController["getResults"]>): RankingEntry[] {
    const finishers = finishedAndDnf.filter((r) => r.status === "finished");
    const dnfs = finishedAndDnf.filter((r) => r.status === "dnf");
    const racing = race
      .getPendingNames()
      .map((name) => ({ name, y: marblesByName.get(name)!.body.translation().y }))
      .sort((a, b) => a.y - b.y)
      .map((e) => ({
        name: e.name,
        color: marbleColors.get(e.name)!,
        status: "racing" as const,
      }));

    return [
      ...finishers.map((f) => ({
        name: f.name,
        color: marbleColors.get(f.name)!,
        status: "finished" as const,
        rank: f.rank,
      })),
      ...racing,
      ...dnfs.map((d) => ({
        name: d.name,
        color: marbleColors.get(d.name)!,
        status: "dnf" as const,
        rank: d.rank,
      })),
    ];
  }

  const timer = new THREE.Timer();
  timer.connect(document);

  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = timer.getDelta();

    // Advance kinematic spinners before stepping — setNextKinematicRotation
    // only takes effect on the step that follows it.
    for (const spinner of track.spinners) spinner.update();

    world.step(eventQueue);

    eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      if (!started) return;

      const finishHandle = track.finish.collider.handle;
      const groundHandle = ground.collider.handle;

      if (handle1 === finishHandle || handle2 === finishHandle) {
        const otherHandle = handle1 === finishHandle ? handle2 : handle1;
        const name = marbleNames.get(otherHandle);
        if (name) race.reportFinish(name);
        return;
      }

      if (handle1 === groundHandle || handle2 === groundHandle) {
        const otherHandle = handle1 === groundHandle ? handle2 : handle1;
        const name = marbleNames.get(otherHandle);
        if (name) race.reportDNF(name);
      }
    });

    for (const marble of marbles) syncMarble(marble);

    if (race.state === "racing") {
      const now = performance.now();
      for (const name of race.getPendingNames()) {
        const marble = marblesByName.get(name)!;
        const v = marble.body.linvel();
        const speed = Math.hypot(v.x, v.y, v.z);
        if (speed < STILLNESS_SPEED_THRESHOLD) {
          const since = stillSince.get(name);
          if (since === undefined) {
            stillSince.set(name, now);
          } else if (now - since > STILLNESS_DNF_MS) {
            stillSince.delete(name);
            race.reportDNF(name);
          }
        } else {
          stillSince.delete(name);
        }
      }
      hud.setRanking(buildRankingEntries(race.getResults()));
    }
    hud.setTimer(race.getElapsedMs());

    const followTarget =
      cameraController.mode === "leader"
        ? getLeaderMarble()
        : cameraController.mode === "player"
          ? (marblesByName.get(playerMarbleName) ?? null)
          : null;
    cameraController.followMarble(followTarget, dt);

    // OrbitControls.update() unconditionally rewrites camera.position from
    // its own target/spherical state even when `enabled` is false (enabled
    // only gates input listeners) — calling it during a chase-cam mode would
    // silently undo followMarble()'s positioning.
    if (cameraController.mode === "overview") controls.update();
    composer.render();
  });
}

main();
