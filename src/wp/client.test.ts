import assert from "node:assert/strict";
import { test } from "node:test";
import { createWp, WpError } from "./client.ts";

const creds = { username: "u", appPassword: "aaaa bbbb" };

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let n = 0;
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[n++] ?? { status: 200, body: [] };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("findEntry ищет в любом статусе с авторизацией и в заданном типе записи", async () => {
  const f = fakeFetch([{ status: 200, body: [{ id: 7, link: "L", slug: "s", status: "draft" }] }]);
  const wp = createWp({
    baseUrl: "https://site.example/",
    postType: "encyclopedia",
    fetch: f.impl,
  });
  const entry = await wp.findEntry("my slug", creds);
  assert.deepEqual(entry, { id: 7, link: "L", slug: "s", status: "draft" });
  assert.match(
    f.calls[0].url,
    /^https:\/\/site\.example\/wp-json\/wp\/v2\/encyclopedia\?slug=my%20slug&status=any&context=edit/,
  );
  const auth = (f.calls[0].init.headers as Record<string, string>).Authorization;
  assert.equal(auth, `Basic ${Buffer.from("u:aaaa bbbb").toString("base64")}`);
});

test("findEntry: пустой ответ — null", async () => {
  const f = fakeFetch([{ status: 200, body: [] }]);
  assert.equal(await createWp({ baseUrl: "https://x", fetch: f.impl }).findEntry("s", creds), null);
});

test("createEntry: categories и meta только если заданы; ошибка — WpError со статусом", async () => {
  const f = fakeFetch([
    { status: 201, body: { id: 1, link: "L", slug: "s", status: "draft" } },
    { status: 403, body: { code: "rest_forbidden" } },
  ]);
  const wp = createWp({ baseUrl: "https://x", fetch: f.impl });
  await wp.createEntry({ title: "T", slug: "s", contentHtml: "<p>x</p>", status: "draft" }, creds);
  const payload = JSON.parse(String(f.calls[0].init.body));
  assert.equal("categories" in payload, false);
  assert.equal("meta" in payload, false);
  await assert.rejects(
    wp.createEntry({ title: "T", slug: "s", contentHtml: "", status: "draft" }, creds),
    (e: unknown) => e instanceof WpError && e.status === 403,
  );
});

test("publishEntry: статус не сменился — ошибка, а не тихий успех", async () => {
  const f = fakeFetch([{ status: 200, body: { id: 1, link: "L", slug: "s", status: "draft" } }]);
  await assert.rejects(
    createWp({ baseUrl: "https://x", fetch: f.impl }).publishEntry(1, creds),
    /статус не сменился/,
  );
});

test("lookupPublished ходит без авторизации", async () => {
  const f = fakeFetch([{ status: 200, body: [] }]);
  await createWp({ baseUrl: "https://x", fetch: f.impl }).lookupPublished("s");
  assert.equal("Authorization" in (f.calls[0].init.headers as Record<string, string>), false);
});
