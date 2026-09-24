/**
 * Module surface for `ChatTranscript`, a pure re-export barrel:
 *
 *   export { ChatTranscript } from "../features/chat/transcript/ChatTranscript";
 *   export { SubagentDetail } from "../features/chat/transcript/SubagentDetail";
 *
 * This is a plain `.ts` module rather than a `.vue` one, and that is forced
 * rather than chosen: the SFC compiler emits
 * `import _sfc_main from "<file>?vue&type=script&lang.ts"` for every `.vue`
 * file, so a component-less SFC that only re-exports other modules fails the
 * build with `"default" is not exported by ...ChatTranscript.vue`. A barrel has
 * no component to answer for the module, so it is not an SFC.
 *
 * `SessionPane.vue` imports `ChatTranscript` from here, and
 * `workpanel/SubagentPanel.vue` imports `SubagentDetail` straight from the
 * transcript cluster, so this barrel exists to keep the module path resolvable.
 */
export { default as ChatTranscript } from "../features/chat/transcript/ChatTranscript.vue";
export { default as SubagentDetail } from "../features/chat/transcript/SubagentDetail.vue";
