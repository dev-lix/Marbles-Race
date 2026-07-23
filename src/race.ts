export type RaceState = "idle" | "countdown" | "racing" | "finished";

export interface RaceResult {
  name: string;
  status: "finished" | "dnf";
  rank: number;
}

export interface RaceControllerCallbacks {
  onStateChange?: (state: RaceState) => void;
  onCountdownTick?: (value: number | "GO") => void;
  onResultsChange?: (results: RaceResult[]) => void;
  /** Switch gravity back on for every held marble so they drop onto the track. */
  releaseMarbles: () => void;
  resetMarbles: () => void;
}

const COUNTDOWN_SECONDS = 3;

/** Drives idle -> countdown -> racing -> finished. Framework-agnostic: it
 * only tracks state/results and calls back into main.ts for the physics/DOM
 * side effects (releasing the marbles, resetting them, etc).
 *
 * There's deliberately no fixed race-length timeout here: the randomized
 * track (see track/generate.ts) caps vertical descent but not total path
 * length, so a long run of zigzags/bumper pits can legitimately take much
 * longer than a short one while every marble keeps moving normally the
 * whole time. A fixed cutoff was confirmed live to force-DNF marbles that
 * were still healthily racing, just on an unusually long track. Instead, a
 * marble is only resolved by an actual event: finishing, touching the
 * ground (main.ts's collision handling), or main.ts's stillness watchdog
 * calling reportDNF() when a marble hasn't moved in a few seconds. The
 * user-facing backstop for anything those miss is the New Track / Race
 * Again buttons, which work at any time, including mid-race. */
export class RaceController {
  state: RaceState = "idle";

  private pending: Set<string>;
  private finishers: RaceResult[] = [];
  private dnfs: Array<{ name: string; status: "dnf" }> = [];
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private raceStartTime: number | null = null;
  private raceEndTime: number | null = null;

  constructor(
    private marbleNames: string[],
    private callbacks: RaceControllerCallbacks,
  ) {
    this.pending = new Set(marbleNames);
  }

  private setState(state: RaceState): void {
    this.state = state;
    this.callbacks.onStateChange?.(state);
  }

  private results(): RaceResult[] {
    return [
      ...this.finishers,
      ...this.dnfs.map((d, i) => ({
        ...d,
        rank: this.finishers.length + i + 1,
      })),
    ];
  }

  /** Click handler for the single Start/Race-Again button: does whatever is
   * appropriate for the current state (no-op while countdown/racing, since
   * the button is disabled then anyway). */
  handleButtonClick(): void {
    if (this.state === "idle") {
      this.startCountdown();
    } else if (this.state === "finished") {
      this.resetToIdle();
      this.startCountdown();
    }
  }

  private startCountdown(): void {
    this.setState("countdown");
    let count = COUNTDOWN_SECONDS;
    this.callbacks.onCountdownTick?.(count);
    this.countdownTimer = setInterval(() => {
      count -= 1;
      if (count > 0) {
        this.callbacks.onCountdownTick?.(count);
        return;
      }
      clearInterval(this.countdownTimer!);
      this.countdownTimer = null;
      this.callbacks.onCountdownTick?.("GO");
      this.beginRacing();
    }, 1000);
  }

  private beginRacing(): void {
    this.setState("racing");
    this.raceStartTime = performance.now();
    this.callbacks.releaseMarbles();
  }

  /** Milliseconds since the marbles were released; frozen once the race finishes. */
  getElapsedMs(): number {
    if (this.raceStartTime === null) return 0;
    return (this.raceEndTime ?? performance.now()) - this.raceStartTime;
  }

  /** Finished + DNF'd marbles ranked so far (finishers first, DNFs after). */
  getResults(): RaceResult[] {
    return this.results();
  }

  /** Names of marbles still racing (neither finished nor DNF'd yet). */
  getPendingNames(): string[] {
    return Array.from(this.pending);
  }

  /** Called from main.ts's finish-line sensor handling. */
  reportFinish(name: string): void {
    this.resolve(name, "finished");
  }

  /** Called from main.ts's ground-contact (fell off the track) handling. */
  reportDNF(name: string): void {
    this.resolve(name, "dnf");
  }

  private resolve(name: string, status: "finished" | "dnf"): void {
    if (this.state !== "racing" || !this.pending.has(name)) return;
    this.pending.delete(name);
    if (status === "finished") {
      this.finishers.push({ name, status, rank: this.finishers.length + 1 });
    } else {
      this.dnfs.push({ name, status });
    }
    this.callbacks.onResultsChange?.(this.results());
    if (this.pending.size === 0) this.endRace();
  }

  private endRace(): void {
    this.raceEndTime = performance.now();
    this.setState("finished");
  }

  /** Clears results/timers and goes back to idle without starting a
   * countdown — used both for "Race Again" (via handleButtonClick) and
   * externally for a "New Track" action, which needs to reset race state
   * without immediately racing. */
  resetToIdle(): void {
    if (this.countdownTimer !== null) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
    this.pending = new Set(this.marbleNames);
    this.finishers = [];
    this.dnfs = [];
    this.raceStartTime = null;
    this.raceEndTime = null;
    this.callbacks.resetMarbles();
    this.callbacks.onResultsChange?.([]);
    this.setState("idle");
  }
}
