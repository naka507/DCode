import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reader for the composer surface.
 *
 * The roots are `src/renderer/...`, and the facade is the
 * `components/Composer.vue` SFC, so the extension filter is `ts|vue`.
 */
const rendererRoot = fileURLToPath(new URL("../../src/renderer/", import.meta.url));
const composerRoot = join(rendererRoot, "features/chat/composer");
const SOURCE_EXTENSION = /\.(ts|vue)$/;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return entry.isFile() && SOURCE_EXTENSION.test(path) ? [path] : [];
      }),
  );
  return nested.flat();
}

/** Read the Composer facade plus the extracted editor, hooks, and UI modules. */
export async function readComposerSource() {
  const facade = join(rendererRoot, "components/Composer.vue");
  const autocompleteHook = join(rendererRoot, "hooks/use-composer-autocomplete.ts");
  const paths = [facade, autocompleteHook, ...(await sourceFiles(composerRoot))];
  const chunks = await Promise.all(
    paths.map(async (path) => {
      const source = await readFile(path, "utf8");
      return `\n/* ${relative(rendererRoot, path)} */\n${source}`;
    }),
  );
  return chunks.join("\n");
}

export async function readComposerModule(relativePath) {
  return readFile(join(composerRoot, relativePath), "utf8");
}
