import "./chrome.css";

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
      <div className="sw-titlebar-lights" aria-hidden="true">
        <span className="sw-titlebar-light sw-titlebar-light-red" />
        <span className="sw-titlebar-light sw-titlebar-light-yellow" />
        <span className="sw-titlebar-light sw-titlebar-light-green" />
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
