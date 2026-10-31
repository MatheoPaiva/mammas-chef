import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import PlannerV2Setup from "./PlannerV2Setup";

vi.mock("@/components/SpeechToTextButton", () => ({ default: () => null }));

describe("PlannerV2Setup", () => {
  it("shows the profile readout with an Edit in Profile link in the week view", () => {
    render(
      <MemoryRouter>
        <PlannerV2Setup
          job="week"
          onJobChange={vi.fn()}
          includedMeals={["dinner"]}
          onToggleMeal={vi.fn()}
          orderedDays={["Monday", "Tuesday"]}
          skippedDays={[]}
          onToggleDay={vi.fn()}
          oneMealType="dinner"
          onOneMealTypeChange={vi.fn()}
          oneMealWhen="today"
          onOneMealWhenChange={vi.fn()}
          prompt=""
          onPromptChange={vi.fn()}
          mealCount={2}
          onGenerate={vi.fn()}
          isGenerating={false}
          profileLoaded
          profileSummary="For 2 · Dairy-Free"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/For 2 · Dairy-Free/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit in Profile" })).toHaveAttribute("href", "/profile");
  });
});
