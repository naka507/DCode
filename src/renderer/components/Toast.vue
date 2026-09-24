<script lang="ts">
/**
 * Alias for the toast stack.
 *
 * The host implementation lives in `ToastHost.vue` (the exported `ToastHost`
 * component; `ToastCard.vue` is its per-toast child). This file exists because
 * the shell mounts the stack by the `components/Toast.vue` path, so that import
 * keeps resolving without a second implementation.
 */
import ToastHost from "./ToastHost.vue";

export default ToastHost;
</script>
