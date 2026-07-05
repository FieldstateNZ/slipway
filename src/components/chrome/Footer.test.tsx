import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

import { SETTINGS_STORAGE_KEY, SettingsProvider } from "../../lib/settings";
import { Footer } from "./Footer";

const HINTS_COPY = "1 2 3 lanes · ⇥ deal · ↵ open · g map · l learned · drop a doc → intake";

function renderFooter(props: Partial<ComponentProps<typeof Footer>> = {}) {
  const onReset = vi.fn();
  const view = render(
    <SettingsProvider>
      <Footer onReset={onReset} {...props} />
    </SettingsProvider>,
  );
  return { onReset, view };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

describe("Footer", () => {
  it("shows the exact keyboard hints line when keyHints is on (default)", () => {
    renderFooter();
    expect(screen.getByText(HINTS_COPY)).toBeInTheDocument();
  });

  it("hides the hints line when keyHints=false", () => {
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ reducedMotion: false, keyHints: false }),
    );
    renderFooter();
    expect(screen.queryByText(HINTS_COPY)).not.toBeInTheDocument();
  });

  it("fires onReset from the reset link", async () => {
    const user = userEvent.setup();
    const { onReset } = renderFooter();
    await user.click(screen.getByRole("button", { name: "reset" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("renders the toast slot when provided, and omits it otherwise", () => {
    const { view } = renderFooter({ toast: "task parked — 2 ready" });
    expect(screen.getByText("task parked — 2 ready")).toBeInTheDocument();
    expect(view.container.querySelector(".sw-footer-toast")).not.toBeNull();

    view.rerender(
      <SettingsProvider>
        <Footer onReset={vi.fn()} />
      </SettingsProvider>,
    );
    expect(view.container.querySelector(".sw-footer-toast")).toBeNull();
  });

  it("renders the recheck slot with an accent [r] prefix and fires onOpen", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderFooter({ recheck: { label: "20s recheck — cache ttl ◌", onOpen } });

    const recheck = screen.getByRole("button", {
      name: "[r] 20s recheck — cache ttl ◌",
    });
    expect(recheck.querySelector(".sw-footer-recheck-key")).toHaveTextContent("[r]");

    await user.click(recheck);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
