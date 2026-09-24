---
name: React Best Practices
description: React and Next.js performance optimization guidelines. Use when writing, reviewing, or refactoring React/Next.js code to ensure optimal performance patterns.
---

# React & Next.js Performance Best Practices

Comprehensive performance optimization guide for React and Next.js applications. Contains 70 rules across 8 prioritized categories to guide automated refactoring and code generation.

## When to Apply

Reference these guidelines when:
- Writing new React components or Next.js pages
- Implementing data fetching (client or server-side)
- Reviewing code for performance issues
- Refactoring existing React/Next.js code
- Optimizing bundle size or load times

## Rule Categories by Priority

| Priority | Category                  | Impact      | Prefix       |
| -------- | ------------------------- | ----------- | ------------ |
| 1        | Eliminating Waterfalls    | CRITICAL    | `async-`     |
| 2        | Bundle Size Optimization  | CRITICAL    | `bundle-`    |
| 3        | Server-Side Performance   | HIGH        | `server-`    |
| 4        | Client-Side Data Fetching | MEDIUM-HIGH | `client-`    |
| 5        | Re-render Optimization    | MEDIUM      | `rerender-`  |
| 6        | Rendering Performance     | MEDIUM      | `rendering-` |
| 7        | JavaScript Performance    | LOW-MEDIUM  | `js-`        |
| 8        | Advanced Patterns         | LOW         | `advanced-`  |

---

## 1. Eliminating Waterfalls (CRITICAL)

- **`async-cheap-condition-before-await`**: Check synchronous, cheap conditions (e.g. `if (!enabled) return;`) before awaiting asynchronous flags or remote values.
- **`async-defer-await`**: Move `await` into branches where the result is actually used rather than awaiting at the top of a function.
- **`async-parallel`**: Use `Promise.all()` for independent asynchronous operations to execute them concurrently instead of serially.
  ```typescript
  // Bad: Sequential waterfall
  const user = await fetchUser(id);
  const posts = await fetchPosts(id);

  // Good: Concurrent execution
  const [user, posts] = await Promise.all([fetchUser(id), fetchPosts(id)]);
  ```
- **`async-dependencies`**: For partial dependencies, initiate independent promises early and await them only when needed.
- **`async-api-routes`**: Start independent background promises early, await late in API route handlers.
- **`async-suspense-boundaries`**: Wrap slow data-fetching components in `<Suspense>` boundaries so the shell streams immediately without blocking on slowest queries.

---

## 2. Bundle Size Optimization (CRITICAL)

- **`bundle-barrel-imports`**: Import directly from specific modules; avoid barrel index files that pull unnecessary transitive dependencies.
  ```typescript
  // Bad: Imports entire icon library
  import { Check } from "lucide-react";
  // Good: Direct module import when tree-shaking is sub-optimal
  ```
- **`bundle-analyzable-paths`**: Prefer statically analyzable import paths over dynamic string concatenations.
- **`bundle-dynamic-imports`**: Use `next/dynamic` or `React.lazy()` for heavy components that are not visible during initial paint (e.g., modals, rich text editors).
- **`bundle-defer-third-party`**: Defer non-critical third-party analytics, logging, and widgets until after hydration.
- **`bundle-conditional`**: Load vendor modules only when the feature flag or user action triggers them.
- **`bundle-preload`**: Preload code chunks on mouse hover or element focus for near-instant navigation perception.

---

## 3. Server-Side Performance (HIGH)

- **`server-auth-actions`**: Authenticate and validate permissions in server actions with the same rigor as API routes.
- **`server-cache-react`**: Wrap per-request data functions in `React.cache()` to automatically deduplicate identical calls within the same request lifecycle.
- **`server-cache-lru`**: Implement bounded LRU memory caches for expensive cross-request operations.
- **`server-dedup-props`**: Avoid passing duplicate or oversized objects from Server Components to Client Components to minimize JSON serialization payload.
- **`server-hoist-static-io`**: Hoist static I/O (fonts, config files, static assets) to module scope to avoid re-reading them per request.
- **`server-no-shared-module-state`**: Never store request-specific mutable data in module-level variables in SSR environments.
- **`server-parallel-fetching`**: Structure component trees so sibling data-fetching components can execute in parallel.

---

## 4. Client-Side Data Fetching (MEDIUM-HIGH)

- **`client-swr-dedup`**: Leverage SWR or React Query for automatic deduplication, background revalidation, and caching.
- **`client-event-listeners`**: Deduplicate global window/document event listeners using a centralized dispatcher.
- **`client-passive-event-listeners`**: Always mark touch and scroll event listeners as `{ passive: true }` to keep the main thread fluid.
- **`client-localstorage-schema`**: Version schema keys and minimize JSON payload size when reading/writing to `localStorage`.

---

## 5. Re-render Optimization (MEDIUM)

- **`rerender-defer-reads`**: Do not subscribe to state inside a component if that state is only read inside an event callback; use refs or store getters instead.
- **`rerender-memo`**: Extract computationally expensive subtrees into memoized components (`React.memo`).
- **`rerender-memo-with-default-value`**: Hoist default non-primitive objects and arrays outside components so reference equality is preserved.
  ```typescript
  // Bad: New array reference created every render
  function List({ items = [] }) { ... }

  // Good: Constant reference
  const EMPTY_ITEMS: Item[] = [];
  function List({ items = EMPTY_ITEMS }) { ... }
  ```
- **`rerender-dependencies`**: Prefer primitive values (strings, numbers, booleans) in dependency arrays rather than wide composite objects.
- **`rerender-derived-state-no-effect`**: Derive state synchronously during rendering instead of syncing with `useEffect`.
  ```typescript
  // Bad: Unnecessary render pass
  const [fullName, setFullName] = useState("");
  useEffect(() => { setFullName(`${first} ${last}`); }, [first, last]);

  // Good: Synchronously derived
  const fullName = `${first} ${last}`;
  ```
- **`rerender-functional-setstate`**: Use functional updater form `setCount(prev => prev + 1)` to eliminate dependencies in `useCallback`.
- **`rerender-lazy-state-init`**: Pass initializer functions `useState(() => expensiveComputation())` for expensive initial states.
- **`rerender-no-inline-components`**: Never define a React component function inside another component's render body.

---

## 6. Rendering Performance (MEDIUM)

- **`rendering-content-visibility`**: Apply CSS `content-visibility: auto` to off-screen elements in long lists to bypass layout and paint costs.
- **`rendering-hoist-jsx`**: Hoist immutable JSX trees outside component functions.
- **`rendering-conditional-render`**: Use ternary expressions `condition ? <Comp /> : null` instead of `condition && <Comp />` to avoid rendering `0` or falsy strings.
- **`rendering-usetransition-loading`**: Prefer `useTransition` for non-urgent state updates to keep input typing and animations responsive.
- **`rendering-script-defer-async`**: Always add `defer` or `async` to external scripts.

---

## 7. JavaScript Performance (LOW-MEDIUM)

- **`js-batch-dom-css`**: Batch DOM mutations using CSS classes or `requestAnimationFrame`.
- **`js-index-maps`**: Build `Map` or `Set` lookups once for $O(1)$ item lookups instead of repeated $O(N)$ `array.find()` in loops.
- **`js-cache-property-access`**: Cache repeatedly accessed nested properties in local variables inside tight loops.
- **`js-combine-iterations`**: Combine consecutive `.filter().map()` calls into a single loop or `reduce()` when handling large arrays.
- **`js-early-exit`**: Guard with early returns at function heads to reduce nesting and skip unnecessary processing.
- **`js-set-map-lookups`**: Use `Set.has()` instead of `Array.includes()` for membership checks over large collections.
- **`js-tosorted-immutable`**: Use `toSorted()` / `toReversed()` instead of mutating `sort()` / `reverse()`.

---

## 8. Advanced Patterns (LOW)

- **`advanced-init-once`**: Ensure application-level singletons initialize exactly once per app session.
- **`advanced-use-latest`**: Implement `useLatest(callback)` refs to access current state in long-lived subscriptions without triggering effect teardown/re-subscribe.
