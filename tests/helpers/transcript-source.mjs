import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reader for the transcript surface.
 *
 * The roots are `src/renderer/...`, and the surface is `.vue` SFCs, so the
 * extension filter is `ts|vue`.
 *
 * Everything else — the legacy facade plus every module under the transcript
 * directory, concatenated in a stable order — is what a source-contract
 * assertion reads.
 */
const rendererRoot = fileURLToPath(new URL("../../src/renderer/", import.meta.url));
const transcriptRoot = join(rendererRoot, "features/chat/transcript");
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

/** Read the legacy facade and all transcript domain modules together. */
export async function readTranscriptSource() {
  const facade = join(rendererRoot, "components/ChatTranscript.ts");
  const paths = [facade, ...(await sourceFiles(transcriptRoot))];
  const chunks = await Promise.all(
    paths.map(async (path) => {
      const source = await readFile(path, "utf8");
      return `\n/* ${relative(rendererRoot, path)} */\n${source}`;
    }),
  );
  return chunks.join("\n");
}

export async function readTranscriptModule(relativePath) {
  return readFile(join(transcriptRoot, relativePath), "utf8");
}
