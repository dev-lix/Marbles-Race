import type { CameraMode } from "../camera";
import type { RaceResult } from "../race";

export interface MarbleInfo {
  name: string;
  color: number;
}

export interface RankingEntry {
  name: string;
  color: number;
  status: "finished" | "racing" | "dnf";
  rank?: number;
}

export interface HudCallbacks {
  onStartClick: () => void;
  onCameraMode: (mode: CameraMode) => void;
  onSelectMarble: (name: string) => void;
}

function toCssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element in index.html`);
  return el as T;
}

export function createHud(marbles: MarbleInfo[], callbacks: HudCallbacks) {
  const startButton = requireEl<HTMLButtonElement>("start-button");
  const countdownOverlay = requireEl<HTMLDivElement>("countdown-overlay");
  const timerEl = requireEl<HTMLDivElement>("timer");
  const cameraControls = requireEl<HTMLDivElement>("camera-controls");
  const marblePicker = requireEl<HTMLDivElement>("marble-picker");
  const rankingList = requireEl<HTMLOListElement>("ranking-list");
  const resultsOverlay = requireEl<HTMLDivElement>("results-overlay");
  const podium = requireEl<HTMLDivElement>("podium");
  const resultsList = requireEl<HTMLOListElement>("results-list");

  const marbleColors = new Map(marbles.map((m) => [m.name, m.color]));

  startButton.addEventListener("click", () => callbacks.onStartClick());

  const camButtons = Array.from(
    cameraControls.querySelectorAll<HTMLButtonElement>(".cam-btn"),
  );
  function setActiveCamButton(mode: CameraMode | null): void {
    for (const btn of camButtons) {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    }
  }
  for (const btn of camButtons) {
    btn.addEventListener("click", () => {
      callbacks.onCameraMode(btn.dataset.mode as CameraMode);
    });
  }

  const marbleButtons = new Map<string, HTMLButtonElement>();
  for (const marble of marbles) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "marble-btn";
    btn.style.background = toCssColor(marble.color);
    btn.title = marble.name;
    btn.addEventListener("click", () => callbacks.onSelectMarble(marble.name));
    marblePicker.appendChild(btn);
    marbleButtons.set(marble.name, btn);
  }
  function setActiveMarbleButton(name: string | null): void {
    for (const [n, btn] of marbleButtons) {
      btn.classList.toggle("active", n === name);
    }
  }

  function setButtonState(text: string, enabled: boolean): void {
    startButton.textContent = text;
    startButton.disabled = !enabled;
  }

  function showCountdown(value: number | "GO" | null): void {
    if (value === null) {
      countdownOverlay.classList.remove("visible");
      return;
    }
    countdownOverlay.textContent = value === "GO" ? "GO!" : String(value);
    countdownOverlay.classList.add("visible");
  }

  function setTimer(ms: number): void {
    timerEl.textContent = `${(ms / 1000).toFixed(1)}s`;
  }

  function setRanking(entries: RankingEntry[]): void {
    rankingList.innerHTML = "";
    entries.forEach((entry, i) => {
      const li = document.createElement("li");

      const rankNum = document.createElement("span");
      rankNum.className = "rank-num";
      rankNum.textContent = `${entry.rank ?? i + 1}.`;
      li.appendChild(rankNum);

      const swatch = document.createElement("span");
      swatch.className = "rank-swatch";
      swatch.style.background = toCssColor(entry.color);
      li.appendChild(swatch);

      const name = document.createElement("span");
      name.className = "rank-name";
      name.textContent = entry.name;
      li.appendChild(name);

      if (entry.status === "dnf") {
        const dnf = document.createElement("span");
        dnf.className = "rank-dnf";
        dnf.textContent = "DNF";
        li.appendChild(dnf);
      }

      rankingList.appendChild(li);
    });
  }

  function showResults(results: RaceResult[]): void {
    podium.innerHTML = "";
    const top3 = results.filter((r) => r.status === "finished").slice(0, 3);
    // Podium display order: 2nd, 1st, 3rd (classic centered-winner layout).
    const order = [top3[1], top3[0], top3[2]];
    for (const result of order) {
      const step = document.createElement("div");
      if (!result) {
        step.className = "podium-step";
        step.style.visibility = "hidden";
        podium.appendChild(step);
        continue;
      }
      step.className = `podium-step place-${result.rank}`;

      const swatch = document.createElement("div");
      swatch.className = "podium-swatch";
      swatch.style.background = toCssColor(marbleColors.get(result.name) ?? 0xffffff);
      step.appendChild(swatch);

      const name = document.createElement("div");
      name.className = "podium-name";
      name.textContent = result.name;
      step.appendChild(name);

      const bar = document.createElement("div");
      bar.className = "podium-bar";
      bar.textContent = String(result.rank);
      step.appendChild(bar);

      podium.appendChild(step);
    }

    resultsList.innerHTML = "";
    for (const result of results.slice(3)) {
      const li = document.createElement("li");
      li.textContent = `${result.rank}. ${result.name}${result.status === "dnf" ? " (DNF)" : ""}`;
      resultsList.appendChild(li);
    }

    resultsOverlay.classList.add("visible");
  }

  function hideResults(): void {
    resultsOverlay.classList.remove("visible");
  }

  return {
    setButtonState,
    showCountdown,
    setTimer,
    setCameraMode: setActiveCamButton,
    setSelectedMarble: setActiveMarbleButton,
    setRanking,
    showResults,
    hideResults,
  };
}

export type Hud = ReturnType<typeof createHud>;
