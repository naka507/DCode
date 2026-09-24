import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AgentSidecar as RuntimeAgentSidecar,
  type StderrHandler,
} from "@dcode/engine";
import { redactValue } from "./logger";

export type {
  LocalToolHandler,
  LocalToolResult,
  ProjectInstructionResolver,
  SidecarNotificationHandler,
  TrustedExtensionSidecarBridge,
  VendorAuthResolver,
} from "@dcode/engine";

/**
 * The bundled sidecar entry, or the path it is expected at when neither
 * candidate exists (so the spawn failure names the real location).
 *
 * `scripts/bundle-sidecar.mjs` emits `resources/runtime/sidecar.js` beside the
 * `package.json` that marks it ESM, and electron-builder's `extraResources`
 * copies that whole directory to `<resources>/agent-runtime`. A source checkout
 * reaches the same tree relatively: this module is bundled into `out/main`, so
 * `../../` is the repo root.
 */
function resolveSidecarEntry(): string {
  const candidates = [
    // packaged resources
    join(process.resourcesPath || "", "agent-runtime/sidecar.js"),
    // source checkout: out/main -> ../../resources/runtime
    join(__dirname, "../../resources/runtime/sidecar.js"),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return join(__dirname, "../../resources/runtime/sidecar.js");
}

function fallbackStderrLogger(text: string): void {
  console.error(
    `[agent/runtime] ${JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      channel: "agent",
      category: "runtime",
      event: "child.process.stderr",
      message: "child process stderr",
      data: { output: redactValue(text.trimEnd()) },
    })}`,
  );
}

/**
 * The desktop's agent sidecar: the shared stdio transport from
 * `@dcode/engine`, launched the only way Electron can run Node
 * code out of process — its own executable with `ELECTRON_RUN_AS_NODE` — on
 * the sidecar bundle this build ships.
 */
export class AgentSidecar extends RuntimeAgentSidecar {
  constructor(onStderr?: StderrHandler) {
    super({
      launch: {
        command: process.execPath,
        args: [resolveSidecarEntry()],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
        },
      },
      onStderr: onStderr ?? fallbackStderrLogger,
    });
  }
}
