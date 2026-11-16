import type { ChatResult } from "./chat.ts";

/**
 * Журнал расхода LLM: один вызов — одна строка в таблице `llm.calls` (схема — bds-content
 * `sql/llm_ledger.sql`). Запрос к БД передаётся параметром (`pool.query` из pg или любой совместимый),
 * поэтому модуль не тянет драйвер и тестируется без базы. Сбой журнала никогда не роняет вызывающий
 * код: только предупреждение — журнал не причина терять статью.
 */

export type LedgerQuery = (sql: string, params: unknown[]) => Promise<unknown>;

export type LedgerEntry = {
  stage: string;
  /** Фактическая модель ответа: у маршрута fallback может отличаться от заданной. */
  model: string;
  provider?: string;
  site?: string;
  /** Статья, кандидат или новость — для расхода «за статью». */
  ref?: string | number;
  usage?: Partial<ChatResult["usage"]>;
  /** Ответ из кэша проекта: денег не стоил, в журнал идёт с cost 0. */
  cached?: boolean;
  /** false — ответ оплачен, но не годен (обрезан, без картинки). */
  ok?: boolean;
  /** Версия models.yaml, по которой выбрана модель. */
  modelsVersion?: string;
};

export type Ledger = { record(entry: LedgerEntry): Promise<void> };

const INSERT = `insert into llm.calls (project, stage, model, provider, site, ref, prompt_tokens,
  completion_tokens, reasoning_tokens, cost_usd, cached, ok, models_version)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`;

/** Журнал проекта. Без `query` (DSN не задан) — журнал молча выключен. */
export function createLedger(opts: {
  project: string;
  query?: LedgerQuery | null;
  warn?: (message: string) => void;
}): Ledger {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  return {
    async record(e) {
      if (!opts.query) return;
      const u = e.usage ?? {};
      const params = [
        opts.project,
        e.stage,
        e.model,
        e.provider ?? null,
        e.site ?? null,
        e.ref === undefined || e.ref === null ? null : String(e.ref),
        u.promptTokens ?? null,
        u.completionTokens ?? null,
        u.reasoningTokens ?? null,
        e.cached ? 0 : (u.costUsd ?? 0),
        e.cached ?? false,
        e.ok ?? true,
        e.modelsVersion ?? null,
      ];
      try {
        await opts.query(INSERT, params);
      } catch (err) {
        warn(
          `[llm-ledger] ${opts.project}/${e.stage}: запись не удалась: ${(err as Error).message}`,
        );
      }
    },
  };
}
