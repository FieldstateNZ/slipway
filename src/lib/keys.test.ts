import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KEY_PRIORITY, registerKeyLayer, useKeyLayer } from "./keys";

const cleanups: Array<() => void> = [];

function register(priority: number, handler: (e: KeyboardEvent) => boolean) {
  const unregister = registerKeyLayer(priority, handler);
  cleanups.push(unregister);
  return unregister;
}

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

afterEach(() => {
  cleanup();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("KEY_PRIORITY", () => {
  it("orders quiz > drawer > overlay > board", () => {
    expect(KEY_PRIORITY.QUIZ).toBeGreaterThan(KEY_PRIORITY.DRAWER);
    expect(KEY_PRIORITY.DRAWER).toBeGreaterThan(KEY_PRIORITY.OVERLAY);
    expect(KEY_PRIORITY.OVERLAY).toBeGreaterThan(KEY_PRIORITY.BOARD);
  });
});

describe("registerKeyLayer", () => {
  it("gives Escape to the drawer layer, not the overlay behind it", () => {
    const overlay = vi.fn(() => true);
    const drawer = vi.fn(() => true);
    register(KEY_PRIORITY.OVERLAY, overlay);
    register(KEY_PRIORITY.DRAWER, drawer);

    press("Escape");

    expect(drawer).toHaveBeenCalledTimes(1);
    expect(overlay).not.toHaveBeenCalled();
  });

  it("falls through to lower layers when a higher layer does not handle", () => {
    const board = vi.fn((e: KeyboardEvent) => e.key === "Enter");
    const drawer = vi.fn((e: KeyboardEvent) => e.key === "Escape");
    register(KEY_PRIORITY.BOARD, board);
    register(KEY_PRIORITY.DRAWER, drawer);

    press("Enter");

    expect(drawer).toHaveBeenCalledTimes(1);
    expect(board).toHaveBeenCalledTimes(1);
  });

  it("stops falling through once a layer handles the key", () => {
    const board = vi.fn(() => true);
    const drawer = vi.fn(() => true);
    register(KEY_PRIORITY.BOARD, board);
    register(KEY_PRIORITY.DRAWER, drawer);

    press("Escape");

    expect(drawer).toHaveBeenCalledTimes(1);
    expect(board).not.toHaveBeenCalled();
  });

  it("removes a layer on unregister", () => {
    const overlay = vi.fn(() => true);
    const drawer = vi.fn(() => true);
    register(KEY_PRIORITY.OVERLAY, overlay);
    const unregisterDrawer = register(KEY_PRIORITY.DRAWER, drawer);

    unregisterDrawer();
    press("Escape");

    expect(drawer).not.toHaveBeenCalled();
    expect(overlay).toHaveBeenCalledTimes(1);
  });

  it("is idempotent when unregister is called twice", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const unregisterFirst = register(KEY_PRIORITY.BOARD, first);
    register(KEY_PRIORITY.BOARD, second);

    unregisterFirst();
    unregisterFirst();
    press("a");

    expect(second).toHaveBeenCalledTimes(1);
  });

  it("prefers the most recently registered layer at equal priority", () => {
    const older = vi.fn(() => true);
    const newer = vi.fn(() => true);
    register(KEY_PRIORITY.OVERLAY, older);
    register(KEY_PRIORITY.OVERLAY, newer);

    press("Escape");

    expect(newer).toHaveBeenCalledTimes(1);
    expect(older).not.toHaveBeenCalled();
  });

  it("prevents default on Tab when handled", () => {
    register(KEY_PRIORITY.BOARD, () => true);

    const event = press("Tab");

    expect(event.defaultPrevented).toBe(true);
  });

  it("does not prevent default on Tab when unhandled", () => {
    register(KEY_PRIORITY.BOARD, () => false);

    const event = press("Tab");

    expect(event.defaultPrevented).toBe(false);
  });

  it("attaches exactly one document listener for multiple layers", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const a = register(KEY_PRIORITY.BOARD, () => false);
    const b = register(KEY_PRIORITY.DRAWER, () => false);

    const keydownAdds = addSpy.mock.calls.filter(([type]) => type === "keydown");
    expect(keydownAdds).toHaveLength(1);

    a();
    b();

    const keydownRemoves = removeSpy.mock.calls.filter(([type]) => type === "keydown");
    expect(keydownRemoves).toHaveLength(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe("useKeyLayer", () => {
  it("registers a layer that handles keys", () => {
    const handler = vi.fn(() => true);
    const { unmount } = renderHook(() => useKeyLayer(KEY_PRIORITY.DRAWER, handler));

    press("Escape");
    expect(handler).toHaveBeenCalledTimes(1);

    unmount();
    press("Escape");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not intercept keys while disabled", () => {
    const behind = vi.fn(() => true);
    register(KEY_PRIORITY.OVERLAY, behind);

    const handler = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useKeyLayer(KEY_PRIORITY.DRAWER, handler, enabled),
      { initialProps: { enabled: false } },
    );

    press("Escape");
    expect(handler).not.toHaveBeenCalled();
    expect(behind).toHaveBeenCalledTimes(1);

    rerender({ enabled: true });
    press("Escape");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(behind).toHaveBeenCalledTimes(1);
  });

  it("uses the latest handler without re-registering", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ handler }: { handler: (e: KeyboardEvent) => boolean }) =>
        useKeyLayer(KEY_PRIORITY.BOARD, handler),
      { initialProps: { handler: first } },
    );

    rerender({ handler: second });
    press("a");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
