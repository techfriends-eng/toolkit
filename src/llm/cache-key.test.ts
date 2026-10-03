import assert from "node:assert/strict";
import test from "node:test";
import { buildCacheKey, fingerprint } from "./cache-key.ts";

const base = {
  kind: "post",
  model: "grok-4.3",
  system: "stable system",
  articleId: "a1",
  body: "ClickHouse release notes about Keeper.",
};

test("whitespace in body does not change key", () => {
  const a = buildCacheKey(base);
  const b = buildCacheKey({ ...base, body: "  ClickHouse   release notes about Keeper. \n" });
  assert.equal(a, b);
});

test("same article different wrapper-only fields stay same via body fingerprint", () => {
  assert.equal(fingerprint("hello  world"), fingerprint("hello world"));
});

test("body change busts key", () => {
  const a = buildCacheKey(base);
  const b = buildCacheKey({ ...base, body: "ClickHouse Cloud autoscaling" });
  assert.notEqual(a, b);
});

test("kind and model are part of key", () => {
  const post = buildCacheKey(base);
  const article = buildCacheKey({ ...base, kind: "article" });
  const model = buildCacheKey({ ...base, model: "grok-4.5" });
  assert.notEqual(post, article);
  assert.notEqual(post, model);
});

test("LLM_PROMPT_VERSION busts keys", () => {
  const before = buildCacheKey(base);
  process.env.LLM_PROMPT_VERSION = "v2";
  const after = buildCacheKey(base);
  delete process.env.LLM_PROMPT_VERSION;
  assert.notEqual(before, after);
});
