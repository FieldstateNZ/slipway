import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Titlebar } from "./Titlebar";

const close = vi.fn().mockResolvedValue(undefined);
const minimize = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close, minimize }),
}));

beforeEach(() => {
  close.mockClear();
  minimize.mockClear();
});

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

  it("closes the window from the red light and minimizes from the yellow", async () => {
    const user = userEvent.setup();
    renderTitlebar();

    await user.click(screen.getByRole("button", { name: "Close window" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(minimize).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Minimize window" }));
    await waitFor(() => expect(minimize).toHaveBeenCalledTimes(1));
  });

  it("keeps the green light decorative (maxWidth pins the window at 440px)", () => {
    const { view } = renderTitlebar();
    const green = view.container.querySelector(".sw-titlebar-light-green");
    expect(green?.tagName).toBe("SPAN");
    expect(green).toHaveAttribute("aria-hidden", "true");
  });

  it("orders the buttons: close, minimize, then + l g", () => {
    renderTitlebar();
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toEqual(["Close window", "Minimize window", "Intake", "Learned", "Map"]);
  });
});
