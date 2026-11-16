import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "node:util";
import { runWpCli } from "./wp-run.ts";

function harness(
  argv: string[],
  responses: { status: number; body: unknown }[],
  files: Record<string, string> = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  let n = 0;
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    argv,
    env: { WP_BASE_URL: "https://site.example" } as Record<string, string | undefined>,
    readFile: async (p: string) => {
      if (!(p in files)) throw new Error(`нет файла ${p}`);
      return files[p];
    },
    out: (s: string) => void out.push(s),
    err: (s: string) => void err.push(s),
    parseArgs,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses[n++] ?? { status: 200, body: [] };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as unknown as typeof fetch,
  };
  return { io, calls, out, err };
}

const credFiles = { "/u": "user\n", "/p": "aaaa bbbb\n" };
const credArgs = ["--user-file", "/u", "--pass-file", "/p"];

test("find: id и link построчно, креды из файлов без перевода строки", async () => {
  const h = harness(
    ["find", "--type", "encyclopedia", "--slug", "kafka", ...credArgs],
    [
      {
        status: 200,
        body: [{ id: 7, link: "https://site.example/wiki/kafka/", slug: "kafka", status: "draft" }],
      },
    ],
    credFiles,
  );
  assert.equal(await runWpCli(h.io), 0);
  assert.equal(h.out.join(""), "7\nhttps://site.example/wiki/kafka/\n");
  const auth = (h.calls[0].init.headers as Record<string, string>).Authorization;
  assert.equal(auth, `Basic ${Buffer.from("user:aaaa bbbb").toString("base64")}`);
  assert.match(h.calls[0].url, /\/wp-json\/wp\/v2\/encyclopedia\?slug=kafka&status=any/);
});

test("find: нет записи — код 1 и пустой вывод", async () => {
  const h = harness(
    ["find", "--type", "encyclopedia", "--slug", "x", ...credArgs],
    [{ status: 200, body: [] }],
    credFiles,
  );
  assert.equal(await runWpCli(h.io), 1);
  assert.equal(h.out.join(""), "");
});

test("create --only-accepted-meta: непринятые ключи в stderr, в запросе только принятые, всегда draft", async () => {
  const h = harness(
    [
      "create",
      "--type",
      "encyclopedia",
      "--title",
      "Kafka",
      "--slug",
      "kafka",
      "--content-file",
      "/c",
      "--featured-media",
      "42",
      "--only-accepted-meta",
      "--meta-json",
      '{"_yoast_wpseo_title":"T","_yoast_wpseo_metadesc":"D"}',
      ...credArgs,
    ],
    [
      {
        status: 200,
        body: { schema: { properties: { meta: { properties: { _yoast_wpseo_title: {} } } } } },
      },
      { status: 201, body: { id: 9, link: "L9", slug: "kafka", status: "draft" } },
    ],
    { ...credFiles, "/c": "<p>тело</p>" },
  );
  assert.equal(await runWpCli(h.io), 0);
  assert.equal(h.out.join(""), "9\nL9\n");
  assert.match(h.err.join(""), /^seo_meta_skipped: _yoast_wpseo_metadesc/);
  assert.equal(h.calls[0].init.method, "OPTIONS");
  const payload = JSON.parse(String(h.calls[1].init.body));
  assert.deepEqual(payload, {
    title: "Kafka",
    slug: "kafka",
    content: "<p>тело</p>",
    status: "draft",
    featured_media: 42,
    meta: { _yoast_wpseo_title: "T" },
  });
});

test("publish --date-gmt: печатает link; ошибка WP — код 1 и текст в stderr", async () => {
  const ok = harness(
    ["publish", "--type", "posts", "--id", "5", "--date-gmt", "2030-01-01T09:00:00", ...credArgs],
    [{ status: 200, body: { id: 5, link: "L5", slug: "s", status: "future" } }],
    credFiles,
  );
  assert.equal(await runWpCli(ok.io), 0);
  assert.equal(ok.out.join(""), "L5\n");

  const bad = harness(
    ["publish", "--type", "posts", "--id", "5", ...credArgs],
    [{ status: 403, body: { code: "rest_cannot_edit" } }],
    credFiles,
  );
  assert.equal(await runWpCli(bad.io), 1);
  assert.match(bad.err.join(""), /toolkit-wp publish: publishEntry \(HTTP 403\)/);
});

test("categories и meta-keys — JSON одной строкой; без адреса сайта — код 2", async () => {
  const c = harness(
    ["categories", "--text", "Kafka", "--root", "1", "--link-pattern", "/blog/news/.+"],
    [{ status: 200, body: [{ id: 10, name: "Kafka", link: "https://x/blog/news/kafka/" }] }],
  );
  assert.equal(await runWpCli(c.io), 0);
  assert.equal(c.out.join(""), "[1,10]\n");

  const m = harness(
    ["meta-keys", "--type", "posts"],
    [{ status: 200, body: { schema: { properties: { meta: { properties: { b: {}, a: {} } } } } } }],
  );
  assert.equal(await runWpCli(m.io), 0);
  assert.equal(m.out.join(""), '["a","b"]\n');

  const noUrl = harness(["meta-keys"], []);
  noUrl.io.env = {};
  assert.equal(await runWpCli(noUrl.io), 2);
});

test("dates: по строке; неизвестная команда и нехватка опций — код 2", async () => {
  const d = harness(
    ["dates", "--type", "encyclopedia", "--after", "2026-11-01T00:00:00", ...credArgs],
    [{ status: 200, body: [{ date_gmt: "a" }, { date_gmt: "b" }] }],
    credFiles,
  );
  assert.equal(await runWpCli(d.io), 0);
  assert.equal(d.out.join(""), "a\nb\n");

  assert.equal(await runWpCli(harness(["nope"], []).io), 2);
  assert.equal(await runWpCli(harness(["find", ...credArgs], [], credFiles).io), 2);
});

test("raw-content: content.raw без добавок; count: из X-WP-Total через HEAD", async () => {
  const r = harness(
    ["raw-content", "--type", "encyclopedia", "--id", "3", ...credArgs],
    [{ status: 200, body: { content: { raw: "<p>a</p>\n" } } }],
    credFiles,
  );
  assert.equal(await runWpCli(r.io), 0);
  assert.equal(r.out.join(""), "<p>a</p>\n");
  assert.match(r.calls[0].url, /encyclopedia\/3\?context=edit&_fields=content$/);

  const c = harness(
    ["count", "--type", "encyclopedia", "--status", "draft", ...credArgs],
    [],
    credFiles,
  );
  c.io.fetch = (async (url: string, init: RequestInit) => {
    c.calls.push({ url, init });
    return new Response(null, { status: 200, headers: { "X-WP-Total": "17" } });
  }) as unknown as typeof fetch;
  assert.equal(await runWpCli(c.io), 0);
  assert.equal(c.out.join(""), "17\n");
  assert.equal(c.calls[0].init.method, "HEAD");
  assert.match(c.calls[0].url, /encyclopedia\?status=draft&per_page=1$/);
});
