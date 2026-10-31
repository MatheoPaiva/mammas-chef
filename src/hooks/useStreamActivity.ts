import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Real, activity-driven "stream speed" signal for the branded loading scene
 * (ChefLoader). No fake progress bar — `activity` eases toward 1 whenever the
 * caller pings on each streamed chunk (onDelta), and decays toward a low
 * "still simmering" floor after a short silence window. Mirrors the
 * approved mock's stream-sim model (mock-spinner-lab.html lines 358-387).
 */

const SILENCE_TIMEOUT_MS = 650;
const SILENCE_TARGET = 0.15;
// Asymmetric easing: rise fast on chunk bursts, decay slowly afterward.
// Real SSE delivers the plan in sub-second bursts separated by long silent
// stretches (model generation, prep-tips second call) — a slow decay lets a
// burst leave a visible wake on the rev bar instead of vanishing in ~1s.
const EASE_UP_PER_SEC = 4;
const EASE_DOWN_PER_SEC = 0.9;
const MAX_DT_SEC = 0.05;

interface UseStreamActivityResult {
  /** Eases 0 -> 1 on ping(), decays toward 0.15 after ~650ms of silence. */
  activity: number;
  /** Call on every streamed chunk (onDelta) to register kitchen activity. */
  ping: () => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useStreamActivity(): UseStreamActivityResult {
  const [activity, setActivity] = useState(0);
  const stateRef = useRef({ activity: 0, target: 0 });
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ping = useCallback(() => {
    stateRef.current.target = 1;
    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    silenceTimeoutRef.current = setTimeout(() => {
      stateRef.current.target = SILENCE_TARGET;
    }, SILENCE_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      return;
    }

    const reduced = prefersReducedMotion();

    const tick = (now: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = now;
      const dt = Math.min(MAX_DT_SEC, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;

      const s = stateRef.current;
      if (reduced) {
        s.activity = s.target;
      } else {
        const ease = s.target >= s.activity ? EASE_UP_PER_SEC : EASE_DOWN_PER_SEC;
        s.activity += (s.target - s.activity) * Math.min(1, dt * ease);
      }
      setActivity(s.activity);

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    };
  }, []);

  return { activity, ping };
}
