import { useEffect, useRef } from "react";

/**
 * Global keyboard dispatcher.
 *
 * Layers register a handler with a priority. Exactly one `keydown` listener
 * is attached to `document`; on each key event, layers are consulted from
 * highest priority to lowest, and the first handler that returns `true`
 * consumes the event. Unhandled keys fall through to lower layers. Among
 * layers with equal priority, the most recently registered wins.
 */
export const KEY_PRIORITY = {
  QUIZ: 40,
  DRAWER: 30,
  OVERLAY: 20,
  BOARD: 10,
} as const;

/** Returns true if the layer handled the key (stops propagation to lower layers). */
export type KeyHandler = (event: KeyboardEvent) => boolean;

interface KeyLayer {
  priority: number;
  handler: KeyHandler;
  seq: number;
}

const layers: KeyLayer[] = [];
let nextSeq = 0;
let listenerAttached = false;

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  );
}

function dispatch(event: KeyboardEvent): void {
  // Typing into a field never reaches the layers — otherwise the board would
  // steal digits (and handled keys' preventDefault would eat characters).
  if (isEditable(event.target)) return;
  // Highest priority first; within a priority, most recently registered first.
  const ordered = [...layers].sort((a, b) => b.priority - a.priority || b.seq - a.seq);
  for (const layer of ordered) {
    // A higher layer may unregister lower ones mid-dispatch; skip the dead.
    if (!layers.includes(layer)) continue;
    if (layer.handler(event)) {
      // Kill the default action for EVERY handled key: a handled Enter must
      // not also fire a synthetic click on whichever button holds focus
      // (double-advance), and a handled Tab must not move focus.
      event.preventDefault();
      return;
    }
  }
}

function syncListener(): void {
  if (!listenerAttached && layers.length > 0) {
    document.addEventListener("keydown", dispatch);
    listenerAttached = true;
  } else if (listenerAttached && layers.length === 0) {
    document.removeEventListener("keydown", dispatch);
    listenerAttached = false;
  }
}

/**
 * Register a key layer. Returns an unregister function (idempotent).
 */
export function registerKeyLayer(priority: number, handler: KeyHandler): () => void {
  const layer: KeyLayer = { priority, handler, seq: nextSeq++ };
  layers.push(layer);
  syncListener();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const index = layers.indexOf(layer);
    if (index !== -1) {
      layers.splice(index, 1);
    }
    syncListener();
  };
}

/**
 * React hook wrapper around `registerKeyLayer`. The latest `handler` is
 * always invoked without re-registering the layer (registration order — and
 * therefore same-priority precedence — is stable across renders).
 */
export function useKeyLayer(priority: number, handler: KeyHandler, enabled = true): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    return registerKeyLayer(priority, (event) => handlerRef.current(event));
  }, [priority, enabled]);
}
