import type { Provider } from "./provider.js";
/**
 * Minimal deterministic provider used to exercise the provider contract in
 * tests and as a template for future concrete providers. It writes one raw
 * artifact listing the workspace's top-level entries.
 */
export declare function createFixtureProvider(options?: {
    readonly id?: string;
    readonly available?: boolean;
}): Provider;
