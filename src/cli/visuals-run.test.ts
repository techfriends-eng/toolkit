import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseArgs } from "node:util";
import { runVisualsCli } from "./visuals-run.ts";

function harness(
  argv: string[],
  files: Record<string, string>,
  size: { w: number; h: number } | null = null,
) {
  const cmds: { dir: string; cmd: string }[] = [];
  const err: string[] = [];
  const io = {
    argv,
    readFile: async (p: string) => {
      if (!(p in files)) throw new Error(`нет файла ${p}`);
      return files[p];
    },
    err: (s: string) => void err.push(s),
    parseArgs,
    runner: (dir: string) => (cmd: string) => {
      cmds.push({ dir, cmd });
      return { rc: 0, out: "" };
    },
    size: () => size,
  };
  return { io, cmds, err };
}

const files = { "/c.json": '{"theme":"base"}', "/d.mmd": "flowchart TD\n  a-->b\n" };

test("render: PNG без -quality и exiftool, ширина холста, каталог результата", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vcli-"));
  const out = join(dir, "draft.png");
  const h = harness(
    [
      "render",
      "--in",
      "/d.mmd",
      "--out",
      out,
      "--background",
      "#F5F7FA",
      "--config",
      "/c.json",
      "--puppeteer",
      "/app/config/puppeteer-config.json",
      "--width",
      "1800",
      "--no-strip",
    ],
    files,
    { w: 1200, h: 500 },
  );
  assert.equal(await runVisualsCli(h.io), 0);
  assert.equal(h.cmds[0].dir, dir);
  const c = h.cmds[0].cmd;
  assert.match(
    c,
    /mmdc -i draft\.png\.mmd -o draft\.png\.png -b '#F5F7FA' -p \/app\/config\/puppeteer-config\.json -c draft\.png\.mermaid\.json -s 3 -w 1800/,
  );
  assert.match(c, /-resize '1200x800>' draft\.png && rm -f draft\.png\.png$/);
  assert.doesNotMatch(c, /exiftool|-quality/);
  assert.match(c, /draft\.png\.lr\.mmd/);
  assert.equal(h.err.join(""), "");
});

test("render: схема осталась выше, чем шире, — предупреждение R5 в stderr, код 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vcli-"));
  const h = harness(
    [
      "render",
      "--in",
      "/d.mmd",
      "--out",
      join(dir, "x.jpg"),
      "--background",
      "#FFFFFF",
      "--config",
      "/c.json",
      "--puppeteer",
      "/p.json",
    ],
    files,
    { w: 400, h: 900 },
  );
  assert.equal(await runVisualsCli(h.io), 0);
  assert.match(h.err.join(""), /R5 — схема выше, чем шире/);
  assert.match(h.cmds[0].cmd, /-quality 95 x\.jpg && exiftool/);
});

test("render: ошибки аргументов — код 2, сбой рендера — код 1", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vcli-"));
  const base = [
    "render",
    "--in",
    "/d.mmd",
    "--out",
    join(dir, "x.png"),
    "--config",
    "/c.json",
    "--puppeteer",
    "/p.json",
  ];
  assert.equal(await runVisualsCli(harness([...base, "--background", "white"], files).io), 2);
  assert.equal(
    await runVisualsCli(
      harness([...base, "--background", "#FFFFFF", "--config", "/nope"], files).io,
    ),
    2,
  );
  assert.equal(await runVisualsCli(harness(["draw"], files).io), 2);
  const bad = harness([...base, "--background", "#FFFFFF"], files);
  bad.io.runner = () => () => ({ rc: 1, out: "Parse error on line 2" });
  assert.equal(await runVisualsCli(bad.io), 1);
  assert.match(bad.err.join(""), /Parse error on line 2/);
  writeFileSync(join(dir, "keep"), "");
});
