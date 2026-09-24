/**
 * Registers the TypeScript/alias resolution hooks for the whole `node --test`
 * process, so a test file gets them whether or not it registers them itself.
 *
 * Individual tests still call `register(...)` on ts-import-hooks.mjs — that is
 * harmless (the chain just runs twice) and keeps files runnable on their own
 * via `node --test tests/some.test.mjs`.
 *
 * Wired up in package.json:
 *   node --import ./tests/helpers/register-hooks.mjs --test tests/*.test.mjs
 */
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "ts-import-hooks.mjs")));
