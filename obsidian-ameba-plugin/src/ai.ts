/* ai.ts — optional local-LLM integration via Ollama (runs on the user's GPU).
 *
 * Uses Obsidian's requestUrl so there are no CORS issues talking to
 * http://localhost:11434. Embeddings drive MEANING-based convergence/divergence;
 * the chat model writes natural-Korean lesson recommendations. Everything here is
 * best-effort: if Ollama isn't running, callers fall back to the heuristic engine.
 */
import { requestUrl } from "obsidian";
import { Reco, TraitBrief } from "./engine";

export interface AIConfig {
  enabled: boolean;
  baseUrl: string;     // e.g. http://localhost:11434
  embedModel: string;  // e.g. nomic-embed-text  / mxbai-embed-large
  chatModel: string;   // e.g. qwen2.5:7b / llama3.1:8b
}

export const DEFAULT_AI: AIConfig = {
  enabled: false,
  baseUrl: "http://localhost:11434",
  embedModel: "nomic-embed-text",
  chatModel: "qwen2.5:7b",
};

export class OllamaClient {
  constructor(private cfg: AIConfig) {}

  private base(): string { return this.cfg.baseUrl.replace(/\/+$/, ""); }

  async available(): Promise<boolean> {
    try {
      const r = await requestUrl({ url: this.base() + "/api/tags", method: "GET" });
      return r.status === 200;
    } catch { return false; }
  }

  /** Embed one text. Returns a vector, or null on failure. */
  async embedOne(text: string): Promise<number[] | null> {
    try {
      const r = await requestUrl({
        url: this.base() + "/api/embeddings",
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({ model: this.cfg.embedModel, prompt: text.slice(0, 4000) }),
        throw: false,
      });
      if (r.status !== 200) return null;
      const v = r.json?.embedding;
      return Array.isArray(v) && v.length ? v : null;
    } catch { return null; }
  }

  /** Embed many texts with bounded concurrency; index-aligned with input. */
  async embedMany(texts: string[], concurrency = 4): Promise<(number[] | null)[]> {
    const out: (number[] | null)[] = new Array(texts.length).fill(null);
    let i = 0;
    const worker = async () => {
      while (i < texts.length) {
        const idx = i++;
        out[idx] = await this.embedOne(texts[idx]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, worker));
    return out;
  }

  /** Ask the chat model for lesson recommendations as structured JSON. */
  async recommend(student: string, traits: TraitBrief[]): Promise<Reco[] | null> {
    const sys =
      "당신은 영어 1:1 강사를 돕는 교육 코치입니다. 학생의 학습 특질(trait) 목록을 보고 " +
      "다음 수업에서 무엇을 어떻게 다룰지 구체적이고 실행 가능한 한국어 추천을 만듭니다. " +
      "반드시 JSON만 출력하세요.";
    const payload = traits.slice(0, 8).map((t) => ({
      focus: t.label, category: t.category, keywords: t.keywords, observations: t.members, samples: t.samples,
    }));
    const user =
      `학생: ${student}\n특질 목록(JSON):\n${JSON.stringify(payload, null, 0)}\n\n` +
      `다음 형식의 JSON 배열만 출력하세요(3개): ` +
      `[{"focus":"핵심 주제","category":"카테고리","action":"구체적 수업 활동(한국어 1~2문장)","confidence":0-100}]`;
    try {
      const r = await requestUrl({
        url: this.base() + "/api/chat",
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({
          model: this.cfg.chatModel,
          messages: [{ role: "system", content: sys }, { role: "user", content: user }],
          stream: false,
          options: { temperature: 0.4 },
          format: "json",
        }),
        throw: false,
      });
      if (r.status !== 200) return null;
      const content: string = r.json?.message?.content ?? "";
      return parseRecos(content);
    } catch { return null; }
  }
}

function parseRecos(content: string): Reco[] | null {
  let data: unknown;
  try { data = JSON.parse(content); }
  catch {
    const m = content.match(/\[[\s\S]*\]/);
    if (!m) return null;
    try { data = JSON.parse(m[0]); } catch { return null; }
  }
  // model may wrap the array in an object key
  let arr: unknown = data;
  if (!Array.isArray(arr) && data && typeof data === "object") {
    const vals = Object.values(data as Record<string, unknown>);
    arr = vals.find((v) => Array.isArray(v)) ?? null;
  }
  if (!Array.isArray(arr)) return null;
  const out: Reco[] = arr.slice(0, 3).map((x) => {
    const o = (x || {}) as Record<string, unknown>;
    return {
      focus: String(o.focus ?? "—"),
      category: String(o.category ?? "general"),
      action: String(o.action ?? ""),
      confidence: clampInt(o.confidence, 70),
    };
  });
  return out.length ? out : null;
}
function clampInt(v: unknown, dflt: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (isNaN(n)) return dflt;
  return Math.max(0, Math.min(100, Math.round(n)));
}
