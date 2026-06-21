/* main.ts — Amoeba System plugin entry. */
import {
  App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, Notice, debounce,
} from "obsidian";
import { AmoebaView, VIEW_TYPE, DataProvider, ViewData } from "./view";
import { SourceNote, setAI } from "./engine";
import { OllamaClient, AIConfig, DEFAULT_AI } from "./ai";

interface AmoebaSettings {
  scopeFolder: string;   // "" = whole vault; else only notes under this folder
  ai: AIConfig;          // local LLM (Ollama) settings
  semWeight: number;     // 0..1 how much semantic embedding outweighs tags
}
const DEFAULT_SETTINGS: AmoebaSettings = {
  scopeFolder: "",
  ai: { ...DEFAULT_AI },
  semWeight: 0.6,
};

export default class AmoebaPlugin extends Plugin {
  settings: AmoebaSettings = DEFAULT_SETTINGS;
  private bodyCache: Record<string, string> = {};
  private embCache: Record<string, number[]> = {};
  private embHash: Record<string, string> = {};
  private client!: OllamaClient;
  private embedding = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.client = new OllamaClient(this.settings.ai);
    setAI(this.settings.ai.enabled, this.settings.semWeight);

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new AmoebaView(leaf, this.provider));

    this.addRibbonIcon("git-fork", "Amoeba System 열기", () => this.activateView());
    this.addCommand({ id: "open-amoeba-system", name: "Amoeba System 열기 (학생 진화 그래프)", callback: () => this.activateView() });
    this.addCommand({ id: "amoeba-compute-embeddings", name: "Amoeba: 의미 임베딩 다시 계산 (로컬 GPU)", callback: () => this.computeEmbeddings(true) });

    this.addSettingTab(new AmoebaSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(async () => {
      await this.warmCache();
      if (this.settings.ai.enabled) await this.computeEmbeddings(false);
      this.refreshViews();
    });

    const refresh = debounce(() => this.refreshViews(), 600, true);
    const onChange = async (f: unknown, oldPath?: string) => {
      if (oldPath) { delete this.bodyCache[oldPath]; delete this.embCache[oldPath]; delete this.embHash[oldPath]; }
      if (f instanceof TFile && f.extension === "md") {
        await this.readBody(f);
        if (this.settings.ai.enabled) await this.embedFile(f.path);
      }
      refresh();
    };
    this.registerEvent(this.app.vault.on("modify", (f) => onChange(f)));
    this.registerEvent(this.app.vault.on("create", (f) => onChange(f)));
    this.registerEvent(this.app.vault.on("rename", (f, oldPath) => onChange(f, oldPath)));
    this.registerEvent(this.app.vault.on("delete", (f) => {
      if (f instanceof TFile) { delete this.bodyCache[f.path]; delete this.embCache[f.path]; delete this.embHash[f.path]; }
      refresh();
    }));
    this.registerEvent(this.app.metadataCache.on("changed", () => refresh()));
  }

  onunload(): void { /* view detaches itself */ }

  // The view pulls fresh data (notes + embeddings + AI hook) through this.
  private provider: DataProvider = (): ViewData => ({
    students: this.buildData(),
    embeddings: this.settings.ai.enabled ? this.embCache : {},
    aiRecommend: this.settings.ai.enabled ? (s, t) => this.client.recommend(s, t) : null,
  });

  private buildData(): Record<string, SourceNote[]> {
    const out: Record<string, SourceNote[]> = {};
    const scope = this.settings.scopeFolder.replace(/\/+$/, "");
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (scope && !(file.path === scope || file.path.startsWith(scope + "/"))) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || fm.student == null) continue;
      const note: SourceNote = {
        path: file.path,
        title: file.basename,
        student: String(fm.student),
        category: typeof fm.category === "string" ? fm.category : "general",
        tags: normalizeTags(fm.tags),
        strength: typeof fm.strength === "number" ? fm.strength : 0.55,
        session: typeof fm.session === "number" ? fm.session : 0,
        body: this.bodyCache[file.path] || "",
      };
      (out[note.student!] ||= []).push(note);
    }
    return out;
  }

  // --- body cache --------------------------------------------------------
  private async warmCache(): Promise<void> {
    await Promise.all(this.app.vault.getMarkdownFiles().map((f) => this.readBody(f)));
  }
  private async readBody(file: TFile): Promise<void> {
    try {
      const raw = await this.app.vault.cachedRead(file);
      this.bodyCache[file.path] = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
    } catch { /* ignore */ }
  }

  // --- embeddings (local GPU via Ollama) ---------------------------------
  async computeEmbeddings(force = false): Promise<void> {
    if (!this.settings.ai.enabled) { new Notice("설정에서 로컬 LLM(Ollama)을 먼저 켜세요."); return; }
    if (this.embedding) return;
    this.embedding = true;
    const notice = new Notice("의미 임베딩 계산 중…", 0);
    try {
      if (!(await this.client.available())) {
        notice.hide();
        new Notice(`Ollama에 연결 실패: ${this.settings.ai.baseUrl}\n명령창에서 'ollama serve'가 실행 중인지 확인하세요.`);
        return;
      }
      const data = this.buildData();
      const items: { path: string; text: string }[] = [];
      for (const notes of Object.values(data)) for (const n of notes) {
        const text = (n.title + "\n" + n.body).slice(0, 4000);
        const h = djb2(text);
        if (!force && this.embHash[n.path] === h && this.embCache[n.path]) continue;
        items.push({ path: n.path, text }); this.embHash[n.path] = h;
      }
      if (!items.length) { notice.hide(); new Notice("임베딩이 이미 최신입니다."); return; }
      const vecs = await this.client.embedMany(items.map((i) => i.text));
      let ok = 0;
      vecs.forEach((v, i) => { if (v) { this.embCache[items[i].path] = v; ok++; } });
      notice.hide();
      new Notice(`의미 임베딩 ${ok}/${items.length}개 계산 완료 (${this.settings.ai.embedModel})`);
      this.refreshViews();
    } catch (e) {
      notice.hide(); new Notice("임베딩 실패: " + (e as Error).message);
    } finally {
      this.embedding = false;
    }
  }
  private async embedFile(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || fm.student == null) return;
    const text = (file.basename + "\n" + (this.bodyCache[path] || "")).slice(0, 4000);
    const h = djb2(text);
    if (this.embHash[path] === h && this.embCache[path]) return;
    if (!(await this.client.available())) return;
    const v = await this.client.embedOne(text);
    if (v) { this.embCache[path] = v; this.embHash[path] = h; }
  }

  // --- views -------------------------------------------------------------
  private refreshViews(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      if (leaf.view instanceof AmoebaView) leaf.view.reload();
    });
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    let leaf: WorkspaceLeaf;
    if (existing.length) leaf = existing[0];
    else { leaf = this.app.workspace.getLeaf(true); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
    if (!Object.keys(this.buildData()).length) {
      new Notice("학생 노트가 없습니다. frontmatter에 student/category/tags/strength를 넣어주세요.");
    }
  }

  // --- settings ----------------------------------------------------------
  applyAISettings(): void {
    this.client = new OllamaClient(this.settings.ai);
    setAI(this.settings.ai.enabled, this.settings.semWeight);
    this.refreshViews();
  }
  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    this.settings.ai = Object.assign({}, DEFAULT_AI, data?.ai);
  }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}

function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw === "string") return raw.split(/[,\s]+/).filter(Boolean);
  return [];
}
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

class AmoebaSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AmoebaPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Amoeba System" });
    containerEl.createEl("p", {
      text: "student / category / tags / strength frontmatter를 가진 노트가 학생별 아메바로 진화합니다.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("스캔 폴더 제한")
      .setDesc("비워두면 전체 볼트를 스캔합니다. 예: students")
      .addText((t) => t.setPlaceholder("(전체 볼트)").setValue(this.plugin.settings.scopeFolder)
        .onChange(async (v) => { this.plugin.settings.scopeFolder = v.trim(); await this.plugin.saveSettings(); }));

    containerEl.createEl("h3", { text: "🧠 로컬 GPU AI (Ollama)" });
    containerEl.createEl("p", {
      text: "내 PC의 GPU(RTX 6000 Ada 등)에서 Ollama로 노트 의미를 임베딩하여, 태그가 아닌 '의미' 기반으로 융합/분기합니다. " +
        "끄면 검증된 휴리스틱 엔진으로 동작합니다.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("로컬 LLM 사용 (의미 기반 진화)")
      .addToggle((t) => t.setValue(this.plugin.settings.ai.enabled)
        .onChange(async (v) => {
          this.plugin.settings.ai.enabled = v;
          await this.plugin.saveSettings();
          this.plugin.applyAISettings();
          if (v) this.plugin.computeEmbeddings(false);
        }));

    new Setting(containerEl)
      .setName("Ollama 주소")
      .setDesc("기본: http://localhost:11434")
      .addText((t) => t.setValue(this.plugin.settings.ai.baseUrl)
        .onChange(async (v) => { this.plugin.settings.ai.baseUrl = v.trim() || DEFAULT_AI.baseUrl; await this.plugin.saveSettings(); this.plugin.applyAISettings(); }));

    new Setting(containerEl)
      .setName("임베딩 모델")
      .setDesc("예: nomic-embed-text, mxbai-embed-large")
      .addText((t) => t.setValue(this.plugin.settings.ai.embedModel)
        .onChange(async (v) => { this.plugin.settings.ai.embedModel = v.trim() || DEFAULT_AI.embedModel; await this.plugin.saveSettings(); this.plugin.applyAISettings(); }));

    new Setting(containerEl)
      .setName("채팅 모델 (추천 생성)")
      .setDesc("예: qwen2.5:7b, llama3.1:8b")
      .addText((t) => t.setValue(this.plugin.settings.ai.chatModel)
        .onChange(async (v) => { this.plugin.settings.ai.chatModel = v.trim() || DEFAULT_AI.chatModel; await this.plugin.saveSettings(); this.plugin.applyAISettings(); }));

    new Setting(containerEl)
      .setName("의미 가중치 (semantic weight)")
      .setDesc("0=태그만, 1=의미만. 기본 0.6")
      .addSlider((s) => s.setLimits(0, 1, 0.05).setValue(this.plugin.settings.semWeight).setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.semWeight = v; await this.plugin.saveSettings(); this.plugin.applyAISettings(); }));

    new Setting(containerEl)
      .setName("연결 테스트 / 임베딩 계산")
      .addButton((b) => b.setButtonText("연결 테스트").onClick(async () => {
        const ok = await new OllamaClient(this.plugin.settings.ai).available();
        new Notice(ok ? "✅ Ollama 연결 성공" : "❌ 연결 실패 — 'ollama serve' 실행 여부 확인");
      }))
      .addButton((b) => b.setButtonText("임베딩 다시 계산").setCta().onClick(() => this.plugin.computeEmbeddings(true)));
  }
}
