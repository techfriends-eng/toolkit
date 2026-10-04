import assert from "node:assert/strict";
import { test } from "node:test";
import { createTopicMatcher } from "./topics.ts";

const m = createTopicMatcher({
  spark: [/\bspark\b/i],
  kafka: [/\bkafka\b/i],
  postgres: [/postgres/i, /(?<![а-яё])постгрес/i],
});

test("тема по границе слова: sparkline — не spark", () => {
  assert.deepEqual(m.match("Spark 4 вышел"), ["spark"]);
  assert.deepEqual(m.match("sparkline chart"), []);
});

test("несколько тем в одном тексте; ничего — fallback", () => {
  assert.deepEqual(m.match("Kafka и Spark"), ["spark", "kafka"]);
  assert.deepEqual(m.match("ничего", ["kafka"]), ["kafka"]);
});

test("profileHits: заголовок засчитывает тему, одно упоминание в теле — нет, два — да", () => {
  assert.deepEqual(m.profileHits({ title: "Postgres 18" }), ["postgres"]);
  assert.deepEqual(m.profileHits({ title: "Боты", body: "храним в Postgres" }), []);
  assert.deepEqual(m.profileHits({ title: "Боты", body: "Postgres тут и Postgres там" }), [
    "postgres",
  ]);
});

test("кириллица через lookaround, а не \\b", () => {
  assert.deepEqual(m.match("переехали на Постгрес"), ["postgres"]);
});

test("explain говорит, где сработала тема, с цитатой", () => {
  const [hit] = m.explain({ title: "Новое в Kafka", body: "kafka kafka" });
  assert.equal(hit.topic, "kafka");
  assert.equal(hit.where, "заголовок, тело ×2");
  assert.match(hit.snippet, /Kafka/);
});

test("порог тела настраивается", () => {
  const strict = createTopicMatcher({ kafka: [/kafka/i] }, { minBodyHits: 3 });
  assert.deepEqual(strict.profileHits({ title: "x", body: "kafka kafka" }), []);
});
