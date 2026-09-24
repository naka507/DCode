/**
 * Store access shared by the renderer slices and runtimes.
 *
 * The shape is the store's `{ get, set }` pair; only the `AppState` import points
 * at the store declarations.
 */
import type { AppState } from "../app-state";

export type StoreSet = (
  update: Partial<AppState> | ((state: AppState) => Partial<AppState>),
) => void;

export type StoreGet = () => AppState;

export type StoreAccess = {
  get: StoreGet;
  set: StoreSet;
};
