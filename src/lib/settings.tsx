import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const SETTINGS_STORAGE_KEY = "slipway-settings-v1";

export interface Settings {
  reducedMotion: boolean;
  keyHints: boolean;
  launchAtLogin: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  reducedMotion: false,
  keyHints: true,
  launchAtLogin: false,
};

export interface SettingsContextValue extends Settings {
  setReducedMotion: (value: boolean) => void;
  setKeyHints: (value: boolean) => void;
  setLaunchAtLogin: (value: boolean) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTINGS;
    const candidate = parsed as Partial<Record<keyof Settings, unknown>>;
    return {
      reducedMotion:
        typeof candidate.reducedMotion === "boolean"
          ? candidate.reducedMotion
          : DEFAULT_SETTINGS.reducedMotion,
      keyHints:
        typeof candidate.keyHints === "boolean" ? candidate.keyHints : DEFAULT_SETTINGS.keyHints,
      launchAtLogin:
        typeof candidate.launchAtLogin === "boolean"
          ? candidate.launchAtLogin
          : DEFAULT_SETTINGS.launchAtLogin,
    };
  } catch {
    // Corrupt storage or unavailable localStorage: fall back to defaults.
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Persistence is best-effort; ignore quota/unavailability errors.
  }
}

/**
 * Sync the OS-level autostart entry with the setting via the Tauri plugin.
 * Lazily imported and fully guarded so jsdom tests (no Tauri IPC) never
 * throw — outside Tauri the setting still persists, it just does nothing.
 */
async function applyLaunchAtLogin(value: boolean): Promise<void> {
  try {
    const autostart = await import("@tauri-apps/plugin-autostart");
    if (value) {
      await autostart.enable();
    } else if (await autostart.isEnabled()) {
      await autostart.disable();
    }
  } catch {
    // Not running under Tauri — nothing to apply.
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("sw-reduced-motion", settings.reducedMotion);
    return () => {
      root.classList.remove("sw-reduced-motion");
    };
  }, [settings.reducedMotion]);

  // Keep the OS autostart entry in step with the persisted setting (also
  // repairs drift on startup, e.g. the entry was removed outside the app).
  useEffect(() => {
    void applyLaunchAtLogin(settings.launchAtLogin);
  }, [settings.launchAtLogin]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      ...settings,
      setReducedMotion: (reducedMotion) => setSettings((prev) => ({ ...prev, reducedMotion })),
      setKeyHints: (keyHints) => setSettings((prev) => ({ ...prev, keyHints })),
      setLaunchAtLogin: (launchAtLogin) => setSettings((prev) => ({ ...prev, launchAtLogin })),
    }),
    [settings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (context === null) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
