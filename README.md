# Marbles Race

A 3D physics-based marble race, entirely client-side in the browser: a batch of
marbles drop onto a procedurally generated track — ramps, zigzags, spinners,
bumper pits — and race downhill under real rigid-body physics until each one
finishes or DNFs. No server, no game engine editor, just Three.js for
rendering and a Rust-compiled physics engine driving the simulation in
real time. The interesting part isn't the marbles themselves, it's making
sure the physics and the generated geometry never disagree with each other:
every track is assembled from randomized pieces at load time, validated for
gaps with raycasts before a race can start, and kept in sync with the render
scene frame by frame.

Built with Claude Code as an AI pair-programmer. Architecture decisions (physics engine choice, track module design, states) were mine; Claude Code handled implementation.

![gameplay](./docs/gameplay.gif)

## Stack

- **[Three.js](https://threejs.org/)** — scene, camera, lighting, bloom
  post-processing.
- **[Rapier](https://rapier.rs/)** (`@dimforge/rapier3d-compat`) — rigid-body
  physics. Chosen over the more common cannon-es/ammo.js pairing with
  Three.js because it's a Rust core compiled to WASM: deterministic,
  actively maintained, and fast enough to simulate several marbles plus a
  large static track mesh without hand-rolled optimization.
- **TypeScript** + **Vite** — build tooling and dev server.

## Running it

```bash
git clone <this-repo>
cd marbles-race
npm install
npm run dev      # starts the Vite dev server
npm run build    # type-checks (tsc -b) and produces a production build
```

## Architecture

**Physics/render sync.** Three.js and Rapier each own their own world state;
neither is the source of truth for the other. Every animation frame
(`main.ts`): kinematic spinners advance one step, `world.step()` advances the
physics simulation, then `eventQueue.drainCollisionEvents()` reads out
finish-line/ground contacts and feeds them to the race state machine.
Afterwards, every marble's Three.js mesh has its position/rotation copied
from its Rapier rigid body (`syncMarble`) — physics drives the simulation,
rendering just reflects it.

**Track modules.** Every obstacle (straight ramp, zigzag, spinner, bumper
pit, funnel, finish line) is a function that takes an `Anchor` (a world
position + yaw) and returns a `TrackModule`: its meshes, its Rapier
bodies/colliders, an `end` anchor for the next piece to chain from, and a
set of floor sample points used for gap validation. `track/generate.ts`
assembles a full track by chaining a fixed entrance ramp, a randomized
sequence of modules picked from a pool, and a fixed funnel + finish line —
capped by a running "height budget" so an unlucky run of steep random picks
can never push the track below ground. Before a race can start, every
floor sample is raycast-checked for gaps.

**Race state machine.** `race.ts` is a small, framework-agnostic state
machine (`idle → countdown → racing → finished`) that knows nothing about
Three.js or Rapier — it's driven entirely by events reported from
`main.ts`: a marble finishes (finish-line sensor), DNFs (touches the ground,
or hasn't moved in a few seconds), and the race ends once every marble is
resolved one way or the other. There's deliberately no fixed race-length
timeout, since generated tracks vary a lot in length.
