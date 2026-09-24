<script setup lang="ts">
/**
 * The settings sheet for one installed plugin: every field its manifest declared,
 * rendered as the control its type asks for.
 *
 * The `PluginSettingsSheet` component. The choices that
 * are not mechanical:
 *
 *   1. **`onClose` / `onSaved` are the `close` / `saved` emits.** A child reaches
 *      its parent only through `emit()`, so a listener is the faithful form; the
 *      caller writes `@close` / `@saved`. The save path awaited `onSaved()` before
 *      closing, and `emit` returns nothing, so the save path cannot await the
 *      listener — the sheet closes on the same tick either way, which is what
 *      the caller's own handler does with the refresh.
 *   2. **`useState` is `ref`, and the two state setters keep their
 *      call shape** where the setter is called with a function of the current
 *      value (`setDraft((current) => …)`) — the Vue form is a plain assignment
 *      of the merged object.
 *   3. **The `useEffect` on `[plugin.id, plugin.settings]` is a `watch`.** It
 *      re-seeds the draft whenever the sheet is handed a different record or a
 *      re-read one, which is exactly what the dependency list did.
 *   4. **`useMemo` is `computed`**, and the store read is
 *      `computed(() => store.appState?.settings?.keybindings)` — the tracked
 *      form of the `useAppStore((state) => state.settings?.keybindings)`.
 *   5. **`SettingsMenuSelect`'s `onChange` is a `change` emit**, and the
 *      `Input` / `Textarea` primitives take `value` plus an `input` listener
 *      (this tree's primitives are uncontrolled-looking one-way fields; see
 *      `components/ui/Input.vue`).
 *   6. **`t(key, "Fallback")` becomes `t(key)`** — every key ships in the
 *      catalogs — and the shortcut recorder's `onKeyDown` gets Vue's
 *      `KeyboardEvent`, which already satisfies `keybindingFromEvent`'s
 *      `KeyboardEventLike`.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  KEYBOARD_SHORTCUTS,
  isAllowedKeybinding,
  isReservedKeybinding,
  keybindingDisplayParts,
  keybindingFromEvent,
  keybindingsConflict,
  normalizeKeybinding,
  resolveKeybinding,
  type PluginSettingDefinition,
  type PluginSummary,
  type ShortcutPlatform,
} from "@dcode/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import Button from "../ui/Button.vue";
import Input from "../ui/Input.vue";
import Textarea from "../ui/Textarea.vue";
import HelpIcon from "../ui/HelpIcon.vue";
import TooltipButton from "../TooltipButton.vue";
import SettingsMenuSelect from "../settings/SettingsMenuSelect.vue";
import { IconKeyboard, IconSettings, IconX } from "../../lib/icons";

const props = defineProps<{
  plugin: PluginSummary;
  platform: ShortcutPlatform;
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const { t } = useI18n();
const store = useAppStore();

const appKeybindings = computed(() => store.appState?.settings?.keybindings);

const settings = computed<PluginSettingDefinition[]>(() => props.plugin.settings ?? []);

const draft = ref<Record<string, unknown>>({});
const recordingKey = ref<string | null>(null);
const error = ref<string | null>(null);
const saving = ref(false);

/** What a setting starts as: its private value, else its declared default. */
function initialValue(setting: PluginSettingDefinition): unknown {
  if (setting.value !== undefined) return setting.value;
  if (setting.default !== undefined) return setting.default;
  switch (setting.type) {
    case "boolean":
      return false;
    case "number":
      return 0;
    case "json":
      return {};
    case "select":
      return setting.enum?.[0]?.value ?? "";
    default:
      return "";
  }
}

/** The shortcut as a person reads it on this platform; an em dash when unset. */
function shortcutLabel(value: unknown, platform: ShortcutPlatform): string {
  const normalized = normalizeKeybinding(value);
  if (!normalized) return "—";
  return keybindingDisplayParts(normalized, platform).join(
    platform === "darwin" ? "" : "+",
  );
}

function serializeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function seedDraft(): void {
  draft.value = Object.fromEntries(
    settings.value.map((setting) => [setting.key, initialValue(setting)]),
  );
  recordingKey.value = null;
  error.value = null;
}

seedDraft();

watch(() => [props.plugin.id, props.plugin.settings], seedDraft);

/**
 * The first shortcut that collides with a reserved binding, an app shortcut, or
 * another plugin shortcut on this sheet. Null when nothing collides.
 */
const shortcutConflict = computed<string | null>(() => {
  const shortcuts = settings.value.filter((setting) => setting.type === "shortcut");
  for (const left of shortcuts) {
    const leftValue = String(draft.value[left.key] ?? "");
    if (!leftValue) continue;
    if (isReservedKeybinding(leftValue, props.platform)) return left.key;
    const appConflict = KEYBOARD_SHORTCUTS.some((shortcut) =>
      keybindingsConflict(
        resolveKeybinding(shortcut, appKeybindings.value, props.platform),
        leftValue,
      ),
    );
    if (appConflict) return left.key;
    for (const right of shortcuts) {
      if (left.key === right.key) continue;
      if (keybindingsConflict(leftValue, String(draft.value[right.key] ?? ""))) {
        return left.key;
      }
    }
  }
  return null;
});

function setValue(key: string, value: unknown): void {
  draft.value = { ...draft.value, [key]: value };
  error.value = null;
}

function resetValue(setting: PluginSettingDefinition): void {
  setValue(setting.key, initialValue({ ...setting, value: undefined }));
}

async function save(): Promise<void> {
  if (shortcutConflict.value) {
    error.value = t("plugins.settingsShortcutConflict");
    return;
  }
  const payload = { ...draft.value };
  for (const setting of settings.value) {
    if (setting.type !== "json") continue;
    try {
      payload[setting.key] = JSON.parse(String(payload[setting.key] ?? "{}"));
    } catch {
      error.value = t("plugins.settingsInvalidJson", { name: setting.title });
      return;
    }
  }
  saving.value = true;
  error.value = null;
  try {
    await api.setPluginSettings(props.plugin.id, payload);
    emit("saved");
    emit("close");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving.value = false;
  }
}

/**
 * Record one keystroke as the shortcut for this setting. Escape leaves recording
 * without changing anything; anything that is not a modifier-plus-key (or an
 * F-key), or that is reserved, is refused with an explanation.
 */
function recordShortcut(event: KeyboardEvent, setting: PluginSettingDefinition): void {
  if (event.key === "Escape") {
    event.preventDefault();
    recordingKey.value = null;
    return;
  }
  event.preventDefault();
  const binding = keybindingFromEvent(event, props.platform);
  if (
    !binding ||
    !isAllowedKeybinding(binding) ||
    isReservedKeybinding(binding, props.platform)
  ) {
    error.value = t("plugins.settingsShortcutInvalid");
    return;
  }
  setValue(setting.key, binding);
  recordingKey.value = null;
}
</script>

<template>
  <div class="plugins-modal-backdrop" role="presentation">
    <div
      class="plugins-modal plugins-settings-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('plugins.settingsTitle', { name: plugin.name })"
    >
      <header class="plugins-modal-head">
        <span class="plugins-modal-icon" aria-hidden="true">
          <IconSettings :size="17" />
        </span>
        <div class="plugins-settings-heading">
          <h2 class="plugins-modal-title">
            {{ t("plugins.settingsTitle", { name: plugin.name }) }}
          </h2>
          <p class="plugins-modal-subtitle">{{ t("plugins.settingsHint") }}</p>
        </div>
        <TooltipButton
          as="button"
          type="button"
          class="plugins-icon-btn"
          :label="t('plugins.closeSettings')"
          :aria-label="t('plugins.closeSettings')"
          @click="emit('close')"
        >
          <IconX :size="15" />
        </TooltipButton>
      </header>

      <div class="plugins-settings-body">
        <div v-for="setting in settings" :key="setting.key" class="plugins-setting-row">
          <div class="plugins-setting-copy">
            <div class="plugins-setting-title">
              <IconKeyboard v-if="setting.type === 'shortcut'" :size="14" aria-hidden="true" />
              <span>
                {{ setting.title }}
                <!--
                  The plugin's own blurb about the field; a setting that
                  declares none leaves no mark.
                -->
                <HelpIcon
                  v-if="setting.description"
                  :label="setting.description"
                />
              </span>
            </div>
            <span v-if="setting.type === 'shortcut'" class="plugins-setting-scope">
              {{ t("plugins.settingsPluginScope") }}
            </span>
          </div>
          <div class="plugins-setting-control">
            <Input
              v-if="setting.type === 'string'"
              :value="String(draft[setting.key] ?? '')"
              @input="setValue(setting.key, ($event.target as HTMLInputElement).value)"
            />
            <Input
              v-else-if="setting.type === 'number'"
              type="number"
              :value="typeof draft[setting.key] === 'number' ? draft[setting.key] : ''"
              @input="
                setValue(
                  setting.key,
                  ($event.target as HTMLInputElement).value === ''
                    ? 0
                    : Number(($event.target as HTMLInputElement).value),
                )
              "
            />
            <button
              v-else-if="setting.type === 'boolean'"
              type="button"
              class="settings-toggle"
              :class="{ on: draft[setting.key] === true }"
              role="switch"
              :aria-checked="draft[setting.key] === true"
              :aria-label="setting.title"
              @click="setValue(setting.key, draft[setting.key] !== true)"
            >
              <span class="settings-toggle-thumb" />
            </button>
            <SettingsMenuSelect
              v-else-if="setting.type === 'select'"
              :label="setting.title"
              :value="
                String(
                  (setting.enum ?? []).findIndex((option) =>
                    Object.is(option.value, draft[setting.key]),
                  ),
                )
              "
              :options="
                (setting.enum ?? []).map((option, index) => ({
                  id: String(index),
                  label: option.label,
                }))
              "
              @change="
                (id: string) => {
                  const option = setting.enum?.[Number(id)];
                  if (option) setValue(setting.key, option.value);
                }
              "
            />
            <Textarea
              v-else-if="setting.type === 'json'"
              class="plugins-setting-json"
              :value="
                typeof draft[setting.key] === 'string'
                  ? (draft[setting.key] as string)
                  : serializeJson(draft[setting.key])
              "
              @input="setValue(setting.key, ($event.target as HTMLTextAreaElement).value)"
            />
            <button
              v-else
              type="button"
              class="plugins-shortcut-recorder"
              :class="{
                recording: recordingKey === setting.key,
                error: setting.type === 'shortcut' && shortcutConflict === setting.key,
              }"
              :aria-label="t('plugins.settingsShortcutChange', { name: setting.title })"
              @click="recordingKey = recordingKey === setting.key ? null : setting.key"
              @keydown="
                (event: KeyboardEvent) =>
                  recordingKey === setting.key && recordShortcut(event, setting)
              "
            >
              {{
                recordingKey === setting.key
                  ? t("plugins.settingsShortcutRecording")
                  : shortcutLabel(draft[setting.key], platform)
              }}
            </button>
            <button
              type="button"
              class="plugins-setting-reset"
              @click="resetValue(setting)"
            >
              {{ t("plugins.settingsReset") }}
            </button>
          </div>
        </div>
      </div>

      <p v-if="error" class="plugins-settings-error" role="alert">{{ error }}</p>
      <div class="plugins-modal-actions">
        <Button variant="secondary" @click="emit('close')">
          {{ t("plugins.cancel") }}
        </Button>
        <Button variant="primary" :disabled="saving" @click="void save()">
          {{ saving ? t("settings.saving") : t("plugins.settingsSave") }}
        </Button>
      </div>
    </div>
  </div>
</template>
