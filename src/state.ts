import type { Selection } from "./types.ts";
import type { PermitId } from "./lib/permits.ts";

export type View = "map" | "list" | "ask" | "plan";

export interface State {
  view: View;
  selection: Selection;
  /** Where the selection came from. Only non-map sources trigger the fly-to animation. */
  source: "map" | "list" | "sheet" | "assistant" | null;
  query: string;
  /** Permits the driver says they hold. Empty = no filtering, show everything unjudged. */
  permits: PermitId[];
  /** State-issued accessible plate or placard. */
  ada: boolean;
}

type Listener = (next: State, prev: State) => void;

/** ~20-line store: one State object, patch to update, subscribers called synchronously. */
export function createStore(initial: State) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<State>) {
      const prev = state;
      state = { ...state, ...patch };
      for (const l of listeners) l(state, prev);
    },
    subscribe(l: Listener) {
      listeners.add(l);
    },
  };
}

export const sameSelection = (a: Selection, b: Selection) => a?.kind === b?.kind && a?.id === b?.id;
