// The v0.1 happy path (issue #9), against the real binary with a fresh
// profile: first-run empty state → seed import → board → do ds1 in the
// drawer → capture → toast → ledger shows the concept → map shows it done.
import { $, $$, browser, expect } from "@wdio/globals";

/** Wait until `element` (re-queried each tick) has text containing `text`. */
async function waitForTextContaining(selector: string, text: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      const target = $(selector);
      return (await target.isExisting()) && (await target.getText()).includes(text);
    },
    { timeoutMsg: `no "${text}" inside ${selector}` },
  );
}

describe("Slipway v0.1 happy path", () => {
  it("goes first-run → seed → complete ds1 → ledger → map", async () => {
    // Issue #9 acceptance: "no console errors" through the whole loop.
    // WebKitWebDriver exposes no log API, so hook the page itself.
    await browser.execute(() => {
      const sink: string[] = [];
      (window as unknown as { __swErrors: string[] }).__swErrors = sink;
      window.addEventListener("error", (event) => sink.push(String(event.message)));
      window.addEventListener("unhandledrejection", (event) =>
        sink.push(`unhandled rejection: ${String(event.reason)}`),
      );
      const original = console.error.bind(console);
      console.error = (...args: unknown[]) => {
        sink.push(args.map(String).join(" "));
        original(...args);
      };
    });

    // First-run empty state: never a blank wall — the seed button and the
    // intake line are both on offer.
    const seedButton = $(".sw-board-empty-btn");
    await seedButton.waitForDisplayed();
    await expect(seedButton).toHaveText("load the launch graph");
    await expect($(".sw-board-empty-sub")).toHaveText(
      "or go straight to intake — drop a doc / press i",
    );

    // Load the launch graph: three lanes, ds1 dealt as the first focus.
    await seedButton.click();
    await browser.waitUntil(async () => (await $$(".sw-lane")).length === 3, {
      timeoutMsg: "expected 3 lanes after seed import",
    });
    await expect($(".sw-focus-title")).toHaveText("Merge PR #1 — OIDC publishing");

    // Optional: refresh the README screenshot from a real run
    // (SLIPWAY_SCREENSHOT=docs/screenshot.png xvfb-run pnpm e2e).
    if (process.env.SLIPWAY_SCREENSHOT !== undefined) {
      await browser.pause(1500); // let the dealt cards paint
      await browser.saveScreenshot(process.env.SLIPWAY_SCREENSHOT);
    }

    // Open ds1 and step through both steps.
    await $(".sw-focus").click();
    await $(".sw-drawer").waitForDisplayed();
    await expect($(".sw-drawer-phase-label")).toHaveText("STEP 1 OF 2");
    await $(".sw-drawer-cta").click();
    await expect($(".sw-drawer-phase-label")).toHaveText("STEP 2 OF 2");
    await $(".sw-drawer-cta").click();

    // Capture — the ONE TAP question. Index 1 is the correct answer.
    await $(".sw-drawer-cap-q").waitForDisplayed();
    const choices = await $$(".sw-drawer-cap-choice");
    await choices[1].click();

    // Correct pick: dwell, drawer closes, board choreography runs, and the
    // footer toast reports the capture.
    await $(".sw-drawer").waitForExist({ reverse: true });
    await waitForTextContaining(".sw-footer-toast", "oidc trusted publishing — captured");

    // l → the ledger holds the concept.
    await browser.keys("l");
    await $(".sw-ledger").waitForDisplayed();
    await waitForTextContaining(".sw-ledger-body", "oidc trusted publishing");

    // Esc closes it; g → the map shows ds1 done.
    await browser.keys("Escape");
    await $(".sw-ledger").waitForExist({ reverse: true });
    await browser.keys("g");
    await $(".sw-map").waitForDisplayed();
    await waitForTextContaining(".sw-map-body", "✓ ds1");

    // The whole loop ran without a single console error, page error, or
    // unhandled rejection.
    const errors = await browser.execute(
      () => (window as unknown as { __swErrors: string[] }).__swErrors,
    );
    expect(errors).toEqual([]);
  });
});
