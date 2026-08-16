import type { Observation } from "./observation.js";
import type { Provider } from "./provider.js";
export type ScipObservation = Observation;
/**
 * Evidence provider for SCIP / scip-typescript (Issue #8). Runs
 * scip-typescript against the isolated workspace, retains its raw `.scip`
 * protobuf index unmodified, and projects documents/occurrences/symbols
 * into the common observation envelope without discarding or normalizing
 * SCIP-native symbol identities.
 */
export declare function createScipTypescriptProvider(): Provider;
