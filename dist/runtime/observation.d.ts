/**
 * Minimal provider observation envelope (see Issue #5). Providers emit
 * observations to express comparable subject/predicate/object facts while
 * retaining provider-native evidence and provenance.
 */
export type ObservationDerivation = "deterministic" | "non-deterministic";
export interface SourceLocation {
    readonly path: string;
    readonly startLine: number;
    readonly startColumn: number;
    readonly endLine: number;
    readonly endColumn: number;
}
export interface ObservationSubject {
    readonly kind: string;
    readonly name: string;
    readonly location?: SourceLocation;
}
export interface ObservationObject {
    readonly kind: string;
    readonly name: string;
    readonly location?: SourceLocation;
    readonly value?: string;
}
export type ObservationPredicate = "defines" | "references" | "calls" | "imports" | "exports" | "extends" | "implements" | "type-of";
export interface Observation {
    readonly predicate: ObservationPredicate;
    readonly subject: ObservationSubject;
    readonly object: ObservationObject;
    readonly provider: {
        readonly id: string;
        readonly version: string;
    };
    readonly repository: {
        readonly source: string;
        readonly commitSha: string;
    };
    readonly derivation: ObservationDerivation;
    /** Provider-native payload/reference so information is not discarded. */
    readonly native: unknown;
}
