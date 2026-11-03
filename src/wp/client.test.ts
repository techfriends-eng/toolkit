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

test("updateEntry: обложка ставится, только если задана", async () => {
  const entry = { id: 1, link: "L", slug: "s", status: "draft" };
  const f = fakeFetch([
    { status: 200, body: entry },
    { status: 200, body: entry },
  ]);
  const wp = createWp({ baseUrl: "https://x", fetch: f.impl });
  await wp.updateEntry(1, { title: "T", contentHtml: "<p>x</p>", featuredMedia: 42 }, creds);
  await wp.updateEntry(1, { title: "T", contentHtml: "<p>x</p>" }, creds);
  assert.equal(JSON.parse(String(f.calls[0].init.body)).featured_media, 42);
  assert.equal("featured_media" in JSON.parse(String(f.calls[1].init.body)), false);
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

test("ensureTags: находит метку без учёта регистра, создаёт недостающую, term_exists — тоже id", async () => {
  const f = fakeFetch([
    {
      status: 200,
      body: [
        { id: 7, name: "Apache Kafka" },
        { id: 8, name: "Kafka &amp; KRaft" },
      ],
    },
    { status: 200, body: [] },
    { status: 201, body: { id: 9, name: "KRaft" } },
    { status: 200, body: [] },
    { status: 400, body: { code: "term_exists", data: { term_id: 11 } } },
  ]);
  const wp = createWp({ baseUrl: "https://x", fetch: f.impl });
  const ids = await wp.ensureTags(["apache kafka", "KRaft", " ", "kraft", "Raft"], creds);
  assert.deepEqual(ids, [7, 9, 11]);
  assert.match(f.calls[0].url, /\/wp-json\/wp\/v2\/tags\?search=apache%20kafka/);
  assert.equal(f.calls[2].init.method, "POST");
  assert.deepEqual(JSON.parse(String(f.calls[2].init.body)), { name: "KRaft" });
});

test("tags в createEntry и updateEntry только если заданы", async () => {
  const f = fakeFetch([
    { status: 201, body: { id: 1, link: "L", slug: "s", status: "draft" } },
    { status: 200, body: { id: 1, link: "L", slug: "s", status: "draft" } },
  ]);
  const wp = createWp({ baseUrl: "https://x", fetch: f.impl });
  await wp.createEntry(
    { title: "T", slug: "s", contentHtml: "", status: "draft", tags: [3, 4] },
    creds,
  );
  await wp.updateEntry(1, { title: "T", contentHtml: "" }, creds);
  assert.deepEqual(JSON.parse(String(f.calls[0].init.body)).tags, [3, 4]);
  assert.equal("tags" in JSON.parse(String(f.calls[1].init.body)), false);
});

test("restMetaKeys: ключи meta из схемы OPTIONS без авторизации", async () => {
  const f = fakeFetch([
    {
      status: 200,
      body: {
        schema: { properties: { meta: { properties: { _yoast_wpseo_title: {}, footnotes: {} } } } },
      },
    },
  ]);
  const wp = createWp({ baseUrl: "https://x", fetch: f.impl });
  assert.deepEqual(await wp.restMetaKeys(), ["_yoast_wpseo_title", "footnotes"]);
  assert.equal(f.calls[0].init.method, "OPTIONS");
  assert.equal("Authorization" in (f.calls[0].init.headers as Record<string, string>), false);
});
