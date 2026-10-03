import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readSecret } from "./secret.ts";

test("значение из переменной важнее файла, хвостовые пробелы срезаются", () => {
  assert.equal(readSecret("TOKEN", { TOKEN: "abc \n", TOKEN_FILE: "/nope" }), "abc");
});

test("значение из файла NAME_FILE", () => {
  const dir = mkdtempSync(join(tmpdir(), "secret-"));
  const file = join(dir, "token");
  writeFileSync(file, "from-file\n");
  assert.equal(readSecret("TOKEN", { TOKEN_FILE: file }), "from-file");
});

test("нет ни переменной, ни файла — пустая строка", () => {
  assert.equal(readSecret("TOKEN", {}), "");
});
