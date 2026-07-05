import { useSettings } from "../../lib/settings";
import "./chrome.css";

export interface RecheckSlot {
  label: string;
  onOpen: () => void;
}

export interface FooterProps {
  /** Toast message shown in a bordered accent box. */
  toast?: string;
  /** Clickable recheck prompt, rendered with an accent "[r] " prefix. */
  recheck?: RecheckSlot;
  onReset: () => void;
}

export function Footer({ toast, recheck, onReset }: FooterProps) {
  const { keyHints } = useSettings();
  return (
    <div className="sw-footer">
      {toast !== undefined && (
        <div className="sw-footer-box sw-footer-toast" role="status">
          {toast}
        </div>
      )}
      {recheck !== undefined && (
        <button type="button" className="sw-footer-box sw-footer-recheck" onClick={recheck.onOpen}>
          <span className="sw-footer-recheck-key">[r]</span> {recheck.label}
        </button>
      )}
      <div className="sw-footer-hints">
        {keyHints && (
          <span className="sw-footer-hintline">
            1 2 3 lanes · ⇥ deal · ↵ open · g map · l learned · drop a doc → intake
          </span>
        )}
        <span className="sw-footer-spacer" />
        <button type="button" className="sw-footer-reset" onClick={onReset}>
          reset
        </button>
      </div>
    </div>
  );
}
