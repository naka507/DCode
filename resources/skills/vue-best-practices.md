---
name: Vue Best Practices
description: Vue 3, Vite, and Pinia performance and architecture guidelines. Use when writing, reviewing, or refactoring Vue 3 components, composables, and Pinia stores to ensure optimal reactivity, rendering, and memory management.
---

# Vue 3, Vite & Pinia Performance & Architecture Best Practices

Comprehensive performance optimization and architecture guide for Vue 3 applications utilizing the Composition API, `<script setup>`, Vite, and Pinia. Contains concrete, actionable rules across 8 prioritized categories to guide automated code generation, refactoring, and code reviews.

## When to Apply

Reference these guidelines when:
- Writing new Vue 3 Single-File Components (`.vue`)
- Creating or refactoring Composition API composables (`use*`)
- Designing Pinia state stores and managing application data flow
- Optimizing reactivity performance, memory footprint, and virtual DOM patching
- Reviewing Vue code for memory leaks, event listener dangling, or unnecessary re-renders

## Rule Categories by Priority

| Priority | Category                              | Impact      | Prefix         |
| -------- | ------------------------------------- | ----------- | -------------- |
| 1        | Reactivity & State Optimization       | CRITICAL    | `reactivity-`  |
| 2        | Lifecycle & Memory Leak Prevention    | CRITICAL    | `lifecycle-`   |
| 3        | Template & Rendering Performance      | HIGH        | `template-`    |
| 4        | Component Architecture & Code Split   | HIGH        | `bundle-`      |
| 5        | Composable Design Patterns            | MEDIUM-HIGH | `composable-`  |
| 6        | Component Contracts & Communication   | MEDIUM      | `contract-`    |
| 7        | Pinia State Management                | MEDIUM      | `store-`       |
| 8        | Styling & Teleport Hygiene            | LOW-MEDIUM  | `style-`       |

---

## 1. Reactivity & State Optimization (CRITICAL)

- **`reactivity-shallow-ref-large-payloads`**: Use `shallowRef()` / `shallowReactive()` for large arrays, long lists, and IPC payloads. Deep `ref()` wraps every nested property in a `Proxy`, causing excessive memory overhead and serialization lag.
  ```typescript
  // Bad: Deep proxy over thousands of items
  const sessionList = ref<SessionRecord[]>([]);

  // Good: Only triggers on whole-reference replacement
  const sessionList = shallowRef<SessionRecord[]>([]);
  sessionList.value = nextSessions; // Triggers UI update cleanly
  ```
- **`reactivity-mark-raw-external-instances`**: Wrap complex external class instances, third-party libraries, and non-reactive utilities (e.g. Monaco Editor, Shiki, Canvas contexts, Mermaid, WebWorkers) with `markRaw()`.
  ```typescript
  // Bad: Vue recursively proxies Monaco editor or canvas internals
  const editor = ref(monaco.editor.create(container, options));

  // Good: Prevents Vue from proxying complex internal state
  const editor = shallowRef(markRaw(monaco.editor.create(container, options)));
  ```
- **`reactivity-safe-destructuring`**: Never destructure `props`, `reactive()` objects, or Pinia stores directly with ES6 destructuring, as this severs reactivity. Use `toRefs()`, `toRef()`, or `storeToRefs()`.
  ```typescript
  // Bad: title and count lose reactivity
  const { title, count } = props;

  // Good: Preserves reactive connections
  const { title, count } = toRefs(props);
  // Or for single property:
  const title = toRef(props, "title");
  ```
- **`reactivity-pure-computed`**: Keep `computed()` getters strictly pure, deterministic, and synchronous. Never mutate reactive state, trigger async side-effects, or perform DOM operations inside a computed getter.
  ```typescript
  // Bad: Mutating state inside computed
  const filteredList = computed(() => {
    lastCount.value = items.value.length; // Side-effect!
    return items.value.filter(i => i.active);
  });

  // Good: Pure transformation
  const filteredList = computed(() => items.value.filter(i => i.active));
  ```
- **`reactivity-cleanup-watchers`**: When creating watchers with async operations or listeners, use `onWatcherCleanup()` (Vue 3.5+) or the cleanup callback to avoid race conditions and resource leaks.
  ```typescript
  watch(query, (newQuery) => {
    const controller = new AbortController();
    fetchResults(newQuery, { signal: controller.signal });
    onWatcherCleanup(() => controller.abort());
  });
  ```

---

## 2. Lifecycle & Memory Leak Prevention (CRITICAL)

- **`lifecycle-cleanup-listeners`**: Always remove native window/document event listeners, custom event bus subscriptions, and Electron IPC listeners inside `onBeforeUnmount()` or `onUnmounted()`.
  ```typescript
  // Good: Retain unsubscribe function and invoke on unmount
  let unsubscribe: (() => void) | undefined;

  onMounted(() => {
    unsubscribe = window.dcode.on("notification", handleNotification);
    window.addEventListener("resize", handleResize);
  });

  onBeforeUnmount(() => {
    unsubscribe?.();
    window.removeEventListener("resize", handleResize);
  });
  ```
- **`lifecycle-cleanup-timers`**: Clear all active `setTimeout()`, `setInterval()`, and `requestAnimationFrame()` handles before component unmount.
  ```typescript
  let timer: number | undefined;
  onBeforeUnmount(() => {
    if (timer) window.clearTimeout(timer);
  });
  ```
- **`lifecycle-safe-dom-refs`**: Template element references (`ref<HTMLElement | null>(null)`) are only populated after mounting. Never access DOM refs in the root `<script setup>` execution body.
  ```typescript
  const containerRef = ref<HTMLDivElement | null>(null);

  // Bad: containerRef.value is null here!
  containerRef.value?.focus();

  // Good: Access inside onMounted or after nextTick
  onMounted(() => {
    containerRef.value?.focus();
  });
  ```

---

## 3. Template & Rendering Performance (HIGH)

- **`template-v-show-vs-v-if`**: Use `v-show` for elements that toggle visibility frequently (tooltips, dropdown menus, tab panes, popup overlays); use `v-if` for conditionally rendered sections that are rarely shown or benefit from lazy initialization.
- **`template-v-for-stable-key`**: Always provide a stable, unique identifier for `:key` in `v-for`. Never use array index (`:key="index"`) when the list can be reordered, inserted, or filtered.
  ```html
  <!-- Bad: Index causes unnecessary DOM replacement and input state bugs -->
  <div v-for="(item, index) in list" :key="index">{{ item.text }}</div>

  <!-- Good: Stable unique ID minimizes VNode patching -->
  <div v-for="item in list" :key="item.id">{{ item.text }}</div>
  ```
- **`template-no-v-if-with-v-for`**: Never place `v-if` and `v-for` on the same HTML element (`v-if` has higher precedence in Vue 3 and will fail to access list iteration variables). Filter the list via `computed()` instead, or wrap with a `<template v-if="...">`.
- **`template-v-memo-large-lists`**: Use `v-memo` on large lists (hundreds or thousands of items) to conditionally skip virtual DOM diffing unless key dependencies change.
  ```html
  <div v-for="item in list" :key="item.id" v-memo="[item.id === selectedId, item.updatedAt]">
    <ItemDetail :item="item" />
  </div>
  ```
- **`template-v-once-static`**: Apply `v-once` to complex static subtrees that never change after initial render to cache the VNode tree completely.

---

## 4. Component Architecture & Code Splitting (HIGH)

- **`bundle-async-components`**: Use `defineAsyncComponent()` to lazily load heavy dialogs, drawers, settings views, and non-immediate work panel plugins.
  ```typescript
  const MarkdownPreview = defineAsyncComponent(() =>
    import("./MarkdownPreview.vue")
  );
  ```
- **`bundle-keep-alive-bounded`**: When wrapping dynamic views with `<KeepAlive>`, always provide a `:max="N"` limit and `:include` / `:exclude` to prevent unbounded memory growth from cached component instances.
  ```html
  <KeepAlive :max="10" :include="cachedViews">
    <component :is="activeComponent" />
  </KeepAlive>
  ```
- **`bundle-barrel-imports`**: Avoid importing from monolithic library entrypoints (e.g. `import { Check } from "lucide-vue-next"`). Prefer direct module paths or auto-import resolver plugins to enable optimal tree-shaking.

---

## 5. Composable Design Patterns (MEDIUM-HIGH)

- **`composable-use-prefix`**: Encapsulate reusable stateful logic into composable functions with the `use*` naming convention (e.g., `useSessionTranscript`, `useKeyboardShortcuts`).
- **`composable-flexible-args`**: Accept `MaybeRefOrGetter<T>` for composable parameters and resolve them using `toValue()` to support raw values, refs, and getter functions interchangeably.
  ```typescript
  import { toValue, type MaybeRefOrGetter } from "vue";

  export function useFilter(items: MaybeRefOrGetter<Item[]>, query: MaybeRefOrGetter<string>) {
    return computed(() => {
      const q = toValue(query).toLowerCase();
      return toValue(items).filter(item => item.name.includes(q));
    });
  }
  ```
- **`composable-destructurable-return`**: Return a plain JavaScript object containing `ref` or `computed` properties, allowing callers to safely destructure without breaking reactivity.
- **`composable-instance-scope`**: Register lifecycle hooks (`onMounted`, `onUnmounted`) synchronously at the top level of the composable, guaranteeing they attach to the calling component instance.

---

## 6. Component Contracts & Communication (MEDIUM)

- **`contract-define-model`**: In Vue 3.4+, use `defineModel()` for two-way bindings instead of boilerplate `props.modelValue` and `emit("update:modelValue")`.
  ```vue
  <script setup lang="ts">
  // Creates two-way binding with automatic update emitter
  const modelValue = defineModel<string>({ required: true });
  const isExpanded = defineModel<boolean>("expanded", { default: false });
  </script>
  ```
- **`contract-typed-props-emits`**: Use pure TypeScript type declarations for `defineProps<{ ... }>()` and `defineEmits<{ ... }>()` to enforce compile-time verification without runtime overhead.
  ```vue
  <script setup lang="ts">
  const props = defineProps<{
    sessionId: string;
    readOnly?: boolean;
  }>();

  const emit = defineEmits<{
    select: [id: string];
    delete: [id: string];
  }>();
  </script>
  ```
- **`contract-typed-injection-keys`**: When using `provide()` / `inject()`, define and share typed `InjectionKey<T>` symbols to guarantee type safety between ancestor and descendant components.
  ```typescript
  import type { InjectionKey, Ref } from "vue";
  export const ActiveSessionKey: InjectionKey<Ref<SessionSummary | null>> = Symbol("ActiveSession");
  ```

---

## 7. Pinia State Management (MEDIUM)

- **`store-shallow-for-heavy-collections`**: In setup stores (`defineStore("id", () => { ... })`), store bulk data (e.g. lists of transcripts, files, or audit logs) in `shallowRef()` to avoid recursive Proxy overhead across large datasets.
- **`store-colocate-actions`**: Keep state mutations encapsulated within store actions and methods rather than performing arbitrary direct state mutations across disparate components.
- **`store-selective-destructuring`**: Use `storeToRefs(store)` only for the specific state and getter properties needed by the component, avoiding wholesale reactive cloning.
  ```typescript
  const store = useAppStore();
  const { currentProject, isWorking } = storeToRefs(store); // Preserves reactivity
  const { openProject } = store; // Methods can be destructured directly
  ```

---

## 8. Styling & Teleport Hygiene (LOW-MEDIUM)

- **`style-scoped-selectors`**: Use `<style scoped>` by default for all component styles. Use `:deep()` intentionally and sparingly to style slotted or child component internals.
- **`style-teleport-target`**: Ensure the target DOM node for `<Teleport to="...">` (such as `#dcode-overlays` or `body`) exists in the document before the component renders, avoiding mounting failures.
- **`style-css-variable-theming`**: Rely on CSS variables for theme tokens (colors, radii, spacing) rather than computing style colors in JavaScript, ensuring instant, zero-recalculation theme switches.
