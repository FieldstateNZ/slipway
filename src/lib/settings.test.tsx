import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import { SETTINGS_STORAGE_KEY, SettingsProvider, useSettings } from "./settings";

function wrapper({ children }: { children: ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("sw-reduced-motion");
});

describe("SettingsProvider", () => {
  it("defaults to reducedMotion=false, keyHints=true", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.reducedMotion).toBe(false);
    expect(result.current.keyHints).toBe(true);
  });

  it("persists changes and restores them in a fresh provider", () => {
    const first = renderHook(() => useSettings(), { wrapper });
    act(() => {
      first.result.current.setReducedMotion(true);
      first.result.current.setKeyHints(false);
    });
    first.unmount();

    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual({
      reducedMotion: true,
      keyHints: false,
    });

    const second = renderHook(() => useSettings(), { wrapper });
    expect(second.result.current.reducedMotion).toBe(true);
    expect(second.result.current.keyHints).toBe(false);
  });

  it("falls back to defaults on corrupt storage", () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, "not json {");
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.reducedMotion).toBe(false);
    expect(result.current.keyHints).toBe(true);
  });

  it("applies and removes .sw-reduced-motion on the document root", () => {
    const { result, unmount } = renderHook(() => useSettings(), { wrapper });
    const root = document.documentElement;
    expect(root.classList.contains("sw-reduced-motion")).toBe(false);

    act(() => {
      result.current.setReducedMotion(true);
    });
    expect(root.classList.contains("sw-reduced-motion")).toBe(true);

    act(() => {
      result.current.setReducedMotion(false);
    });
    expect(root.classList.contains("sw-reduced-motion")).toBe(false);

    act(() => {
      result.current.setReducedMotion(true);
    });
    unmount();
    expect(root.classList.contains("sw-reduced-motion")).toBe(false);
  });

  it("throws when useSettings is used outside the provider", () => {
    expect(() => renderHook(() => useSettings())).toThrow(/within a SettingsProvider/);
  });
});
