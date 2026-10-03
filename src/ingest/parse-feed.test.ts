import assert from "node:assert/strict";
import test from "node:test";
import { parseFeed, stripHtml } from "./parse-feed.ts";

test("decodes &amp; in RSS link, not just cosmetic entities", () => {
  const xml = `<rss><channel><item>
    <title>Заголовок</title>
    <link>https://habr.com/ru/articles/1084334/?utm_campaign=1084334&amp;utm_source=habrahabr&amp;utm_medium=rss</link>
    <description>Текст</description>
  </item></channel></rss>`;
  const [item] = parseFeed(xml);
  assert.equal(
    item.url,
    "https://habr.com/ru/articles/1084334/?utm_campaign=1084334&utm_source=habrahabr&utm_medium=rss",
  );
});

test("stripHtml decodes &lt; &gt; &quot; alongside &amp;", () => {
  assert.equal(
    stripHtml("Kafka &lt;4.0&gt; &amp; Flink &quot;test&quot;"),
    'Kafka <4.0> & Flink "test"',
  );
});
