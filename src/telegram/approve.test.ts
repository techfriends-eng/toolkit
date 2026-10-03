import assert from "node:assert/strict";
import test from "node:test";
import { verdictForCard, verdictOf } from "./approve.ts";

test("латинское ok в любом регистре", () => {
  for (const t of ["ok", "OK", "Ok", "oK", "okay", "Okay"]) {
    assert.equal(verdictOf(t), "approve", t);
  }
});

test("кириллическое ок в любом регистре", () => {
  for (const t of ["ок", "ОК", "Ок", "оК"]) {
    assert.equal(verdictOf(t), "approve", t);
  }
});

test("смесь кириллицы и латиницы в «ок»", () => {
  // О кириллическая + k латинская, и наоборот — на глаз одно и то же.
  assert.equal(verdictOf("Оk"), "approve"); // О + k
  assert.equal(verdictOf("oк"), "approve"); // o + к
  assert.equal(verdictOf("оk"), "approve"); // о + k
});

test("да в любом регистре", () => {
  for (const t of ["да", "Да", "ДА", "дА"]) {
    assert.equal(verdictOf(t), "approve", t);
  }
});

test("не та раскладка: lf, jr, щл", () => {
  for (const t of ["lf", "Lf", "LF", "jr", "JR", "щл", "ЩЛ"]) {
    assert.equal(verdictOf(t), "approve", t);
  }
});

test("хвостовая пунктуация и невидимые символы не мешают", () => {
  for (const t of ["ок!", "Да.", " ok ", "ok​", " да ", "«ок»"]) {
    assert.equal(verdictOf(t), "approve", JSON.stringify(t));
  }
});

test("эмодзи-галочка с селектором вариации", () => {
  assert.equal(verdictOf("✅"), "approve");
  assert.equal(verdictOf("👍️"), "approve");
});

test("отказ в разных написаниях", () => {
  for (const t of ["нет", "НЕТ", "no", "No", "ytn", "тщ", "reject", "-", "❌"]) {
    assert.equal(verdictOf(t), "reject", t);
  }
});

test("фраза из нескольких слов — не решение", () => {
  for (const t of ["да, но давай другую", "ок но позже", "не уверен", "ok?  нет"]) {
    assert.equal(verdictOf(t), "unknown", t);
  }
});

test("пустое и мусор — unknown", () => {
  for (const t of ["", "   ", null, undefined, "?", "хм"]) {
    assert.equal(verdictOf(t as string), "unknown", JSON.stringify(t));
  }
});

test("вердикт засчитывается только на реплай к своей карточке в своей теме", () => {
  const card = { messageId: 627, threadId: 615 };

  assert.equal(
    verdictForCard(
      { text: "Ok", message_thread_id: 615, reply_to_message: { message_id: 627 } },
      card,
    ),
    "approve",
  );
  // Чужая тема: бот-администратор получает и Wiki, и логи.
  assert.equal(
    verdictForCard(
      { text: "ok", message_thread_id: 619, reply_to_message: { message_id: 627 } },
      card,
    ),
    "unknown",
  );
  // Реплай на другое сообщение.
  assert.equal(
    verdictForCard(
      { text: "ok", message_thread_id: 615, reply_to_message: { message_id: 999 } },
      card,
    ),
    "unknown",
  );
  // Не реплай вообще.
  assert.equal(verdictForCard({ text: "ok", message_thread_id: 615 }, card), "unknown");
  // General: у сообщений вне тем message_thread_id отсутствует.
  assert.equal(verdictForCard({ text: "ok" }, card), "unknown");
});
