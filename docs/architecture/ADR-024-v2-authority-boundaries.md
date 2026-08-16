# ADR-024: Wabachi v2 authority boundaries and storage evolution

- Status: Accepted architecture contract
- Date: 2026-08-16
- Scope: Wabachi v2 semantic authority and persistence evolution
- Parent: [Issue #5](https://github.com/yohn-jp/wabachi/issues/5)

## Decision

Wabachi has two deliberately separate products built on one provenance-preserving
processing substrate:

1. The **Wabachi authority core** stores immutable evidence, derived state, and
   explicitly admitted canonical semantic declarations.
2. The **Provider Evaluation Lab** evaluates provider coverage, overlap,
   disagreement, ambiguity, and information gain as a downstream projection.

The Provider Matrix is part of the Evaluation Lab. It is never the canonical
semantic data model, and the authority pipeline neither depends on Matrix
generation nor treats a Matrix failure as an authority-store failure.

The first deployment uses an embedded SQL database (SQLite-class) for the
domain-owned persistence boundary and a content-addressed evidence store. A
PostgreSQL-class service database is a later adapter for a shared or
VM-hosted deployment, selected by operational migration triggers rather than
by dataset size or the mere availability of QEMU. JSONL, Parquet, Arrow, and
similar formats are export/projection formats only.

No generic ORM or speculative multi-database framework is introduced by this
decision. The domain owns a narrow persistence contract whose semantics are
portable between the first embedded adapter and a later PostgreSQL adapter.

## Context and current boundary

Parent Issue #5 established the initial empirical path:

```text
repository @ immutable revision
  -> provider discovery / execution
  -> immutable raw provider evidence
  -> observations
  -> entity correlation
  -> normalized facts
  -> coverage / overlap / disagreement Matrix
  -> report
```

The current runtime implements that Phase 0 experiment. Provider execution
records provider identity, repository commit, execution status, and retained
artifact paths. The observation envelope preserves provider-native payloads;
fact normalization and deterministic correlation produce the inputs used by
the Matrix. PR #23 reduced Matrix artifact duplication by making Matrix rows
reference normalized facts/evidence, but it did not turn the artifacts into a
durable authority store.

The experiment exposed boundaries that must be explicit before a storage
rewrite:

- a self-contained JSON artifact or whole-dataset materialization does not
  scale as the authority representation;
- repeating provider-native payloads in observations, facts, and projections
  creates avoidable storage and provenance problems;
- candidate-pair caps can make correlation completeness unclear;
- a correlation identity produced from one run's provider membership is not a
  durable identity across revisions;
- one provider-to-Matrix workflow is not a resumable stage model.

Generated or inferred information (observations, derived facts, findings,
claims) references or is derived from evidence, but is not itself immutable
evidence. It becomes canonical only when an explicit review/admission
operation creates a canonical declaration. A canonical declaration can later
be stale or conflict with current evidence; regeneration must not silently
replace it.

## Authority and processing paths

The durable processing graph is:

```text
repository @ revision
  -> provider runs
  -> immutable evidence objects
  -> observations / provider-native entities
  -> revision-local entity resolution
       |-> derived facts and ambiguity sets
       |     -> semantic findings
       |          -> proposed claims
       |               -> explicit admission/review
       |                    -> canonical declarations
       |
       `-> Provider Evaluation Lab projection
            (Matrix / benchmark / coverage / reports)
```

The two downstream branches share references and provenance, but have
different authority:

- The authority branch may create derived state and proposals. Only the
  admission/review boundary may create or mutate canonical declarations.
- The Evaluation Lab may create, replace, or discard projections for a
  particular run and schema version. It cannot create canonical declarations
  and it cannot make authority unavailable merely because a projection failed.
- The authority branch may run without the Evaluation Lab. A Lab projection
  may run later over retained evidence and derived state.

## Logical data classes and mutation rules

The following are logical classes, independent of the first physical schema.
Every record carries a schema/version identity and provenance sufficient to
reconstruct why it exists.

| Class                                        | Regenerable / authoritative                                                                                                | Allowed writers and mutation                                                                                                                                                                                                                 | Provenance, versioning, and retention                                                                                                                                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Immutable provider evidence**              | Not regenerated in place; authoritative as the lossless record of what a provider emitted, but not a semantic declaration. | Provider execution may append a new object and its catalog metadata. Bytes, digest, and original artifact identity are immutable; correction means a new object plus an audit relation.                                                      | Provider/version, repository and commit, run, timestamps, media type, digest, byte length, and source artifact reference. Content-addressed retention is policy-controlled; references remain auditable while retained, and a missing object is explicit rather than silently replaced. |
| **Observations / provider-native entities**  | Regenerable derived input; never canonical authority.                                                                      | Provider adapter and observation importer append a versioned observation set. No update is allowed to make an observation agree with a claim; a rerun creates a new stage output.                                                            | Observation schema, provider identity, run, revision, source span, and one or more evidence references. Superseded outputs remain addressable until retention policy permits removal.                                                                                                   |
| **Derived facts and correlation results**    | Regenerable derived state; not authoritative semantic declarations.                                                        | Normalization and resolution stages write versioned outputs keyed by input and implementation version. Replacement is allowed only for derived outputs and must leave the prior run/output auditable.                                        | Input stage/output digests, algorithm version, provider set, revision, and evidence references. A result is never promoted to canonical merely because it is deterministic.                                                                                                             |
| **Revision-local entity instances**          | Regenerable identity within one repository revision; not cross-revision authority.                                         | The entity extraction/resolution stage creates instances and records provider links. Re-resolution creates a new version or explicit supersession; it cannot rewrite a canonical ID.                                                         | Repository identity, immutable commit, revision-local namespace, provider-native references, location/qualified-name evidence, and identity algorithm version. Retain historical instances with the run/output that produced them.                                                      |
| **Ambiguity sets**                           | Regenerable derived state and a first-class result, not an error to hide.                                                  | Resolution may append candidate sets, scores/rules, and unresolved/overflow diagnostics. No writer may collapse an ambiguity by guessing; an explicit review decision is a separate mutation.                                                | Candidate revision-local IDs, excluded/unknown state, rationale, algorithm/version, input references, and completeness status. Keep them for audit as long as related findings or decisions are retained.                                                                               |
| **Semantic findings**                        | Regenerable derived findings; not canonical.                                                                               | Finding stages may append a versioned interpretation of evidence, including non-deterministic provider output. Findings can be superseded or marked rejected, but not rewritten to impersonate an admission.                                 | Evidence/fact/ambiguity references, producer and model/tool version, prompt/configuration where applicable, revision, and finding schema version. Retain the finding and its decision trail when it informed a claim.                                                                   |
| **Proposed claims**                          | Reviewable proposal; not authoritative until admitted.                                                                     | Finding/review workflows may create, amend, reject, withdraw, or supersede a proposal through append-only review events. A proposal cannot mutate a canonical declaration directly.                                                          | Claim schema, subject/object references, supporting finding/evidence references, proposer, review status, and event/version history. Retain admitted and rejected proposals with their audit trail.                                                                                     |
| **Admitted canonical semantic declarations** | Durable authority. Not regenerated.                                                                                        | Only an explicit admission or authorized semantic-review transaction may create, amend, supersede, retire, or retract one. Every mutation is an append-only semantic mutation record; a regeneration or provider run has no write path here. | Stable canonical entity/declaration IDs, admission actor/time, supporting claim/evidence, policy/schema version, and supersession/retraction links. Never delete or overwrite to make current evidence look consistent; retirement preserves history.                                   |
| **Freshness / conformance results**          | Regenerable comparison of authority with current evidence; not authority.                                                  | Conformance stages append results and status. They may propose a claim or review task but cannot alter the declaration being checked.                                                                                                        | Declaration ID, evidence/revision/run, checker version, inputs, and result status. Retain results needed to explain a declaration's history; new checks create new results.                                                                                                             |
| **Semantic mutation / review records**       | Append-only audit authority; individual events are immutable.                                                              | Admission and review services append events. Events are not edited; a correction is a compensating event.                                                                                                                                    | Actor, timestamp, reason, prior/current references, policy, and request/input versions. Retain for the lifetime of the declaration and its dependent audit obligations.                                                                                                                 |
| **Run/stage/checkpoint records**             | Operational state, regenerable only by explicit retry/resume semantics.                                                    | The orchestrator creates status transitions and checkpoints. A retry is a new attempt or idempotent continuation, never a false success.                                                                                                     | Run/stage name, implementation version, input/output references, status, limits, cursor/checkpoint, diagnostics, and timestamps. Retain enough history to distinguish attempts and reproduce results.                                                                                   |

The key invariant is:

> Regeneration may add or supersede evidence, observations, derived state,
> findings, and projections, but it must never silently overwrite an admitted
> canonical declaration or its mutation history.

Canonical declarations are allowed to be stale, contradicted, or unsupported
by a later run. Those conditions produce freshness/conformance results or a
review task; they do not grant the provider pipeline an implicit mutation
right.

## Provenance and reference contract

Large raw and provider-native payloads are stored once in a content-addressed
store (CAS or object store). A relational row or export envelope contains a
reference, not a required duplicate of the payload:

```text
Fact / Observation / Finding / Claim
  -> evidence reference
       -> evidence catalog metadata
            -> immutable provider-native bytes or artifact
```

An initial evidence reference contains at least an algorithm/digest, media
type, byte length, object key, provider/run, repository revision, and source
location. The digest is the content identity; the object key is not semantic
identity. Small bounded metadata may be copied for query convenience, but the
CAS object and its catalog record remain the lossless source. A changed
payload is a new evidence object and a new reference, never an in-place edit.

The CAS may start as a repository-local directory and later move to an object
store without changing evidence IDs or the domain meaning of references.
Database BLOBs or repeated JSON payloads are not required by the authority
contract. Importers may temporarily accept the current v1 inline
`providerNative` shape, but must digest and externalize it at the persistence
boundary.

## Identity contract

Wabachi keeps three namespaces distinct:

| Identity                            | Scope                                                                                                 | Contract                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Provider-native entity**          | Provider, provider version, and provider run                                                          | The provider's own symbol/entity ID. It is evidence and may be absent, renamed, or inconsistent across providers. It is never a canonical ID.                                |
| **Revision-local entity instance**  | Wabachi repository identity and immutable commit/revision, under a versioned local identity namespace | The entity represented in that revision. It can link multiple provider-native entities and can be recreated by a later run. It is not promised to survive a revision change. |
| **Cross-revision canonical entity** | Wabachi authority, independent of any provider run or membership set                                  | A durable ID allocated or retained by an explicit continuity/admission decision. It is referenced by canonical declarations and may link many revision-local instances.      |

The following are invariants, not implementation suggestions:

- A canonical ID must not be derived from the current provider membership set,
  provider order, a run-local correlation group, or the set of providers that
  happened to be available.
- Adding or removing a provider cannot change an already admitted canonical
  entity ID. It can add evidence, create a new candidate, or trigger review.
- A rename or move may preserve a canonical ID only through an explicit,
  auditable continuity resolution. No heuristic may silently assert continuity.
- An ambiguous or incomplete resolution produces an ambiguity set and no
  guessed canonical assignment. Interrupted or capped processing is represented
  with an explicit incomplete/unknown state plus a candidate-set completeness
  marker. "Ambiguous" is reserved for complete evaluations that yielded
  multiple candidates. Consumers must be able to distinguish unmatched,
  incomplete, ambiguous, and resolved states.
- Every historical resolution records its input revision-local instances,
  candidate set, algorithm/rule version, evidence references, decision, and
  actor or automated process. Replaying a later algorithm does not rewrite the
  historical decision.

The full cross-revision continuity algorithm is intentionally deferred to a
later Identity/Correlation implementation issue. This ADR defines the
contract that algorithm must satisfy; it does not choose matching thresholds,
rename heuristics, or an LLM policy.

## Completeness, stages, and resume contract

The v2 pipeline is resumable. A run is a container for independently tracked
stages such as `provider-execution`, `evidence-catalog`, `observation-import`,
`entity-resolution`, `fact-derivation`, `semantic-finding`, `claim-review`,
`freshness-check`, and `evaluation-projection`. Each stage records:

- a stable stage name and implementation/schema version;
- versioned input references and output references/digests;
- status, start/finish timestamps, diagnostics, and resource limits;
- a checkpoint/cursor when the stage supports resume; and
- attempt identity and an idempotency key for retry.

The idempotency key is scoped to the combination of stage, input references,
and implementation version. When a request with a matching key already exists,
the behavior depends on whether the inputs match: if inputs match, the
existing output is reused; if inputs conflict, the request is rejected without
partial persistence. Checkpoint, authoritative output, and audit-event
publication occur atomically.

The minimum status vocabulary is `pending`, `running`, `complete`,
`incomplete`, `failed`, and `cancelled`. `incomplete` is not a successful
substitute: it means that a bounded run produced partial output or could not
evaluate its entire declared input. Consumers must carry the status forward
and cannot present an incomplete result as complete.

Stage output is versioned by its input references and implementation version.
Resuming a stage continues from a recorded checkpoint or creates a new
attempt; it does not silently merge incompatible output versions. Transactions
and idempotency prevent a retry from creating duplicate authoritative events.

Resource caps, candidate-pair limits, unavailable providers, and interrupted
workers are explicit diagnostics. A correlation stage may persist the
candidates it evaluated, plus an overflow/unknown marker, but it must mark the
stage/run `incomplete` when the cap prevents completeness. No semantic
candidate may disappear solely because a cap was reached while the run still
claims to be complete. Incomplete derived output may be inspected and may
create a review task under an explicit policy, but it cannot silently become a
complete canonical declaration.

Evaluation projections inherit input completeness and have their own stage
status. A failed or incomplete Matrix does not roll back evidence, derived
facts, findings, or canonical authority. Conversely, the authority path does
not wait for a Matrix artifact to exist.

## Storage decision and evolution path

### Deployment shapes

| Shape                                                             | Role and fit                                                                                                                                                                                                                                                                   | Limits / boundary                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Embedded SQL (SQLite-class) + local CAS**                    | Default for repository-local execution. Provides transactions, foreign keys, unique constraints, indexed lookups, and ordinary joins without a service to operate. The CAS keeps large evidence out of relational rows.                                                        | Write serialization is local to the authority process/host. It is not the default for independent writers on multiple hosts or a long-lived shared service. A multi-GB dataset alone does not require PostgreSQL.   |
| **B. VM-hosted service DB (PostgreSQL-class) + CAS/object store** | Future Mottainai/QEMU deployment option. Suits a shared authority, multiple hosts, independent writers, server backup/replication, and service-grade transaction/concurrency operations. Evidence remains in CAS/object storage rather than being duplicated in database rows. | Adds service lifecycle, network, backup, and migration operations. QEMU/VM availability enables this option but does not by itself trigger migration. It is introduced behind the same domain persistence contract. |
| **C. JSONL / Parquet / Arrow and similar exports**                | Downstream analytical/evaluation projections, bulk interchange, benchmarks, and offline reports. They may be generated from versioned evidence/derived outputs and can be sharded or streamed.                                                                                 | Never the authority store, claim/admission path, or source of canonical identity. A projection can be regenerated or fail without changing authority.                                                               |

The decision distinguishes **data volume** from **deployment and concurrency**:

- Volume influences indexing, streaming, partitioning, CAS layout, and export
  strategy. It does not, by itself, mandate a server database.
- Deployment and concurrency determine whether one authority process can
  serialize writes and provide the required backup/recovery guarantees. Those
  are the migration decision inputs.

### Migration triggers

Migrate from the embedded adapter to a service DB when one or more of these
conditions is a real operational requirement, not merely a possible future:

1. Multiple hosts must concurrently mutate the same authority.
2. Multiple independent writers cannot be serialized through one Wabachi
   authority process.
3. The authority is becoming a long-lived shared service rather than
   repository-local state.
4. VM-backed operations materially benefit from server-database transaction,
   concurrency, backup, restore, or operational tooling.

QEMU/VM availability alone is not a migration trigger. Neither is a large
artifact or a multi-GB repository if local serialization, backup, and recovery
remain adequate.

Migration preserves domain meaning and IDs:

1. Freeze or serialize authority mutations and record the source watermark.
2. Install the PostgreSQL-class adapter implementing the same domain boundary.
3. Copy logical rows, event order, IDs, schema versions, foreign-key
   references, and stage/checkpoint state; do not reinterpret provider or
   canonical identity. Each audit record includes an immutable, monotonic
   ordering field (or equivalent transaction-and-causation chain) to preserve
   event order across adapters.
4. Move or retain CAS objects by digest and verify object digests, row counts,
   unique constraints, references, and audit ordering. Use the audit record
   ordering for source watermarks, replay, and reconciliation instead of
   timestamps or physical row order.
5. Run a reconciliation from the source watermark, cut over writes, and keep
   the embedded snapshot as a recoverable read-only backup until the migration
   is accepted.

The CAS/object layer may migrate independently of the SQL adapter because
references are content identities. PostgreSQL-specific features can be added
later behind a deliberate schema/adapter migration once service deployment is
real; portability is not intended to constrain the mature product forever.

## Portable persistence boundary

The domain exposes a narrow authority persistence boundary, implemented first
by the embedded adapter and later by a PostgreSQL adapter. Its operations are
domain-shaped rather than table-shaped, for example:

- begin an explicit transaction and record a run/stage attempt;
- append immutable evidence metadata and resolve evidence references;
- read/write versioned observations, revision-local entities, ambiguity sets,
  facts, findings, and evaluation projections;
- append proposed-claim and canonical-mutation/review events;
- read canonical declarations and freshness/conformance history; and
- save/resume checkpoints and query deterministic, ordered slices.

The boundary must preserve these semantics on every initial adapter:

- explicit transaction boundaries and atomic multi-record mutations;
- foreign-key/reference integrity;
- unique constraints for domain keys and idempotency keys;
- deterministic ordered queries wherever order affects output or resume;
- durable stage/checkpoint state;
- append-only/audit semantics for canonical mutations and review events,
  requiring an expected prior declaration version or compare-and-set
  precondition for concurrent canonical mutations (when the precondition fails,
  the mutation is rejected and the caller must retry with current state); the
  canonical-head update and corresponding audit event succeed atomically
  without depending on backend-specific locking; and
- ordinary SQL joins and indexed lookups for the core query paths.

The initial core schema deliberately forbids making domain meaning depend on
backend-specific features, including:

- PostgreSQL `JSONB`, arrays, enums, extensions, advisory locks, `LISTEN`/
  `NOTIFY`, or server-specific full-text/search behavior;
- engine-specific row IDs or physical row order;
- provider payloads stored in database-specific large-object/BLOB facilities;
- stored procedures, triggers, or vendor-specific generated columns as the
  only enforcement of domain invariants;
- vendor-specific isolation/locking behavior or a dialect-specific upsert as
  the only way to achieve correctness; and
- database-specific materialized views or query syntax as the required read
  path for the authority.

Portable scalar columns, application-assigned IDs, validated text metadata,
normal indexes, foreign keys, and ordinary joins are sufficient for the first
core. Adapter-specific optimizations may exist outside the contract. When a
real PostgreSQL service justifies them, capabilities such as JSONB indexing,
partitioning, notifications, row-level security, or materialized views may be
introduced in a deliberate migration with a portable fallback for domain
meaning.

## v1 compatibility and migration boundary

The current Provider Matrix v0/v1 artifacts remain usable as **read-only
compatibility inputs and Evaluation Lab projections**. A future importer may:

1. register the run, repository commit, provider versions, and artifact
   manifests;
2. place raw provider artifacts in the CAS and retain their digests;
3. map observations/facts to evidence references while preserving schema
   versions and source locations;
4. map current correlation output to revision-local instances and ambiguity
   sets; and
5. regenerate Matrix/report projections from those references.

The importer must not treat a Matrix row or a current correlation `canonicalId`
as an admitted canonical declaration. Any promotion requires a separate
claim, review, and admission event.

The following v1 behavior is explicitly outside the long-term compatibility
contract:

- self-contained giant JSON artifacts, whole-dataset materialization, and
  mandatory inline repetition of provider-native payloads;
- provider-member-derived or run-local correlation IDs used as
  cross-revision canonical IDs; and
- the monolithic provider -> normalize -> correlate -> Matrix workflow as the
  only execution model.

PR #23's reference projections and streaming reader are compatible scale
improvements for the evaluation artifact path, not a promise that the v1
artifact schema is the v2 authority schema. Existing artifacts are retained
according to their run/retention policy and imported through a versioned
adapter; they are not silently rewritten in place.

## Follow-up implementation leaves

The implementation should proceed in this dependency order. Each item is an
independently reviewable Issue/PR-sized leaf; no item below is part of this ADR
itself.

1. **Evidence catalog and CAS adapter** — define evidence references,
   immutable artifact retention, digest verification, and the v1 artifact
   importer boundary.
2. **Domain persistence contract and embedded adapter** — implement the
   narrow transaction, reference-integrity, ordered-query, and append/audit
   semantics over a SQLite-class store; depends on 1.
3. **Run/stage/checkpoint model** — split provider execution and normalization
   into versioned resumable stages with explicit incomplete/failed outcomes;
   depends on 2.
4. **Revision-local entity and ambiguity model** — persist provider-native
   links, revision-local instances, candidate sets, and auditable resolution
   inputs; depends on 1–3.
5. **Derived facts and semantic findings** — move normalization/finding
   outputs behind evidence references and stage completeness; depends on 1–4.
6. **Claims, review, admission, and canonical declarations** — add explicit
   proposal/admission paths and append-only semantic mutation records; depends
   on 2, 4, and 5.
7. **Freshness and conformance** — compare canonical declarations with later
   evidence without mutating them; depends on 3, 5, and 6.
8. **Provider Evaluation Lab projection** — migrate Matrix/benchmark/coverage
   generation to consume versioned derived state, preserve incomplete status,
   and keep projection failure isolated; depends on 3–5.
9. **Analytical/export projections** — add streamed JSONL/Parquet/Arrow exports
   for Lab and offline analysis; depends on 8.
10. **Continuity resolution** — define and implement cross-revision continuity
    algorithms under the identity contract, including review of ambiguous
    cases; depends on 4 and 6. The algorithm is intentionally not selected
    here.
11. **PostgreSQL-class adapter and VM deployment** — implement migration,
    backup, and service operations only when the migration triggers are met;
    depends on 2 and the operational decision, not on QEMU availability alone.

## Non-goals

This ADR does not:

- implement SQLite, PostgreSQL, CAS, QEMU, or any migration tooling;
- repair or rerun Provider Matrix v0;
- finalize the semantic claim vocabulary;
- choose or implement a cross-revision continuity algorithm;
- build a generic multi-database abstraction or ORM; or
- make Mottainai/VM integration an immediate product requirement.

## Acceptance criteria mapping

| Issue #24 criterion                                                                           | Contract location                                                                                                              |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Matrix is evaluation tooling, not canonical product data                                      | [Authority and processing paths](#authority-and-processing-paths)                                                              |
| Distinct evidence, derived state, claims, and canonical mutation rules                        | [Logical data classes and mutation rules](#logical-data-classes-and-mutation-rules)                                            |
| Regeneration cannot overwrite canonical declarations                                          | [Logical data classes and mutation rules](#logical-data-classes-and-mutation-rules)                                            |
| Evidence is referenced, immutable, and not mandatorily duplicated inline                      | [Provenance and reference contract](#provenance-and-reference-contract)                                                        |
| Revision-local and cross-revision identity are distinct                                       | [Identity contract](#identity-contract)                                                                                        |
| Canonical identity is independent of provider membership                                      | [Identity contract](#identity-contract)                                                                                        |
| Ambiguity and incomplete processing are first-class                                           | [Identity contract](#identity-contract), [Completeness, stages, and resume contract](#completeness-stages-and-resume-contract) |
| Embedded SQL, VM PostgreSQL-class DB, CAS/object storage, and analytical formats are compared | [Storage decision and evolution path](#storage-decision-and-evolution-path)                                                    |
| Concrete embedded-to-service migration triggers are defined                                   | [Migration triggers](#migration-triggers)                                                                                      |
| QEMU is an enabling future option, not an immediate PostgreSQL requirement                    | [Storage decision and evolution path](#storage-decision-and-evolution-path)                                                    |
| Narrow domain persistence boundary without a generic ORM                                      | [Portable persistence boundary](#portable-persistence-boundary)                                                                |
| Portable initial SQL semantics preserve later domain meaning                                  | [Portable persistence boundary](#portable-persistence-boundary)                                                                |
| Giant v1 JSON and provider-member-derived canonical IDs are outside the long-term contract    | [v1 compatibility and migration boundary](#v1-compatibility-and-migration-boundary)                                            |
| Follow-up leaves are dependency-ordered                                                       | [Follow-up implementation leaves](#follow-up-implementation-leaves)                                                            |
