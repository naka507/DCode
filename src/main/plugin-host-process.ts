/**
 * Plugin host process (ADR 0008).
 *
 * One instance runs exactly one plugin's main module, outside the Electron main
 * process. It owns no host capability: every `pi.*` call is proxied back to the
 * broker in `plugin-runtime.ts`, where the permission gateway and the host API
 * allowlist live. TypeScript implementation bundled to `out/main/plugin-host-process.js`
 * for the app, and runnable by Node tests with --experimental-transform-types.
 *
 * Wire protocol (both directions, one JSON message per frame):
 *   parent -> child  { t: "init", id, pluginId, pluginPath, main, manifest }
 *   parent -> child  { t: "call", id, method, payload, invocationId? } command.run | tool.execute |
 *                                                        service.start | service.stop |
 *                                                        lifecycle.unload
 *   child  -> parent { t: "call", id, api, args, invocationId? } host API request
 *   parent -> child  { t: "cancel", invocationId, reason } abort one tool invocation
 *   *      -> *      { t: "res", id, ok, value } | { t: "res", id, ok: false, error: { code, message } }
 *   parent -> child  { t: "event", event, ... }           push, no reply (bus.message, host events)
 *   child  -> parent { t: "log", level, message }         diagnostics, fire and forget
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  main: string;
  schemaVersion: number;
  [key: string]: unknown;
}

interface WireMessage {
  t: string;
  id?: string;
  api?: string;
  args?: unknown[];
  method?: string;
  payload?: any;
  invocationId?: string;
  reason?: string;
  ok?: boolean;
  value?: unknown;
  error?: { code?: string; message?: string };
  level?: string;
  message?: any;
  event?: string;
  subscriptionId?: string;
  pluginId?: string;
  pluginPath?: string;
  main?: string;
  manifest?: PluginManifest;
  [key: string]: unknown;
}

interface PendingCall {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  invocationId?: string;
}

interface Invocation {
  id: string;
  controller: AbortController;
}

interface CodedError extends Error {
  code?: string;
}

interface ServiceEntry {
  start: (context: { log: (msg: string) => void }) => Promise<unknown> | unknown;
  stop?: () => Promise<unknown> | unknown;
  running: boolean;
}

interface PluginCommandDefinition {
  id: string;
  title?: string;
  keywords?: string[];
  category?: string;
  run: () => Promise<unknown> | unknown;
}

interface PluginSpeechAdapterDefinition {
  protocol: string;
  label?: string;
  roles?: string[];
  handle: (payload: any) => Promise<unknown> | unknown;
}

interface PluginToolDefinition {
  name: string;
  description?: string;
  risk?: string;
  schema?: unknown;
  execute: (args: any, context: PluginToolContext) => Promise<unknown> | unknown;
}

interface PluginToolContext {
  sessionId?: string;
  turnId?: string;
  mode?: string;
  modelKey?: string;
  thinkingLevel?: string;
  signal: AbortSignal;
  log: (msg: string) => void;
}

interface PluginServiceDefinition {
  id: string;
  start: (context: { log: (msg: string) => void }) => Promise<unknown> | unknown;
  stop?: () => Promise<unknown> | unknown;
}

const parentPort = (process as unknown as {
  parentPort?: {
    postMessage: (message: unknown) => void;
    on: (event: string, handler: (event: { data: WireMessage }) => void) => void;
  };
}).parentPort;

/** Electron utilityProcess and node:child_process disagree on the transport. */
function send(message: WireMessage): void {
  if (parentPort) parentPort.postMessage(message);
  else process.send?.(message);
}

function onHostMessage(handler: (message: WireMessage) => void): void {
  if (parentPort) parentPort.on("message", (event) => handler(event.data));
  else process.on("message", (msg) => handler(msg as WireMessage));
}

function log(level: string, message: unknown): void {
  send({ t: "log", level, message: String(message) });
}

let pluginId = "";
let pluginPath = "";
let manifest: PluginManifest = { id: "", name: "", version: "", main: "", schemaVersion: 1 };
let pluginModule: Record<string, any> | null = null;

const pending = new Map<string, PendingCall>();
const invocations = new Map<string, Invocation>();
const invocationContext = new AsyncLocalStorage<Invocation | undefined>();
let nextCallId = 1;

/** Proxy a host API call to the broker and await its verdict. */
function call<T = any>(api: string, args: unknown[] = []): Promise<T> {
  const invocation = invocationContext.getStore();
  if (invocation && (invocation.controller.signal.aborted || invocations.get(invocation.id) !== invocation)) {
    return Promise.reject(invocation.controller.signal.reason ?? toolAbortedError("Plugin tool invocation finished"));
  }
  const id = `c${nextCallId++}`;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, invocationId: invocation?.id });
    try {
      send({ t: "call", id, api, args, ...(invocation ? { invocationId: invocation.id } : {}) });
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

function toolAbortedError(reason: string): CodedError {
  return Object.assign(new Error(reason), { code: "PLUGIN_TOOL_ABORTED" });
}

/**
 * The same refusal the broker returns for the audio surface, for the two
 * synchronous registration helpers that cannot reject.
 */
function audioUnavailable(api: string): CodedError {
  return Object.assign(new Error(`host api not available: ${api}`), {
    code: "UNSUPPORTED",
  });
}

function rejectInvocationCalls(invocationId: string, error: unknown): void {
  for (const [id, entry] of pending) {
    if (entry.invocationId !== invocationId) continue;
    pending.delete(id);
    entry.reject(error);
  }
}

function cancelInvocation(invocationId: string, reason?: string): void {
  const invocation = invocations.get(invocationId);
  if (!invocation || invocation.controller.signal.aborted) return;
  const error = toolAbortedError(reason || "Plugin tool execution aborted");
  invocation.controller.abort(error);
  rejectInvocationCalls(invocationId, error);
}

function settle(message: WireMessage): void {
  if (!message.id) return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.ok) {
    entry.resolve(message.value);
    return;
  }
  const error: CodedError = new Error(message.error?.message || "plugin host call failed");
  error.code = message.error?.code || "UNKNOWN";
  entry.reject(error);
}

function asUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (!value || typeof value !== "object") return new Uint8Array();
  const bytes = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, byte]) => Number(byte));
  return Uint8Array.from(bytes);
}

function normalizeClipboardHistory(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) =>
    entry && typeof entry === "object" && (entry as Record<string, unknown>).type === "image"
      ? { ...entry, data: asUint8Array((entry as Record<string, unknown>).data) }
      : entry,
  );
}

function normalizeBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (!value || typeof value !== "object") return new Uint8Array();
  const obj = value as Record<string, unknown>;
  if (obj.type === "Buffer" && Array.isArray(obj.data)) {
    return Uint8Array.from(obj.data as number[]);
  }
  return Uint8Array.from(
    Object.entries(obj)
      .filter(([key]) => /^\d+$/.test(key))
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, byte]) => Number(byte)),
  );
}

// Contribution points registered by this plugin. The callable half stays here;
// the broker only ever holds the descriptor plus a proxy back into this process.
const commands = new Map<string, () => Promise<unknown> | unknown>();
const tools = new Map<string, (args: any, context: PluginToolContext) => Promise<unknown> | unknown>();
const speechHandles = new Map<string, (payload: any) => Promise<unknown> | unknown>();
// Resident services declared in the manifest. The broker decides when they run;
// this map only holds the callables and whether they are currently up.
const services = new Map<string, ServiceEntry>();
// Bus subscriptions keyed by the id the broker handed out, plus the `pi.events`
// listeners. Both are driven by the parent's push frames.
const busHandlers = new Map<string, (message: unknown) => void>();
const eventListeners = new Map<string, Set<(...args: any[]) => void>>();

function buildApi() {
  return {
    app: {
      getVersion: () => call("app.getVersion"),
      getLocale: () => call("app.getLocale"),
      getAppearance: () => call("app.getAppearance"),
      setTheme: (themeId: string) => call("app.setTheme", [themeId]),
    },
    themes: {
      upsert: (input: unknown) => call("themes.upsert", [input]),
      remove: (themeId: string) => call("themes.remove", [themeId]),
      list: () => call("themes.list"),
      setVariables: (themeId: string, values: unknown) => call("themes.setVariables", [themeId, values]),
    },
    plugin: {
      getId: () => pluginId,
      getManifest: () => manifest,
      getSettings: () => call("plugin.getSettings"),
      setSettings: (partial: unknown) => call("plugin.setSettings", [partial]),
      getDataPath: () => call("plugin.getDataPath"),
    },
    commands: {
      register: async (command: PluginCommandDefinition) => {
        if (!command || typeof command.id !== "string" || !command.id) {
          throw new Error("command.id is required");
        }
        if (typeof command.run !== "function") {
          throw new Error("command.run must be a function");
        }
        commands.set(command.id, command.run);
        try {
          await call("commands.register", [
            {
              id: command.id,
              title: command.title,
              keywords: command.keywords,
              category: command.category,
            },
          ]);
        } catch (error) {
          commands.delete(command.id);
          throw error;
        }
      },
      unregister: async (id: string) => {
        commands.delete(id);
        await call("commands.unregister", [id]);
      },
    },
    speech: {
      registerAdapter: async (adapter: PluginSpeechAdapterDefinition) => {
        if (!adapter || typeof adapter.protocol !== "string" || !adapter.protocol.trim()) {
          throw new Error("speech protocol is required");
        }
        if (typeof adapter.handle !== "function") {
          throw new Error("speech handle must be a function");
        }
        const protocol = adapter.protocol.trim();
        const roles = Array.isArray(adapter.roles) ? adapter.roles : [];
        speechHandles.set(protocol, adapter.handle);
        try {
          await call("speech.registerAdapter", [
            {
              protocol,
              label: adapter.label,
              roles,
            },
          ]);
        } catch (error) {
          speechHandles.delete(protocol);
          throw error;
        }
      },
      unregisterAdapter: async (protocol: string) => {
        speechHandles.delete(String(protocol ?? ""));
        await call("speech.unregisterAdapter", [protocol]);
      },
    },
    ui: {
      openPanel: (options?: unknown) => call("ui.openPanel", [options]),
      closePanel: () => call("ui.closePanel"),
      showToast: (message: string, level?: string) => call("ui.showToast", [message, level]),
      notify: (input: unknown) => call("ui.notify", [input]),
      getNotificationPermission: () => call("ui.getNotificationPermission"),
      requestNotificationPermission: () => call("ui.requestNotificationPermission"),
      showNativeNotification: (input: unknown) => call("ui.showNativeNotification", [input]),
    },
    project: {
      create: (input?: unknown) => call("project.create", [input ?? {}]),
    },
    workspace: {
      get: () => call("workspace.get"),
    },
    desktop: {
      listOperations: () => call("desktop.listOperations"),
      invoke: (input?: unknown) => call("desktop.invoke", [input ?? {}]),
    },
    fs: {
      readText: (path: string) => call("fs.readText", [path]),
      stat: (path: string, grantId?: string) => call("fs.stat", [path, grantId]),
      readRange: (path: string, byteOffset: number, length: number, grantId?: string) =>
        call<any>("fs.readRange", [path, byteOffset, length, grantId]).then((result) => ({
          ...result,
          bytes: normalizeBytes(result?.bytes),
        })),
      readPreview: (path: string) => call("fs.readPreview", [path]),
      openDefault: (path: string) => call("fs.openDefault", [path]),
      reveal: (path: string) => call("fs.reveal", [path]),
      writeText: (path: string, content: string) => call("fs.writeText", [path, content]),
      glob: (pattern: string) => call("fs.glob", [pattern]),
      list: (path: string) => call("fs.list", [path]),
      remove: (path: string) => call("fs.remove", [path]),
      requestDirectory: () => call("fs.requestDirectory"),
    },
    agent: {
      registerTool: async (tool: PluginToolDefinition) => {
        if (!tool || typeof tool.name !== "string" || !tool.name) {
          throw new Error("tool.name is required");
        }
        if (typeof tool.execute !== "function") {
          throw new Error("tool.execute must be a function");
        }
        tools.set(tool.name, tool.execute);
        try {
          await call("agent.registerTool", [
            {
              name: tool.name,
              description: tool.description,
              risk: tool.risk,
              schema: tool.schema,
            },
          ]);
        } catch (error) {
          tools.delete(tool.name);
          throw error;
        }
      },
      unregisterTool: async (name: string) => {
        tools.delete(name);
        await call("agent.unregisterTool", [name]);
      },
      complete: (input?: unknown) => call("agent.complete", [input ?? {}]),
    },
    models: {
      list: () => call("models.list"),
    },
    session: {
      getLlmContext: () => call("session.getLlmContext"),
      list: (input?: unknown) => call("session.list", [input ?? {}]),
      get: (input?: unknown) => call("session.get", [input ?? {}]),
      listMessages: (input?: unknown) => call("session.listMessages", [input ?? {}]),
      import: (input?: unknown) => call("session.import", [input ?? {}]),
      importBatch: (input?: unknown) => call("session.importBatch", [input ?? {}]),
      rename: (input?: unknown) => call("session.rename", [input ?? {}]),
      delete: (input?: unknown) => call("session.delete", [input ?? {}]),
    },
    // Read-only usage facts (`usage.read`). The main-process dispatch owns
    // the permission check and parameter bounds; the host returns per-turn
    // counters and identifiers only, so no message body crosses this bridge.
    usage: {
      listTurns: (input?: unknown) => call("usage.listTurns", [input ?? {}]),
    },
    /**
     * Resident background workers (spec 07 §3). Registration is local: the
     * manifest already declared the service, and the broker starts it only when
     * `background.service` was granted — so a plugin that registers without the
     * permission simply never runs.
     */
    services: {
      register: (service: PluginServiceDefinition) => {
        if (!service || typeof service.id !== "string" || !service.id) {
          throw new Error("service.id is required");
        }
        if (typeof service.start !== "function") {
          throw new Error("service.start must be a function");
        }
        services.set(service.id, {
          start: service.start,
          stop: typeof service.stop === "function" ? service.stop : undefined,
          running: false,
        });
      },
      unregister: async (id: string) => {
        const entry = services.get(String(id ?? ""));
        services.delete(String(id ?? ""));
        if (entry?.running && entry.stop) await entry.stop();
      },
    },
    /**
     * Inter-plugin message bus (spec 07 §3). Topics must be declared in
     * `contributes.bus`; the broker owns the routing table, so this side only
     * keeps the handler for each subscription it was given.
     */
    bus: {
      publish: (topic: string, payload?: unknown) => call("bus.publish", [topic, payload]),
      subscribe: async (topic: string, handler: (message: unknown) => void) => {
        if (typeof handler !== "function") {
          throw new Error("bus.subscribe handler must be a function");
        }
        const result = await call<{ subscriptionId?: string }>("bus.subscribe", [topic]);
        const id = String(result?.subscriptionId ?? "");
        busHandlers.set(id, handler);
        return async () => {
          busHandlers.delete(id);
          await call("bus.unsubscribe", [id]);
        };
      },
    },
    clipboard: {
      readText: () => call("clipboard.readText"),
      writeText: (text: string) => call("clipboard.writeText", [text]),
      getHistory: () => call("clipboard.getHistory").then(normalizeClipboardHistory),
    },
    shell: {
      openExternal: (url: string) => call("shell.openExternal", [url]),
    },
    browser: {
      navigate: (input?: unknown) => call("browser.navigate", [input ?? {}]),
      action: (input?: unknown) => call("browser.action", [input]),
      setBounds: (hole?: unknown) => call("browser.setBounds", [hole]),
      setVisible: (visible?: boolean) => call("browser.setVisible", [visible]),
      getState: () => call("browser.getState"),
      openExternal: () => call("browser.openExternal"),
      snapshot: () => call("browser.snapshot"),
      screenshot: (input?: unknown) => call("browser.screenshot", [input ?? {}]),
      click: (input?: unknown) => call("browser.click", [input]),
      fill: (input?: unknown) => call("browser.fill", [input]),
      evaluate: (input?: unknown) => call("browser.evaluate", [input]),
      console: (input?: unknown) => call("browser.console", [input ?? {}]),
      cdp: (input?: unknown) => call("browser.cdp", [input]),
    },
    net: {
      fetch: (input?: unknown) => call("net.fetch", [input]),
      // Real-time connections (`net.websocket`). Frames arrive back as
      // `net:websocket:message` host events, so a plugin subscribes with
      // `pi.events.on` exactly as it does for any other host event.
      websocket: {
        connect: (input?: unknown) => call("net.websocket.connect", [input ?? {}]),
        send: (input?: unknown) => call("net.websocket.send", [input ?? {}]),
        close: (input?: unknown) => call("net.websocket.close", [input ?? {}]),
      },
    },
    /**
     * Background audio (`audio.capture.background`, `audio.playback.background`).
     * The host has no device backend yet, so the async calls travel to the
     * broker and come back as a coded `UNSUPPORTED` refusal — a plugin can
     * branch on `error.code` instead of catching a TypeError. The two
     * registration helpers are synchronous by contract and cannot reject, so
     * they throw the same refusal immediately rather than registering a handler
     * that could never fire.
     */
    audio: {
      getInputDevices: () => call("audio.getInputDevices"),
      openInput: (options?: unknown) => call("audio.openInput", [options ?? {}]),
      closeInput: (streamId: string) => call("audio.closeInput", [streamId]),
      getCaptureState: () => call("audio.getCaptureState"),
      onInputFrame: () => {
        throw audioUnavailable("audio.onInputFrame");
      },
      offInputFrame: () => {
        throw audioUnavailable("audio.offInputFrame");
      },
      openOutput: (options?: unknown) => call("audio.openOutput", [options ?? {}]),
      writeOutput: (input?: unknown) => call("audio.writeOutput", [input ?? {}]),
      stopOutput: (streamId: string) => call("audio.stopOutput", [streamId]),
      closeOutput: (streamId: string) => call("audio.closeOutput", [streamId]),
    },
    // System-wide accelerators. The arrow handlers live in the host: this
    // object only carries requests across the boundary.
    keyboard: {
      registerGlobalShortcut: (input?: unknown) => call("keyboard.registerGlobalShortcut", [input]),
      unregisterGlobalShortcut: (id: string) => call("keyboard.unregisterGlobalShortcut", [id]),
      listGlobalShortcuts: () => call("keyboard.listGlobalShortcuts"),
    },
    // Fed by the parent's `event` frames; bus deliveries also arrive as
    // `bus.message` here, so a plugin can watch the raw stream if it wants to.
    events: {
      on: (event: string, handler: (...args: any[]) => void) => {
        if (typeof handler !== "function") return;
        const listeners = eventListeners.get(event) ?? new Set();
        listeners.add(handler);
        eventListeners.set(event, listeners);
      },
      off: (event: string, handler: (...args: any[]) => void) => {
        eventListeners.get(event)?.delete(handler);
      },
    },
  };
}

/** Dispatch one parent push frame; a throwing handler must not kill the plugin. */
function handleHostEvent(message: WireMessage): void {
  const event = String(message.event ?? "");
  if (event === "bus.message") {
    const handler = busHandlers.get(String(message.subscriptionId ?? ""));
    if (handler) {
      try {
        handler(message.message);
      } catch (error: any) {
        log("warn", `bus handler failed for ${message.message?.topic}: ${error?.message ?? error}`);
      }
    }
  }
  const args = message.args ?? [message.message];
  for (const listener of [...(eventListeners.get(event) ?? [])]) {
    try {
      listener(...args);
    } catch (error: any) {
      log("warn", `event handler failed for ${event}: ${error?.message ?? error}`);
    }
  }
}

async function loadPluginModule(entry: string): Promise<any> {
  const req = createRequire(import.meta.url);
  try {
    delete req.cache[req.resolve(entry)];
    return req(entry);
  } catch (error: any) {
    if (error?.code === "ERR_REQUIRE_ESM" || error?.code === "ERR_REQUIRE_ASYNC_MODULE") {
      const mod = await import(pathToFileURL(entry).href);
      return mod?.default && typeof mod.default === "object" ? mod.default : mod;
    }
    throw error;
  }
}

async function handleInit(message: WireMessage): Promise<{ pluginId: string }> {
  pluginId = String(message.pluginId ?? "");
  pluginPath = String(message.pluginPath ?? "");
  manifest = (message.manifest as PluginManifest) ?? manifest;
  const entry = join(pluginPath, String(message.main ?? manifest.main ?? ""));

  (globalThis as Record<string, unknown>).pi = buildApi();
  pluginModule = await loadPluginModule(entry);
  if (pluginModule?.onLoad) await pluginModule.onLoad();
  return { pluginId };
}

async function handleParentCall(method: string, payload: any, invocationId?: string): Promise<unknown> {
  switch (method) {
    case "panel.invoke": {
      const invoke = pluginModule?.onPanelInvoke;
      if (typeof invoke !== "function") {
        const error: CodedError = new Error("plugin does not expose panel operations");
        error.code = "UNSUPPORTED";
        throw error;
      }
      return invoke(String(payload?.channel ?? ""), payload?.payload ?? {});
    }
    case "command.run": {
      const run = commands.get(String(payload?.id ?? ""));
      if (!run) {
        const error: CodedError = new Error(`command not registered: ${payload?.id}`);
        error.code = "NOT_FOUND";
        throw error;
      }
      await run();
      return { ok: true };
    }
    case "speech.handle": {
      const handle = speechHandles.get(String(payload?.protocol ?? ""));
      if (!handle) {
        const error: CodedError = new Error(`speech adapter not registered: ${payload?.protocol}`);
        error.code = "NOT_FOUND";
        throw error;
      }
      return handle(payload ?? {});
    }
    case "tool.execute": {
      if (typeof invocationId !== "string" || !invocationId || invocations.has(invocationId)) {
        throw toolAbortedError("A unique host tool invocation ID is required");
      }
      const execute = tools.get(String(payload?.name ?? ""));
      if (!execute) {
        const error: CodedError = new Error(`tool not registered: ${payload?.name}`);
        error.code = "TOOL_NOT_FOUND";
        throw error;
      }
      const invocation: Invocation = { id: invocationId, controller: new AbortController() };
      invocations.set(invocationId, invocation);
      try {
        const result = await invocationContext.run(invocation, () =>
          execute(payload?.args, {
            sessionId: payload?.sessionId,
            turnId: payload?.turnId,
            mode: payload?.mode,
            modelKey: payload?.modelKey,
            thinkingLevel: payload?.thinkingLevel,
            signal: invocation.controller.signal,
            log: (msg: string) => log("info", msg),
          }),
        );
        return result ?? null;
      } finally {
        invocations.delete(invocationId);
        rejectInvocationCalls(invocationId, toolAbortedError("Plugin tool invocation finished"));
      }
    }
    case "service.start": {
      const id = String(payload?.id ?? "");
      const entry = services.get(id);
      if (!entry) {
        const error: CodedError = new Error(`service not registered: ${id}`);
        error.code = "NOT_FOUND";
        throw error;
      }
      // Idempotent: a restart of the host process re-runs start, but a second
      // start inside one process must not spawn a duplicate worker.
      if (entry.running) return { ok: true, alreadyRunning: true };
      await entry.start({ log: (msg: string) => log("info", msg) });
      entry.running = true;
      return { ok: true };
    }
    case "service.stop": {
      const entry = services.get(String(payload?.id ?? ""));
      if (!entry?.running) return { ok: true };
      entry.running = false;
      if (entry.stop) await entry.stop();
      return { ok: true };
    }
    case "lifecycle.unload": {
      for (const id of invocations.keys()) cancelInvocation(id, "Plugin unloaded");
      // Best effort: a throwing onUnload must not block teardown.
      try {
        if (pluginModule?.onUnload) await pluginModule.onUnload();
      } catch (error: any) {
        log("warn", `onUnload failed: ${error?.message ?? error}`);
      }
      commands.clear();
      tools.clear();
      speechHandles.clear();
      services.clear();
      busHandlers.clear();
      eventListeners.clear();
      return { ok: true };
    }
    default: {
      const error: CodedError = new Error(`unknown method: ${method}`);
      error.code = "UNSUPPORTED";
      throw error;
    }
  }
}

onHostMessage((message: WireMessage) => {
  if (!message || typeof message !== "object") return;
  if (message.t === "res") {
    settle(message);
    return;
  }
  if (message.t === "event") {
    handleHostEvent(message);
    return;
  }
  if (message.t === "cancel") {
    cancelInvocation(String(message.invocationId ?? ""), String(message.reason ?? ""));
    return;
  }
  if (message.t === "init") {
    void handleInit(message)
      .then((value) => send({ t: "res", id: message.id, ok: true, value }))
      .catch((error: any) =>
        send({
          t: "res",
          id: message.id,
          ok: false,
          error: {
            code: error?.code || "PLUGIN_LOAD_FAILED",
            message: error?.message ? String(error.message) : String(error),
          },
        }),
      );
    return;
  }
  if (message.t === "call") {
    void invocationContext
      .run(undefined, () => handleParentCall(String(message.method ?? ""), message.payload, message.invocationId))
      .then((value) => send({ t: "res", id: message.id, ok: true, value: value ?? null }))
      .catch((error: any) =>
        send({
          t: "res",
          id: message.id,
          ok: false,
          error: {
            code: error?.code || "PLUGIN_CALL_FAILED",
            message: error?.message ? String(error.message) : String(error),
          },
        }),
      );
  }
});

// A misbehaving plugin must not take down its own host process silently, and it
// can never take down the app: the broker owns teardown decisions.
process.on("uncaughtException", (error: any) => {
  log("error", `uncaught exception: ${error?.stack || error}`);
});
process.on("unhandledRejection", (reason: unknown) => {
  log("error", `unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
});
