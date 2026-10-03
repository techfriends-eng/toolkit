/**
 * Разбор ответа на карточку отбора.
 *
 * Правило жёсткое и взято из wiki_visualizer: approve засчитывается, только
 * если ответ ЦЕЛИКОМ равен одному из токенов и является реплаем на конкретную
 * карточку. «Да, но давай другую» — это фидбек, а не согласие, и такой ответ
 * должен возвращать `unknown`, а не `approve`.
 *
 * Три класса ошибок, из-за которых здесь столько возни с нормализацией:
 *
 *  1. **Регистр.** На живой проверке ответ пришёл как «Ok» с заглавной.
 *     В TypeScript `toLowerCase()` знает про кириллицу, в отличие от `tr` в
 *     минимальном Debian, на котором wiki_visualizer когда-то молча читал «Да»
 *     как reject.
 *  2. **Раскладка.** «Да», набранное при английской раскладке, приходит как
 *     «lf», «ок» — как «jr», а латинское «ok» при русской раскладке — «щл».
 *  3. **Похожие буквы.** «Ок» часто набрано смесью: кириллическая О и
 *     латинская k. Визуально одно и то же, по кодам — разные строки.
 */

export type Verdict = "approve" | "reject" | "unknown";

/**
 * Кириллические буквы, неотличимые от латинских на глаз. Сводим к латинице
 * только для сравнения — сам ответ пользователя мы не меняем.
 */
const CONFUSABLES: Record<string, string> = {
  а: "a",
  в: "b",
  е: "e",
  ё: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ѕ: "s",
  ј: "j",
};

/** Согласие. Каждая строка — то, что реально приходило или может прийти. */
const APPROVE_WORDS = [
  "ok",
  "okay",
  "ок", // кириллицей
  "да",
  "yes",
  "approve",
  "+",
  "lf", // «да» на английской раскладке
  "jr", // «ок» на английской раскладке
  "щл", // «ok» на русской раскладке
  "✅",
  "👍",
];

/** Отказ. Reject терминален: повторного автозапроса по статье нет. */
const REJECT_WORDS = [
  "no",
  "нет",
  "не",
  "reject",
  "skip",
  "-",
  "ytn", // «нет» на английской раскладке
  "yt", // «не» на английской раскладке
  "тщ", // «no» на русской раскладке
  "❌",
  "👎",
];

/**
 * Приводит к нижнему регистру, выбрасывает невидимые символы и хвостовую
 * пунктуацию. Пробелы внутри не трогаем: ответ из двух слов обязан остаться
 * двумя словами и не пройти сравнение.
 */
function normalize(raw: string): string {
  return (
    raw
      .normalize("NFKC")
      // Невидимые: zero-width, неразрывный пробел, селекторы вариаций эмодзи.
      .replace(/[\u200B-\u200D\uFEFF\u00A0]|\uFE0E|\uFE0F/g, "")
      .trim()
      .toLowerCase()
      .replace(/^[!?.,;:()"'«»]+|[!?.,;:()"'«»]+$/g, "")
      .trim()
  );
}

/** Сводит похожие кириллические буквы к латинским. */
function fold(value: string): string {
  let out = "";
  for (const char of value) out += CONFUSABLES[char] ?? char;
  return out;
}

/** Из читаемого списка слов делает множество со всеми формами сравнения. */
function buildSet(words: string[]): Set<string> {
  const set = new Set<string>();
  for (const word of words) {
    const normalized = normalize(word);
    set.add(normalized);
    set.add(fold(normalized));
  }
  return set;
}

const APPROVE = buildSet(APPROVE_WORDS);
const REJECT = buildSet(REJECT_WORDS);

/**
 * Вердикт по тексту ответа. Пустая строка, фраза из нескольких слов и всё
 * незнакомое дают `unknown` — карточка остаётся висеть, а не считается
 * решённой.
 */
export function verdictOf(text: string | null | undefined): Verdict {
  if (!text) return "unknown";

  const normalized = normalize(text);
  if (!normalized) return "unknown";

  const folded = fold(normalized);
  if (APPROVE.has(normalized) || APPROVE.has(folded)) return "approve";
  if (REJECT.has(normalized) || REJECT.has(folded)) return "reject";
  return "unknown";
}

/**
 * Полный разбор апдейта: вердикт засчитывается только на реплай к нужной
 * карточке и в нужной теме.
 *
 * Тема проверяется обязательно: бот — администратор супергруппы, а значит
 * получает сообщения ВСЕХ тем, включая чужие (Wiki и логи). Без фильтра шаг
 * отбора начнёт разбирать не свою переписку.
 */
export type ReplyLike = {
  text?: string | null;
  message_thread_id?: number | null;
  reply_to_message?: { message_id?: number | null } | null;
};

export function verdictForCard(
  message: ReplyLike,
  card: { messageId: number; threadId: number },
): Verdict {
  if (message.message_thread_id !== card.threadId) return "unknown";
  if (message.reply_to_message?.message_id !== card.messageId) return "unknown";
  return verdictOf(message.text);
}
