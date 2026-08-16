/** Shape of graft/.graph/wiring.json as produced by `graft build` (deterministic, non-`--deep` mode). */

export interface GraftWiringNode {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly path: string;
  readonly span: string | null;
  readonly signature: string | null;
  readonly exported: boolean;
  readonly origin: string;
  readonly [key: string]: unknown;
}

export interface GraftWiringEdge {
  readonly source: string;
  readonly target: string;
  readonly relation: string;
  readonly confidence: string;
  readonly [key: string]: unknown;
}

export interface GraftWiringGraph {
  readonly meta: {
    readonly version: number;
    readonly nodeCount: number;
    readonly edgeCount: number;
    readonly languages: readonly string[];
    readonly [key: string]: unknown;
  };
  readonly nodes: readonly GraftWiringNode[];
  readonly edges: readonly GraftWiringEdge[];
}
