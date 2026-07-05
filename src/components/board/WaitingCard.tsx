import "./board.css";

export interface WaitingCardProps {
  title: string;
  sub: string;
}

/** Dashed whisper card shown when a lane has nothing owner-you and ready. */
export function WaitingCard({ title, sub }: WaitingCardProps) {
  return (
    <div className="sw-wait">
      <div className="sw-wait-title">{title}</div>
      <div className="sw-wait-sub">{sub}</div>
    </div>
  );
}
