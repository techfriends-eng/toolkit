/**
 * Не больше одного вызова за раз: пока первый не завершился, повторные
 * получают тот же промис, а не запускают второй.
 *
 * Зачем. Опрос getUpdates шёл по setInterval раз в 4 секунды при таймауте
 * запроса 20 секунд. Когда Telegram тормозил, запросы накладывались, и
 * Telegram отвечал Conflict: terminated by other getUpdates request — бот
 * конфликтовал сам с собой (разбор 02.10, задача 51). Для курсора отбора
 * наложение опаснее: два прохода читают один хвост апдейтов и решают одну
 * карточку дважды.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    running ??= fn().finally(() => {
      running = null;
    });
    return running;
  };
}
