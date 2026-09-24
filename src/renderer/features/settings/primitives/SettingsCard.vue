<script setup lang="ts">
/**
 * A titled group of rows. `description` follows the same rule as a row's: it
 * explains the card, so it lives behind the heading's help icon.
 *
 * The title is optional — the import result cards render an untitled panel.
 */
import HelpIcon from "../../../components/ui/HelpIcon.vue";

defineProps<{ title?: string; description?: string }>();
</script>

<template>
  <section class="settings-card-block">
    <!--
      The help mark is the heading's sibling, not its child: a nested button
      joins the heading's accessible name, and a screen reader's list of
      headings should not read out every explanation.
    -->
    <div v-if="title" class="settings-card-heading-help">
      <h3 class="settings-card-heading">{{ title }}</h3>
      <HelpIcon v-if="description" :label="description" />
    </div>
    <div class="settings-panel">
      <slot />
    </div>
  </section>
</template>
