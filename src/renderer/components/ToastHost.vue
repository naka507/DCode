<script setup lang="ts">
/**
 * Global toast stack — mount once per shell, above dialogs (z-toast).
 *
 * The card is `ToastCard.vue`, one instance per toast so each keeps its own
 * dismiss timer.
 */
import { computed } from "vue";
import { useAppStore } from "../stores/app-store";
import ToastCard from "./ToastCard.vue";

const store = useAppStore();
const toasts = computed(() => store.appState?.toasts ?? []);
</script>

<template>
  <div class="toast-viewport" aria-live="polite">
    <ToastCard v-for="item in toasts" :key="item.id" :item="item" />
  </div>
</template>
