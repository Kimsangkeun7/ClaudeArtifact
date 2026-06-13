/* engine.ts — the Amoeba evolution engine (my own heuristic design).
 *
 * Philosophy: convergence and divergence are not scripted steps — they EMERGE.
 * The view runs a force simulation; this module supplies the rules:
 *
 *   • similarity(a,b)      — how strongly two cells attract (tag/keyword cosine
 *                            + same-category affinity). The view turns this into
 *                            spring forces, so similar cells drift together.
 *   • shouldMerge / merge  — when two cells are similar AND have physically
 *                            collided, they FUSE (수렴). Emergent, not timed.
 *   • tension / split      — a fused cell that has quietly accumulated
 *                            heterogeneous members builds internal "tension";
 *                            past a threshold it spontaneously DIVERGES (분기)
 *                            into two coherent, differentiated sub-traits that
 *                            no longer attract each other (so it doesn't bounce
 *                            back). Chains A~B~C with A≁C are what create it.
 *   • decay                — unreinforced signal fades (도태); big clusters persist.
 *   • score / recommend    — refinement read out as a maturity ("천재") index
 *                            and concrete next-lesson suggestions.
 */

export type Vec = Record<string, number>;

export interface SourceNote {
  path: string;
  title: string;
  student?: string;
  category: string;
  tags: string[];
  strength: number;
  session: number;
  body: string;
}

export interface Cell {
  id: string;
  members: string[];   // source note paths contributing to this cell
  subCells: Cell[];    // leaf observations, used for divergence analysis
  vec: Vec;
  emb?: number[];      // semantic embedding (unit-normalized) when AI is on
  strength: number;    // 0..1
  category: string;
  session: number;
  label: string;
  text: string;
  age: number;         // ticks alive (for decay)
}

export interface Reco {
  focus: string;
  category: string;
  action: string;
  confidence: number;
}

// Brief used to ask a local LLM for semantic labels / recommendations.
export interface TraitBrief {
  label: string;
  category: string;
  keywords: string[];
  members: number;
  samples: string[];
}

// When AI is on, semantic embedding cosine blends into similarity, so
// convergence/divergence follow MEANING, not just shared tags.
export const aiState = { enabled: false, semWeight: 0.6 };
export function setAI(enabled: boolean, semWeight = 0.6): void {
  aiState.enabled = enabled; aiState.semWeight = semWeight;
}

export const CFG = {
  categoryBonus: 0.22,    // similarity boost for same category
  mergeThreshold: 0.46,   // min similarity for two collided cells to fuse
  tensionThreshold: 0.52, // internal heterogeneity above which a cell splits
  divergeFloor: 3,        // a cell needs >= this many sub-observations to split
  decayPerTick: 0.0006,   // strength bleed per frame (gentle 도태)
  reinforcePerMember: 0.0004,
  cullFloor: 0.08,
};

const STOP = new Set(("the a an and or but of to in on for with at by is are was were be been " +
  "he she it they we you i his her their our your my me him them as so if then than too very " +
  "can will would should could not no yes do does did has have had get got make made use used " +
  "about into out up down over under again still also more most this that these those today week " +
  "last next time uses good bad keeps keep often tends tend session student").split(/\s+/));

let _seq = 0;
function nid(): string { return "c" + (_seq++).toString(36); }
function norm(s: string): string { return String(s).toLowerCase().replace(/[^a-z0-9\-]/g, "").replace(/s$/, ""); }

// --- keyword extraction -------------------------------------------------
function keywordsOf(note: SourceNote): Vec {
  const kw: Vec = {};
  (note.tags || []).forEach((t) => { const k = norm(t); if (k) kw[k] = (kw[k] || 0) + 4.0; });
  const body = (note.body || "")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, " $1 ")
    .replace(/[#>*_`\-]/g, " ").toLowerCase();
  const counts: Vec = {};
  (body.match(/[a-z][a-z'\-]{3,}/g) || []).forEach((w) => {
    const k = norm(w); if (STOP.has(k) || k.length < 4) return;
    counts[k] = (counts[k] || 0) + 1;
  });
  Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 6)
    .forEach((w) => { kw[w] = (kw[w] || 0) + 0.5; });
  return kw;
}

export function cellsFromNotes(notes: SourceNote[], embByPath?: Record<string, number[]>): Cell[] {
  return notes.map((n) => {
    const emb = embByPath && embByPath[n.path] ? normalize(embByPath[n.path]) : undefined;
    const cell: Cell = {
      id: nid(),
      members: [n.path],
      subCells: [],
      vec: keywordsOf(n),
      emb,
      strength: typeof n.strength === "number" ? n.strength : 0.55,
      category: n.category || "general",
      session: n.session || 0,
      label: labelOf(n),
      text: (n.body || "").split("\n").map((l) => l.trim()).filter(Boolean)[0]?.slice(0, 140) || n.title,
      age: 0,
    };
    cell.subCells = [leaf(cell)];
    return cell;
  });
}

function normalize(v: number[]): number[] {
  let s = 0; for (const x of v) s += x * x;
  s = Math.sqrt(s) || 1;
  return v.map((x) => x / s);
}
function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length); let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
function mixEmb(a: number[] | undefined, b: number[] | undefined, wa: number, wb: number): number[] | undefined {
  if (a && b) { const out = a.map((x, i) => x * wa + (b[i] || 0) * wb); return normalize(out); }
  return a || b;
}
function avgEmb(cells: Cell[]): number[] | undefined {
  const withEmb = cells.filter((c) => c.emb);
  if (!withEmb.length) return undefined;
  const len = withEmb[0].emb!.length; const out = new Array(len).fill(0);
  withEmb.forEach((c) => { for (let i = 0; i < len; i++) out[i] += c.emb![i]; });
  return normalize(out);
}
function leaf(c: Cell): Cell { return { ...c, subCells: [] }; }

function labelOf(n: SourceNote): string {
  if (n.tags && n.tags.length) return n.tags.slice(0, 2).join(" · ");
  return (n.category || "관찰");
}

// --- similarity & geometry ---------------------------------------------
export function cosine(a: Vec, b: Vec): number {
  let dot = 0, na = 0, nb = 0;
  for (const k in a) { na += a[k] * a[k]; if (b[k]) dot += a[k] * b[k]; }
  for (const k in b) nb += b[k] * b[k];
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function similarity(a: Cell, b: Cell): number {
  const tagCos = cosine(a.vec, b.vec);
  let s: number;
  if (aiState.enabled && a.emb && b.emb) {
    const sem = Math.max(0, dot(a.emb, b.emb));          // semantic meaning
    const w = aiState.semWeight;
    s = w * sem + (1 - w) * tagCos + (a.category === b.category ? CFG.categoryBonus * 0.5 : 0);
  } else {
    s = tagCos + (a.category === b.category ? CFG.categoryBonus : 0);
  }
  return Math.min(1, s);
}

function topKeys(vec: Vec, n: number): string[] {
  return Object.keys(vec).sort((a, b) => vec[b] - vec[a]).slice(0, n);
}
export function topKeywords(vec: Vec, n = 4): string[] { return topKeys(vec, n); }

function dominantCategory(cells: Cell[]): string {
  const tally: Vec = {};
  cells.forEach((c) => { tally[c.category] = (tally[c.category] || 0) + c.strength; });
  let best = "general", bv = -1;
  for (const k in tally) if (tally[k] > bv) { bv = tally[k]; best = k; }
  return best;
}

// --- CONVERGENCE -------------------------------------------------------
export function shouldMerge(a: Cell, b: Cell): boolean {
  return similarity(a, b) >= CFG.mergeThreshold;
}

export function merge(a: Cell, b: Cell): Cell {
  const subCells = (a.subCells.length ? a.subCells : [leaf(a)])
    .concat(b.subCells.length ? b.subCells : [leaf(b)]);
  const vec: Vec = {};
  for (const k in a.vec) vec[k] = a.vec[k] * a.strength;
  for (const k in b.vec) vec[k] = (vec[k] || 0) + b.vec[k] * b.strength;
  const cell: Cell = {
    id: nid(),
    members: a.members.concat(b.members),
    subCells,
    vec,
    emb: mixEmb(a.emb, b.emb, a.strength, b.strength),
    strength: Math.min(1, (a.strength + b.strength) * 0.62 + 0.1), // synergy bump
    category: dominantCategory(subCells),
    session: Math.max(a.session, b.session),
    label: topKeys(vec, 2).join(" · "),
    text: a.text,
    age: Math.min(a.age, b.age),
  };
  return cell;
}

// --- DIVERGENCE --------------------------------------------------------
// Tags shared by a majority of sub-cells = the "generic" label that hides
// real sub-structure; we ignore it when measuring tension and when forming
// children (so the children become genuinely differentiated).
function commonTags(cells: Cell[]): Set<string> {
  const n = cells.length; const count: Vec = {};
  cells.forEach((c) => { for (const k in c.vec) if (c.vec[k] >= 1) count[k] = (count[k] || 0) + 1; });
  const common = new Set<string>();
  for (const k in count) if (count[k] >= Math.ceil(n * 0.6)) common.add(k);
  return common;
}
function strip(vec: Vec, keys: Set<string>): Vec {
  const out: Vec = {}; for (const k in vec) if (!keys.has(k)) out[k] = vec[k];
  return out;
}

// internal heterogeneity once the shared generic tag is removed
export function tension(c: Cell): number {
  const subs = c.subCells;
  if (subs.length < CFG.divergeFloor) return 0;
  const common = commonTags(subs);
  const stripped = subs.map((s) => strip(s.vec, common));
  let sum = 0, cnt = 0;
  for (let i = 0; i < stripped.length; i++)
    for (let j = i + 1; j < stripped.length; j++) { sum += cosine(stripped[i], stripped[j]); cnt++; }
  return cnt ? 1 - sum / cnt : 0;
}

export function shouldSplit(c: Cell): boolean {
  return c.subCells.length >= CFG.divergeFloor && tension(c) >= CFG.tensionThreshold;
}

export function split(c: Cell): [Cell, Cell] | null {
  const subs = c.subCells;
  const common = commonTags(subs);
  const items = subs.map((s) => ({ ref: s, vec: strip(s.vec, common) }));
  const parts = twoMeans(items);
  if (!parts || parts[0].length < 2 || parts[1].length < 2) return null;
  const a = condense(parts[0].map((x) => x.ref), common);
  const b = condense(parts[1].map((x) => x.ref), common);
  if (!a || !b) return null;
  return [a, b];
}

function condense(cells: Cell[], stripCommon: Set<string>): Cell | null {
  const vec: Vec = {}; let str = 0;
  cells.forEach((c) => {
    for (const k in c.vec) { if (stripCommon.has(k)) continue; vec[k] = (vec[k] || 0) + c.vec[k]; }
    str += c.strength;
  });
  if (!Object.keys(vec).length) cells.forEach((c) => { for (const k in c.vec) vec[k] = (vec[k] || 0) + c.vec[k]; });
  return {
    id: nid(),
    members: ([] as string[]).concat(...cells.map((c) => c.members)),
    subCells: cells.map(leaf),
    vec,
    emb: avgEmb(cells),
    strength: Math.min(1, str / cells.length + 0.05),
    category: dominantCategory(cells),
    session: Math.max(...cells.map((c) => c.session)),
    label: topKeys(vec, 2).join(" · "),
    text: cells[0].text,
    age: 0,
  };
}

function centroid(vecs: Vec[]): Vec {
  const v: Vec = {}; vecs.forEach((cv) => { for (const k in cv) v[k] = (v[k] || 0) + cv[k]; });
  const n = vecs.length; for (const k in v) v[k] /= n; return v;
}
function twoMeans<T extends { vec: Vec }>(items: T[]): [T[], T[]] | null {
  let a = 0, b = 1, worst = -1;
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const d = 1 - cosine(items[i].vec, items[j].vec);
      if (d > worst) { worst = d; a = i; b = j; }
    }
  let ca = items[a].vec, cb = items[b].vec, g1: T[] = [], g2: T[] = [];
  for (let it = 0; it < 5; it++) {
    g1 = []; g2 = [];
    items.forEach((x) => { (cosine(x.vec, ca) >= cosine(x.vec, cb) ? g1 : g2).push(x); });
    if (!g1.length || !g2.length) return null;
    ca = centroid(g1.map((x) => x.vec)); cb = centroid(g2.map((x) => x.vec));
  }
  return [g1, g2];
}

// --- DECAY / 도태 -------------------------------------------------------
export function decay(c: Cell): void {
  const reinforce = Math.min(0.0025, CFG.reinforcePerMember * (c.members.length - 1));
  c.strength = clamp(c.strength - CFG.decayPerTick + reinforce, 0, 1);
  c.age++;
}
export function isDead(c: Cell): boolean {
  return c.strength < CFG.cullFloor && c.members.length <= 1 && c.age > 1500;
}

// --- maturity score & recommendations ----------------------------------
export function score(cells: Cell[], totalLeaves: number): number {
  if (!cells.length) return 0;
  const consolidated = cells.filter((c) => c.members.length > 1).length;
  const cats: Record<string, 1> = {}; cells.forEach((c) => { cats[c.category] = 1; });
  const coverage = Object.keys(cats).length;
  const avg = cells.reduce((s, c) => s + c.strength, 0) / cells.length;
  const compression = totalLeaves ? 1 - cells.length / totalLeaves : 0;
  return Math.min(100, Math.round(consolidated * 8 + coverage * 6 + avg * 30 + compression * 40));
}

export function recommendations(cells: Cell[]): Reco[] {
  return cells.slice()
    .map((t) => ({ t, p: (1 - t.strength) * 0.5 + Math.min(1, t.members.length / 5) * 0.3 + (t.session / 12) * 0.2 }))
    .sort((x, y) => y.p - x.p).slice(0, 3)
    .map((r) => ({
      focus: r.t.label || r.t.category,
      category: r.t.category,
      action: lessonAction(r.t.category, topKeys(r.t.vec, 3)),
      confidence: Math.round(r.t.strength * 100),
    }));
}

function lessonAction(cat: string, kws: string[]): string {
  const k = kws.join(", ");
  const map: Record<string, string> = {
    grammar: `타깃 드릴 + 오류 교정 글쓰기로 «${k}» 정확도 강화`,
    pronunciation: `미니멀 페어 청취·섀도잉으로 «${k}» 발음 교정`,
    vocabulary: `맥락형 어휘·콜로케이션 확장: «${k}»`,
    fluency: `타임드 스피킹/즉흥 발화로 «${k}» 유창성 훈련`,
    listening: `받아쓰기·정독 청취로 «${k}» 강화`,
    writing: `구조화 작문 + 피드백 루프: «${k}»`,
    confidence: `저부담 발화 환경에서 «${k}» 자신감 빌드업`,
    errors: `반복 오류 «${k}» 집중 교정 세션`,
    goals: `목표 «${k}» 기준 커리큘럼 재정렬`,
    interests: `관심사 «${k}» 소재로 몰입형 수업 설계`,
    general: `«${k}» 관련 통합 복습`,
  };
  return map[cat] || map.general;
}

export const CAT_COLOR: Record<string, string> = {
  grammar: "#7c6cff", pronunciation: "#e2a04a", vocabulary: "#4ec9a0",
  fluency: "#5aa9e6", listening: "#c792ea", writing: "#f78c6c",
  confidence: "#79b8ff", errors: "#e35d6a", goals: "#9ae6b4",
  interests: "#f6c177", general: "#9aa0aa",
};
export function catColor(c: string): string { return CAT_COLOR[c] || "#9aa0aa"; }

export function traitBrief(c: Cell): TraitBrief {
  const samples: string[] = [];
  (c.subCells.length ? c.subCells : [c]).forEach((s) => { if (s.text) samples.push(s.text); });
  return {
    label: c.label || c.category,
    category: c.category,
    keywords: topKeys(c.vec, 5),
    members: c.members.length,
    samples: samples.slice(0, 4),
  };
}

export function countLeaves(cells: Cell[]): number {
  return cells.reduce((s, c) => s + (c.subCells.length || 1), 0);
}
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
