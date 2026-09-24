import { IPC, ErrorCodes, trustedExtensionCommandId, trustedExtensionCommandName } from "@dcode/shared";
import { builtinPaletteItems } from "../builtin-commands";
import type { AgentExtensionBridge } from "../agent-extensions";
import type { PluginRuntime } from "../plugin-runtime";
import type { IpcRegistrar } from "./types";

export type CommandPaletteIpcDependencies = {
  registrar: IpcRegistrar;
  plugins: PluginRuntime;
  agentExtensions: AgentExtensionBridge;
  optionalWorkspaceRoot: () => Promise<string | null>;
  pluginActiveInProject: (pluginId: string, projectPath: string | null | undefined) => boolean;
  sendToRenderer: (channel: string, payload?: unknown) => void;
};

/**
 * The command palette's two channels.
 *
 * They used to live in `market-ipc.ts`, which registered the marketplace
 * channels beside them. The marketplace is gone; the palette is not, so it has
 * its own registrar. Nothing here reads the host: the palette aggregates
 * built-in items, plugin commands, and trusted-extension commands, all of which
 * the main process already holds.
 */
export function registerCommandPaletteIpc({
  registrar,
  plugins,
  agentExtensions,
  optionalWorkspaceRoot,
  pluginActiveInProject,
  sendToRenderer,
}: CommandPaletteIpcDependencies): void {
  const handle = (channel: string, fn: (...args: any[]) => Promise<any>) => {
    registrar.handle(channel, async (...args) => fn(...args));
  };

  handle(IPC.invoke.commandPaletteSearch, async (query: string) => {
    const q = (query || "").toLowerCase();
    const builtin = builtinPaletteItems();
    const root = await optionalWorkspaceRoot();
    const pluginCmds = plugins
      .getCommands()
      .filter((c) => pluginActiveInProject(c.pluginId, root))
      .map((c) => ({
        id: c.id,
        title: c.title,
        category: c.category,
        keywords: c.keywords,
        source: "plugin" as const,
        pluginId: c.pluginId,
      }));
    const extensionCmds = agentExtensions.allCommands().map((c) => ({
      id: trustedExtensionCommandId(c.name),
      title: `/${c.name}`,
      category: c.extensionLabel,
      keywords: c.description ? [c.description] : [],
      source: "extension" as const,
      extensionId: c.extensionId,
    }));
    return {
      commands: [...builtin, ...pluginCmds, ...extensionCmds].filter((c) => {
        if (!q) return true;
        const hay = `${c.title} ${c.category ?? ""} ${(c as any).keywords?.join(" ") ?? ""}`.toLowerCase();
        return hay.includes(q);
      }),
    };
  });

  handle(IPC.invoke.commandPaletteExecute, async (commandId: string) => {
    if (commandId.startsWith("builtin.")) {
      return { ok: true, commandId };
    }
    if (trustedExtensionCommandName(commandId) !== undefined) {
      // Extension commands need a session; the renderer routes them through
      // `extensions/commands/run` with the active session id.
      throw Object.assign(new Error("extension commands run inside a session"), {
        errorCode: ErrorCodes.INVALID_ARGUMENT,
      });
    }
    const cmd = plugins.getCommands().find((c) => c.id === commandId);
    if (!cmd) throw new Error("command not found");
    // A command can be typed into the composer by name, so the scope has to be
    // re-checked here and not only where the lists are built.
    if (!pluginActiveInProject(cmd.pluginId, await optionalWorkspaceRoot())) {
      throw Object.assign(new Error("command not available in this project"), {
        errorCode: ErrorCodes.NOT_FOUND,
      });
    }
    await cmd.run();
    for (const toast of plugins.drainToasts()) {
      sendToRenderer(IPC.event.toast, { message: toast });
    }
    return { ok: true, commandId };
  });
}
