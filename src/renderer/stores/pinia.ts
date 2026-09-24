/**
 * The renderer's Pinia instance.
 *
 * It lives in its own module, rather than being created inside `main.ts`, for
 * two reasons:
 *
 *   1. `stores/app-store.ts` composes the whole state graph at module scope, so
 *      anything that reaches a store definition needs one instance that every
 *      entry point shares. Creating a second `createPinia()` in `main.ts` would
 *      give the plugin-launcher window and the main window separate store
 *      registries over the same module-scope state cell.
 *   2. Non-component callers (and future tests) can `setActivePinia` it without
 *      standing up an Electron window.
 */
import { createPinia } from "pinia";

export const rendererPinia = createPinia();
