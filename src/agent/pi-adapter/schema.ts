/**
 * ADR-006 (P1-4): schema builder surface.
 *
 * `Type` is pi-ai's TypeBox instance, used to build tool parameter schemas.
 * Re-exported here so schema-building code goes through the adapter seam.
 */
import { Type } from "@earendil-works/pi-ai";
import type { TSchema } from "@earendil-works/pi-ai";

export { Type };
export type { TSchema };
