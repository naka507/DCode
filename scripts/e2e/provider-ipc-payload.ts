/**
 * Real-Chromium regression fixture for the reported "An object could not be
 * cloned." failure on the Add-AI-service save path.
 *
 * The other provider fixture (`scripts/e2e/provider-api-style.ts`) stubs the
 * `api` object itself, which sits *below* the IPC boundary, and it unwraps Vue
 * proxies with its own `unproxy` helper before calling `structuredClone`. That
 * helper is exactly what hid this bug: it removed the proxies the production
 * code was still sending. This fixture instead stubs `window.dcode.invoke`,
 * which is the real boundary, and applies the real `structuredClone` to the
 * argument list. If a Vue proxy escapes `lib/api.ts`, this probe fails with the
 * same `DataCloneError` a user sees.
 *
 * The scenario walks the reported path end to end: open the dialog, pick the
 * custom endpoint, type a name/URL, let the model list arrive from the stubbed
 * discovery call, select a model, and save. The save is the step that used to
 * throw, because `bindingsToPersist` handed back the live `ref` elements.
 */
import { createApp, defineComponent, h, nextTick } from "vue";
import { i18n } from "../../src/renderer/i18n";
import ProviderSetupDialog from "../../src/renderer/components/settings/ProviderSetupDialog.vue";
import { api } from "../../src/renderer/lib/api";

declare global {
  var providerIpcPayloadProbe: () => Promise<unknown>;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

globalThis.providerIpcPayloadProbe = async () => {
  const t = (key: string, params?: Record<string, unknown>): string =>
    params ? i18n.global.t(key, params) : i18n.global.t(key);

  /*
    The boundary. `ipcRenderer.invoke` serialises its arguments with
    `structuredClone`, so that is what this stub does — before recording
    anything, exactly as Electron does. `window.dcode.invoke` is the only
    renderer→main entry point, so stubbing it means every `api.*` call in this
    probe goes through the production code path under test.
  */
  const calls: { channel: string; args: unknown }[] = [];
  const responses = new Map<string, unknown>([
    [
      "dcode/providers/listModels",
      {
        models: [
          {
            modelId: "probe-model",
            displayName: "Probe Model",
            providerId: "probe-provider",
            capabilities: ["text"],
            contextWindow: 128000,
            maxTokens: 8192,
            supportedThinkingLevels: ["off"],
          },
        ],
        source: "remote",
      },
    ],
    [
      "dcode/providers/create",
      {
        provider: {
          id: "probe-provider",
          name: "Probe",
          vendorKey: "custom",
          type: "openai_compatible",
          protocol: "openai_compatible",
          enabled: true,
          authKind: "api_key_and_base_url",
          apiStyle: "chat_completions",
          baseUrl: "https://api.example.com/v1",
          hasSecret: true,
          supportsReasoning: false,
          supportedThinkingLevels: ["off"],
          createdAt: "",
          updatedAt: "",
          models: [],
        },
      },
    ],
  ]);

  // `window` is a read-only accessor in Chromium; assign onto it.
  (globalThis.window as unknown as { dcode: unknown }).dcode = {
    invoke: async (channel: string, ...args: unknown[]) => {
      // The real rule, including Electron's own wording: `ipcRenderer.invoke`
      // serialises with `structuredClone` and rethrows as
      // `Error: An object could not be cloned.`, which is the exact text the
      // reported bug showed in the dialog. Reproducing the message matters —
      // the probe asserts on the banner the user actually sees.
      let cloned: unknown[];
      try {
        cloned = structuredClone(args);
      } catch {
        throw new Error("An object could not be cloned.");
      }
      calls.push({ channel, args: cloned });
      return { ok: true, data: responses.get(channel) ?? null };
    },
    on: () => () => {},
    channels: {},
    platform: "win32",
    locale: "en",
  };

  const dialog = () => {
    const element = document.querySelector<HTMLElement>(
      ".provider-setup-dialog",
    );
    assert(element, "provider setup dialog is not mounted");
    return element;
  };
  const buttonByText = (text: string) => {
    const element = [...dialog().querySelectorAll<HTMLButtonElement>("button")].find(
      (entry) => entry.textContent?.trim() === text,
    );
    assert(element, `missing button: ${text}`);
    return element;
  };
  const click = async (element: HTMLElement | null) => {
    assert(element, "missing click target");
    element.click();
    await nextTick();
  };
  const setInput = async (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
  };

  const host = document.createElement("div");
  document.body.append(host);
  const errors: unknown[] = [];
  let saved: unknown = null;

  const Root = defineComponent({
    name: "ProviderIpcPayloadRoot",
    setup() {
      return () =>
        h(ProviderSetupDialog, {
          onClose: () => {},
          onSaved: (provider: unknown) => {
            saved = provider;
          },
        });
    },
  });
  const app = createApp(Root);
  app.config.errorHandler = (error) => {
    errors.push(error);
    console.error("PROVIDER_IPC_PAYLOAD_RENDER_ERROR", error);
  };
  app.use(i18n);
  app.mount(host);

  const results: string[] = [];
  try {
    i18n.global.locale.value = "en";
    await nextTick();

    // 1. Choose the custom endpoint. The picker's options are keyed by label,
    //    and the custom fields only exist once that choice is committed.
    await click(dialog().querySelector(".provider-service-trigger"));
    const customOption = [
      ...document.querySelectorAll<HTMLButtonElement>(".provider-service-option"),
    ].find(
      (option) =>
        option.textContent?.trim() === t("settings.presetCustomEndpoint"),
    );
    assert(customOption, "custom endpoint option is missing");
    await click(customOption);
    results.push("custom-endpoint-selected");

    // 3. Name and URL, so the form is valid enough to discover models.
    const nameInput = dialog().querySelector<HTMLInputElement>(
      ".provider-setup-custom-identity-row input",
    );
    assert(nameInput, "name field is missing");
    await setInput(nameInput, "Probe");

    const urlInput = dialog().querySelector<HTMLInputElement>(
      ".provider-setup-base-url input[type='url']",
    );
    assert(urlInput, "base url field is missing");
    await setInput(urlInput, "https://api.example.com/v1");

    // 3. Let discovery run and the model list render.
    await pause(700);
    await nextTick();
    results.push(`discovery-calls:${calls.filter((c) => c.channel === "dcode/providers/listModels").length}`);

    // 4. Select the discovered model. The row's checkbox is what adds a binding,
    //    and a binding is what `bindingsToPersist` used to hand over as a proxy.
    const modelCheckbox = dialog().querySelector<HTMLInputElement>(
      "input[type='checkbox']",
    );
    assert(modelCheckbox, "no model row to select");
    if (!modelCheckbox.checked) await click(modelCheckbox);
    results.push(`model-selected:${modelCheckbox.checked}`);

    // 5. Save. This is the call that threw "An object could not be cloned."
    const saveButton = buttonByText(t("settings.saveProvider"));
    assert(!saveButton.disabled, "save is disabled; the form is not valid");
    const createCountBefore = calls.filter(
      (c) => c.channel === "dcode/providers/create",
    ).length;
    await click(saveButton);
    await pause(50);
    await nextTick();

    const createCalls = calls.filter((c) => c.channel === "dcode/providers/create");
    // The reported symptom, read from the dialog's own error banner: the
    // component catches the throw and renders `cause.message`, which for a
    // proxy argument is Chromium's `DataCloneError` text verbatim.
    const bannerText =
      dialog().querySelector(".provider-setup-error")?.textContent?.trim() ?? "";
    assert(
      createCalls.length === createCountBefore + 1,
      `the save never reached the IPC boundary; dialog error: ${bannerText}`,
    );
    assert(
      bannerText === "",
      `the dialog rendered an error on a successful save: ${bannerText}`,
    );
    const payload = createCalls.at(-1)!.args as [
      { models?: { id?: string; thinkingLevels?: string[] }[] },
    ];
    // Assert content, not just shape: a fix that de-proxied but corrupted the
    // bindings would still pass a `length > 0` check.
    const models = payload[0]?.models ?? [];
    assert(
      models.map((model) => model.id).join(",") === "probe-model",
      `the save payload carried the wrong models: ${JSON.stringify(models)}`,
    );
    assert(
      Array.isArray(models[0]?.thinkingLevels),
      `the binding lost its thinking levels: ${JSON.stringify(models[0])}`,
    );
    results.push(`saved-models:${models.map((model) => model.id).join(",")}`);
    assert(saved, "the dialog never emitted saved");
    assert(
      errors.length === 0,
      `render errors: ${errors.map((e) => String((e as Error)?.stack ?? e)).join(" || ")}`,
    );
    return {
      ok: true,
      scenarios: results,
      createCalls: createCalls.length,
      boundary: "window.dcode.invoke + structuredClone",
    };
  } catch (error) {
    return { ok: false, scenarios: results, error: String(error) };
  } finally {
    app.unmount();
    host.remove();
  }
};
