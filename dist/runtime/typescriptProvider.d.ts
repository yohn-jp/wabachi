import type { Provider } from "./provider.js";
/**
 * Compiler-authoritative semantic evidence provider (Issue #7). Discovers
 * the workspace's TypeScript project configuration, builds a Program using
 * full TypeScript compiler/TypeChecker semantics, and emits both lossless
 * raw evidence and normalized observations (Issue #5 envelope) for
 * declarations/symbols, references, imports/exports, type relationships,
 * extends/implements, and statically resolvable calls.
 */
export declare function createTypeScriptProvider(): Provider;
