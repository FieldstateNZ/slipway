import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Titlebar } from "./Titlebar";

afterEach(cleanup);

function renderTitlebar() {
  const onIntake = vi.fn();
  const onLearned = vi.fn();
  const onMap = vi.fn();
  const view = render(
    <Titlebar
      readySummary="4 ready · 35m"
      onIntake={onIntake}
      onLearned={onLearned}
      onMap={onMap}
    />,
  );
  return { onIntake, onLearned, onMap, view };
}

describe("Titlebar", () => {
  it("renders the label and ready summary", () => {
    renderTitlebar();
    expect(screen.getByText("Slipway")).toBeInTheDocument();
    expect(screen.getByText("4 ready · 35m")).toBeInTheDocument();
  });

  it("marks the container as a Tauri drag region, but not the buttons", () => {
    const { view } = renderTitlebar();
    const root = view.container.querySelector(".sw-titlebar");
    expect(root).toHaveAttribute("data-tauri-drag-region");
    for (const button of screen.getAllByRole("button")) {
      expect(button).not.toHaveAttribute("data-tauri-drag-region");
    }
  });

  it("fires callbacks from the + / l / g buttons", async () => {
    const user = userEvent.setup();
    const { onIntake, onLearned, onMap } = renderTitlebar();

    await user.click(screen.getByRole("button", { name: "Intake" }));
    await user.click(screen.getByRole("button", { name: "Learned" }));
    await user.click(screen.getByRole("button", { name: "Map" }));

    expect(onIntake).toHaveBeenCalledTimes(1);
    expect(onLearned).toHaveBeenCalledTimes(1);
    expect(onMap).toHaveBeenCalledTimes(1);
  });

  it("labels the buttons + l g in order", () => {
    renderTitlebar();
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["+", "l", "g"]);
  });
});
