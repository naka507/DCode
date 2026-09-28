/** Only trusted user input may call this; never pass expanded prompts or history. */
export async function grantPromptReadPaths(
  host: { call(method: string, params: unknown): Promise<unknown> },
  sessionId: string,
  content: string,
  expectedTurnId: string,
): Promise<void> {
  // The host owns parsing and canonical containment. Avoid a new RPC for
  // ordinary text, including on older hosts that do not implement grants.
  if (!/(?:^|[\s`"'(<\[，：])(?:[A-Za-z]:[\\/]|\/[^/\s]|\\\\)/u.test(content)) return;
  try {
    await host.call("permissions.grantPromptReadPaths", { sessionId, content, expectedTurnId });
  } catch (error) {
    // An older host retains its existing permission behavior. Other failures
    // must surface, rather than pretending a requested grant succeeded.
    if ((error as { code?: unknown })?.code !== -32601) throw error;
  }
}
