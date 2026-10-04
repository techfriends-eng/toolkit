import assert from "node:assert/strict";
import { test } from "node:test";
import { createChat, type ChatCache } from "./chat.ts";

const req = { model: "m", system: "s", user: "u", maxTokens: 10 };

function fakeFetch(steps: (number | "throw" | string)[]) {
  let n = 0;
  const calls: RequestInit[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    calls.push(init);
    const step = steps[n++];
    if (step === "throw") throw new Error("ECONNRESET");
    if (typeof step === "number") return new Response("{}", { status: step });
    return new Response(JSON.stringify({ choices: [{ message: { content: step } }] }));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const quiet = { log: () => {}, sleep: async () => {} };

test("429 и 5xx повторяются, затем ответ", async () => {
  const f = fakeFetch([429, 503, "ok"]);
  const chat = createChat({ baseUrl: "https://x/v1/", apiKey: "k", fetch: f.impl, ...quiet });
  assert.equal(await chat.complete(req), "ok");
  assert.equal(f.calls.length, 3);
});

test("сетевой сбой повторяется", async () => {
  const f = fakeFetch(["throw", "ok"]);
  assert.equal(
    await createChat({ baseUrl: "https://x", apiKey: "k", fetch: f.impl, ...quiet }).complete(req),
    "ok",
  );
});

test("400 не повторяется, отказ — null", async () => {
  const f = fakeFetch([400, "ok"]);
  assert.equal(
    await createChat({ baseUrl: "https://x", apiKey: "k", fetch: f.impl, ...quiet }).complete(req),
    null,
  );
  assert.equal(f.calls.length, 1);
});

test("попытки кончились — null; паузы нарастают", async () => {
  const pauses: number[] = [];
  const f = fakeFetch([500, 500, 500]);
  const chat = createChat({
    baseUrl: "https://x",
    apiKey: "k",
    fetch: f.impl,
    backoffMs: 100,
    log: () => {},
    sleep: async (ms) => {
      pauses.push(ms);
    },
  });
  assert.equal(await chat.complete(req), null);
  assert.deepEqual(pauses, [100, 200]);
});

test("кэш: попадание без сети, промах пишется после ответа, сбой кэша не роняет вызов", async () => {
  const store = new Map<string, string>([["hit", "from-cache"]]);
  const cache: ChatCache = {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => void store.set(k, v),
  };
  const f = fakeFetch(["fresh"]);
  const chat = createChat({ baseUrl: "https://x", apiKey: "k", fetch: f.impl, cache, ...quiet });
  assert.equal(await chat.complete({ ...req, cacheKey: "hit" }), "from-cache");
  assert.equal(f.calls.length, 0);
  assert.equal(await chat.complete({ ...req, cacheKey: "miss" }), "fresh");
  assert.equal(store.get("miss"), "fresh");

  const broken: ChatCache = {
    get: async () => {
      throw new Error("db down");
    },
    set: async () => {
      throw new Error("db down");
    },
  };
  const f2 = fakeFetch(["ok"]);
  assert.equal(
    await createChat({
      baseUrl: "https://x",
      apiKey: "k",
      fetch: f2.impl,
      cache: broken,
      ...quiet,
    }).complete({ ...req, cacheKey: "k" }),
    "ok",
  );
});

test("без ключа — null без запроса", async () => {
  const f = fakeFetch(["ok"]);
  assert.equal(
    await createChat({ baseUrl: "https://x", apiKey: "", fetch: f.impl, ...quiet }).complete(req),
    null,
  );
  assert.equal(f.calls.length, 0);
});
