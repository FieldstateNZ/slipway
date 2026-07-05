import "./intake.css";

/**
 * The full-window drop curtain (design lines 236–243): shows while a drag is
 * over the window, pointer-events none so the drop still lands underneath.
 */
export function DragOverlay() {
  return (
    <div className="sw-dragover" aria-hidden="true">
      <div className="sw-dragover-inner">
        <div className="sw-dragover-main">drop it — it becomes tasks</div>
        <div className="sw-dragover-sub">intake opens with the parsed loops</div>
      </div>
    </div>
  );
}
