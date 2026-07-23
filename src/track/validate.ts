import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { FloorSample } from "./part";

export interface GapCheckResult {
  ok: boolean;
  checked: number;
  failures: THREE.Vector3[];
}

/** For each sample, cast a short ray from `origin` along `direction` and
 * confirm it hits a collider within `maxToi` — i.e. there's really a solid
 * surface where a marble would expect one. Any miss is reported as a gap.
 *
 * Requires at least one `world.step()` to have already run: Rapier's query
 * structures aren't populated until the first step, so calling this before
 * that always reports every sample as a gap. */
export function checkForGaps(
  world: RAPIER.World,
  samples: FloorSample[],
  maxToi: number = 0.75,
): GapCheckResult {
  const failures: THREE.Vector3[] = [];

  for (const sample of samples) {
    const ray = new RAPIER.Ray(sample.origin, sample.direction);
    const hit = world.castRay(ray, maxToi, true);
    if (!hit) failures.push(sample.origin.clone());
  }

  return { ok: failures.length === 0, checked: samples.length, failures };
}
