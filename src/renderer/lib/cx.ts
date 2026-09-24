/**
 * Join class names, dropping the falsy ones.
 *
 * Most of the renderer's markup writes
 * a static `class` plus an object `:class` binding, which the class-name
 * contract in `tests/vue-class-contract.test.mjs` reads directly. `cx` exists
 * for the handful of call sites that compose a list in script, so those stay
 * unchanged instead of being rewritten into a binding.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
