<script setup lang="ts">
/**
 * Home-screen mascot.
 *
 * The `HomeMascotLogo` component, mechanical apart from the asset imports:
 * Vite resolves the four images to URLs, exactly as `BrandLogo.vue` does for the
 * brand marks.
 *
 * Which pair is visible is pure CSS. `styles/chat-shell.css` shows the `-dark`
 * motion/still pair on the dark theme and the `-light` pair on the light one
 * (`:root:not([data-theme="light"]) …`), and hides the other, so all four
 * images are always rendered and nothing here reads the theme.
 *
 * The bare `aria-hidden` is written as `aria-hidden="true"`: a bare attribute
 * in a Vue template renders as `""`, so the explicit value keeps the rendered
 * output stable.
 */
import mascotMotionDarkUrl from "../assets/home-mascot-dark.gif";
import mascotMotionLightUrl from "../assets/home-mascot-light.gif";
import mascotStillDarkUrl from "../assets/home-mascot-still-dark.png";
import mascotStillLightUrl from "../assets/home-mascot-still-light.png";
</script>

<template>
  <span
    class="home-mascot-logo"
    data-testid="home-mascot-logo"
    aria-hidden="true"
  >
    <img
      class="home-mascot-motion home-mascot-dark"
      :src="mascotMotionDarkUrl"
      alt=""
      :width="100"
      :height="100"
      :draggable="false"
    />
    <img
      class="home-mascot-motion home-mascot-light"
      :src="mascotMotionLightUrl"
      alt=""
      :width="100"
      :height="100"
      :draggable="false"
    />
    <img
      class="home-mascot-still home-mascot-dark"
      :src="mascotStillDarkUrl"
      alt=""
      :width="100"
      :height="100"
      :draggable="false"
    />
    <img
      class="home-mascot-still home-mascot-light"
      :src="mascotStillLightUrl"
      alt=""
      :width="100"
      :height="100"
      :draggable="false"
    />
  </span>
</template>
