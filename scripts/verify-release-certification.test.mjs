import assert from "node:assert/strict";
import { test } from "node:test";
import { hasSuccessfulDogfoodRun } from "./verify-release-certification.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";

test("accepts only a successful architecture dogfood run for the exact release source", () => {
  assert.equal(
    hasSuccessfulDogfoodRun(
      {
        workflow_runs: [
          {
            name: "Architecture dogfood certification",
            head_sha: sha,
            status: "completed",
            conclusion: "success",
          },
        ],
      },
      sha,
    ),
    true,
  );

  assert.equal(
    hasSuccessfulDogfoodRun(
      {
        workflow_runs: [
          {
            name: "Architecture dogfood certification",
            head_sha: "fedcba9876543210fedcba9876543210fedcba98",
            status: "completed",
            conclusion: "success",
          },
          {
            name: "Architecture dogfood certification",
            head_sha: sha,
            status: "completed",
            conclusion: "failure",
          },
        ],
      },
      sha,
    ),
    false,
  );
});
