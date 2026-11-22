import type { GameStore } from "../game/store";
import { useGameState } from "./useGameStore";

/** Clockwork loading indicator naming the level being solved (Req 2.9). */
export function LoadingPlate({ store }: { store: GameStore }) {
  const { screen } = useGameState(store);
  if (screen.kind !== "loading") return null;

  return (
    <div className="bz-loading" role="status">
      <span className="bz-loading__gear" aria-hidden="true" />
      <span className="bz-loading__gear bz-loading__gear--small" aria-hidden="true" />
      <p className="bz-loading__text">{`Loading ${screen.label}`}</p>
    </div>
  );
}
