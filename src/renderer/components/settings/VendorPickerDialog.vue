<script setup lang="ts">
/**
 * Pick which vendor to sign in to; the same vendor can be picked repeatedly.
 *
 * The `VendorPickerDialog` component.
 *
 * Deliberate choices:
 *  - `createPortal(node, overlayRoot())` → `<Teleport :to="overlayRoot()">`, the
 *    viewport-fixed host the `.overlay` dialog family uses (`ui-kit.css` sets
 *    `pointer-events: none` on the host and re-enables them for a direct
 *    `.overlay` child).
 *  - The `keydown` effect's Escape listener becomes `onMounted` / `onUnmounted`
 *    with the same window listener.
 *  - `onPick` / `onClose` stay callback props: the caller passes them straight
 *    through from `VendorAccountsSection`, and `onPick` runs `beginOAuthLogin`
 *    exactly once (a click, not a render), so they are values the dialog reads
 *    rather than events it announces.
 */
import { onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import type { OAuthVendor } from "@dcode/shared";
import { overlayRoot } from "../../lib/overlay-root";
import Button from "../ui/Button.vue";

const props = defineProps<{
  /** Every OAuth-capable vendor; existing accounts do not disable a vendor. */
  vendors: OAuthVendor[];
  onPick: (vendor: OAuthVendor) => void;
  onClose: () => void;
}>();

const { t } = useI18n();

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") props.onClose();
}

onMounted(() => window.addEventListener("keydown", onKeyDown));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown));
</script>

<template>
  <Teleport :to="overlayRoot()">
    <div class="overlay provider-dialog-overlay" role="presentation">
      <div
        class="dialog oauth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vendor-picker-title"
      >
        <h3 id="vendor-picker-title" class="provider-dialog-title">
          {{ t("settings.vendorPickTitle") }}
        </h3>
        <div class="oauth-status">{{ t("settings.vendorPickDesc") }}</div>
        <div class="oauth-options">
          <button
            v-for="vendor in vendors"
            :key="vendor.vendorId"
            type="button"
            class="oauth-option"
            @click="onPick(vendor)"
          >
            <span class="oauth-option-label">{{ vendor.name }}</span>
            <!-- The vendor's own call to action when it has one; otherwise
                 say whether this is a subscription rather than pay-per-use. -->
            <span
              v-if="vendor.loginLabel || vendor.isSubscription"
              class="oauth-option-desc"
            >
              {{ vendor.loginLabel || t("settings.vendorSubscription") }}
              <template v-if="vendor.accounts.length > 0">
                · {{ t("settings.vendorExistingAccounts", { count: vendor.accounts.length }) }}
              </template>
            </span>
            <span v-else-if="vendor.accounts.length > 0" class="oauth-option-desc">
              {{ t("settings.vendorExistingAccounts", { count: vendor.accounts.length }) }}
            </span>
          </button>
        </div>
        <div class="provider-dialog-actions">
          <Button variant="ghost" @click="onClose">
            {{ t("settings.cancel") }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
