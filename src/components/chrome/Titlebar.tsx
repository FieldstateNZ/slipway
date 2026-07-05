import "./chrome.css";

/**
 * Invoke a window action via the Tauri API, lazily imported so the component
 * stays unit-testable under jsdom (no Tauri globals there — the import still
 * resolves, but the invoke inside rejects and is swallowed).
 */
async function windowAction(action: "close" | "minimize"): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    await (action === "close" ? window.close() : window.minimize());
  } catch (cause) {
    // Not running under Tauri (tests, plain browser) — nothing to do.
    console.warn(`window ${action} unavailable`, cause);
  }
}

export interface TitlebarProps {
  /** Ready summary shown in mono, e.g. "4 ready · 35m". */
  readySummary: string;
  onIntake: () => void;
  onLearned: () => void;
  onMap: () => void;
}

export function Titlebar({ readySummary, onIntake, onLearned, onMap }: TitlebarProps) {
  return (
    <div className="sw-titlebar" data-tauri-drag-region="">
      {/* macOS-style lights. Red and yellow are live (close / minimize);
          green stays decorative — maxWidth pins the window at 440px, so
          maximize has nothing meaningful to do in a sidebar-shaped app. */}
      <div className="sw-titlebar-lights">
        <button
          type="button"
          className="sw-titlebar-light sw-titlebar-light-red"
          aria-label="Close window"
          onClick={() => void windowAction("close")}
        />
        <button
          type="button"
          className="sw-titlebar-light sw-titlebar-light-yellow"
          aria-label="Minimize window"
          onClick={() => void windowAction("minimize")}
        />
        <span className="sw-titlebar-light sw-titlebar-light-green" aria-hidden="true" />
      </div>
      <span className="sw-titlebar-label">Slipway</span>
      <span className="sw-titlebar-spacer" />
      <span className="sw-titlebar-summary">{readySummary}</span>
      <button type="button" className="sw-titlebar-btn" onClick={onIntake} aria-label="Intake">
        +
      </button>
      <button type="button" className="sw-titlebar-btn" onClick={onLearned} aria-label="Learned">
        l
      </button>
      <button type="button" className="sw-titlebar-btn" onClick={onMap} aria-label="Map">
        g
      </button>
    </div>
  );
}
