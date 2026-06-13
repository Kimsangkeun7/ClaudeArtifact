/* main.ts — Amoeba System plugin entry. */
import {
  App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, Notice, debounce,
} from "obsidian";
import { AmoebaView, VIEW_TYPE, DataProvider } from "./view";
import { SourceNote } from "./engine";

interface AmoebaSettings {
  scopeFolder: string;   // "" = whole vault; else only notes under this folder
}
const DEFAULT_SETTINGS: AmoebaSettings = { scopeFolder: "" };

export default class AmoebaPlugin extends Plugin {
  settings: AmoebaSettings = DEFAULT_SETTINGS;
  private bodyCache: Record<string, string> = {};

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new AmoebaView(leaf, this.provider));

    this.addRibbonIcon("git-fork", "Amoeba System 열기", () => this.activateView());
    this.addCommand({
      id: "open-amoeba-system",
      name: "Amoeba System 열기 (학생 진화 그래프)",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new AmoebaSettingTab(this.app, this));

    // Warm the body cache, then refresh any open view.
    this.app.workspace.onLayoutReady(async () => {
      await this.warmCache();
      this.refreshViews();
    });

    // Keep caches fresh as the vault changes (debounced to stay smooth).
    const refresh = debounce(() => this.refreshViews(), 600, true);
    this.registerEvent(this.app.vault.on("modify", async (f) => {
      if (f instanceof TFile && f.extension === "md") { await this.readBody(f); refresh(); }
    }));
    this.registerEvent(this.app.vault.on("create", async (f) => {
      if (f instanceof TFile && f.extension === "md") { await this.readBody(f); refresh(); }
    }));
    this.registerEvent(this.app.vault.on("delete", (f) => {
      if (f instanceof TFile) { delete this.bodyCache[f.path]; refresh(); }
    }));
    this.registerEvent(this.app.vault.on("rename", async (f, oldPath) => {
      delete this.bodyCache[oldPath];
      if (f instanceof TFile && f.extension === "md") { await this.readBody(f); }
      refresh();
    }));
    this.registerEvent(this.app.metadataCache.on("changed", () => refresh()));
  }

  onunload(): void { /* view detaches itself; nothing persistent to clean */ }

  // The view pulls fresh data synchronously through this provider.
  private provider: DataProvider = () => this.buildData();

  private buildData(): Record<string, SourceNote[]> {
    const out: Record<string, SourceNote[]> = {};
    const scope = this.settings.scopeFolder.replace(/\/+$/, "");
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (scope && !(file.path === scope || file.path.startsWith(scope + "/"))) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || fm.student == null) continue;   // only student notes feed the amoeba
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

  private async warmCache(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    await Promise.all(files.map((f) => this.readBody(f)));
  }
  private async readBody(file: TFile): Promise<void> {
    try {
      const raw = await this.app.vault.cachedRead(file);
      this.bodyCache[file.path] = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
    } catch (e) { /* ignore unreadable files */ }
  }

  private refreshViews(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      const v = leaf.view;
      if (v instanceof AmoebaView) v.reload();
    });
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    let leaf: WorkspaceLeaf;
    if (existing.length) {
      leaf = existing[0];
    } else {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    if (!Object.keys(this.buildData()).length) {
      new Notice("학생 노트가 없습니다. frontmatter에 student/category/tags/strength를 넣어주세요.");
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}

function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw === "string") return raw.split(/[,\s]+/).filter(Boolean);
  return [];
}

class AmoebaSettingTab extends PluginSettingTab {
  plugin: AmoebaPlugin;
  constructor(app: App, plugin: AmoebaPlugin) { super(app, plugin); this.plugin = plugin; }

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
      .addText((t) => t
        .setPlaceholder("(전체 볼트)")
        .setValue(this.plugin.settings.scopeFolder)
        .onChange(async (v) => { this.plugin.settings.scopeFolder = v.trim(); await this.plugin.saveSettings(); }));
  }
}
