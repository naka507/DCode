/**
 * Notification runtime: native notifications for interactive prompts.
 *
 * Translation goes through the vue-i18n instance in `../../i18n`
 * (`i18n.global.t(...)`). Message keys and payloads are unchanged.
 */
import { i18n } from "../../i18n";
import { api } from "../../lib/api";
import type { StoreGet } from "../slices/types";

export type InteractivePromptNotifier = (
  sessionId: string,
  kind: "ask" | "permission" | "plan",
  payload?: { question?: string; toolName?: string },
) => void;

export function createInteractivePromptNotifier(
  get: StoreGet,
): InteractivePromptNotifier {
  return (sessionId, kind, payload) => {
    const session = get().sessions.find((item) => item.id === sessionId);
    const sessionTitle = session?.title || i18n.global.t("chat.untitledTask");
    let title = "";
    let body = "";
    if (kind === "ask") {
      title = i18n.global.t("notifications.askTitle", { sessionTitle });
      body = payload?.question?.trim() || i18n.global.t("notifications.askBodyFallback");
    } else if (kind === "permission") {
      title = i18n.global.t("notifications.permissionTitle", { sessionTitle });
      body = i18n.global.t("notifications.permissionBody", {
        toolName: payload?.toolName || "tool",
      });
    } else {
      title = i18n.global.t("notifications.planApprovalTitle", { sessionTitle });
      body = i18n.global.t("notifications.planApprovalBody");
    }
    void api
      .showNativeNotification({
        id: crypto.randomUUID(),
        sessionId,
        kind: "interactive",
        title,
        body,
      })
      .catch(() => undefined);
  };
}
