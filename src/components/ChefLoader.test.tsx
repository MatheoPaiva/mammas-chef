import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import ChefLoader, { MESSAGES } from "./ChefLoader";

// Quick task 260709-tdi — migrated from the prior branded-loader test file.
// AnimatePresence mode="wait" defers mounting the next child until the exit
// animation resolves, which stalls under fake timers. Mock framer-motion so
// the cycle-advance assertion is deterministic and timing-independent — the
// standard passthrough-mock pattern for framer-motion in jsdom.
vi.mock("framer-motion", () => {
  const stripFramerProps = (props: Record<string, unknown>) => {
    const {
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...rest
    } = props;
    return rest;
  };

  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
    motion: new Proxy(
      {},
      {
        get:
          (_target, tag: string) =>
          ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
            const Tag = tag as keyof JSX.IntrinsicElements;
            return <Tag {...stripFramerProps(props)}>{children}</Tag>;
          },
      },
    ),
  };
});

describe("ChefLoader", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pins the branded opener as the first MESSAGES entry", () => {
    expect(MESSAGES.length).toBeGreaterThan(0);
    expect(MESSAGES[0]).toBe("Firing up the kitchen...");
  });

  it("renders the first phrase on initial mount", () => {
    render(<ChefLoader mode="indeterminate" />);

    expect(screen.getByText(MESSAGES[0])).toBeInTheDocument();
  });

  it("advances to the next phrase after one cycle interval elapses", () => {
    vi.useFakeTimers();
    render(<ChefLoader mode="indeterminate" />);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText(MESSAGES[1])).toBeInTheDocument();
  });

  it("renders the gradient-hero badge with the inline CookingPot lid", () => {
    const { container } = render(<ChefLoader mode="indeterminate" />);

    expect(container.querySelector(".gradient-hero")).toBeInTheDocument();
    expect(container.querySelector(".chef-lid")).toBeInTheDocument();
    expect(container.querySelectorAll(".chef-steam")).toHaveLength(2);
  });

  it("renders a custom caption when provided", () => {
    render(<ChefLoader mode="stream" activity={0.5} caption="Simmering Thursday's lunch · day 4 of 7" />);

    expect(screen.getByText("Simmering Thursday's lunch · day 4 of 7")).toBeInTheDocument();
  });

  it("drives the rev bar width from activity in stream mode", () => {
    const { container } = render(<ChefLoader mode="stream" activity={0.6} />);

    const fill = container.querySelector(".chef-bar-fill") as HTMLElement;
    expect(fill).toBeInTheDocument();
    expect(fill.style.width).toBe("60%");
  });

  it("applies the ambient breathing class in indeterminate mode (no fake progress)", () => {
    const { container } = render(<ChefLoader mode="indeterminate" />);

    const fill = container.querySelector(".chef-bar-fill") as HTMLElement;
    expect(fill.classList.contains("chef-bar-fill--breathe")).toBe(true);
    expect(fill.style.width).toBe("");
  });
});
