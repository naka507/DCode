<script setup lang="ts">
/**
 * Keyboard shortcut map (Settings → Shortcuts).
 *
 * The recorder button arms
 * itself and captures the next keydown; the binding is validated (modifier,
 * reserved, conflict) before it is written. Overrides live in
 * `settings.keybindings`, with `null` meaning "disabled" and a missing entry
 * meaning "the default".
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  KEYBOARD_SHORTCUTS,
  defaultKeybinding,
  isAllowedKeybinding,
  isReservedKeybinding,
  keybindingDisplayParts,
  keybindingFromEvent,
  keybindingsConflict,
  resolveKeybinding,
  type AppSettings,
  type KeyboardShortcutDefinition,
  type KeyboardShortcutGroup,
  type KeyboardShortcutId,
  type ShortcutPlatform,
} from "@dcode/shared";
import { IconPower, IconSnapshot } from "../../lib/icons";
import TooltipButton from "../TooltipButton.vue";

const props = defineProps<{
  settings: AppSettings;
  platform: ShortcutPlatform;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}>();

const { t } = useI18n();

const GROUP_ORDER: readonly KeyboardShortcutGroup[] = [
  "navigation",
  "agent",
  "window",
];

function shortcutLabelKey(id: KeyboardShortcutId): string {
  return `settings.shortcutAction.${id}`;
}

const recordingId = ref<KeyboardShortcutId | null>(null);
const savingId = ref<KeyboardShortcutId | null>(null);
const error = ref<{ id: KeyboardShortcutId; message: string } | null>(null);

const groups = computed(() =>
  GROUP_ORDER.map((group) => ({
    group,
    shortcuts: KEYBOARD_SHORTCUTS.filter((shortcut) => shortcut.group === group),
  })),
);

const hasOverrides = computed(
  () => Object.keys(props.settings.keybindings ?? {}).length > 0,
);

function displayParts(binding: string): string[] {
  return keybindingDisplayParts(binding, props.platform);
}

async function storeBinding(
  shortcut: KeyboardShortcutDefinition,
  binding: string | null,
  mode: "binding" | "disabled" | "default" = "binding",
) {
  const next: Record<string, string | null> = {
    ...(props.settings.keybindings ?? {}),
  };
  if (mode === "default") {
    delete next[shortcut.id];
  } else if (mode === "disabled") {
    next[shortcut.id] = null;
  } else if (!binding || binding === defaultKeybinding(shortcut, props.platform)) {
    delete next[shortcut.id];
  } else {
    next[shortcut.id] = binding;
  }
  savingId.value = shortcut.id;
  error.value = null;
  try {
    await props.saveSettings({ keybindings: next });
    recordingId.value = null;
  } catch (saveError) {
    error.value = {
      id: shortcut.id,
      message:
        saveError instanceof Error
          ? saveError.message
          : t("settings.shortcutSaveFailed"),
    };
  } finally {
    savingId.value = null;
  }
}

function recordBinding(
  event: KeyboardEvent,
  shortcut: KeyboardShortcutDefinition,
) {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    recordingId.value = null;
    error.value = null;
    return;
  }
  const binding = keybindingFromEvent(event, props.platform);
  if (!binding || !isAllowedKeybinding(binding)) {
    error.value = {
      id: shortcut.id,
      message: t("settings.shortcutRequiresModifier"),
    };
    return;
  }
  if (isReservedKeybinding(binding, props.platform)) {
    error.value = { id: shortcut.id, message: t("settings.shortcutReserved") };
    return;
  }
  const conflict = KEYBOARD_SHORTCUTS.find(
    (candidate) =>
      candidate.id !== shortcut.id &&
      keybindingsConflict(
        resolveKeybinding(candidate, props.settings.keybindings, props.platform),
        binding,
      ),
  );
  if (conflict) {
    error.value = {
      id: shortcut.id,
      message: t("settings.shortcutConflict", {
        action: t(shortcutLabelKey(conflict.id)),
      }),
    };
    return;
  }
  void storeBinding(shortcut, binding);
}

function bindingOf(shortcut: KeyboardShortcutDefinition): string | null {
  return resolveKeybinding(
    shortcut,
    props.settings.keybindings,
    props.platform,
  );
}

function isCustomized(shortcut: KeyboardShortcutDefinition): boolean {
  return Object.prototype.hasOwnProperty.call(
    props.settings.keybindings ?? {},
    shortcut.id,
  );
}

function isDisabled(shortcut: KeyboardShortcutDefinition): boolean {
  return (
    isCustomized(shortcut) &&
    props.settings.keybindings?.[shortcut.id] === null
  );
}

function rowError(shortcut: KeyboardShortcutDefinition): string | null {
  return error.value?.id === shortcut.id ? error.value.message : null;
}

function startRecording(shortcut: KeyboardShortcutDefinition) {
  error.value = null;
  recordingId.value = shortcut.id;
}

function onRecorderBlur(shortcut: KeyboardShortcutDefinition) {
  if (recordingId.value === shortcut.id) recordingId.value = null;
}

function resetAll() {
  recordingId.value = null;
  error.value = null;
  void props.saveSettings({ keybindings: {} });
}
</script>

<template>
  <section class="settings-card-block">
    <div class="settings-card-heading-row">
      <div>
        <h3 class="settings-card-heading">{{ t("settings.keyboard") }}</h3>
      </div>
      <button
        type="button"
        class="settings-text-action"
        :disabled="!hasOverrides || savingId !== null"
        @click="resetAll"
      >
        <IconSnapshot :size="13" />
        <span>{{ t("settings.shortcutResetAll") }}</span>
      </button>
    </div>
    <div class="settings-panel shortcut-map">
      <div
        v-for="{ group, shortcuts } in groups"
        :key="group"
        class="shortcut-group"
      >
        <div class="shortcut-group-label">
          {{ t(`settings.shortcutGroup.${group}`) }}
        </div>
        <div
          v-for="shortcut in shortcuts"
          :key="shortcut.id"
          class="shortcut-row"
        >
          <div class="shortcut-row-copy">
            <div class="settings-row-title">
              {{ t(shortcutLabelKey(shortcut.id)) }}
            </div>
            <div v-if="rowError(shortcut)" class="shortcut-error" role="alert">
              {{ rowError(shortcut) }}
            </div>
          </div>
          <div class="shortcut-row-controls">
            <button
              type="button"
              class="shortcut-recorder"
              :class="{ recording: recordingId === shortcut.id }"
              :aria-label="
                t('settings.shortcutChange', {
                  action: t(shortcutLabelKey(shortcut.id)),
                })
              "
              :aria-pressed="recordingId === shortcut.id"
              :disabled="savingId !== null && savingId !== shortcut.id"
              @click="startRecording(shortcut)"
              @blur="onRecorderBlur(shortcut)"
              @keydown="
                recordingId === shortcut.id
                  ? recordBinding($event, shortcut)
                  : undefined
              "
            >
              <span
                v-if="recordingId === shortcut.id"
                class="shortcut-recording-label"
              >
                {{ t("settings.shortcutRecording") }}
              </span>
              <span
                v-else-if="bindingOf(shortcut)"
                class="shortcut-keybinding"
                :aria-label="displayParts(bindingOf(shortcut)!).join('+')"
              >
                <span
                  v-for="(part, index) in displayParts(bindingOf(shortcut)!)"
                  :key="`${part}-${index}`"
                  class="shortcut-key-part"
                >
                  <span v-if="index > 0" class="shortcut-key-plus">+</span>
                  <kbd>{{ part }}</kbd>
                </span>
              </span>
              <span
                v-else
                class="shortcut-unbound"
                :aria-label="t('settings.shortcutUnbound')"
              >
                {{ t("settings.shortcutUnbound") }}
              </span>
            </button>
            <TooltipButton
              type="button"
              class="shortcut-disable"
              :label="
                t('settings.shortcutDisable', {
                  action: t(shortcutLabelKey(shortcut.id)),
                })
              "
              :aria-label="
                t('settings.shortcutDisable', {
                  action: t(shortcutLabelKey(shortcut.id)),
                })
              "
              :disabled="isDisabled(shortcut) || savingId !== null"
              @click="void storeBinding(shortcut, null, 'disabled')"
            >
              <IconPower :size="13" />
            </TooltipButton>
            <TooltipButton
              type="button"
              class="shortcut-reset"
              :label="
                t('settings.shortcutReset', {
                  action: t(shortcutLabelKey(shortcut.id)),
                })
              "
              :aria-label="
                t('settings.shortcutReset', {
                  action: t(shortcutLabelKey(shortcut.id)),
                })
              "
              :disabled="!isCustomized(shortcut) || savingId !== null"
              @click="void storeBinding(shortcut, null, 'default')"
            >
              <IconSnapshot :size="13" />
            </TooltipButton>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
