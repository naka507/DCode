<script setup lang="ts">
/**
 * Brand mark.
 *
 * The theme comes from the `data-theme` attribute the shell writes on `<html>`,
 * so the mark follows a theme flip that happens after mount without a re-render
 * of the whole shell: the attribute is observed directly and mirrored into a
 * local ref.
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
// Renderer-sized copies of the brand marks. The 1024px masters in build/ are
// installer icons for electron-builder; BrandLogo never renders above 64px.
import logoLight from "../assets/brand/logo-light.png";
import logoDark from "../assets/brand/logo-dark.png";

withDefaults(defineProps<{ size?: number }>(), { size: 16 });

const dark = ref(document.documentElement.dataset.theme !== "light");

let observer: MutationObserver | undefined;

onMounted(() => {
  const el = document.documentElement;
  observer = new MutationObserver(() => {
    dark.value = el.dataset.theme !== "light";
  });
  observer.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <img
    class="brand-logo"
    :src="dark ? logoDark : logoLight"
    alt=""
    aria-hidden="true"
    :width="size"
    :height="size"
    :draggable="false"
  />
</template>
