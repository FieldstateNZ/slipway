import { AppShell } from "./components/chrome/AppShell";
import { SettingsProvider } from "./lib/settings";

function noop(): void {
  // Placeholder chrome handlers until later slices wire real behavior.
}

export default function App() {
  return (
    <SettingsProvider>
      <AppShell
        readySummary="0 ready · 0m"
        onIntake={noop}
        onLearned={noop}
        onMap={noop}
        onReset={noop}
      >
        {/* Board lanes land here in a later slice. */}
      </AppShell>
    </SettingsProvider>
  );
}
