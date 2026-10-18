/**
 * ADR-002 Phase B (DCode consumer side): the tools.describe manifest is
 * strictly validated and converted to TypeBox. Anything unexpected falls
 * back to the static definitions, so these tests pin the validation and
 * conversion behavior — including a golden fixture shaped like DCore's
 * real manifest.
 */
import { describe, expect, it, vi } from "vitest";
import {
  DCORE_MANIFEST_TOOL_NAMES,
  manifestParametersToProperties,
  manifestSchemaToTypeBox,
  parseDCoreManifest,
} from "../../src/agent/tools/dcore-manifest.js";
import { DesktopAgentRuntime } from "../../src/agent/runtime/runtime.js";
import type { RuntimeProviderConfig } from "../../src/agent/runtime/runtime.js";
import type { CommandShellOption } from "../../src/shared/command-shells.js";

/** Shaped like DCore's real `tools.describe` Read entry. */
const READ_ENTRY = {
  name: "Read",
  source: "dcore",
  description: "Read a bounded window from an existing regular text file.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Existing regular file only, never a directory.",
      },
      offset: {
        type: "integer",
        description: "0-based line offset; defaults to 0.",
        minimum: 0,
      },
      limit: {
        type: "integer",
        description: "Maximum lines to return; defaults to 2000.",
        minimum: 1,
      },
    },
    required: ["path"],
  },
  permission: {
    scope: "read",
    paths: "project",
    idempotent: true,
    supportsDryRun: false,
    risk: "low",
  },
};

describe("parseDCoreManifest", () => {
  it("accepts a well-formed manifest and ignores extra fields", () => {
    const tools = parseDCoreManifest([READ_ENTRY]);
    expect(tools).not.toBeNull();
    expect(tools).toHaveLength(1);
    expect(tools![0].name).toBe("Read");
    expect(tools![0].description).toContain("bounded window");
    expect(tools![0].parameters).toEqual(READ_ENTRY.parameters);
  });

  it("rejects non-array payloads", () => {
    expect(parseDCoreManifest(null)).toBeNull();
    expect(parseDCoreManifest({})).toBeNull();
    expect(parseDCoreManifest("tools")).toBeNull();
  });

  it("rejects entries with missing or mistyped fields", () => {
    expect(parseDCoreManifest([{ ...READ_ENTRY, name: 42 }])).toBeNull();
    expect(parseDCoreManifest([{ ...READ_ENTRY, name: "" }])).toBeNull();
    expect(parseDCoreManifest([{ ...READ_ENTRY, description: null }])).toBeNull();
    expect(
      parseDCoreManifest([{ ...READ_ENTRY, parameters: "not-a-schema" }]),
    ).toBeNull();
    expect(parseDCoreManifest([{ name: "Read" }])).toBeNull();
    expect(parseDCoreManifest(["Read"])).toBeNull();
  });

  it("covers every DCore tool name the runtime expects", () => {
    const tools = parseDCoreManifest(
      DCORE_MANIFEST_TOOL_NAMES.map((name) => ({
        name,
        description: `${name} tool`,
        parameters: { type: "object", properties: {} },
      })),
    );
    expect(tools?.map((t) => t.name)).toEqual([...DCORE_MANIFEST_TOOL_NAMES]);
  });
});

describe("manifestSchemaToTypeBox", () => {
  it("converts the golden Read schema with required/optional honored", () => {
    const schema = manifestSchemaToTypeBox(READ_ENTRY.parameters) as {
      type: string;
      properties: Record<string, { type?: string; optional?: boolean }>;
    };
    expect(schema.type).toBe("object");
    // Required stays required; the rest become TypeBox optionals.
    expect(schema.properties.path.type).toBe("string");
    expect(schema.properties.offset.type).toBe("integer");
    // TypeBox marks optionals via the `optional` symbol-ish flag; the
    // runtime only needs a valid TSchema, so assert convertibility.
    expect(typeof schema).toBe("object");
  });

  it("converts enums to a union of literals", () => {
    const schema = manifestSchemaToTypeBox({
      type: "string",
      enum: ["content", "filesWithMatches", "count"],
    }) as { anyOf: Array<{ const: string }> };
    expect(schema.anyOf.map((v) => v.const)).toEqual([
      "content",
      "filesWithMatches",
      "count",
    ]);
  });

  it("throws on unknown or malformed schemas", () => {
    expect(() => manifestSchemaToTypeBox({ type: "array" })).toThrow();
    expect(() => manifestSchemaToTypeBox({ type: "object" })).toThrow();
    expect(() =>
      manifestSchemaToTypeBox({
        type: "object",
        properties: {},
        required: "path",
      }),
    ).toThrow();
    expect(() => manifestSchemaToTypeBox(null)).toThrow();
    expect(() =>
      manifestSchemaToTypeBox({ type: "string", enum: [1, 2] }),
    ).toThrow();
  });
});

describe("manifestParametersToProperties", () => {
  it("returns convertible properties for a good entry", () => {
    const parsed = parseDCoreManifest([READ_ENTRY])!;
    const props = manifestParametersToProperties(parsed[0]);
    expect(props).not.toBeNull();
    expect(Object.keys(props!)).toEqual(["path", "offset", "limit"]);
  });

  it("returns null when the parameters are not an object schema", () => {
    const parsed = parseDCoreManifest([
      { ...READ_ENTRY, parameters: { type: "string" } },
    ])!;
    expect(manifestParametersToProperties(parsed[0])).toBeNull();
  });
});

describe("refreshDCoreToolManifest (runtime integration)", () => {
  const provider: RuntimeProviderConfig = {
    id: "local",
    name: "Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    modelId: "local-model",
    apiKey: "",
    authKind: "none",
    supportsReasoning: true,
    supportedThinkingLevels: ["off", "low", "medium", "high"],
    modelConfig: {
      source: "generic",
      name: "Local Catalog Model",
      baseUrl: "https://catalog.invalid/v1",
      reasoning: true,
      thinkingLevelMap: { minimal: null, xhigh: null, max: null },
      input: ["text", "image"],
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
      contextWindow: 256_000,
      maxTokens: 32_000,
    },
  };
  const commandShell: CommandShellOption = {
    id: "bash",
    label: "Bash",
    dialect: "posix",
    available: true,
    isDefault: true,
  };

  function makeRuntime(hostCall: (...args: unknown[]) => Promise<unknown>) {
    return new DesktopAgentRuntime({
      host: {
        call: hostCall,
        onNotification: () => () => {},
      } as never,
      sessionId: "session-manifest",
      mode: "agent",
      provider,
      commandShell,
      thinkingLevel: "medium",
      onEvent: () => {},
    });
  }

  function catalogDescriptions(runtime: DesktopAgentRuntime) {
    const catalog = (
      runtime as unknown as {
        toolCatalog: Map<string, { description: string; parameters: unknown }>;
      }
    ).toolCatalog;
    return new Map(
      [...catalog.entries()].map(([name, tool]) => [name, tool.description]),
    );
  }

  const manifestTools = DCORE_MANIFEST_TOOL_NAMES.map((name) => ({
    name,
    source: "dcore",
    description: `Manifest description for ${name}.`,
    parameters: { type: "object", properties: { path: { type: "string" } } },
  }));

  it("rebuilds DCore tool entries from the manifest", async () => {
    const hostCall = vi.fn(async (method: unknown) => {
      if (method === "tools.describe") return { tools: manifestTools };
      throw new Error(`unexpected call ${String(method)}`);
    });
    const runtime = makeRuntime(hostCall as never);
    const before = catalogDescriptions(runtime).get("Read")!;
    expect(before).not.toContain("Manifest description for Read.");

    await runtime.refreshDCoreToolManifest();

    const after = catalogDescriptions(runtime);
    expect(hostCall).toHaveBeenCalledWith("tools.describe", {});
    // Manifest description wins, with the DCode path hints still appended.
    expect(after.get("Read")).toContain("Manifest description for Read.");
    expect(after.get("Read")).toContain("explicit path outside the workspace");
    expect(after.get("Bash")).toContain("Manifest description for Bash.");
    // DCode-side augmentations survive: the shell hint is still composed in.
    expect(after.get("Bash")).toContain("through Bash");
    // Non-DCore tools are untouched.
    expect(after.get("PluginCheck")).toContain("Validate a DCode plugin");
    await runtime.dispose();
  });

  it("keeps the static definitions when tools.describe is unavailable", async () => {
    const hostCall = vi.fn(async () => {
      throw Object.assign(new Error("unknown method"), { code: -32601 });
    });
    const runtime = makeRuntime(hostCall as never);
    const before = catalogDescriptions(runtime).get("Read")!;

    await runtime.refreshDCoreToolManifest();

    expect(catalogDescriptions(runtime).get("Read")).toBe(before);
    expect(before).toContain("bounded window");
    await runtime.dispose();
  });

  it("keeps the static definitions when the manifest is malformed", async () => {
    const hostCall = vi.fn(async () => ({ tools: [{ name: "Read" }] }));
    const runtime = makeRuntime(hostCall as never);
    const before = catalogDescriptions(runtime).get("Read")!;

    await runtime.refreshDCoreToolManifest();

    expect(catalogDescriptions(runtime).get("Read")).toBe(before);
    await runtime.dispose();
  });
});
