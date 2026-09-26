import * as z from "zod";
import { defineCommands, defineGroups, flag, option, positional } from "@yohn-jp/cli-canon";
import { wabachiCommandResult } from "./result.js";

const changeId = z
  .string()
  .min(1)
  .refine((value) => !/[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}]/u.test(value))
  .transform((value) => value.normalize("NFC"));
const designSection = z.enum([
  "elements",
  "interfaces",
  "relationships",
  "responsibilities",
  "authority",
  "boundaries",
  "constraints",
  "flows",
  "deployment",
  "repositoryMappings",
  "decisions",
  "views",
  "codeIntent",
]);

const designInput = {
  changeId: positional(changeId, { required: false, metavar: "change-id" }),
  changeIdOption: option("--change-id", changeId, { placement: "anywhere" }),
} as const;

const design = {
  "design.create": {
    route: ["design", "create"],
    summary: "Author and persist a Design Change draft from a target Canon.",
    examples: ["wabachi design create <change-id> <canon>"],
    input: {
      ...designInput,
      canon: positional(z.string(), { required: false, metavar: "canon" }),
      input: option("--input", z.string(), { metavar: "path" }),
    },
    result: wabachiCommandResult,
  },
  "design.show": {
    route: ["design", "show"],
    summary: "Show the current and proposed Canon for a Design Change.",
    examples: ["wabachi design show <change-id>"],
    input: { ...designInput, section: option("--section", designSection) },
    result: wabachiCommandResult,
  },
  "design.diff": {
    route: ["design", "diff"],
    summary: "Show semantic operations for a Design Change.",
    examples: ["wabachi design diff <change-id>"],
    input: { ...designInput, section: option("--section", designSection) },
    result: wabachiCommandResult,
  },
  "design.status": {
    route: ["design", "status"],
    summary: "Show lifecycle and evidence status for a Design Change.",
    examples: ["wabachi design status <change-id>"],
    input: designInput,
    result: wabachiCommandResult,
  },
  "design.validate": {
    route: ["design", "validate"],
    summary: "Validate a Design Change against its bound Canon.",
    examples: ["wabachi design validate <change-id>"],
    input: designInput,
    result: wabachiCommandResult,
  },
  "design.amend": {
    route: ["design", "amend"],
    summary: "Amend a Design Change from a target Canon.",
    examples: ["wabachi design amend <change-id> <canon>"],
    input: {
      ...designInput,
      canon: positional(z.string(), { required: false, metavar: "canon" }),
      input: option("--input", z.string(), { metavar: "path" }),
    },
    result: wabachiCommandResult,
  },
  "design.submit": {
    route: ["design", "submit"],
    summary: "Submit a Design Change for design review.",
    examples: ["wabachi design submit <change-id>"],
    input: designInput,
    result: wabachiCommandResult,
  },
  "design.review": {
    route: ["design", "review"],
    summary: "Record immutable design review evidence.",
    examples: ["wabachi design review <change-id> --input <path>"],
    input: { ...designInput, input: option("--input", z.string(), { required: true, metavar: "path" }) },
    result: wabachiCommandResult,
  },
  "design.start": {
    route: ["design", "start"],
    summary: "Start implementation after current approval.",
    examples: ["wabachi design start <change-id>"],
    input: designInput,
    result: wabachiCommandResult,
  },
  "design.link": {
    route: ["design", "link"],
    summary: "Record an exact-proposal Implementation link.",
    examples: ["wabachi design link <change-id> --input <path>"],
    input: { ...designInput, input: option("--input", z.string(), { required: true, metavar: "path" }) },
    result: wabachiCommandResult,
  },
  "design.certify": {
    route: ["design", "certify"],
    summary: "Derive production certification from admitted evidence.",
    examples: ["wabachi design certify <change-id> --input <path>"],
    input: { ...designInput, input: option("--input", z.string(), { required: true, metavar: "path" }) },
    result: wabachiCommandResult,
  },
  "design.rework": {
    route: ["design", "rework"],
    summary: "Request lifecycle rework through the review service.",
    examples: ["wabachi design rework <change-id>"],
    input: designInput,
    result: wabachiCommandResult,
  },
  "design.promote": {
    route: ["design", "promote"],
    summary: "Promote an exactly certified Design Change.",
    examples: ["wabachi design promote <change-id>"],
    input: designInput,
    result: wabachiCommandResult,
  },
  "design.recover": {
    route: ["design", "recover"],
    summary: "Recover one explicitly selected pending transaction.",
    examples: ["wabachi design recover [<change-id>]"],
    input: {
      ...designInput,
      force: flag("--force"),
    },
    result: wabachiCommandResult,
  },
  "design.render": {
    route: ["design", "render"],
    summary: "Render current and proposed Design Canons as an offline site.",
    examples: ["wabachi design render <change-id> --out <dir>"],
    input: {
      ...designInput,
      output: option("--out", z.string(), { required: true, metavar: "dir" }),
    },
    result: wabachiCommandResult,
  },
} as const;

export const wabachiCommands = defineCommands({
  "architecture.example": {
    route: ["architecture", "example"],
    summary: "Print a minimal valid Architecture Canon example for explicit authoring.",
    examples: ["wabachi architecture example"],
    input: {},
    result: wabachiCommandResult,
  },
  "architecture.validate": {
    route: ["architecture", "validate"],
    summary: "Validate the Architecture Canon at .wabachi/architecture.json or one explicit file.",
    examples: ["wabachi architecture validate", "wabachi architecture validate <file>"],
    input: { file: positional(z.string(), { required: false, metavar: "file" }) },
    result: wabachiCommandResult,
  },
  "architecture.render": {
    route: ["architecture", "render"],
    summary:
      "Render the Architecture Canon at .wabachi/architecture.json or one explicit file as a React Flow + ELK static site.",
    examples: ["wabachi architecture render --out <dir>"],
    input: {
      file: positional(z.string(), { required: false, metavar: "file" }),
      output: option("--out", z.string(), { required: true, metavar: "dir" }),
    },
    result: wabachiCommandResult,
  },
  "run.execute": {
    route: ["run"],
    summary: "Resolve a repository and execute the registered analysis providers.",
    examples: ["wabachi run <repository> --revision <ref> --out <dir>"],
    input: {
      source: positional(z.string(), { metavar: "repository" }),
      revision: option("--revision", z.string(), { metavar: "ref" }),
      output: option("--out", z.string(), { metavar: "dir" }),
    },
    result: wabachiCommandResult,
  },
  "matrix.execute": {
    route: ["matrix"],
    summary: "Run providers and retain auditable facts, correlations, matrices, and reports.",
    examples: ["wabachi matrix <repository> --revision <sha> --out <dir>"],
    input: {
      source: positional(z.string(), { required: false, metavar: "repository" }),
      revision: option("--revision", z.string(), { metavar: "sha" }),
      output: option("--out", z.string(), { required: true, metavar: "dir" }),
      config: option("--config", z.string(), { metavar: "path" }),
    },
    result: wabachiCommandResult,
  },
  ...design,
  "skill.execute": {
    route: ["skill"],
    summary: "List bounded intent-oriented Wabachi playbooks or print one named playbook.",
    examples: ["wabachi skill", "wabachi skill <scenario>"],
    input: { scenario: positional(z.string(), { required: false, metavar: "scenario" }) },
    result: wabachiCommandResult,
  },
});

export const wabachiGroups = defineGroups({
  architecture: {
    route: ["architecture"],
    summary: "Discover Architecture Canon validation, example, and rendering commands.",
  },
  design: {
    route: ["design"],
    summary: "Manage the production Design Intent lifecycle.",
  },
});
