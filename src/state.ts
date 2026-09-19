import type { Selection } from "./types.ts";
import type { PermitChoice } from "./lib/permits.ts";

export type View = "map" | "list" | "ask";

export interface State {
  view: View;
  selection: Selection;
  /** Where the selection came from. Only non-map sources trigger the fly-to animation. */
  source: "map" | "list" | "sheet" | "assistant" | null;
  query: string;
  /** The user's permit, or null for "any permit" (nothing dimmed or filtered). */
  permit: PermitChoice | null;
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
