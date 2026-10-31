import { useEffect, useState, type CSSProperties } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

/**
 * Universal branded loading scene ("engine room" — approved mock
 * mock-spinner-lab.html). Renders the navbar's gradient-hero CookingPot mark
 * at hero size with an animated lid + rising steam, a phrase that cycles
 * through `phrases`, and a rev bar that either breathes with real stream
 * activity (`mode="stream"`) or ambiently idles (`mode="indeterminate"`).
 *
 * No fabricated progress — the bar width in stream mode is driven entirely
 * by the caller's `activity` (see useStreamActivity), which eases toward 1
 * on each streamed chunk and decays on silence.
 */

export const MESSAGES: string[] = [
  "Firing up the kitchen...",
  "Simmering Mediterranean ideas...",
  "Lemon herb chicken, coming up...",
  "Plotting your batch-cook day...",
  "Roasting vegetable couscous...",
  "Whisking up a Greek yogurt parfait...",
  "Balancing toddler-friendly picks...",
  "Shakshuka with crusty bread...",
  "Building your grocery list...",
  "One-pan salmon & olives...",
  "Cucumber tomato salad, chopped...",
  "Plating it all together...",
];

export const CYCLE_INTERVAL_MS = 2800;

// Mock's canonical hero badge is 136px (mock-spinner-lab.html line 142).
// Steam origin + wisp offsets are authored against that size; we scale the
// origin point (not the verbatim wisp svg width/height) proportionally for
// the smaller inline badge used in drawers.
const MOCK_BADGE_PX = 136;
const MOCK_STEAM_BOTTOM_PX = 92;
const MOCK_LOGOBOX_EXTRA_PX = 36; // logobox height (172) - badge height (136)

interface ChefLoaderProps {
  mode: "stream" | "indeterminate";
  activity?: number;
  caption?: string;
  phrases?: string[];
  fullScreen?: boolean;
}

const ChefLoader = ({
  mode,
  activity = 0,
  caption,
  phrases = MESSAGES,
  fullScreen = false,
}: ChefLoaderProps) => {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setIndex((i) => (i + 1) % phrases.length);
    }, CYCLE_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [phrases.length]);

  const badgePx = fullScreen ? 128 : 80;
  const iconPx = fullScreen ? 68 : 42;
  const scale = badgePx / MOCK_BADGE_PX;
  const steamBottomPx = Math.round(MOCK_STEAM_BOTTOM_PX * scale);
  const logoboxHeightPx = badgePx + Math.round(MOCK_LOGOBOX_EXTRA_PX * scale);

  const steamMax = mode === "stream" ? 0.45 + 0.5 * Math.min(1, Math.max(0, activity)) : 0.8;
  const barWidthPercent = Math.round(Math.min(1, Math.max(0, activity)) * 100);

  const badgeSizeClass = fullScreen ? "w-32 h-32" : "w-20 h-20";

  const content = (
    <div className="flex flex-col items-center gap-5">
      <div
        className="relative"
        style={{ width: badgePx, height: logoboxHeightPx }}
      >
        {/* Steam wisps — rise off the lid, over the badge (mock .steam) */}
        <div
          className="absolute left-1/2 -translate-x-1/2 w-0 h-0 z-10"
          style={{ bottom: steamBottomPx, "--steam-max": steamMax } as CSSProperties}
        >
          <svg
            className="chef-steam absolute overflow-visible"
            style={{ left: -20, bottom: 2 }}
            viewBox="0 0 24 44"
            width={22}
            height={40}
            fill="#FFFFFF"
          >
            <path d="M12 44 L11.36 42.79 L10.72 41.61 L10.11 40.45 L9.57 39.31 L9.11 38.19 L8.75 37.1 L8.49 36.04 L8.35 35.02 L8.32 34.03 L8.4 33.07 L8.59 32.12 L8.88 31.17 L9.27 30.21 L9.76 29.23 L10.33 28.24 L10.98 27.22 L11.7 26.18 L12.47 25.12 L13.26 24.03 L14.05 22.93 L14.84 21.8 L15.58 20.65 L16.27 19.48 L16.87 18.28 L17.38 17.06 L17.77 15.81 L18.01 14.55 L18.11 13.29 L18.05 12.04 L17.84 10.8 L17.49 9.6 L17 8.43 L16.41 7.3 L15.71 6.2 L14.94 5.12 L14.11 4.07 L13.24 3.03 L12.34 2.01 L11.44 0.99 L10.52 0 L11.14 1.21 L11.81 2.39 L12.48 3.57 L13.14 4.73 L13.75 5.88 L14.29 7 L14.74 8.1 L15.1 9.17 L15.35 10.2 L15.49 11.2 L15.52 12.16 L15.45 13.11 L15.27 14.05 L14.98 14.99 L14.6 15.94 L14.12 16.92 L13.56 17.92 L12.91 18.95 L12.2 20 L11.45 21.07 L10.67 22.17 L9.88 23.28 L9.12 24.42 L8.39 25.58 L7.73 26.76 L7.14 27.97 L6.67 29.19 L6.31 30.43 L6.09 31.68 L6.02 32.93 L6.11 34.17 L6.35 35.38 L6.73 36.56 L7.23 37.7 L7.84 38.81 L8.55 39.89 L9.33 40.95 L10.17 41.99 L11.06 43.01 L12 44 Z" />
          </svg>
          <svg
            className="chef-steam absolute overflow-visible"
            style={{ left: 6, bottom: -6 }}
            viewBox="0 0 20 26"
            width={15}
            height={20}
            fill="#FFFFFF"
          >
            <path d="M10 26 L9.69 25.26 L9.36 24.53 L9.04 23.82 L8.73 23.12 L8.44 22.43 L8.19 21.76 L7.97 21.1 L7.78 20.45 L7.64 19.83 L7.53 19.22 L7.47 18.64 L7.45 18.07 L7.47 17.52 L7.52 16.97 L7.62 16.43 L7.74 15.89 L7.91 15.34 L8.11 14.79 L8.35 14.22 L8.62 13.63 L8.92 13.04 L9.25 12.43 L9.61 11.8 L9.99 11.16 L10.38 10.51 L10.79 9.84 L11.19 9.17 L11.6 8.48 L11.99 7.78 L12.37 7.08 L12.72 6.37 L13.04 5.65 L13.32 4.93 L13.57 4.2 L13.76 3.48 L13.9 2.76 L13.97 2.05 L13.99 1.35 L13.94 0.66 L13.8 0 L13.61 0.64 L13.4 1.25 L13.16 1.85 L12.88 2.44 L12.56 3.02 L12.21 3.6 L11.83 4.17 L11.43 4.75 L11 5.33 L10.54 5.92 L10.07 6.52 L9.59 7.12 L9.11 7.73 L8.62 8.36 L8.14 8.99 L7.66 9.64 L7.21 10.3 L6.78 10.97 L6.38 11.66 L6.01 12.37 L5.69 13.08 L5.41 13.81 L5.19 14.56 L5.03 15.31 L4.93 16.07 L4.9 16.83 L4.94 17.58 L5.04 18.33 L5.21 19.06 L5.44 19.78 L5.73 20.47 L6.07 21.15 L6.45 21.8 L6.88 22.44 L7.33 23.07 L7.82 23.68 L8.33 24.28 L8.86 24.87 L9.42 25.44 L10 26 Z" />
          </svg>
        </div>

        {/* Gradient-hero badge — same construction as the Navbar mark */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 bottom-0 ${badgeSizeClass} rounded-full gradient-hero shadow-elevated flex items-center justify-center`}
        >
          <svg
            width={iconPx}
            height={iconPx}
            viewBox="0 0 24 24"
            fill="none"
            stroke="hsl(var(--primary-foreground))"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            role="img"
            aria-label="Mamma's Chef cooking pot logo"
            className="overflow-visible"
          >
            <g className="chef-lid">
              <path d="m4 8 16-4" />
              <path d="m8.86 6.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8" />
            </g>
            <path d="M2 12h20" />
            <path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" />
          </svg>
        </div>
      </div>

      <div className="min-h-[2.1rem] flex items-center justify-center">
        {reducedMotion ? (
          <p className="font-heading font-semibold text-lg text-foreground text-center text-balance">
            {phrases[index]}
          </p>
        ) : (
          <AnimatePresence mode="wait">
            <motion.p
              key={index}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="font-heading font-semibold text-lg text-foreground text-center text-balance"
            >
              {phrases[index]}
            </motion.p>
          </AnimatePresence>
        )}
      </div>

      <div className="chef-bar-track relative">
        <div
          className={`chef-bar-fill${mode === "indeterminate" ? " chef-bar-fill--breathe" : " relative z-10"}`}
          style={mode === "stream" ? { width: `${barWidthPercent}%` } : undefined}
        />
        {mode === "stream" && (
          // Ambient baseline: real SSE arrives in short bursts with long
          // silences, so the bar breathes continuously underneath while the
          // solid activity fill above surges on live chunks.
          <div
            className="chef-bar-fill chef-bar-fill--breathe chef-bar-fill--ambient absolute inset-y-0 left-0"
            aria-hidden="true"
          />
        )}
      </div>

      {caption && (
        <p className="text-sm text-muted-foreground text-center tabular-nums -mt-3 min-h-[1.4em]">
          {caption}
        </p>
      )}
    </div>
  );

  if (!fullScreen) {
    return content;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.4, ease: "easeInOut" }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-cream"
    >
      {content}
    </motion.div>
  );
};

export default ChefLoader;
