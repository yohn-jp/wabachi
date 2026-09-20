# ADR-188: Design Intent shared contract baseline

- Status: accepted for Epic #188 implementation leaves
- Date: 2026-09-20
- Scope: shared contract and semantic identity baseline only

## Decision

Wabachi keeps the existing Architecture Canon as the semantic authority. The Design Intent lifecycle composes with that Canon through the contracts in `src/design/contracts.ts`; it does not create a parallel architecture document model.

The shared baseline is split into four ownership boundaries:

- `src/design/entry-key.ts` owns collection-qualified semantic entry identity. Identity tuples are explicit and ordered for each collection. Relationship keys use the ordered `(source, target, kind, interfaceId?)` tuple and are encoded as JSON, so delimiters inside input strings cannot collide.
- `src/design/digest.ts` owns canonical JSON serialization and SHA-256 payload digests. Object keys are sorted with locale-independent ordinal comparison, arrays retain their semantic order, and invalid JSON values fail closed. A digest is computed from a payload without including the result in that payload.
- `src/design/contracts.ts` owns transport-neutral Design Change, review, Implementation linkage, certification evidence, and lifecycle wire types. Review evidence binds `changeId`, `proposalDigest`, `proposalRevision`, `decision`, `actor`, `reason`, `timestamp`, and provider-neutral evidence. External Implementation identity is the Inari-compatible `(repositoryHost, repositoryId, repository?, number)` tuple; the optional repository name is only a locator. Semantic Change Set content is separate from lifecycle/evidence records. These types do not grant Inari authorization or Nawabari execution permission.
- `src/design/ports.ts` owns domain ports for reading the Canon, evaluating/storing Change Sets, and storing review, linkage, certification, and lifecycle records. Implementations and persistence remain later-leaf responsibilities.

Source-level Code Intent remains inside Canon at `src/architecture/canon/code-intent-contract.ts`. Its canonical model is `ownerId`, set-like `responsibilityIds` and `decisionIds`, invariant/prohibition statements, and verification obligations with statement IDs, modes, and predicates. It reuses existing Canon responsibility, decision, and source-mapping identities and does not turn every source symbol into an Architecture Canon element.

The dependency direction is therefore:

```text
Architecture Canon  <-- Code Intent contract
        ^
        | type-only composition
Design Intent contracts and ports
```

No Canon runtime module imports `src/design/**`. Existing Canon v1 behavior, `.wabachi/architecture.json`, and the public architecture CLI remain unchanged in this baseline.

## Compatibility rules

- Current Canon documents without Code Intent remain valid.
- Design Change Sets bind to an explicit Canon version, Canon digest, and repository revision.
- Change Set digests cover the semantic payload only; the self-referential digest field is excluded.
- Semantic operations use stable entry keys rather than JSON paths or serialized array positions.
- Added, modified, and removed operations remain distinguishable; applying a valid set to its exact base is the responsibility of a later Design Change implementation.
- Review evidence is immutable for the exact proposal revision and records actor/reason/timestamp/evidence without becoming authentication or approval authority.
- External Implementation linkage uses repository host/id/number identity; an optional repository name is a locator and cannot change identity. It never copies Inari authorization fields.
- Code Intent references existing owner/responsibility/decision identities and keeps verification mode/predicate explicit; it does not duplicate responsibility or decision prose.
- Certification is tied to the exact implementation repository revision. Mismatch or unresolved evidence is not success, and a later proposal or implementation revision makes prior evidence stale.

## History and provenance

Repository revisions and Canon digests are explicit in the shared references. Git remains the history mechanism for prior current Canon revisions; this contract does not introduce a second snapshot archive. External provider references are evidence/provenance only and do not become Wabachi lifecycle authority.

## Routing for this implementation phase

Epic #188 uses the current two-level routing:

```text
main <- epic/188-design-intent-lifecycle <- feat/200-design-intent-contract
```

The child PR targets the Epic integration branch. Three-level `issue/*` routing, Inari integration, lifecycle behavior, persistence, review execution, linkage resolution, certification, promotion, projections, CLI workflows, and dogfood are outside this contract leaf.
