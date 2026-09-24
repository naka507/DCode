/**
 * Copy-to-clipboard affordance state.
 *
 * Kept in `lib`
 * rather than in `Markdown.vue` because three surfaces share it (the Markdown
 * code card, the transcript's copy buttons, and the tool-detail block heads) and
 * a `.vue` file cannot export a composable to them without a second module
 * anyway.
 *
 * `useEffect(() => () => clearTimeout(...), [])` becomes `onScopeDispose`.
 */
import { onScopeDispose, ref } from "vue";

export function useCopy() {
  const copied = ref(false);
  let timer: number | undefined;
  onScopeDispose(() => window.clearTimeout(timer));
  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      copied.value = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        copied.value = false;
      }, 1500);
    });
  }
  return { copied, copy };
}
