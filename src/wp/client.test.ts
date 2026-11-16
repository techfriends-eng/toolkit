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

test("publishEntry с dateGmt: шлёт date_gmt и принимает future", async () => {
  const f = fakeFetch([{ status: 200, body: { id: 5, link: "L", slug: "s", status: "future" } }]);
  const wp = createWp({ baseUrl: "https://x", postType: "encyclopedia", fetch: f.impl });
  const e = await wp.publishEntry(5, creds, { dateGmt: "2030-01-01T09:00:00" });
  assert.equal(e.status, "future");
  assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), {
    status: "publish",
    date_gmt: "2030-01-01T09:00:00",
  });
});

test("publishEntry без даты: future — ошибка, а не тихий успех", async () => {
  const f = fakeFetch([{ status: 200, body: { id: 5, link: "L", slug: "s", status: "future" } }]);
  const wp = createWp({ baseUrl: "https://x", fetch: f.impl });
  await assert.rejects(wp.publishEntry(5, creds), WpError);
});

test("entryDates: постранично, пока страница полная", async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ date_gmt: `d${i}` }));
  const f = fakeFetch([
    { status: 200, body: full },
    { status: 200, body: [{ date_gmt: "last" }] },
  ]);
  const wp = createWp({ baseUrl: "https://x", postType: "encyclopedia", fetch: f.impl });
  const ds = await wp.entryDates("2026-11-01T00:00:00", creds);
  assert.equal(ds.length, 101);
  assert.equal(ds[100], "last");
  assert.match(
    f.calls[0].url,
    /encyclopedia\?status=publish,future&context=edit&per_page=100&page=1&after=2026-11-01T00%3A00%3A00/,
  );
  assert.match(f.calls[1].url, /page=2/);
});

test("entryDates: ответ не массив — WpError", async () => {
  const f = fakeFetch([{ status: 400, body: { code: "rest_invalid_param" } }]);
  await assert.rejects(
    createWp({ baseUrl: "https://x", fetch: f.impl }).entryDates("a", creds),
    WpError,
  );
});

test("matchCategories: корневая первой, подрубрики по слову в тексте и шаблону ссылки", async () => {
  const f = fakeFetch([
    {
      status: 200,
      body: [
        { id: 1, name: "Статьи", link: "https://x/blog/news/" },
        { id: 10, name: "Kafka", link: "https://x/blog/news/kafka/" },
        { id: 11, name: "Spark", link: "https://x/blog/news/spark/" },
        { id: 12, name: "Kafka", link: "https://x/other/kafka/" },
        { id: 13, name: "Flink", link: "https://x/blog/news/flink/" },
      ],
    },
  ]);
  const wp = createWp({ baseUrl: "https://x", fetch: f.impl });
  const ids = await wp.matchCategories("Kafka Streams и Apache-Spark, sparkle", {
    rootId: 1,
    linkPattern: /\/blog\/news\/.+/,
  });
  assert.deepEqual(ids, [1, 10, 11]);
  assert.equal("Authorization" in (f.calls[0].init.headers as Record<string, string>), false);
});

test("matchCategories: сбой сети — только корневая", async () => {
  const impl = (async () => {
    throw new Error("down");
  }) as unknown as typeof fetch;
  const ids = await createWp({ baseUrl: "https://x", fetch: impl }).matchCategories("Kafka", {
    rootId: 1,
    linkPattern: /./,
  });
  assert.deepEqual(ids, [1]);
});
