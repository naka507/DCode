<script setup lang="ts">
/**
 * One capability. The level badge is on the row itself, not only in the group
 * header, so a row scrolled away from its divider still says where it lives.
 *
 * The `CapabilityRow` surface. The `glyph`, `badges`, `meta` and
 * `actions` nodes are slots.
 *
 * `glyphState` is tinted through an object `:class` with literal keys rather
 * than the `` `is-${glyphState}` `` template literal: the class-name
 * contract reads a template literal's static text verbatim, so the interpolated
 * form would be reported as the glued fragment `is-` instead of the three names
 * `styles/settings.css` actually defines (`.is-connecting`, `.is-ready`,
 * `.is-failed`). `McpConnectionState` has exactly those three plus `idle`, and
 * `idle` has no rule in either tree, so it is deliberately not named.
 */
defineProps<{
  /** Tints the glyph for capabilities that carry live state, e.g. MCP handshakes. */
  glyphState?: string;
  name: string;
  command?: string;
  description: string;
  off?: boolean;
  menuOpen?: boolean;
}>();
</script>

<template>
  <div
    class="agent-capability-row"
    :class="{ 'is-off': off, 'menu-open': menuOpen }"
    role="listitem"
  >
    <span
      class="agent-capability-glyph"
      :class="{
        'is-connecting': glyphState === 'connecting',
        'is-ready': glyphState === 'ready',
        'is-failed': glyphState === 'failed',
      }"
      aria-hidden="true"
    >
      <slot name="glyph" />
    </span>
    <div class="agent-capability-copy">
      <div class="agent-capability-row-title">
        <span class="agent-capability-name">{{ name }}</span>
        <slot name="badges" />
      </div>
      <code v-if="command" class="agent-capability-command" :title="command">
        {{ command }}
      </code>
      <p class="agent-capability-description" :title="description">
        {{ description }}
      </p>
      <div v-if="$slots.meta" class="agent-capability-meta">
        <slot name="meta" />
      </div>
    </div>
    <div class="agent-capability-row-actions">
      <slot name="actions" />
    </div>
  </div>
</template>
