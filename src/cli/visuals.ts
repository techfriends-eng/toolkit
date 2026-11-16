#!/usr/bin/env node
/**
 * toolkit-visuals — CLI над `@techfriends-eng/toolkit/visuals` для bash-проектов (wiki_visualizer):
 * Mermaid → PNG/JPG тем же кодом, что у спутников (bds-content ADR 0001, п. 4c).
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runVisualsCli } from "./visuals-run.ts";

process.exitCode = await runVisualsCli({
  argv: process.argv.slice(2),
  readFile: (p) => readFile(p, "utf8"),
  err: (s) => process.stderr.write(s),
  parseArgs,
  size: (p) => {
    const r = spawnSync("identify", ["-format", "%w %h", p], { encoding: "utf8" });
    const [w, h] = (r.stdout ?? "").split(" ").map(Number);
    return r.status === 0 && w > 0 && h > 0 ? { w, h } : null;
  },
});
