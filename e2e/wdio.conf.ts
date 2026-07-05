// WebdriverIO + tauri-driver: drives the real debug binary end-to-end.
//
// Prereqs (Linux): `webkit2gtk-driver` + `xvfb` (apt) and
// `cargo install tauri-driver --locked`, then:
//
//   pnpm tauri build --debug --no-bundle
//   xvfb-run --auto-servernum pnpm e2e
//
// Every run gets a throwaway profile: XDG_DATA_HOME/XDG_CONFIG_HOME/
// XDG_CACHE_HOME point into a fresh temp dir, so the SQLite store starts
// empty (first-run state) and window-state/autostart writes stay contained.
// To wipe a real local profile instead: rm -rf ~/.local/share/nz.fieldstate.slipway
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const application = path.resolve(here, "../target/debug/slipway");

function tauriDriverBinary(): string {
  if (process.env.TAURI_DRIVER !== undefined) return process.env.TAURI_DRIVER;
  const cargoBin = path.join(homedir(), ".cargo", "bin", "tauri-driver");
  return existsSync(cargoBin) ? cargoBin : "tauri-driver";
}

let tauriDriver: ChildProcess | undefined;

export const config: WebdriverIO.Config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./*.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application,
      },
    } as WebdriverIO.Capabilities,
  ],
  logLevel: "warn",
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  onPrepare: () => {
    if (!existsSync(application)) {
      throw new Error(
        `missing app binary at ${application} — run: pnpm tauri build --debug --no-bundle`,
      );
    }
    // Fresh profile per run: the app resolves app_data_dir (SQLite store),
    // config, and cache under these, so first-run state is guaranteed.
    const profile = mkdtempSync(path.join(tmpdir(), "slipway-e2e-"));
    for (const dir of ["data", "config", "cache"]) mkdirSync(path.join(profile, dir));
    tauriDriver = spawn(tauriDriverBinary(), [], {
      stdio: [null, process.stdout, process.stderr],
      env: {
        ...process.env,
        XDG_DATA_HOME: path.join(profile, "data"),
        XDG_CONFIG_HOME: path.join(profile, "config"),
        XDG_CACHE_HOME: path.join(profile, "cache"),
      },
    });
    tauriDriver.on("error", (error) => {
      console.error("tauri-driver failed to start:", error);
      process.exit(1);
    });
  },

  onComplete: () => {
    tauriDriver?.kill();
  },
};
