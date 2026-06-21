/* view.ts — the living Amoeba graph.
 *
 * An Obsidian-graph-style force simulation (nodes, links, glow, drag, zoom,
 * theme-matched colours). Convergence and divergence are NOT button-driven:
 * similar nodes are pulled together by similarity springs until they collide
 * and FUSE; nodes whose internal tension has crept up spontaneously SPLIT and
 * drift apart. It just runs, like a culture in a dish.
 */
import { ItemView, WorkspaceLeaf, setIcon, TFile, Notice } from "obsidian";
import {
  Cell, SourceNote, cellsFromNotes, similarity, shouldMerge, merge,
  shouldSplit, split, decay, isDead, score, recommendations, topKeywords,
  catColor, traitBrief, TraitBrief, Reco,
} from "./engine";

export const VIEW_TYPE = "amoeba-system-view";

export interface ViewData {
  students: Record<string, SourceNote[]>;
  embeddings: Record<string, number[]>;
  aiRecommend: ((student: string, traits: TraitBrief[]) => Promise<Reco[] | null>) | null;
}

interface PNode {
  cell: Cell;
  x: number; y: number; vx: number; vy: number;
  r: number; tr: number;        // radius + target radius (eased)
  birth: number;                // ms, for spawn animation
  flash: number;                // 0..1 highlight after a merge/split
}
interface PLink { a: PNode; b: PNode; sim: number; }

interface Event { kind: "converge" | "diverge" | "ingest" | "decay"; text: string; t: number; }

export type DataProvider = () => ViewData;

export class AmoebaView extends ItemView {
  private provider: DataProvider;
  private data: Record<string, SourceNote[]> = {};
  private embeddings: Record<string, number[]> = {};
  private aiRecommend: ViewData["aiRecommend"] = null;
  private aiRecos: Reco[] | null = null;
  private aiLoading = false;
  private aiBtn: HTMLElement | null = null;
  private current = "";

  private nodes: PNode[] = [];
  private links: PLink[] = [];
  private totalLeaves = 0;
  private epoch = 0;
  private events: Event[] = [];

  private playing = true;
  private speed = 1;
  private frame = 0;
  private raf = 0;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private side!: HTMLElement;
  private studentSel!: HTMLSelectElement;
  private playBtn!: HTMLElement;

  private tx = 0; private ty = 0; private scale = 1;
  private hover: PNode | null = null;
  private drag: PNode | null = null;
  private dragMoved = false;
  private pan: { x: number; y: number; tx: number; ty: number } | null = null;

  constructor(leaf: WorkspaceLeaf, provider: DataProvider) {
    super(leaf);
    this.provider = provider;
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Amoeba System"; }
  getIcon(): string { return "git-fork"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("amoeba-root");

    // --- toolbar ---
    const bar = root.createDiv({ cls: "amoeba-bar" });
    bar.createSpan({ cls: "amoeba-title", text: "🧬 Amoeba" });
    this.studentSel = bar.createEl("select", { cls: "amoeba-select dropdown" });
    this.studentSel.onchange = () => this.selectStudent(this.studentSel.value);

    this.playBtn = bar.createEl("button", { cls: "amoeba-btn" });
    this.playBtn.onclick = () => this.togglePlay();

    const speedBtn = bar.createEl("button", { cls: "amoeba-btn", text: "1×" });
    speedBtn.onclick = () => {
      this.speed = this.speed >= 4 ? 0.5 : this.speed * 2;
      speedBtn.setText(this.speed + "×");
    };

    const reseed = bar.createEl("button", { cls: "amoeba-btn" });
    setIcon(reseed.createSpan(), "rotate-ccw");
    reseed.createSpan({ text: " 재배양" });
    reseed.onclick = () => this.selectStudent(this.current, true);

    const rescan = bar.createEl("button", { cls: "amoeba-btn" });
    setIcon(rescan.createSpan(), "refresh-cw");
    rescan.createSpan({ text: " 노트 다시읽기" });
    rescan.onclick = () => this.reload();

    this.aiBtn = bar.createEl("button", { cls: "amoeba-btn amoeba-ai-btn" });
    setIcon(this.aiBtn.createSpan(), "brain-circuit");
    this.aiBtn.createSpan({ text: " AI 추천" });
    this.aiBtn.onclick = () => this.runAIRecommend();

    // --- body: canvas + side panel ---
    const body = root.createDiv({ cls: "amoeba-body" });
    const stage = body.createDiv({ cls: "amoeba-stage" });
    this.canvas = stage.createEl("canvas", { cls: "amoeba-canvas" });
    this.ctx = this.canvas.getContext("2d")!;
    this.side = body.createDiv({ cls: "amoeba-side" });

    this.bindPointer();
    this.reload();

    // start loop
    const loop = () => { this.tick(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(stage);
    this.registerEvent(this.app.workspace.on("resize", () => this.resize()));
    window.addEventListener("resize", this.onWinResize);
    setTimeout(() => this.resize(), 50);
  }

  async onClose(): Promise<void> {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onWinResize);
  }

  private onWinResize = () => this.resize();

  // --- data --------------------------------------------------------------
  reload(): void {
    const d = this.provider();
    this.data = d?.students || {};
    this.embeddings = d?.embeddings || {};
    this.aiRecommend = d?.aiRecommend || null;
    if (this.aiBtn) this.aiBtn.toggleClass("amoeba-hidden", !this.aiRecommend);
    const names = Object.keys(this.data).sort();
    this.studentSel.empty();
    if (!names.length) {
      this.studentSel.createEl("option", { text: "(학생 없음)", value: "" });
      this.current = "";
      this.nodes = []; this.links = []; this.renderSide();
      return;
    }
    names.forEach((n) => {
      const o = this.studentSel.createEl("option", { text: `${n} (${this.data[n].length})`, value: n });
      if (n === this.current) o.selected = true;
    });
    if (!this.current || !this.data[this.current]) this.current = names[0];
    this.studentSel.value = this.current;
    this.selectStudent(this.current, true);
  }

  private selectStudent(name: string, reseed = false): void {
    this.current = name;
    this.aiRecos = null;
    const notes = this.data[name] || [];
    const cells = cellsFromNotes(notes, this.embeddings);
    this.totalLeaves = cells.length;
    this.epoch = 0;
    this.events = [{ kind: "ingest", text: `${cells.length}개 관찰 유입`, t: Date.now() }];
    const w = this.canvas.clientWidth || 700, h = this.canvas.clientHeight || 500;
    this.nodes = cells.map((c, i) => {
      const ang = (i / Math.max(1, cells.length)) * Math.PI * 2;
      const node: PNode = {
        cell: c,
        x: w / 2 + Math.cos(ang) * (90 + Math.random() * 40),
        y: h / 2 + Math.sin(ang) * (90 + Math.random() * 40),
        vx: 0, vy: 0, r: 6, tr: radiusFor(c), birth: performance.now(), flash: 0,
      };
      return node;
    });
    this.rebuildLinks();
    this.renderSide();
    if (reseed) { this.tx = 0; this.ty = 0; this.scale = 1; }
  }

  private togglePlay(): void {
    this.playing = !this.playing;
    this.playBtn.empty();
    setIcon(this.playBtn.createSpan(), this.playing ? "pause" : "play");
    this.playBtn.createSpan({ text: this.playing ? " 일시정지" : " 재생" });
  }

  // --- simulation --------------------------------------------------------
  private rebuildLinks(): void {
    this.links = [];
    const n = this.nodes;
    for (let i = 0; i < n.length; i++)
      for (let j = i + 1; j < n.length; j++) {
        const s = similarity(n[i].cell, n[j].cell);
        if (s >= 0.30) this.links.push({ a: n[i], b: n[j], sim: s });
      }
  }

  private tick(): void {
    this.frame++;
    if (this.playing) {
      const steps = this.speed < 1 ? (this.frame % 2 ? 1 : 0) : Math.round(this.speed);
      for (let s = 0; s < steps; s++) this.physics();
      this.perFrame();                                 // decay/radius once per frame (speed-independent)
      // structural events run at a calmer cadence so they're watchable
      if (this.frame % Math.max(5, Math.round(9 / this.speed)) === 0) {
        const changed = this.tryConverge() || this.tryDiverge();
        if (changed) { this.rebuildLinks(); this.renderSide(); }
      }
      if (this.frame % 120 === 0) this.cull();
    }
    this.draw();
  }

  private physics(): void {
    const n = this.nodes;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const cx = W / 2, cy = H / 2;
    for (let i = 0; i < n.length; i++) {
      const A = n[i];
      for (let j = i + 1; j < n.length; j++) {
        const B = n[j];
        const dx = A.x - B.x, dy = A.y - B.y;
        const d2 = dx * dx + dy * dy + 0.01;
        const d = Math.sqrt(d2);
        const f = (2600 + (A.r + B.r) * 26) / d2;      // repulsion (bigger nodes push more)
        const fx = (dx / d) * f, fy = (dy / d) * f;
        A.vx += fx; A.vy += fy; B.vx -= fx; B.vy -= fy;
      }
      A.vx += (cx - A.x) * 0.0022;                     // gentle gravity to center
      A.vy += (cy - A.y) * 0.0022;
    }
    // similarity springs: the more similar, the shorter the rest length →
    // similar cells are dragged into collision (and then fuse).
    this.links.forEach((l) => {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const rest = (l.a.r + l.b.r) + 70 - l.sim * 90;  // similar → shorter than radii sum → collide
      const k = 0.012 + l.sim * 0.03;
      const f = (d - rest) * k;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      l.a.vx += fx; l.a.vy += fy; l.b.vx -= fx; l.b.vy -= fy;
    });
    n.forEach((A) => {
      if (A === this.drag) { A.vx = 0; A.vy = 0; return; }
      A.x += A.vx * 0.5; A.y += A.vy * 0.5;
      A.vx *= 0.85; A.vy *= 0.85;
    });
  }

  // speed-independent per-frame updates: decay (도태), radius easing, flash fade
  private perFrame(): void {
    this.nodes.forEach((A) => {
      decay(A.cell);
      A.tr = radiusFor(A.cell);
      A.r += (A.tr - A.r) * 0.08;
      if (A.flash > 0) A.flash -= 0.02;
    });
  }

  // CONVERGENCE — fuse the first similar pair that has physically collided.
  private tryConverge(): boolean {
    const n = this.nodes;
    for (let i = 0; i < n.length; i++)
      for (let j = i + 1; j < n.length; j++) {
        const A = n[i], B = n[j];
        const d = Math.hypot(A.x - B.x, A.y - B.y);
        if (d < (A.r + B.r) * 0.9 && shouldMerge(A.cell, B.cell)) {
          const cell = merge(A.cell, B.cell);
          const node: PNode = {
            cell,
            x: (A.x + B.x) / 2, y: (A.y + B.y) / 2,
            vx: (A.vx + B.vx) / 2, vy: (A.vy + B.vy) / 2,
            r: Math.max(A.r, B.r), tr: radiusFor(cell), birth: performance.now(), flash: 1,
          };
          this.nodes = n.filter((x) => x !== A && x !== B).concat(node);
          this.epoch++;
          this.pushEvent("converge", cell.label);
          return true;
        }
      }
    return false;
  }

  // DIVERGENCE — the most-tense eligible node splits and the halves shoot apart.
  private tryDiverge(): boolean {
    let best: PNode | null = null, bestT = 0;
    for (const node of this.nodes) {
      if (!shouldSplit(node.cell)) continue;
      // (re)use tension via shouldSplit; pick the largest cluster as proxy
      const t = node.cell.members.length;
      if (t > bestT) { bestT = t; best = node; }
    }
    if (!best) return false;
    const parts = split(best.cell);
    if (!parts) return false;
    const ang = Math.random() * Math.PI * 2;
    const kick = 2.4;
    const mk = (c: Cell, dir: number): PNode => ({
      cell: c,
      x: best!.x + Math.cos(ang) * dir * 6,
      y: best!.y + Math.sin(ang) * dir * 6,
      vx: Math.cos(ang) * dir * kick, vy: Math.sin(ang) * dir * kick,
      r: best!.r * 0.7, tr: radiusFor(c), birth: performance.now(), flash: 1,
    });
    this.nodes = this.nodes.filter((x) => x !== best).concat(mk(parts[0], 1), mk(parts[1], -1));
    this.epoch++;
    this.pushEvent("diverge", `${parts[0].label} ⟂ ${parts[1].label}`);
    return true;
  }

  private cull(): void {
    const before = this.nodes.length;
    this.nodes = this.nodes.filter((x) => !isDead(x.cell));
    if (this.nodes.length !== before) { this.rebuildLinks(); this.renderSide(); }
  }

  private pushEvent(kind: Event["kind"], text: string): void {
    this.events.unshift({ kind, text, t: Date.now() });
    if (this.events.length > 30) this.events.pop();
  }

  // --- drawing -----------------------------------------------------------
  private theme(): { bg: string; text: string; accent: string; line: string } {
    const cs = getComputedStyle(document.body);
    const g = (v: string, f: string) => (cs.getPropertyValue(v).trim() || f);
    return {
      bg: g("--background-primary", "#1e1e1e"),
      text: g("--text-normal", "#dcddde"),
      accent: g("--interactive-accent", "#7c6cff"),
      line: g("--background-modifier-border", "#444"),
    };
  }

  private draw(): void {
    const ctx = this.ctx, W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const th = this.theme();
    ctx.clearRect(0, 0, W, H);
    // subtle vignette like Obsidian's graph
    const bgGrad = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H / 2, Math.max(W, H) * 0.7);
    bgGrad.addColorStop(0, shade(th.bg, 8));
    bgGrad.addColorStop(1, th.bg);
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

    if (!this.nodes.length) {
      ctx.fillStyle = th.text; ctx.globalAlpha = 0.5;
      ctx.font = "14px var(--font-interface)"; ctx.textAlign = "center";
      ctx.fillText("이 학생의 노트가 없습니다. frontmatter에 student/category/tags를 넣어보세요.", W / 2, H / 2);
      ctx.globalAlpha = 1; return;
    }

    ctx.save();
    ctx.translate(this.tx, this.ty); ctx.scale(this.scale, this.scale);

    // links (Obsidian-style thin glowing lines, brighter when more similar)
    this.links.forEach((l) => {
      ctx.strokeStyle = rgba(th.accent, 0.06 + l.sim * 0.22);
      ctx.lineWidth = 0.6 + l.sim * 1.6;
      ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke();
    });

    const now = performance.now();
    this.nodes.forEach((nd) => {
      const spawn = Math.min(1, (now - nd.birth) / 360);
      const r = nd.r * (0.4 + 0.6 * spawn);
      const col = catColor(nd.cell.category);
      // glow
      ctx.shadowColor = col; ctx.shadowBlur = 14 + nd.flash * 22;
      const grad = ctx.createRadialGradient(nd.x - r * 0.3, nd.y - r * 0.3, r * 0.2, nd.x, nd.y, r);
      grad.addColorStop(0, lighten(col, 70));
      grad.addColorStop(1, col);
      ctx.beginPath(); ctx.arc(nd.x, nd.y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad; ctx.globalAlpha = 0.5 + 0.5 * spawn; ctx.fill();
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;

      if (nd === this.hover || nd === this.drag) {
        ctx.lineWidth = 2; ctx.strokeStyle = th.text; ctx.stroke();
      }
      // member-count ring
      if (nd.cell.members.length > 1) {
        ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(th.text, 0.35);
        ctx.beginPath(); ctx.arc(nd.x, nd.y, r + 3, 0, Math.PI * 2 * Math.min(1, nd.cell.members.length / 6)); ctx.stroke();
      }
      // label
      if (r > 14 || nd === this.hover) {
        ctx.fillStyle = th.text; ctx.globalAlpha = nd === this.hover ? 1 : 0.85;
        ctx.font = (r > 22 ? 12 : 10) + "px var(--font-interface)";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const lbl = nd.cell.label || nd.cell.category;
        ctx.fillText(lbl.length > 16 ? lbl.slice(0, 15) + "…" : lbl, nd.x, nd.y);
        ctx.globalAlpha = 1;
      }
    });
    ctx.restore();

    // HUD
    ctx.fillStyle = rgba(th.text, 0.55); ctx.font = "12px var(--font-interface)";
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(`epoch ${this.epoch} · 특질 ${this.nodes.length} · 원본 ${this.totalLeaves} · 고도화 ${score(this.cells(), this.totalLeaves)}`, 12, H - 12);
  }

  private cells(): Cell[] { return this.nodes.map((n) => n.cell); }

  private async runAIRecommend(): Promise<void> {
    if (!this.aiRecommend) { new Notice("AI가 꺼져 있습니다. 설정에서 로컬 LLM(Ollama)을 켜세요."); return; }
    if (this.aiLoading || !this.current) return;
    this.aiLoading = true; this.renderSide();
    try {
      const briefs = this.cells().slice().sort((a, b) => b.strength - a.strength).map(traitBrief);
      const recos = await this.aiRecommend(this.current, briefs);
      if (recos && recos.length) { this.aiRecos = recos; new Notice("AI 추천을 생성했습니다."); }
      else new Notice("AI 응답을 받지 못했습니다. Ollama 실행/모델을 확인하세요.");
    } catch (e) {
      new Notice("AI 추천 실패: " + (e as Error).message);
    } finally {
      this.aiLoading = false; this.renderSide();
    }
  }

  // --- side panel --------------------------------------------------------
  private renderSide(): void {
    const cells = this.cells().slice().sort((a, b) => b.strength - a.strength);
    const sc = score(cells, this.totalLeaves);
    const compression = this.totalLeaves ? Math.round((1 - cells.length / this.totalLeaves) * 100) : 0;
    const recos = this.aiRecos || recommendations(cells);
    const aiOn = !!this.aiRecos;
    this.side.empty();

    const h = this.side.createDiv({ cls: "amoeba-panel" });
    h.createEl("h3", { text: "고도화 지수 (천재 지수)" });
    const meter = h.createDiv({ cls: "amoeba-meter" });
    meter.createSpan().style.width = sc + "%";
    h.createDiv({ cls: "amoeba-sub", text: `${this.current || "—"} · 특질 ${cells.length}개 · 원본 관찰 ${this.totalLeaves}개 → 수렴률 ${compression}%` });

    const reco = this.side.createDiv({ cls: "amoeba-reco" });
    reco.createEl("h4", { text: this.aiLoading ? "🧠 AI 추천 생성 중…" : (aiOn ? "🧠 AI 수업 추천 (로컬 LLM)" : "📌 다음 수업 추천") });
    recos.forEach((r: Reco) => {
      const li = reco.createDiv({ cls: "amoeba-reco-item" });
      li.createEl("b", { text: r.focus });
      li.createSpan({ cls: "amoeba-cat", text: ` (${r.category} · ${r.confidence}%)` });
      li.createDiv({ text: r.action });
    });

    const tl = this.side.createDiv({ cls: "amoeba-panel" });
    tl.createEl("h3", { text: "진화 로그" });
    const log = tl.createDiv({ cls: "amoeba-log" });
    this.events.slice(0, 12).forEach((e) => {
      const tag = { converge: "융합", diverge: "분기", ingest: "유입", decay: "도태" }[e.kind];
      const row = log.createDiv({ cls: "amoeba-ev ev-" + e.kind });
      row.createSpan({ cls: "ev-tag", text: tag });
      row.createSpan({ text: " " + e.text });
    });

    const tr = this.side.createDiv({ cls: "amoeba-panel" });
    tr.createEl("h3", { text: "특질 (Traits)" });
    cells.forEach((c) => {
      const card = tr.createDiv({ cls: "amoeba-trait" });
      const head = card.createDiv({ cls: "amoeba-trait-h" });
      head.createSpan({ text: c.label || c.category });
      head.createSpan({ cls: "amoeba-cat", text: c.category }).style.color = catColor(c.category);
      card.createDiv({ cls: "amoeba-kw", text: topKeywords(c.vec, 5).join(", ") });
      card.createDiv({ cls: "amoeba-kw amoeba-faint", text: `관찰 ${c.members.length}개 · 강도 ${Math.round(c.strength * 100)}%` });
      const bar = card.createDiv({ cls: "amoeba-bar" });
      const fill = bar.createSpan();
      fill.style.width = Math.round(c.strength * 100) + "%";
      fill.style.background = catColor(c.category);
    });
  }

  // --- canvas sizing -----------------------------------------------------
  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // --- pointer -----------------------------------------------------------
  private toWorld(mx: number, my: number) { return { x: (mx - this.tx) / this.scale, y: (my - this.ty) / this.scale }; }
  private pick(mx: number, my: number): PNode | null {
    const p = this.toWorld(mx, my);
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const nd = this.nodes[i];
      if (Math.hypot(nd.x - p.x, nd.y - p.y) <= nd.r + 4) return nd;
    }
    return null;
  }

  private bindPointer(): void {
    const c = this.canvas;
    c.addEventListener("mousemove", (ev) => {
      const r = c.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      if (this.drag) { const p = this.toWorld(mx, my); this.drag.x = p.x; this.drag.y = p.y; this.dragMoved = true; return; }
      this.hover = this.pick(mx, my);
      c.style.cursor = this.hover ? "pointer" : "grab";
    });
    c.addEventListener("mousedown", (ev) => {
      const r = c.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      this.drag = this.pick(mx, my); this.dragMoved = false;
      if (!this.drag) this.pan = { x: ev.clientX, y: ev.clientY, tx: this.tx, ty: this.ty };
    });
    window.addEventListener("mousemove", (ev) => {
      if (this.pan) { this.tx = this.pan.tx + (ev.clientX - this.pan.x); this.ty = this.pan.ty + (ev.clientY - this.pan.y); }
    });
    window.addEventListener("mouseup", () => {
      if (this.drag && !this.dragMoved) this.openSource(this.drag.cell);
      this.drag = null; this.pan = null;
    });
    c.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const r = c.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const before = this.toWorld(mx, my);
      this.scale *= ev.deltaY < 0 ? 1.1 : 0.9;
      this.scale = Math.max(0.3, Math.min(4, this.scale));
      const after = this.toWorld(mx, my);
      this.tx += (after.x - before.x) * this.scale; this.ty += (after.y - before.y) * this.scale;
    }, { passive: false });
  }

  private openSource(cell: Cell): void {
    const path = cell.members[cell.members.length - 1];
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) this.app.workspace.getLeaf(false).openFile(file);
  }
}

// --- helpers --------------------------------------------------------------
function radiusFor(c: Cell): number {
  return 10 + c.strength * 26 + Math.min(20, (c.members.length - 1) * 2.6);
}
function rgba(hex: string, a: number): string {
  const c = parse(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
function lighten(hex: string, amt: number): string {
  const c = parse(hex);
  return `rgb(${Math.min(255, c[0] + amt)},${Math.min(255, c[1] + amt)},${Math.min(255, c[2] + amt)})`;
}
function shade(hex: string, amt: number): string {
  const c = parse(hex);
  return `rgb(${Math.min(255, c[0] + amt)},${Math.min(255, c[1] + amt)},${Math.min(255, c[2] + amt)})`;
}
function parse(hex: string): [number, number, number] {
  hex = hex.trim();
  if (hex.startsWith("#")) {
    if (hex.length === 4) hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    const n = parseInt(hex.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = hex.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return [124, 108, 255];
}
