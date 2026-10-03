import { createHash } from "node:crypto";

export function normalizeCacheText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function fingerprint(text: string): string {
  return createHash("sha256").update(normalizeCacheText(text), "utf8").digest("hex").slice(0, 16);
}

export function promptVersion(system: string): string {
  return process.env.LLM_PROMPT_VERSION?.trim() || fingerprint(system);
}

/** Ключ не зависит от обёртки промпта (релевантность, slug) и max_tokens. */
export function buildCacheKey(input: {
  kind: string;
  model: string;
  system: string;
  articleId?: string;
  body: string;
}): string {
  const material = [
    input.kind,
    input.model,
    promptVersion(input.system),
    (input.articleId || "anon").slice(0, 80),
    fingerprint(input.body),
  ].join(":");
  return createHash("sha256").update(material, "utf8").digest("hex");
}
