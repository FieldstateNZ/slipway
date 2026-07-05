import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const SETTINGS_STORAGE_KEY = "slipway-settings-v1";

export interface Settings {
  reducedMotion: boolean;
  keyHints: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  reducedMotion: false,
  keyHints: true,
};

export interface SettingsContextValue extends Settings {
  setReducedMotion: (value: boolean) => void;
  setKeyHints: (value: boolean) => void;
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

  const value = useMemo<SettingsContextValue>(
    () => ({
      ...settings,
      setReducedMotion: (reducedMotion) => setSettings((prev) => ({ ...prev, reducedMotion })),
      setKeyHints: (keyHints) => setSettings((prev) => ({ ...prev, keyHints })),
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
