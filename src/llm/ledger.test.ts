import assert from "node:assert/strict";
import { test } from "node:test";
import { createLedger } from "./ledger.ts";

test("record: строка с проектом, этапом, токенами и $; ref приводится к строке", async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const ledger = createLedger({
    project: "bds-satellites",
    query: async (sql, params) => void calls.push({ sql, params }),
  });
  await ledger.record({
    stage: "write",
    model: "anthropic/claude-sonnet-5.5",
    provider: "openrouter",
    site: "kafka",
    ref: 42,
    usage: { promptTokens: 1000, completionTokens: 2000, reasoningTokens: 300, costUsd: 0.0421 },
    modelsVersion: "0.1.0",
  });
  assert.match(calls[0].sql, /insert into llm\.calls/);
  assert.deepEqual(calls[0].params, [
    "bds-satellites",
    "write",
    "anthropic/claude-sonnet-5.5",
    "openrouter",
    "kafka",
    "42",
    1000,
    2000,
    300,
    0.0421,
    false,
    true,
    "0.1.0",
  ]);
});

test("record: кэш — cost 0 и cached; не годен — ok false; пустые поля — null", async () => {
  const params: unknown[][] = [];
  const ledger = createLedger({
    project: "stack-radar",
    query: async (_s, p) => void params.push(p),
  });
  await ledger.record({ stage: "post", model: "grok-4.3", cached: true, usage: { costUsd: 0.5 } });
  await ledger.record({ stage: "image", model: "g", ok: false, usage: { costUsd: 0.12 } });
  assert.deepEqual(params[0], [
    "stack-radar",
    "post",
    "grok-4.3",
    null,
    null,
    null,
    null,
    null,
    null,
    0,
    true,
    true,
    null,
  ]);
  assert.equal(params[1][9], 0.12);
  assert.equal(params[1][11], false);
});

test("record: без query журнал выключен; сбой базы — предупреждение, не исключение", async () => {
  await createLedger({ project: "x" }).record({ stage: "s", model: "m" });
  const warns: string[] = [];
  const ledger = createLedger({
    project: "wiki_visualizer",
    query: async () => {
      throw new Error("connection refused");
    },
    warn: (m) => void warns.push(m),
  });
  await ledger.record({ stage: "prompt_refine", model: "deepseek/deepseek-chat" });
  assert.deepEqual(warns, [
    "[llm-ledger] wiki_visualizer/prompt_refine: запись не удалась: connection refused",
  ]);
});
