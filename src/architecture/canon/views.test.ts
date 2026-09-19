import assert from "node:assert/strict";
import test from "node:test";

import { createDeploymentView, createDynamicView, createStructuralView, normalizeViews } from "./views.js";

test("normalizes structural, dynamic, and deployment views without resolving Canon references", () => {
  const views = normalizeViews([
    {
      key: "deployment",
      kind: "deployment",
      order: 2,
      scope: {
        include: [
          { kind: "deployment-node", id: "node-b" },
          { kind: "element", id: "service-b" },
        ],
      },
    },
    {
      key: "context",
      kind: "structural",
      order: 1,
      scope: {
        include: [
          { kind: "relationship", id: "relationship-b" },
          { kind: "element", id: "service-b" },
        ],
        exclude: [{ kind: "element", id: "service-c" }],
      },
      title: "  Context view  ",
      description: "  Context description  ",
      root: { kind: "element", id: "service-b" },
      presentation: { direction: " left-to-right " },
    },
    {
      key: "flow",
      kind: "dynamic",
      scope: { include: [{ kind: "flow", id: "checkout-flow" }] },
    },
  ]);

  assert.deepEqual(
    views.map(({ key, kind, order }) => ({ key, kind, order })),
    [
      { key: "context", kind: "structural", order: 1 },
      { key: "deployment", kind: "deployment", order: 2 },
      { key: "flow", kind: "dynamic", order: undefined },
    ],
  );
  const context = views.find((view) => view.key === "context");
  assert.deepEqual(context?.scope.include, [
    { kind: "element", id: "service-b" },
    { kind: "relationship", id: "relationship-b" },
  ]);
  assert.equal(context?.title, "Context view");
  assert.equal(context?.description, "Context description");
  assert.deepEqual(context?.root, { kind: "element", id: "service-b" });
  assert.deepEqual(context?.presentation, { direction: "left-to-right" });
  assert.equal(views.find((view) => view.key === "flow")?.scope.include[0]?.id, "checkout-flow");
  assert.equal(Object.isFrozen(views), true);
  assert.equal(Object.isFrozen(context?.scope), true);
});

test("specialized constructors preserve the projection kind", () => {
  assert.equal(createStructuralView({ key: "structure", kind: "structural", scope: {} }).kind, "structural");
  assert.equal(createDynamicView({ key: "sequence", kind: "dynamic", scope: {} }).kind, "dynamic");
  assert.equal(createDeploymentView({ key: "runtime", kind: "deployment", scope: {} }).kind, "deployment");
});

test("rejects contradictory and duplicate scope declarations locally", () => {
  assert.throws(
    () =>
      createStructuralView({
        key: "context",
        kind: "structural",
        scope: {
          include: [{ kind: "element", id: "service" }],
          exclude: [{ kind: "element", id: "service" }],
        },
      }),
    /both included and excluded/,
  );

  assert.throws(
    () =>
      createStructuralView({
        key: "context",
        kind: "structural",
        scope: {
          include: [
            { kind: "element", id: "service" },
            { kind: "element", id: "service" },
          ],
        },
      }),
    /duplicate view include reference/,
  );

  assert.throws(
    () =>
      normalizeViews([
        { key: "context", kind: "structural", scope: {} },
        { key: "context", kind: "dynamic", scope: {} },
      ]),
    /duplicate view key/,
  );
});

test("normalizes equivalent identity and hint spellings deterministically", () => {
  const first = normalizeViews([
    {
      key: "e\u0301-view",
      kind: "structural",
      scope: {
        include: [{ kind: "element", id: "e\u0301lement" }],
      },
      root: { kind: "element", id: "e\u0301lement" },
      description: "  description  ",
      presentation: { layout: "  hierarchical  " },
    },
  ]);
  const second = normalizeViews([
    {
      key: "é-view",
      kind: "structural",
      scope: {
        include: [{ kind: "element", id: "élement" }],
      },
      root: { kind: "element", id: "élement" },
      description: "description",
      presentation: { layout: "hierarchical" },
    },
  ]);

  assert.deepEqual(first, second);
});
