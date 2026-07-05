// Global drag-drop listeners (prototype onDragOver/onDrop, lines 319–335).
// Tauri's native drag-drop interception is disabled in tauri.conf.json
// (`dragDropEnabled: false`) so these HTML5 events reach the webview.

import { useEffect, useRef, useState } from "react";

/** A document dropped anywhere on the window, ready for intake. */
export interface DroppedDoc {
  name: string;
  /** Display size like "12 kb"; empty for zero-byte files and text drops. */
  size: string;
  /** File contents (or the dropped text itself) — Atlas's source. */
  text: string;
}

/** Dragover events stop arriving ~this long before the curtain drops. */
const DRAG_CLEAR_MS = 260;

/**
 * Attach window-level dragover/drop listeners for the app's lifetime.
 * Returns whether a drag is currently over the window (drives the z60
 * drop curtain); `onDrop` fires with the parsed document once file text
 * has been read.
 */
export function useWindowDrop(onDrop: (doc: DroppedDoc) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onDropRef = useRef(onDrop);

  useEffect(() => {
    onDropRef.current = onDrop;
  });

  useEffect(() => {
    const handleDragOver = (event: DragEvent) => {
      event.preventDefault();
      setDragging(true);
      // The DOM has no "drag left the window" event we can trust; like the
      // prototype, the curtain lifts when dragover events stop arriving.
      clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setDragging(false), DRAG_CLEAR_MS);
    };
    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      clearTimeout(clearTimer.current);
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file !== undefined) {
        const size = file.size > 0 ? `${Math.max(1, Math.round(file.size / 1024))} kb` : "";
        // File.text() is async; the drop lands once the body is read. An
        // unreadable file still docks — Atlas just gets an empty source.
        void file.text().then(
          (text) => onDropRef.current({ name: file.name, size, text }),
          () => onDropRef.current({ name: file.name, size, text: "" }),
        );
        return;
      }
      // No file: dropped text. Name = first 34 chars (prototype line 331).
      const text = event.dataTransfer?.getData("text") ?? "";
      const name = text !== "" ? text.slice(0, 34) + (text.length > 34 ? "…" : "") : "pasted text";
      onDropRef.current({ name, size: "", text });
    };
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
      clearTimeout(clearTimer.current);
    };
  }, []);

  return dragging;
}
