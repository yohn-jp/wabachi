/**
 * Minimal ambient typing for the generated SCIP protobuf bindings bundled at
 * `@sourcegraph/scip-typescript/dist/src/scip.js`. That package does not
 * publish `.d.ts` files or export this module through `package.json`, so it
 * is reached by deep import and typed here against the public shape of
 * https://github.com/sourcegraph/scip-protocol/blob/main/scip.proto (the
 * message set implemented by `protoc-gen-ts`, i.e. `deserializeBinary` plus
 * a recursive `toObject()` on every message).
 */
declare module "@sourcegraph/scip-typescript/dist/src/scip.js" {
  export namespace scip {
    interface ToolInfoObject {
      name: string;
      version: string;
      arguments: string[];
    }

    interface MetadataObject {
      version: number;
      tool_info?: ToolInfoObject;
      project_root: string;
      text_document_encoding: number;
    }

    interface RelationshipObject {
      symbol: string;
      is_reference: boolean;
      is_implementation: boolean;
      is_type_definition: boolean;
      is_definition: boolean;
    }

    interface DiagnosticObject {
      severity: number;
      code: string;
      message: string;
      source: string;
      tags: number[];
    }

    interface OccurrenceObject {
      range: number[];
      symbol: string;
      symbol_roles: number;
      override_documentation: string[];
      syntax_kind: number;
      diagnostics: DiagnosticObject[];
      enclosing_range: number[];
    }

    interface SymbolInformationObject {
      symbol: string;
      documentation: string[];
      relationships: RelationshipObject[];
      kind: number;
      display_name: string;
      enclosing_symbol: string;
    }

    interface DocumentObject {
      language: string;
      relative_path: string;
      occurrences: OccurrenceObject[];
      symbols: SymbolInformationObject[];
      text: string;
    }

    interface IndexObject {
      metadata?: MetadataObject;
      documents: DocumentObject[];
      external_symbols: SymbolInformationObject[];
    }

    class Index {
      static deserializeBinary(bytes: Uint8Array): Index;
      toObject(): IndexObject;
    }
  }
}
