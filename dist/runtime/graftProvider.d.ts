import type { Provider } from "./provider.js";
export interface GraftProviderOptions {
    /** Override the `graft` executable, e.g. for tests that stub the CLI. */
    readonly binary?: string;
    /** File extensions passed through to `graft build --extensions`. */
    readonly extensions?: readonly string[];
}
export declare function createGraftProvider(options?: GraftProviderOptions): Provider;
