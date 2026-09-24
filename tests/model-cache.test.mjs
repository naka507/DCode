import { readStoreSource, readMainSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readMainSource();
const storeSource = await readStoreSource();

test("saved provider discovery persists models in the host catalog", () => {
  assert.match(mainSource, /req\.source === "cache"/);
  assert.match(mainSource, /"providers\.listModels"/);
  assert.match(mainSource, /"providers\.cacheModels"/);
  assert.match(mainSource, /catalogPath: app\.isPackaged/);
  assert.match(mainSource, /resources", "models\.dev", "api\.json"/);
  assert.match(mainSource, /modelsDevCatalog\.loadLocal\(\)/);
  // The runtime remote refresh was removed: the bundled snapshot is the only
  // data source, so the main process must never call a catalog refresh.
  assert.doesNotMatch(mainSource, /modelsDevCatalog\.refresh\(/);
  assert.match(mainSource, /const modelsDevModel = modelsDevCatalog\.findModel/);
  assert.match(mainSource, /modelConfigFromModelsDev/);
  assert.match(mainSource, /genericModelConfig/);
  assert.match(mainSource, /providersRefreshModelCatalog/);
  assert.doesNotMatch(mainSource, /modelsDevCatalog\.persist/);
  assert.match(mainSource, /usesSavedEndpoint/);
  assert.match(mainSource, /endpointStillCurrent/);
  assert.match(mainSource, /for \(const binding of provider\.models \?\? \[\]\)/);
  assert.match(mainSource, /models\.dev or generic[\s\S]*per-model state/);
});

test("renderer hydrates cached models before refreshing the provider", () => {
  assert.match(storeSource, /source: "cache"/);
  assert.match(storeSource, /source: "refresh"/);
  assert.match(storeSource, /cachedProviderModels/);
  assert.match(storeSource, /refreshedProviderModels/);
  assert.match(storeSource, /providerModelsGeneration/);
  assert.match(storeSource, /Keep the cached catalog/);
});
