/**
 * Custom-provider API-format boundary fixture for the Vue renderer.
 *
 * The components are Vue 3 SFCs, so the probe is assembled with `createApp` /
 * `h` and the app's own vue-i18n instance (`src/renderer/i18n.ts`). What the
 * probe proves is unchanged: the new custom form exposes exactly the general API
 * formats, a saved account-only format stays visible without becoming a new
 * choice, an explicit protocol change is saved, and a copy neither converts the
 * source protocol nor reuses its identity or credentials.
 *
 * Every adaptation is an API bridge, not a weakened check:
 *
 *  1. **State writes commit asynchronously.** `await nextTick()` is used
 *     wherever a just-written state has to be visible before the next DOM read
 *     (every `render(...)` and every click).
 *  2. **Render errors are caught by `app.config.errorHandler`**, which also
 *     covers watcher and lifecycle errors, so the `errors.length` check is a
 *     superset of a render-only capture and never a subset.
 *  3. **The app's own i18n instance is installed.**
 *     `src/renderer/i18n.ts` installs every catalog at import time and is
 *     `legacy: false`, so `t` is `i18n.global.t` and `i18n.changeLanguage(x)`
 *     is `i18n.global.locale.value = x` followed by a tick.
 *  4. **`<ProviderSetupDialog key={++key} onClose onSaved />` is `h(...)`.** The
 *     dialog declares `close` / `saved` as emits
 *     (`ProviderSetupDialog.vue:181-184`), which Vue exposes as the `onClose` /
 *     `onSaved` props `h` wires; the probe still counts closes.
 *  5. **The API boundary is still monkey-patched.** `api` in
 *     `src/renderer/lib/api.ts` is a mutable object, so the three stubs are
 *     assigned onto it.
 *  6. **No Pinia is installed.** The dialog's dependency graph
 *     (`useProviderModels`, `model-selection-panes`, `ModelSelectionPanes.vue`,
 *     `ServicePicker.vue`, `ProviderHeadersEditor.vue`) contains no store
 *     import, so only `i18n` is used.
 *  7. **`structuredClone` needs the proxies unwrapped.** Vue's reactive state
 *     cannot be cloned, so the three stubs run the payload through `unproxy`
 *     (a `toRaw` walk) before the `structuredClone` call. Nothing the probe
 *     asserts is changed by it.
 *
 * Three assumptions baked into the fixture are stale and are rewritten here
 * against the real DOM rather than copied. Each is noted at its use site below.
 */
import { createApp, defineComponent, h, nextTick, ref, toRaw } from "vue";
import { i18n } from "../../src/renderer/i18n";
import ProviderSetupDialog from "../../src/renderer/components/settings/ProviderSetupDialog.vue";
import {
  copyProviderConfiguration,
  type ProviderCopyDraft,
} from "../../src/renderer/components/settings/provider-copy";
import { CUSTOM_PROVIDER_API_STYLES } from "../../src/renderer/components/settings/provider-api-style";
import { api } from "../../src/renderer/lib/api";
import type {
  ProviderCreateInput,
  ProviderPublic,
  ProviderUpdateInput,
} from "@dcode/shared";

declare global {
  var providerApiStyleProbe: () => Promise<unknown>;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const fixture = (apiStyle: string): ProviderPublic => ({
  id: "legacy",
  name: "Legacy custom",
  vendorKey: "custom",
  type: "openai_compatible",
  protocol: "openai_compatible",
  enabled: true,
  authKind: "api_key_and_base_url",
  apiStyle,
  baseUrl: "https://api.openai.com/v1",
  hasSecret: true,
  supportsReasoning: false,
  supportedThinkingLevels: ["off"],
  createdAt: "",
  updatedAt: "",
  models: [
    {
      id: "fixture",
      alias: "Fixture alias",
      contextWindow: 32000,
      maxTokens: 4000,
      thinkingLevels: ["off"],
      defaultThinkingLevel: "off",
    },
  ],
});

/**
 * Mirrors `API_STYLE_LABEL_KEYS` in
 * `src/renderer/components/settings/ProviderSetupDialog.vue:82-90`. The dialog
 * does not export it, and the label is the only trace of an option's id in the
 * DOM (`SettingsMenuSelect` renders `role="option"` buttons keyed by id but
 * never writes the id as an attribute).
 *
 * `tests/provider-api-style-runner.test.mjs` parses both literals and fails if
 * the two copies drift apart.
 */
const API_STYLE_LABEL_KEYS: Record<string, string> = {
  chat_completions: "settings.apiStyleChatCompletions",
  responses: "settings.apiStyleResponses",
  anthropic_messages: "settings.apiStyleAnthropic",
  google_generative_ai: "settings.apiStyleGoogle",
  openai_codex_responses: "settings.apiStyleCodexResponses",
  pi_messages: "settings.apiStylePiMessages",
  opencode_go: "settings.apiStyleOpenCodeGo",
};

type FixtureProps = {
  provider?: ProviderPublic | null;
  initialDraft?: ProviderCopyDraft | null;
};

/**
 * `structuredClone` cannot clone a Vue reactive proxy, and the dialog hands its
 * save payload through reactive state. Every stub therefore unwraps the proxies
 * with `toRaw` first; the `structuredClone` call is otherwise unchanged, and
 * nothing here is observable to the probe.
 */
function unproxy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => unproxy(entry)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(toRaw(value)).map(([key, entry]) => [key, unproxy(entry)]),
    ) as T;
  }
  return value;
}

globalThis.providerApiStyleProbe = async () => {
  const t = (key: string): string => i18n.global.t(key);
  const creates: ProviderCreateInput[] = [];
  const updates: ProviderUpdateInput[] = [];
  const discoveries: Parameters<typeof api.listProviderModels>[0][] = [];
  // Only the API boundary is faked: render the production form/hooks and inspect
  // exact save payloads. This does not validate Host persistence or live OAuth.
  api.createProvider = async (input) => {
    creates.push(structuredClone(unproxy(input)));
    return { provider: { ...fixture(input.apiStyle!), ...input, id: "copy" } };
  };
  api.updateProvider = async (input) => {
    updates.push(structuredClone(unproxy(input)));
    return { provider: { ...fixture(input.apiStyle!), ...input } };
  };
  api.listProviderModels = async (input) => {
    discoveries.push(structuredClone(unproxy(input)));
    return { models: [], source: "remote" };
  };

  const labelForStyle = (style: string) => t(API_STYLE_LABEL_KEYS[style]!);
  const styleForLabel = (label: string) =>
    Object.keys(API_STYLE_LABEL_KEYS).find((style) => labelForStyle(style) === label);

  /*
    STALE (commit `4720f7f4`, 2026-09-16). The fixture used to read a native
    `<select class="provider-setup-custom-auth-row select">`: its option list,
    its current value, whether the current option was disabled, and it chose by
    writing the value and dispatching a change event. `SettingsMenuSelect`
    replaced that control, so the current value is the trigger's own label, the
    choices are `role="option"` buttons in a menu teleported to `document.body`
    (the id never reaches an attribute), and choosing one is a click on that
    button.
  */
  const apiStyleTrigger = () => {
    const element = document.querySelector<HTMLButtonElement>(
      ".provider-setup-custom-auth-row .settings-menu-select-trigger",
    );
    assert(element, "api format select is not rendered");
    return element;
  };
  const triggerLabel = () =>
    apiStyleTrigger()
      .querySelector(".settings-menu-select-trigger-label")
      ?.textContent?.trim() ?? "";
  const styleOptions = () =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".settings-menu-select-option",
      ),
    ];
  const optionLabel = (option: HTMLButtonElement) =>
    option
      .querySelector(".settings-menu-select-option-label")
      ?.textContent?.trim() ?? "";
  const currentApiStyle = () => styleForLabel(triggerLabel());
  const openApiStyleMenu = async () => {
    await click(apiStyleTrigger());
  };
  /** Open, read the option set and the current option, then close again. */
  const inspectApiStyleMenu = async () => {
    await openApiStyleMenu();
    const options = styleOptions();
    const current = options.find(
      (option) => option.getAttribute("aria-selected") === "true",
    );
    const inspection = {
      labels: options.map(optionLabel),
      currentDisabled: current?.disabled === true,
    };
    await openApiStyleMenu();
    return inspection;
  };
  const choose = async (style: string) => {
    await openApiStyleMenu();
    const target = styleOptions().find(
      (option) => optionLabel(option) === labelForStyle(style),
    );
    assert(target, `api format option is missing: ${style}`);
    await click(target);
  };

  /*
    STALE (commit `8f526431`, 2026-09-17). The dialog became a portal after the
    fixture's last edit (2026-09-15), so the earlier `host.querySelectorAll`,
    `host.querySelector` and `host.textContent` reach nothing on either side.
    The dialog renders `<Teleport :to="overlayRoot()">`, and `overlayRoot()` is
    `#dcode-overlays` appended to `document.documentElement`
    (`src/renderer/lib/overlay-root.ts`), so every dialog query goes through
    `document` instead.
  */
  const dialog = () => {
    const element = document.querySelector<HTMLElement>(
      ".provider-setup-dialog",
    );
    assert(element, "provider setup dialog is not mounted");
    return element;
  };
  const button = (key: string) => {
    const element = [
      ...dialog().querySelectorAll<HTMLButtonElement>("button"),
    ].find((entry) => entry.textContent?.trim() === t(key));
    assert(element, `missing button: ${key}`);
    return element;
  };
  /*
    The hint is a `HelpIcon`: `Field` renders `<HelpIcon :label="hint" />`, whose
    sentence lives in a tooltip teleported to `document.body` and mounted only
    while hovered. The trigger carries the same sentence as its accessible name,
    so the hint is read there — scoped to the api-format field, because the
    custom auth row's key field has its own help icon.
  */
  const apiStyleHint = () => {
    const row = document.querySelector<HTMLElement>(
      ".provider-setup-custom-auth-row",
    );
    assert(row, "custom auth row is not rendered");
    const field = [...row.querySelectorAll<HTMLElement>("label")].find((entry) =>
      entry.querySelector(".settings-menu-select-trigger"),
    );
    assert(field, "api format field is not rendered");
    return (
      field
        .querySelector<HTMLElement>(".ui-help-icon")
        ?.getAttribute("aria-label") ?? ""
    );
  };

  const host = document.createElement("div");
  document.body.append(host);
  const errors: unknown[] = [];
  const state = ref<{ key: number; props: FixtureProps }>({ key: 0, props: {} });
  let closes = 0;

  const Root = defineComponent({
    name: "ProviderApiStyleRoot",
    setup() {
      return () =>
        h(ProviderSetupDialog, {
          key: state.value.key,
          onClose: () => {
            closes += 1;
          },
          onSaved: () => {},
          ...state.value.props,
        });
    },
  });

  const app = createApp(Root);
  app.config.errorHandler = (error) => {
    errors.push(error);
    console.error("PROVIDER_API_STYLE_RENDER_ERROR", error);
  };
  app.use(i18n);
  app.mount(host);

  const render = async (props: FixtureProps = {}) => {
    state.value = { key: state.value.key + 1, props };
    await nextTick();
  };
  const click = async (element: HTMLElement | null) => {
    assert(element, "missing click target");
    element.click();
    await nextTick();
  };

  const results: string[] = [];
  try {
    for (const locale of ["en", "zh-CN"]) {
      i18n.global.locale.value = locale;
      await nextTick();
      await render();
      await click(document.querySelector(".provider-service-trigger"));
      await click(document.querySelector(".provider-service-option"));
      // The new-custom form offers the general formats and none of the
      // account-only or named-service transports, in the shared order.
      const { labels } = await inspectApiStyleMenu();
      assert(
        JSON.stringify(labels) ===
          JSON.stringify(
            CUSTOM_PROVIDER_API_STYLES.map((style) => labelForStyle(style)),
          ),
        `${locale}: new custom form exposes an account format`,
      );
      results.push(`${locale}:new-custom-options`);

      for (const style of ["openai_codex_responses", "pi_messages"]) {
        const original = fixture(style);
        const before = JSON.stringify(original);
        await render({ provider: original });
        const inspection = await inspectApiStyleMenu();
        assert(
          currentApiStyle() === style && inspection.currentDisabled,
          "legacy format must remain visible without being a new choice",
        );
        assert(
          apiStyleHint() === t("settings.apiStyleLegacyAccount"),
          "legacy explanation missing",
        );
        assert(
          !button("settings.saveProvider").disabled,
          "legacy unchanged save blocked",
        );
        await click(button("settings.saveProvider"));
        await pause();
        await nextTick();
        const update = updates.at(-1)!;
        assert(
          update.apiStyle === style &&
            update.name === original.name &&
            update.baseUrl === original.baseUrl,
          "legacy edit changed protocol/name/URL through preset matching",
        );
        assert(
          !("authKind" in update) && !("secretValue" in update),
          "legacy edit changed authentication",
        );
        assert(
          update.models?.[0].alias === "Fixture alias",
          "legacy bindings changed",
        );

        await render({ provider: original });
        await choose("responses");
        await click(button("settings.saveProvider"));
        await pause();
        await nextTick();
        assert(
          updates.at(-1)?.apiStyle === "responses",
          "explicit legacy protocol change not saved",
        );

        const draft = copyProviderConfiguration(original, "Copy fixture");
        await render({ initialDraft: draft });
        assert(
          currentApiStyle() === style,
          "copy silently converted protocol",
        );
        assert(
          button("settings.saveProvider").disabled,
          "copy accepts account-only protocol",
        );
        assert(
          apiStyleHint() === t("settings.apiStyleChooseCustom"),
          "copy choice explanation missing",
        );
        const discoveryCount = discoveries.length;
        await pause(650);
        assert(
          discoveries.length === discoveryCount,
          "unsupported copy triggered discovery",
        );
        const createCount = creates.length;
        await click(button("settings.saveProvider"));
        await pause();
        assert(creates.length === createCount, "blocked copy was saved");
        await click(button("settings.cancel"));
        assert(
          closes > 0 && creates.length === createCount,
          "cancel saved a copy",
        );

        await render({ initialDraft: draft });
        await choose("anthropic_messages");
        await pause(650);
        // `useProviderModels` issues the cache read first and the
        // live read second on the edit path (`providerId` present), so the
        // newest entry is the live call here — a copy draft carries no
        // `providerId`, so it only ever makes the live call. Verified by run;
        // no filtering is needed, so `at(-1)` is the right read.
        const discovery = discoveries.at(-1)!;
        assert(
          discovery.apiStyle === "anthropic_messages" &&
            !discovery.providerId &&
            !discovery.apiKey,
          "copy discovery reused source protocol or credentials",
        );
        assert(
          !button("settings.saveProvider").disabled,
          "supported copy is blocked",
        );
        await click(button("settings.saveProvider"));
        await pause();
        await nextTick();
        const created = creates.at(-1)!;
        assert(
          created.apiStyle === "anthropic_messages" &&
            created.authKind === "api_key_and_base_url",
          "copy did not persist the explicitly chosen protocol",
        );
        assert(
          !created.secretValue && !("id" in created),
          "copy retained source identity or credential",
        );
        assert(
          JSON.stringify(original) === before,
          "edit/copy mutated source object",
        );
        results.push(`${locale}:${style}:edit-change-copy-cancel`);
      }
    }
    assert(errors.length === 0, "render errors");
    return {
      ok: true,
      scenarios: results,
      creates: creates.length,
      updates: updates.length,
      apiBoundary: "stubbed",
      hostPersistence: "not exercised",
      liveModel: "not exercised",
    };
  } finally {
    app.unmount();
    host.remove();
  }
};
