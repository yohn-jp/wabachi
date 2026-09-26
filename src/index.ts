#!/usr/bin/env node
import { runWabachiCli } from "./cli.js";
export * from "./working-set/index.js";

runWabachiCli(process.argv.slice(2)).then((result) => {
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
});
