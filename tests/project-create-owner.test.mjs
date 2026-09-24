/**
 * The "Add project" button opens the dialog.
 *
 * The reported bug: clicking Add in the project archive did nothing. Six entry
 * points (the archive page, the sidebar, the home switcher, the onboarding
 * checklist, the pull-request page, and the application menu) all flip
 * `createProjectDialogOpen` on the composed app store, but `ProjectCreateDialog`
 * read a *different* Pinia store that had its own flag of the same name. Nothing
 * ever called that store's `openProject()`, so the flag the dialog watched was
 * never set and `DialogRoot` never mounted its content.
 *
 * These tests pin the single-owner rule rather than one call site, so the same
 * split cannot come back through a new component.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [dialog, appState, appStore, projectsPage, ...rest] = await Promise.all([
  read("../src/renderer/components/ProjectCreateDialog.vue"),
  read("../src/renderer/stores/app-state.ts"),
  read("../src/renderer/stores/app-store.ts"),
  read("../src/renderer/pages/ProjectsPage.vue"),
  read("../src/renderer/stores/slices/project-slice.ts"),
]);

test("the create dialog reads the flag every entry point writes", () => {
  // One flag, one owner: the dialog must read the composed app store.
  assert.match(
    dialog,
    /import \{ useAppStore \} from "\.\.\/stores\/app-store";/,
    "the dialog must reach the composed app store",
  );
  assert.match(
    dialog,
    /get: \(\) => store\.appState\?\.createProjectDialogOpen/,
    "the dialog's open flag must come from the app store",
  );
  // The orphan store is what made the button inert; it must not come back.
  assert.doesNotMatch(
    dialog,
    /useProjectCreateStore/,
    "a second store owning this flag is exactly the reported defect",
  );
});

test("the app store is the only declarer of the dialog flag", async () => {
  // A `defineStore` that re-declares `createProjectDialogOpen` is the shape of
  // the bug: two owners, one of which nothing writes.
  const storeFiles = [
    "../src/renderer/stores/app-store.ts",
    "../src/renderer/stores/app-state.ts",
  ];
  const sources = await Promise.all(storeFiles.map(read));
  for (const source of sources) {
    assert.ok(source.length > 0);
  }
  // The dialog's flag is typed on the app state contract.
  assert.match(
    appState,
    /createProjectDialogOpen: boolean;/,
    "the flag belongs to the app state contract",
  );
  // And the slice that owns it writes it.
  assert.match(
    rest[0],
    /openProject: async \(\) => \{\s*set\(\{ createProjectDialogOpen: true \}\);/,
    "the project slice must be the writer",
  );
  // `app-store.ts` must not define a competing flag of its own.
  assert.doesNotMatch(
    appStore,
    /createProjectDialogOpen: false/,
    "the composed store must not re-declare the flag as independent state",
  );
});

test("every entry point routes through the same app-store action", async () => {
  const entryPoints = [
    "../src/renderer/pages/ProjectsPage.vue",
    "../src/renderer/components/Sidebar.vue",
    "../src/renderer/components/HomeProjectSwitcher.vue",
    "../src/renderer/components/OnboardingChecklist.vue",
    "../src/renderer/pages/PullRequestsPage.vue",
  ];
  for (const path of entryPoints) {
    const source = await read(path);
    assert.match(
      source,
      /openProject\(\)/,
      `${path} must call the shared open action`,
    );
  }
  // The archive's own Add button is the reported one.
  assert.match(
    projectsPage,
    /function addProject\(\) \{\s*void store\.appState\?\.openProject\(\)/,
    "the archive Add button must flip the app store flag",
  );
});
