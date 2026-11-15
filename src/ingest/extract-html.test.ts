import assert from "node:assert/strict";
import test from "node:test";
import { htmlToArticleText } from "./extract-html.ts";

const page = `<html><body><article>${"слово ".repeat(10_000)}</article></body></html>`;

test("htmlToArticleText: без параметра лимит 24 000 знаков", () => {
  assert.equal(htmlToArticleText(page).length, 24_000);
});

test("htmlToArticleText: maxChars снимает лимит для длинной статьи", () => {
  assert.ok(htmlToArticleText(page, 100_000).length > 50_000);
  assert.equal(htmlToArticleText(page, 40_000).length, 40_000);
});
