import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EditablePlanTitle from "./EditablePlanTitle";

// Nyquist validation for Phase 13 / TITLE-03 (13-02-PLAN.md, Task 1).
// Pins the lifted inline-edit state machine that 13-HUMAN-UAT.md verified by hand:
// Enter commits, Escape cancels, blur commits, the WR-01 empty-title guard, the
// unchanged-title no-op, trim-before-commit, error surfacing, the pencil affordance,
// and the non-interactive fallback when onRename is absent.

const enterEditMode = () => {
  fireEvent.click(screen.getByRole("button", { name: "Rename plan" }));
  return screen.getByRole("textbox", { name: "Plan title" });
};

describe("EditablePlanTitle", () => {
  it("renders a plain non-interactive heading when onRename is absent", () => {
    render(<EditablePlanTitle title="Weekly Meal Plan" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Weekly Meal Plan",
    );
    expect(screen.queryByRole("button", { name: "Rename plan" })).toBeNull();
  });

  it("renders the editable heading with a pencil affordance when onRename is provided", () => {
    render(<EditablePlanTitle title="Mediterranean Week" onRename={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Rename plan" });
    expect(button).toHaveTextContent("Mediterranean Week");
    // D-09: the discoverability pencil (aria-hidden lucide SVG) lives inside the trigger.
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("opens an input seeded with the current title on click", () => {
    render(<EditablePlanTitle title="Mediterranean Week" onRename={vi.fn()} />);

    const input = enterEditMode();
    expect(input).toHaveValue("Mediterranean Week");
  });

  it("commits the trimmed draft via onRename when Enter is pressed", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<EditablePlanTitle title="Old Name" onRename={onRename} />);

    const input = enterEditMode();
    fireEvent.change(input, { target: { value: "  New Name  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("New Name"));
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("commits on blur", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<EditablePlanTitle title="Old Name" onRename={onRename} />);

    const input = enterEditMode();
    fireEvent.change(input, { target: { value: "Blurred Name" } });
    fireEvent.blur(input);

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("Blurred Name"));
  });

  it("cancels on Escape without calling onRename and restores the heading", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<EditablePlanTitle title="Original" onRename={onRename} />);

    const input = enterEditMode();
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onRename).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Plan title" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Rename plan" })).toHaveTextContent(
      "Original",
    );
  });

  // WR-01 regression guard: an empty draft must never reach onRename/saveMealPlan.
  it("rejects an empty title (WR-01) without calling onRename", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<EditablePlanTitle title="Keep Me" onRename={onRename} />);

    const input = enterEditMode();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRename).not.toHaveBeenCalled();
    // Silent revert by design (13-HUMAN-UAT Test 5): editor closes, title intact.
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Plan title" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Rename plan" })).toHaveTextContent(
      "Keep Me",
    );
  });

  it("treats an unchanged title as a no-op (does not call onRename)", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<EditablePlanTitle title="Same Title" onRename={onRename} />);

    const input = enterEditMode();
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRename).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Plan title" })).toBeNull(),
    );
  });

  it("surfaces an inline error and keeps the input mounted when onRename rejects", async () => {
    const onRename = vi
      .fn()
      .mockRejectedValue(new Error("Plan title is too long (max 100 chars)."));
    render(<EditablePlanTitle title="Old Name" onRename={onRename} />);

    const input = enterEditMode();
    fireEvent.change(input, { target: { value: "A Valid But Failing Rename" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      await screen.findByText("Plan title is too long (max 100 chars)."),
    ).toBeInTheDocument();
    // Input stays mounted so the user can correct it.
    expect(screen.getByRole("textbox", { name: "Plan title" })).toBeInTheDocument();
  });
});
