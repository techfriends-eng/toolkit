import assert from "node:assert/strict";
import test from "node:test";
import { canonicalArticleUrl } from "./article-id.ts";

test("hub and company feeds of one Habr article map to one url", () => {
  const hub =
    "https://habr.com/ru/companies/sberbank/articles/1085576/?utm_campaign=1085576&utm_source=habrahabr&utm_medium=rss";
  const company =
    "https://habr.com/ru/companies/sberbank/articles/1085576/?utm_source=habrahabr&utm_medium=rss&utm_campaign=corporate_blog";
  assert.equal(
    canonicalArticleUrl(hub),
    "https://habr.com/ru/companies/sberbank/articles/1085576/",
  );
  assert.equal(canonicalArticleUrl(company), canonicalArticleUrl(hub));
});

test("keeps non-utm params and drops fragment", () => {
  assert.equal(
    canonicalArticleUrl("https://example.com/?p=123&utm_source=x#comments"),
    "https://example.com/?p=123",
  );
});

test("leaves unparsable input as is", () => {
  assert.equal(canonicalArticleUrl("not a url"), "not a url");
});
