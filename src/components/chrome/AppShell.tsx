import type { ReactNode } from "react";

import { Footer, type RecheckSlot } from "./Footer";
import { Titlebar } from "./Titlebar";
import "./chrome.css";

export interface AppShellProps {
  readySummary: string;
  onIntake: () => void;
  onLearned: () => void;
  onMap: () => void;
  toast?: string;
  recheck?: RecheckSlot;
  onReset: () => void;
  children?: ReactNode;
}

export function AppShell({
  readySummary,
  onIntake,
  onLearned,
  onMap,
  toast,
  recheck,
  onReset,
  children,
}: AppShellProps) {
  return (
    <div className="sw-app">
      <Titlebar
        readySummary={readySummary}
        onIntake={onIntake}
        onLearned={onLearned}
        onMap={onMap}
      />
      <main className="sw-main">{children}</main>
      <Footer toast={toast} recheck={recheck} onReset={onReset} />
    </div>
  );
}
