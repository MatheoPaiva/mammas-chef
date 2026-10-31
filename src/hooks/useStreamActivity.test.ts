import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStreamActivity } from "./useStreamActivity";

// Quick task 260709-tdi — pins the rAF-eased activity model (ping -> ease up,
// silence -> decay toward 0.15) that drives ChefLoader's rev bar + steam.
describe("useStreamActivity", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at ~0 activity", () => {
    const { result } = renderHook(() => useStreamActivity());
    expect(result.current.activity).toBe(0);
  });

  it("trends activity up toward 1 after ping()", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamActivity());

    act(() => {
      result.current.ping();
      vi.advanceTimersByTime(300);
    });

    expect(result.current.activity).toBeGreaterThan(0);
  });

  it("decays target toward ~0.15 after 650ms of silence (monotonic after the window)", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStreamActivity());

    act(() => {
      result.current.ping();
      vi.advanceTimersByTime(300);
    });
    const peak = result.current.activity;
    expect(peak).toBeGreaterThan(0);

    // Push well past the 650ms silence timeout AND through enough decay time
    // to drop clearly below the peak — decay is deliberately slow (rise fast
    // / fall slow, so chunk bursts leave a visible wake on the bar).
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    const justAfterSilence = result.current.activity;

    // Slow decay needs a long settle window to approach the 0.15 floor.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const settled = result.current.activity;

    expect(justAfterSilence).toBeLessThan(peak);
    expect(settled).toBeLessThanOrEqual(justAfterSilence);
    expect(settled).toBeCloseTo(0.15, 1);
  });

  it("cleans up rAF + timeout on unmount without throwing", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useStreamActivity());

    act(() => {
      result.current.ping();
      vi.advanceTimersByTime(100);
    });

    expect(() => unmount()).not.toThrow();
  });
});
