<script setup lang="ts">
/**
 * Renderer-drawn window controls for Windows/Linux (D-frameless chrome).
 *
 * The `WindowControls` surface.:
 * macOS keeps native inset traffic lights, other platforms run a frameless
 * window, so minimize/maximize/close live here — flat Codex-style glyph buttons
 * pinned to the top-right of the 46px titlebar band. AppShell owns a single
 * control band outside the conversation and work-panel stacking contexts.
 *
 * `useEffect(., [platform])` becomes `onMounted` + `onUnmounted` on a single
 * read of `platform`: the dependency never changes for a window, so
 * the subscription is established once.
 *
 * One deliberate choice: thinner strokes suit these
 * small glyphs (`strokeWidth={1.5}`/`1.4`), but this tree's `icon()` helper
 * pins `strokeWidth: 1.75` for every icon (`lib/icons.ts:158`), and no other
 * surface passes one. The size is kept; the stroke follows the tree.
 */
import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "../lib/api";
import { IconClose, IconCopy, IconMinus, IconSquare } from "../lib/icons";
import TooltipButton from "./TooltipButton.vue";

const { t } = useI18n();

const platform = (window.dcode?.platform ?? "darwin") as string;
const maximized = ref(false);
let mounted = true;
let unsubscribe: (() => void) | null = null;

onMounted(() => {
  if (platform === "darwin") return;
  void api
    .windowControl("getState")
    .then((state) => {
      if (mounted) maximized.value = state.maximized;
    })
    .catch(() => undefined);
  unsubscribe = api.onWindowMaximized((event) => {
    maximized.value = event.maximized;
  });
});

onUnmounted(() => {
  mounted = false;
  unsubscribe?.();
  unsubscribe = null;
});
</script>

<template>
  <div v-if="platform !== 'darwin'" class="window-controls no-drag">
    <TooltipButton
      as="button"
      class="window-control-btn"
      :label="t('window.minimize')"
      :aria-label="t('window.minimize')"
      @click="void api.windowControl('minimize')"
    >
      <IconMinus :size="12" aria-hidden="true" />
    </TooltipButton>
    <TooltipButton
      as="button"
      class="window-control-btn"
      :label="maximized ? t('window.restore') : t('window.maximize')"
      :aria-label="maximized ? t('window.restore') : t('window.maximize')"
      @click="
        void api
          .windowControl('toggleMaximize')
          .then((result) => {
            maximized = result.maximized;
          })
      "
    >
      <IconCopy v-if="maximized" :size="11" aria-hidden="true" />
      <IconSquare v-else :size="10" aria-hidden="true" />
    </TooltipButton>
    <TooltipButton
      as="button"
      class="window-control-btn window-control-close"
      :label="t('window.close')"
      :aria-label="t('window.close')"
      @click="void api.windowControl('close')"
    >
      <IconClose :size="12" aria-hidden="true" />
    </TooltipButton>
  </div>
</template>
