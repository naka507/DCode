<script setup lang="ts">
/**
 * Composer controls: mode, permission, model, enhancement, and send/stop.
 *
 * The `ComposerToolbar` component. The decisions that are not mechanical:
 *
 *  1. **`t` is not a prop.** The i18next `TFunction` was threaded down from
 *     the Composer; every component here reads the same instance through
 *     `useI18n()` instead.
 *  2. **Every callback stays a prop, deliberately.** `setPermissionOpen` is
 *     a `Dispatch<SetStateAction<boolean>>`, not an `onXxx` handler: a
 *     child cannot write its parent's state, so the Composer hands its own setter
 *     down — functional-update form included
 *     (`setPermissionOpen((open) => !open)`), in the same way as before.
 *     `configureActiveSession` and `showToast` are store actions the toolbar
 *     *awaits* and toasts through on rejection; an emit returns `void`, so it
 *     could not carry that contract (the same call `useComposerSubmit` makes for
 *     `sendPrompt` / `steerPrompt` / `showToast`). `pickAndAttach`,
 *     `enhancePrompt`, `undoPromptEnhancement`, `abort` and `submit` are the
 *     Composer's controller functions, passed down the way `ComposerModelPicker`
 *     takes its `controller`.
 *  3. **Per-render derivations move into `computed`s.** The mode,
 *     permission and send labels twice each — once for `tooltip`, once for
 *     `ariaLabel` — and rebuilt them on every render; the two values are
 *     identical, so each is computed once here.
 *  4. **`AnchoredMenu`'s `trigger(ref)` render prop is its `#trigger` slot.**
 *     The slot hands back `setAnchor`, the same function ref the trigger took
 *     the trigger (`PlanApprovalBar.vue` and `ComposerModelPicker.vue` do the
 *     same). `onClose` is that component's `close` emit, and the
 *     `className` prop is the wrapper's `class`, which falls through.
 *  5. **`key={mode}` is kept as `:key`.** It is load-bearing: a key change makes
 *     Vue replace the span, which restarts the `composer-mode-face-in`
 *     animation `styles/composer.css` pins to `.composer-mode-chip-face`.
 *  6. **Bare `aria-hidden` is written `"true"`.** The bare attribute used to
 *     render that way and Vue would render `""`. The boolean ARIA attributes
 *     bound here (`aria-expanded`, `aria-busy`, `aria-checked`) keep their
 *     boolean form, which both frameworks serialize as `"true"` / `"false"`.
 *  7. **`{...contextUsage}` is `v-bind="contextUsage"`**, the translation of an
 *     object spread that `FileRefChip.vue` already uses. The spread's source is
 *     `lib/latest-turn-context.ts`'s `LatestTurnContextInspector`, which is the
 *     shape derived with `Parameters<typeof ContextUsageInspector>[0]`.
 *  8. `clearEnhancementError` stays a declared prop: it was declared in
 *     `ComposerToolbarProps` and never read, so the contract is unchanged.
 *     The exported props type itself has no SFC counterpart; a caller
 *     that needs it uses `InstanceType<typeof ComposerToolbar>`.
 *  9. `t(\`${mode}.planning\`)` resolves only for `plan` and `goal` — no shipped
 *     catalog has an `agent` namespace — so the agent chip echoes the key in
 *     both implementations.
 * 10. `text-sm`, `flex-1` and `text-left` are Tailwind utilities carried over
 *     verbatim from the markup; neither the stylesheet nor
 *     the `styles/*.css` defines them.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  keybindingDisplayParts,
  type Mode,
  type PermissionMode,
  type ShortcutPlatform,
  type SessionThinkingLevel,
} from "@dcode/shared";
import type { AppState } from "../../../stores/app-store";
import type { LatestTurnContextInspector } from "../../../lib/latest-turn-context";
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconPlus,
  IconSparkles,
  IconStop,
  IconUndo2,
} from "../../../lib/icons";
import TooltipButton from "../../../components/TooltipButton.vue";
import AnchoredMenu from "../../../components/settings/AnchoredMenu.vue";
import ContextUsageInspector from "../../../components/ContextUsageInspector.vue";
import ComposerModeIcon from "./ComposerModeIcon.vue";
import ComposerModelPicker from "./ComposerModelPicker.vue";
import {
  MODE_LABEL_KEYS,
  PERMISSION_MODE_I18N_KEYS,
  nextMode,
} from "./model";
import type { ComposerModelMenuController } from "./hooks/useComposerModelMenu";

/** The permission rows the menu offers. */
const PERMISSION_MODE_CANDIDATES = ["ask", "accept-edits", "auto"] as const;

const props = defineProps<{
  mode: Mode;
  planningLive: boolean;
  providerId?: string;
  modelId?: string;
  thinkingLevel: SessionThinkingLevel;
  composerPermissionMode: Exclude<PermissionMode, "inherit">;
  permissionOpen: boolean;
  /** See note 3: a `Dispatch<SetStateAction<boolean>>`, kept verbatim. */
  setPermissionOpen: (
    next: boolean | ((current: boolean) => boolean),
  ) => void;
  controlsBlocked: boolean;
  pasting: boolean;
  pickAndAttach: () => Promise<void>;
  configureActiveSession: AppState["configureActiveSession"];
  showToast: AppState["showToast"];
  modelMenu: ComposerModelMenuController;
  modelLabel: string;
  thinkingLabel: string;
  contextUsage: LatestTurnContextInspector | null;
  enhancementDraft: string;
  value: string;
  modelReady: boolean;
  sendBlocked: boolean;
  enhancingPrompt: boolean;
  enhancementUndoText: string | null;
  enhancePrompt: () => Promise<void>;
  undoPromptEnhancement: () => void;
  /** Declared and never read here either — see note 9. */
  clearEnhancementError: () => void;
  runActive: boolean;
  hasDraftContent: boolean;
  abort: AppState["abort"];
  submit: () => Promise<void>;
}>();


const { t } = useI18n();

/* The platform is read once; it never changes for an instance. */
const platform = (window.dcode?.platform ?? "darwin") as ShortcutPlatform;
const steeringShortcut = keybindingDisplayParts("Alt+Enter", platform).join("+");

/* See note 4: one value per label, instead of the same expression twice. */
const modeLabel = computed(() => t(MODE_LABEL_KEYS[props.mode]));

const modeChipTooltip = computed(() =>
  props.planningLive ? t(`${props.mode}.planning`) : t("settings.mode"),
);

const permissionChipTooltip = computed(() =>
  props.mode === "goal"
    ? `${t("chat.permissionMode")} · ${t("goal.autoWarning")}`
    : props.mode === "plan" && props.composerPermissionMode === "auto"
      ? `${t("chat.permissionMode")} · ${t("plan.autoWarning")}`
      : t("chat.permissionMode"),
);


const sendTooltip = computed(() =>
  props.runActive
    ? t("chat.sendWhileRunning", { shortcut: steeringShortcut })
    : props.modelReady
      ? t("chat.send")
      : t("settings.addProvider"),
);

const sendAriaLabel = computed(() =>
  props.modelReady ? t("chat.send") : t("settings.addProvider"),
);

function closePermissionMenu(): void {
  props.setPermissionOpen(false);
}

/** `chat.addFiles`: the picker closes the permission menu first. */
function attachFiles(): void {
  closePermissionMenu();
  void props.pickAndAttach();
}

/** The mode chip: close the sibling menus, then advance the cycle. */
async function cycleMode(): Promise<void> {
  props.modelMenu.setOpen(false);
  closePermissionMenu();
  const next: Mode = nextMode(props.mode);
  try {
    await props.configureActiveSession({
      mode: next,
      providerId: props.providerId,
      modelId: props.modelId,
      thinkingLevel: props.thinkingLevel,
    });
  } catch (error) {
    props.showToast(error instanceof Error ? error.message : String(error), {
      variant: "error",
    });
  }
}

/** One permission row: the menu closes, then the session is reconfigured. */
async function selectPermissionMode(
  candidate: (typeof PERMISSION_MODE_CANDIDATES)[number],
): Promise<void> {
  closePermissionMenu();
  try {
    await props.configureActiveSession({
      mode: props.mode,
      providerId: props.providerId,
      modelId: props.modelId,
      thinkingLevel: props.thinkingLevel,
      permissionMode: candidate,
    });
  } catch (error) {
    props.showToast(error instanceof Error ? error.message : String(error), {
      variant: "error",
    });
  }
}

function togglePermissionMenu(): void {
  props.modelMenu.setOpen(false);
  props.setPermissionOpen((current) => !current);
}

</script>

<template>
  <div class="composer-toolbar">
    <div class="composer-left">
      <div class="composer-plus">
        <TooltipButton
          type="button"
          class="icon-btn icon-btn-square"
          :label="t('chat.addFiles')"
          :aria-label="t('chat.addFiles')"
          :disabled="controlsBlocked || pasting"
          @click="attachFiles"
        >
          <IconPlus :size="15" aria-hidden="true" />
        </TooltipButton>
      </div>
      <TooltipButton
        type="button"
        class="icon-btn mode-chip composer-mode-chip"
        :data-mode="mode"
        :data-planning="planningLive ? 'true' : undefined"
        :label="modeChipTooltip"
        :aria-label="modeChipTooltip"
        :disabled="controlsBlocked"
        @click="cycleMode"
      >
        <span :key="mode" class="composer-mode-chip-face">
          <ComposerModeIcon :mode="mode" />
          <span class="composer-mode-chip-label text-sm">
            {{ modeLabel }}
          </span>
        </span>
      </TooltipButton>
      <AnchoredMenu
        class="composer-permission"
        :open="permissionOpen && mode !== 'goal'"
        menu-class-name="composer-permission-menu"
        :label="t('chat.permissionMode')"
        role="menu"
        align="start"
        side="top"
        @close="closePermissionMenu"
      >
        <template #trigger="{ setAnchor }">
          <TooltipButton
            :ref="setAnchor"
            type="button"
            class="icon-btn mode-chip"
            :class="{ active: permissionOpen }"
            :label="permissionChipTooltip"
            :aria-label="permissionChipTooltip"
            :aria-haspopup="mode === 'goal' ? undefined : 'menu'"
            :aria-expanded="mode === 'goal' ? false : permissionOpen"
            :disabled="controlsBlocked || mode === 'goal'"
            @click="togglePermissionMenu"
          >
            <span class="text-sm">
              {{ t(PERMISSION_MODE_I18N_KEYS[composerPermissionMode]) }}
            </span>
            <IconChevronDown :size="12" />
          </TooltipButton>
        </template>
        <button
          v-for="candidate in PERMISSION_MODE_CANDIDATES"
          :key="candidate"
          type="button"
          role="menuitemradio"
          :aria-checked="composerPermissionMode === candidate"
          :disabled="controlsBlocked"
          class="composer-plus-item"
          :class="{ active: composerPermissionMode === candidate }"
          @click="selectPermissionMode(candidate)"
        >
          <span class="flex-1 text-left">
            {{ t(PERMISSION_MODE_I18N_KEYS[candidate]) }}
          </span>
          <IconCheck v-if="composerPermissionMode === candidate" :size="13" />
        </button>
      </AnchoredMenu>
    </div>

    <div class="composer-right">
      <ContextUsageInspector v-if="contextUsage" v-bind="contextUsage" />
      <ComposerModelPicker
        :controller="modelMenu"
        :model-label="modelLabel"
        :thinking-label="thinkingLabel"
        :thinking-level="thinkingLevel"
        :selected-provider-id="providerId"
        :selected-model-id="modelId"
        :controls-blocked="controlsBlocked"
        @close-other-menus="closePermissionMenu"
      />
      <TooltipButton
        type="button"
        class="icon-btn icon-btn-square composer-enhance-btn"
        :class="{ 'is-loading': enhancingPrompt }"
        :label="t('chat.enhancePrompt')"
        :aria-label="
          enhancingPrompt ? t('chat.enhancingPrompt') : t('chat.enhancePrompt')
        "
        :aria-busy="enhancingPrompt"
        :disabled="
          !enhancementDraft.trim() ||
          enhancementDraft.trim().startsWith('/') ||
          !modelReady ||
          sendBlocked ||
          enhancingPrompt
        "
        @click="void enhancePrompt()"
      >
        <template v-if="enhancingPrompt">
          <span class="tool-spinner" aria-hidden="true" />
          <span>{{ t("chat.enhancingPrompt") }}</span>
        </template>
        <IconSparkles v-else :size="15" aria-hidden="true" />
      </TooltipButton>
      <TooltipButton
        v-if="enhancementUndoText !== null"
        type="button"
        class="icon-btn icon-btn-square composer-enhance-undo"
        :label="t('chat.undoEnhancement')"
        :aria-label="t('chat.undoEnhancement')"
        :disabled="controlsBlocked"
        @click="undoPromptEnhancement"
      >
        <IconUndo2 :size="15" aria-hidden="true" />
      </TooltipButton>
      <TooltipButton
        v-if="runActive && !hasDraftContent"
        type="button"
        class="stop-btn"
        :label="t('chat.stopGenerating')"
        :aria-label="t('chat.stopGenerating')"
        @click="void abort()"
      >
        <IconStop :size="14" />
      </TooltipButton>
      <TooltipButton
        v-else
        type="button"
        class="send-btn"
        :aria-label="sendAriaLabel"
        :label="sendTooltip"
        :disabled="
          !hasDraftContent ||
          sendBlocked ||
          (!modelReady && !value.trim().startsWith('/'))
        "
        @click="void submit()"
      >
        <IconArrowUp :size="15" />
      </TooltipButton>
    </div>
  </div>
</template>
