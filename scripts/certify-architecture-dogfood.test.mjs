import assert from "node:assert/strict";
import test from "node:test";
import {
  STRUCTURIZR_IMAGE_DIGEST,
  STRUCTURIZR_IMAGE_IDENTITY,
  STRUCTURIZR_VERSION,
  dockerShimInvocation,
} from "./certify-architecture-dogfood.mjs";

test("pins the official Structurizr vNext image and keeps the shim argv-bounded", () => {
  assert.equal(STRUCTURIZR_VERSION, "2026.06.28");
  assert.match(STRUCTURIZR_IMAGE_DIGEST, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(STRUCTURIZR_IMAGE_IDENTITY, `structurizr/structurizr@${STRUCTURIZR_IMAGE_DIGEST}`);

  const invocation = dockerShimInvocation("/tmp/certification root", [
    "export",
    "-workspace",
    "/tmp/certification root/workspace.dsl",
    "-output",
    "/tmp/certification root/diagrams",
  ]);

  assert.equal(invocation.executable, "docker");
  assert.equal(invocation.shell, false);
  assert.equal(invocation.args.at(-1), "/usr/local/structurizr/diagrams");
  assert.equal(invocation.args.includes("/usr/local/structurizr/workspace.dsl"), true);
  assert.equal(invocation.args.includes(STRUCTURIZR_IMAGE_IDENTITY), true);
});
