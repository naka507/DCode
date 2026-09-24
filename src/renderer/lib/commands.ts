/**
 * First-party command execution shared by the command palette and the
 * composer "/" dispatch (D123). Builtin ids run app actions locally; other
 * ids round-trip to the plugin runtime via commandPalette/execute.
 *
 * Translation goes through the vue-i18n instance in `../i18n`
 * (`i18n.global.t`), and the store access comes from `../stores/app-store`.
 * The command ids, aliases, switch cases and error text are unchanged.
 */
import { i18n } from "../i18n";
import { api } from "./api";
import { currentAppState, patchAppState } from "../stores/app-store";
import { trustedExtensionCommandName, type Mode } from "@dcode/shared";

export async function runPaletteCommand(commandId: string): Promise<void> {
  const store = currentAppState();
  switch (commandId) {
    case "builtin.session.new":
      await store.newSession();
      break;
    case "builtin.agent.compact":
      await store.compactContext();
      break;
    case "builtin.mode.agent":
    case "builtin.mode.plan":
    case "builtin.mode.goal": {
      const mode: Mode = commandId.endsWith("plan")
        ? "plan"
        : commandId.endsWith("goal")
          ? "goal"
          : "agent";
      const activeSession = store.activeSessionId
        ? store.sessions.find((session) => session.id === store.activeSessionId)
        : undefined;
      if (activeSession) {
        await store.configureActiveSession({
          mode,
          providerId: activeSession.providerId,
          modelId: activeSession.modelId,
          thinkingLevel: activeSession.thinkingLevel,
        });
      } else if (store.settings) {
        // Keep the command useful from the empty home, where no session has
        // been created yet. The next session will inherit this default.
        const next = { ...store.settings, defaultMode: mode };
        await api.setSettings(next);
        patchAppState({ settings: next });
      }
      break;
    }
    default: {
      // Trusted extension commands run inside the active session's sidecar
      // (spec 16 §8); without a session there is nothing to run them in.
      const extensionCommand = trustedExtensionCommandName(commandId);
      if (extensionCommand !== undefined) {
        await runExtensionCommand(extensionCommand, "");
        return;
      }
      await api.executeCommand(commandId);
    }
  }
}

export async function runExtensionCommand(name: string, args: string): Promise<void> {
  const store = currentAppState();
  if (!store.activeSessionId) {
    throw new Error(i18n.global.t("plugins.agentExtension.commandNeedsSession"));
  }
  await api.runExtensionCommand({ sessionId: store.activeSessionId, name, args });
}
