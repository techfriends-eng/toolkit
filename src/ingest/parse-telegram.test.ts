import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseTelegramChannel } from "./parse-telegram.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "__fixtures__/rockyourdata.html"), "utf8");

test("parses posts from the public channel preview", () => {
  const items = parseTelegramChannel(fixture, "rockyourdata");
  assert.equal(items.length, 3);
  for (const item of items) {
    assert.ok(item.title.length > 0);
    assert.ok(item.url.startsWith("http"));
    assert.match(item.publishedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(item.author, "@rockyourdata");
  }
});

test("post with an external link uses it as the card URL, not the Telegram permalink", () => {
  const items = parseTelegramChannel(fixture, "rockyourdata");
  const withLink = items.find((i) => i.url.includes("instagram.com"));
  assert.ok(withLink, "ожидали пост со ссылкой на instagram.com");
  assert.equal(withLink?.url, "https://www.instagram.com/reel/DdZYFWpsUIc/");
});

test("post without any external link falls back to the permanent t.me link", () => {
  const items = parseTelegramChannel(fixture, "rockyourdata");
  const noLink = items.find((i) => i.url === "https://t.me/rockyourdata/6116");
  assert.ok(noLink, "ожидали пост 6116 без ссылок с постоянной ссылкой на сообщение");
});

test("post with only an internal t.me link also falls back to the permanent link", () => {
  const items = parseTelegramChannel(fixture, "rockyourdata");
  const internalOnly = items.find((i) => i.url === "https://t.me/rockyourdata/6134");
  assert.ok(
    internalOnly,
    "пост 6134 содержит только внутреннюю ссылку t.me, url должен быть постоянной ссылкой",
  );
});

test("media-only post with no caption is skipped", () => {
  const html = `<div class="tgme_widget_message" data-post="rockyourdata/9999">
    <time datetime="2026-09-01T00:00:00+00:00"></time>
  </div>`;
  assert.deepEqual(parseTelegramChannel(html, "rockyourdata"), []);
});

test("multi-line post: title is the first non-empty line, body joins the rest", () => {
  const html = `<div class="tgme_widget_message" data-post="rockyourdata/1">
    <time datetime="2026-09-01T00:00:00+00:00"></time>
    <div class="tgme_widget_message_text js-message_text" dir="auto">Заголовок находки<br/><br/>Первая строка тела.<br/>Вторая строка тела.</div>
  </div>`;
  const [item] = parseTelegramChannel(html, "rockyourdata");
  assert.equal(item.title, "Заголовок находки");
  assert.equal(item.body, "Заголовок находки Первая строка тела. Вторая строка тела.");
});
