/**
 * ADR-002 Phase B (DCode consumer side): build DCore tool entries from the
 * `tools.describe` manifest instead of hardcoded descriptions/schemas.
 *
 * The manifest is fetched once per runtime via `tools.describe` and is
 * strictly validated. Anything unexpected — missing method (older DCore),
 * malformed entries, an unconvertible schema — falls back to the static
 * definitions in `runtime.ts`, so the agent never loses its tools because
 * the manifest was unavailable.
 */
import { Type, type TSchema } from "@earendil-works/pi-ai";

/** One entry of the DCore `tools.describe` manifest (wire format). */
export interface DCoreManifestTool {
  name: string;
  description: string;
  /** JSON Schema for the tool input (`parameters` on the wire). */
  parameters: Record<string, unknown>;
}

/** Names of the tools DCore serves via `tools.describe`. */
export const DCORE_MANIFEST_TOOL_NAMES = [
  "Read",
  "Glob",
  "Grep",
  "Write",
  "Edit",
  "Bash",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a `tools.describe` response payload. Returns the tool list, or
 * `null` when the payload is missing or malformed (caller falls back to
 * the static definitions).
 */
export function parseDCoreManifest(value: unknown): DCoreManifestTool[] | null {
  if (!Array.isArray(value)) return null;
  const tools: DCoreManifestTool[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const { name, description, parameters } = entry;
    if (typeof name !== "string" || name.length === 0) return null;
    if (typeof description !== "string") return null;
    if (!isRecord(parameters)) return null;
    tools.push({ name, description, parameters });
  }
  return tools;
}

class ManifestSchemaError extends Error {
  constructor(message: string) {
    super(`unsupported DCore manifest schema: ${message}`);
    this.name = "ManifestSchemaError";
  }
}

/**
 * Convert a manifest JSON Schema to a TypeBox schema. Strict by design:
 * it supports exactly the subset DCore's `builtin_tool_defs` emits
 * (`object`/`string`/`integer`/`boolean`, `properties`, `required`,
 * `description`, `minimum`, `maximum`, `enum`). Anything else throws, and
 * the caller falls back to the static definition for that tool.
 */
export function manifestSchemaToTypeBox(schema: unknown): TSchema {
  if (!isRecord(schema)) throw new ManifestSchemaError("schema is not an object");
  switch (schema.type) {
    case "string": {
      if (schema.enum !== undefined) {
        if (
          !Array.isArray(schema.enum) ||
          !schema.enum.every((v) => typeof v === "string")
        ) {
          throw new ManifestSchemaError("enum must be string[]");
        }
        return Type.Union(
          schema.enum.map((v) => Type.Literal(v)),
          optionsOf(schema),
        );
      }
      return Type.String(optionsOf(schema));
    }
    case "integer":
      return Type.Integer(optionsOf(schema));
    case "boolean":
      return Type.Boolean(optionsOf(schema));
    case "object": {
      const properties = schema.properties;
      if (!isRecord(properties)) {
        throw new ManifestSchemaError("object without properties record");
      }
      const required = schema.required;
      const requiredList =
        required === undefined
          ? []
          : Array.isArray(required) &&
              required.every((r) => typeof r === "string")
            ? required
            : null;
      if (requiredList === null) {
        throw new ManifestSchemaError("required must be string[]");
      }
      const out: Record<string, TSchema> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        const converted = manifestSchemaToTypeBox(propSchema);
        out[key] = requiredList.includes(key) ? converted : Type.Optional(converted);
      }
      return Type.Object(out, optionsOf(schema));
    }
    default:
      throw new ManifestSchemaError(
        `unknown type ${JSON.stringify((schema as { type?: unknown }).type)}`,
      );
  }
}

/** Pick the TypeBox option fields the manifest is allowed to carry. */
function optionsOf(schema: Record<string, unknown>): {
  description?: string;
  minimum?: number;
  maximum?: number;
} {
  const options: { description?: string; minimum?: number; maximum?: number } = {};
  if (typeof schema.description === "string") {
    options.description = schema.description;
  }
  if (typeof schema.minimum === "number") options.minimum = schema.minimum;
  if (typeof schema.maximum === "number") options.maximum = schema.maximum;
  return options;
}

/**
 * Convert a manifest entry's `parameters` to TypeBox *properties* (not a
 * wrapped object) so the caller can merge DCode-side augmentations
 * (parameter aliases, Bash timeout) before wrapping with `Type.Object`.
 * Returns `null` when the schema can't be converted; the caller then uses
 * the static definition for that tool.
 */
export function manifestParametersToProperties(
  entry: DCoreManifestTool,
): Record<string, TSchema> | null {
  try {
    const params = entry.parameters;
    if (
      !isRecord(params) ||
      params.type !== "object" ||
      !isRecord(params.properties)
    ) {
      return null;
    }
    const required = params.required;
    const requiredList =
      required === undefined
        ? []
        : Array.isArray(required) && required.every((r) => typeof r === "string")
          ? (required as string[])
          : null;
    if (requiredList === null) return null;
    const properties: Record<string, TSchema> = {};
    for (const [key, propSchema] of Object.entries(params.properties)) {
      const converted = manifestSchemaToTypeBox(propSchema);
      properties[key] = requiredList.includes(key)
        ? converted
        : Type.Optional(converted);
    }
    return properties;
  } catch {
    return null;
  }
}
