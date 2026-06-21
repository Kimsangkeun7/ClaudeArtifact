/* app.js — wires views, editor, graph, amoeba, students together. */
(function () {
  "use strict";

  window.HELP_MD = [
    "# 🧬 Obsidian · Amoeba 사용법",
    "",
    "**영어 1:1 강사**를 위한 진화형 노트 시스템입니다. 옵시디언처럼 노트를 쓰면,",
    "**아메바 시스템**이 학생별 데이터를 세대를 거쳐 **수렴(융합)** 하고 **발산(분기)** 시키며 진화시킵니다.",
    "",
    "## 📝 볼트 (노트)",
    "- 좌측 ＋노트로 새 노트를 만듭니다. `[[다른노트]]` 로 위키링크를 겁니다.",
    "- 상단 **프론트매터**로 학생/카테고리/태그/강도를 지정하면 아메바의 먹이가 됩니다:",
    "```",
    "---",
    "student: Jiwon Park",
    "category: grammar",
    "tags: [present-perfect, articles]",
    "strength: 0.7",
    "---",
    "```",
    "- 하단 **백링크**로 이 노트를 가리키는 노트를 확인합니다.",
    "",
    "## 🕸️ 그래프 뷰",
    "노트(노드)와 위키링크·공유 태그(선)를 시각화합니다. 색은 학생별. 드래그·줌·클릭 이동 지원.",
    "",
    "## 🧬 아메바 시스템 — 핵심",
    "학생을 고르고 **▶ 진화** 를 누르면 한 세대씩 나아갑니다. 세대마다:",
    "- **융합(수렴)**: 비슷한 관찰들이 하나의 *특질(trait)* 로 합쳐집니다.",
    "- **분기(발산)**: 한 특질 안에 서로 다른 결이 감지되면 전문화된 하위 특질로 갈라집니다. (예: 막연한 '발음 문제' → `th-sound` ⟂ `r-l`)",
    "- **도태**: 보강되지 않은 약한 신호는 강도가 감쇠하다 사라집니다.",
    "- **고도화 지수**: 구조가 정제될수록 올라가는 '천재 지수'.",
    "우측 패널에 특질 목록과 **다음 수업 추천**이 자동 생성됩니다. 타임라인 슬라이더로 진화 과정을 되감을 수 있습니다.",
    "",
    "## 🎓 학생",
    "학생별 카드(노트 수·세션·특질·고도화 지수). 카드에서 아메바/노트로 바로 이동.",
    "",
    "## 💾 데이터",
    "- 모든 데이터는 브라우저 **localStorage** 에 자동 저장됩니다.",
    "- 📥 로 `.md` 파일들(또는 `.json` 백업)을 가져오고, 💾 로 JSON 백업을 내보냅니다.",
    "",
    "> 팁: `vault/` 폴더의 예시 노트가 처음 자동 탑재되어 있습니다. 바로 진화 버튼을 눌러보세요."
  ].join("\n");

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var app = {
    currentId: null,
    mode: "split",           // split | preview | edit
    view: "vault",
    graph: null,
    amoeba: null,
    lineage: null,
    gen: 0,
    studentFilter: ""
  };

  // ---- boot -------------------------------------------------------------
  function boot() {
    var had = Store.load();
    if (!had && window.SEED) seedVault();
    Store.syncStudents();
    bindUI();
    renderTree();
    refreshStudentSelectors();
    var first = Store.allNotes()[0];
    if (Store.state.activeId && Store.state.notes[Store.state.activeId]) openNote(Store.state.activeId);
    else if (first) openNote(first.id);
    Store.subscribe(function () { renderTree(); });
  }

  function seedVault() {
    window.SEED.forEach(function (f) {
      Store.createNote(f.path.replace(/^vault\//, ""), f.content);
    });
    Store.syncStudents();
    // enrich student profiles
    var profiles = {
      "Jiwon Park": { level: "중급", goal: "비즈니스 영어 · 정확도" },
      "Minseo Lee": { level: "고등", goal: "내신·수능 문법" },
      "Daniel Cho": { level: "상급", goal: "유창성 · 발음 · 관용표현" }
    };
    Object.keys(profiles).forEach(function (k) { if (Store.state.students[k]) Store.ensureStudent(k, profiles[k]); });
  }

  // ---- file tree --------------------------------------------------------
  function renderTree() {
    var tree = $("#file-tree");
    var q = $("#search").value;
    var notes = q ? Vault.search(q) : Store.allNotes();
    if (app.studentFilter) notes = notes.filter(function (n) { return Store.meta(n).student === app.studentFilter; });

    notes.sort(function (a, b) { return a.path.localeCompare(b.path); });
    if (!notes.length) {
      tree.innerHTML = '<div class="tree-empty">결과가 없습니다.<br/>＋ 노트로 새 노트를 만들거나 📥 로 .md 볼트를 가져오세요.</div>';
      return;
    }
    // group by top folder
    var groups = {};
    notes.forEach(function (n) {
      var parts = n.path.split("/");
      var folder = parts.length > 1 ? parts[0] : "/";
      if (folder === "students" && parts.length > 2) folder = "students/" + parts[1];
      (groups[folder] = groups[folder] || []).push(n);
    });
    var html = "";
    Object.keys(groups).sort().forEach(function (folder) {
      html += '<div class="tree-folder"><div class="tree-label">' + esc(folder) + "</div>";
      groups[folder].forEach(function (n) {
        var fm = Store.meta(n);
        var color = fm.student ? Store.studentColor(fm.student) : (fm.type === "concept" ? "#5aa9e6" : "#777");
        html += '<div class="tree-file' + (n.id === app.currentId ? " active" : "") +
          '" data-id="' + n.id + '"><span class="dot" style="background:' + color + '"></span>' +
          esc(Store.title(n)) + "</div>";
      });
      html += "</div>";
    });
    tree.innerHTML = html;
    $$("#file-tree .tree-file").forEach(function (el) {
      el.onclick = function () { openNote(el.dataset.id); };
    });
  }

  // ---- editor -----------------------------------------------------------
  function openNote(id) {
    var n = Store.state.notes[id];
    if (!n) return;
    app.currentId = id; Store.setActive(id);
    switchView("vault");
    $("#editor").value = n.content;
    renderPreview();
    renderBreadcrumb(n);
    renderBacklinks(n);
    renderTree();
  }

  function renderBreadcrumb(n) {
    var fm = Store.meta(n);
    var bits = n.path.split("/");
    var s = bits.slice(0, -1).join(" / ");
    $("#breadcrumb").innerHTML = (s ? esc(s) + " / " : "") + "<b>" + esc(Store.title(n)) + "</b>" +
      (fm.student ? ' <span class="fm-chip student">🎓 ' + esc(fm.student) + "</span>" : "");
  }

  function renderPreview() {
    var content = $("#editor").value;
    var r = MD.render(content, function (name) { return !!Store.noteByName(name); });
    var chips = "";
    var fm = r.data;
    if (fm.student) chips += '<span class="fm-chip student">🎓 ' + esc(fm.student) + "</span>";
    if (fm.category) chips += '<span class="fm-chip">' + esc(fm.category) + "</span>";
    if (fm.session) chips += '<span class="fm-chip">session ' + esc(fm.session) + "</span>";
    if (typeof fm.strength === "number") chips += '<span class="fm-chip">strength ' + fm.strength + "</span>";
    (Array.isArray(fm.tags) ? fm.tags : []).forEach(function (t) { chips += '<span class="tag-chip">#' + esc(t) + "</span>"; });
    $("#preview").innerHTML = (chips ? '<div class="fm-chip-row">' + chips + "</div>" : "") + r.html;
    bindWikilinks($("#preview"));
  }

  function bindWikilinks(scope) {
    $$("a.wikilink", scope).forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        var name = decodeURIComponent(a.dataset.wikilink);
        var t = Store.noteByName(name);
        if (t) openNote(t.id);
        else {
          var id = Store.createNote(name + ".md", "# " + name + "\n\n");
          openNote(id);
          toast("새 노트 생성: " + name);
        }
      };
    });
    function $$(s, sc) { return Array.prototype.slice.call((sc || document).querySelectorAll(s)); }
  }

  function renderBacklinks(n) {
    var bl = Vault.backlinks(n);
    var el = $("#backlinks");
    if (!bl.length) { el.innerHTML = '<h4>백링크</h4><div class="ctx">이 노트를 가리키는 링크가 없습니다.</div>'; return; }
    var html = "<h4>백링크 (" + bl.length + ")</h4>";
    bl.forEach(function (b) {
      html += '<a href="#" data-id="' + b.note.id + '">← ' + esc(Store.title(b.note)) + "</a>" +
        (b.ctx ? '<div class="ctx">' + esc(b.ctx.slice(0, 90)) + "</div>" : "");
    });
    el.innerHTML = html;
    Array.prototype.forEach.call(el.querySelectorAll("a"), function (a) {
      a.onclick = function (e) { e.preventDefault(); openNote(a.dataset.id); };
    });
  }

  function setMode(m) {
    app.mode = m;
    var split = $(".editor-split");
    split.classList.toggle("preview-only", m === "preview");
    split.classList.toggle("edit-only", m === "edit");
    $("#btn-toggle-mode").textContent = m === "preview" ? "✎ 편집" : (m === "edit" ? "⬓ 분할" : "👁 미리보기");
  }

  // ---- views ------------------------------------------------------------
  function switchView(name) {
    app.view = name;
    $$(".view").forEach(function (v) { v.classList.remove("active"); });
    $("#view-" + name).classList.add("active");
    $$(".ribbon-btn[data-view]").forEach(function (b) { b.classList.toggle("active", b.dataset.view === name); });
    if (name === "graph") showGraph();
    if (name === "amoeba") showAmoeba();
    if (name === "students") renderStudents();
  }

  // ---- graph ------------------------------------------------------------
  function showGraph() {
    if (!app.graph) {
      app.graph = new GraphView($("#graph-canvas"), { onOpen: openNote });
    }
    app.graph.resize();
    app.graph.setData(Vault.buildGraph({ tags: $("#graph-show-tags").checked }));
  }

  // ---- amoeba -----------------------------------------------------------
  function showAmoeba() {
    if (!app.amoeba) {
      app.amoeba = new AmoebaView($("#amoeba-canvas"), { onPick: focusTrait });
    }
    app.amoeba.resize();
    var sel = $("#amoeba-student");
    if (!sel.value && sel.options.length) sel.value = sel.options[0].value;
    computeLineage(sel.value);
  }

  function computeLineage(student) {
    var notes = Store.notesForStudent(student);
    app.lineage = Amoeba.lineage(notes, 8);
    app.gen = 0;
    var slider = $("#gen-slider");
    slider.max = app.lineage.snapshots.length - 1;
    slider.value = 0;
    renderGen();
  }

  function renderGen() {
    if (!app.lineage) return;
    var snap = app.lineage.snapshots[app.gen];
    $("#gen-label").textContent = snap.gen;
    $("#gen-slider").value = app.gen;
    app.amoeba.setSnapshot(snap);
    // events
    $("#gen-events").innerHTML = snap.events.map(function (e) {
      var label = { converge: "융합", diverge: "분기", decay: "도태", ingest: "유입" }[e.type] || e.type;
      return '<span class="ev ' + e.type + '">' + label + ": " + esc(e.label) + (e.n ? " ×" + e.n : "") + "</span>";
    }).join("") || '<span class="ev">안정 — 변화 없음</span>';
    renderAmoebaSide(snap);
  }

  function renderAmoebaSide(snap) {
    var traits = snap.traits.slice().sort(function (a, b) { return b.strength - a.strength; });
    var html = "<h3>고도화 지수 (천재 지수)</h3>";
    html += '<div class="meter"><span style="width:' + snap.score + '%"></span></div>';
    html += '<div class="sub">세대 ' + snap.gen + " · 특질 " + traits.length + "개 · 원본 관찰 " +
      app.lineage.totalCells + "개 → 수렴률 " +
      Math.round((1 - traits.length / Math.max(1, app.lineage.totalCells)) * 100) + "%</div>";

    html += '<div class="reco"><h4>📌 다음 수업 추천</h4><ul>';
    snap.recommendations.forEach(function (r) {
      html += "<li><b>" + esc(r.focus) + "</b> <span class=\"cat\">(" + esc(r.category) + " · " + r.confidence + "%)</span><br/>" + esc(r.action) + "</li>";
    });
    html += "</ul></div>";

    html += '<h3 style="margin-top:14px">특질 (Traits)</h3>';
    traits.forEach(function (t) {
      var color = AmoebaView.catColor(t.category);
      html += '<div class="trait-card"><div class="tt"><span>' + esc(t.label || t.category) +
        '</span><span class="cat" style="color:' + color + '">' + esc(t.category) + "</span></div>";
      html += '<div class="kw">' + esc(Amoeba.topKeywords(t.vec, 5).join(", ")) + "</div>";
      html += '<div class="kw" style="opacity:.7">관찰 ' + t.members.length + "개 · 강도 " + Math.round(t.strength * 100) + "%</div>";
      html += '<div class="bar"><span style="width:' + Math.round(t.strength * 100) + "%;background:" + color + '"></span></div></div>';
    });
    $("#amoeba-side").innerHTML = html;
  }

  function focusTrait(trait) {
    // open the most recent source note of this trait
    var id = trait.members[trait.members.length - 1];
    if (Store.state.notes[id]) { openNote(id); toast("특질 «" + (trait.label || trait.category) + "» 의 원본 노트로 이동"); }
  }

  // ---- students ---------------------------------------------------------
  function renderStudents() {
    var grid = $("#students-grid");
    var students = Store.allStudents();
    if (!students.length) { grid.innerHTML = '<div class="tree-empty">학생이 없습니다. 노트 프론트매터에 student: 를 추가하거나 ＋학생 추가를 누르세요.</div>'; return; }
    grid.innerHTML = students.map(function (s) {
      var notes = Store.notesForStudent(s.name);
      var lin = Amoeba.lineage(notes, 8);
      var last = lin.snapshots[lin.snapshots.length - 1];
      var sessions = notes.reduce(function (m, n) { var x = Store.meta(n).session; return Math.max(m, x || 0); }, 0);
      return '<div class="student-card">' +
        '<h3 style="color:' + s.color + '">' + esc(s.name) + "</h3>" +
        '<div class="meta">' + esc(s.level) + (s.goal ? " · " + esc(s.goal) : "") + "</div>" +
        '<div class="stat"><span>관찰 노트</span><b>' + notes.length + "</b></div>" +
        '<div class="stat"><span>세션 수</span><b>' + sessions + "</b></div>" +
        '<div class="stat"><span>최종 특질</span><b>' + last.traits.length + "개</b></div>" +
        '<div class="stat"><span>고도화 지수</span><b>' + last.score + " / 100</b></div>" +
        '<div class="meter"><span style="width:' + last.score + '%"></span></div>' +
        '<div class="actions"><button data-amoeba="' + esc(s.name) + '">🧬 아메바</button>' +
        '<button data-notes="' + esc(s.name) + '">📝 노트</button></div></div>';
    }).join("");
    Array.prototype.forEach.call(grid.querySelectorAll("[data-amoeba]"), function (b) {
      b.onclick = function () { $("#amoeba-student").value = b.dataset.amoeba; switchView("amoeba"); };
    });
    Array.prototype.forEach.call(grid.querySelectorAll("[data-notes]"), function (b) {
      b.onclick = function () { app.studentFilter = b.dataset.notes; $("#filter-student").value = b.dataset.notes; switchView("vault"); renderTree(); };
    });
  }

  function refreshStudentSelectors() {
    var students = Store.allStudents();
    var f = $("#filter-student"), a = $("#amoeba-student");
    f.innerHTML = '<option value="">전체 학생</option>' +
      students.map(function (s) { return '<option value="' + esc(s.name) + '">' + esc(s.name) + "</option>"; }).join("");
    a.innerHTML = students.map(function (s) { return '<option value="' + esc(s.name) + '">' + esc(s.name) + "</option>"; }).join("");
  }

  // ---- import / export --------------------------------------------------
  function handleFiles(files) {
    var arr = Array.prototype.slice.call(files);
    var mdCount = 0;
    var pending = arr.length;
    arr.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        if (/\.json$/i.test(file.name)) {
          try { Store.importJSON(reader.result); } catch (e) { toast("JSON 가져오기 실패"); }
        } else {
          var rel = file.webkitRelativePath || file.name;
          rel = rel.replace(/^.*?\//, "");
          Store.createNote(rel, reader.result); mdCount++;
        }
        if (--pending === 0) {
          Store.syncStudents(); refreshStudentSelectors(); renderTree();
          toast(mdCount ? (mdCount + "개 노트 가져옴") : "가져오기 완료");
        }
      };
      reader.readAsText(file);
    });
  }

  function exportJSON() {
    var blob = new Blob([Store.exportJSON()], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "obsidian-ameba-backup.json"; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("JSON 백업 내보냄");
  }

  // ---- UI binding -------------------------------------------------------
  function bindUI() {
    $$(".ribbon-btn[data-view]").forEach(function (b) {
      b.onclick = function () { switchView(b.dataset.view); };
    });
    $("#editor").addEventListener("input", function () {
      if (!app.currentId) return;
      Store.updateNote(app.currentId, $("#editor").value);
      renderPreview();
      clearTimeout(app._bt);
      app._bt = setTimeout(function () { renderBacklinks(Store.state.notes[app.currentId]); renderBreadcrumb(Store.state.notes[app.currentId]); }, 400);
    });
    $("#btn-toggle-mode").onclick = function () {
      setMode(app.mode === "split" ? "preview" : (app.mode === "preview" ? "edit" : "split"));
    };
    $("#btn-delete-note").onclick = function () {
      if (!app.currentId) return;
      if (!confirm("이 노트를 삭제할까요?")) return;
      Store.deleteNote(app.currentId);
      var first = Store.allNotes()[0];
      app.currentId = null;
      if (first) openNote(first.id); else { $("#editor").value = ""; $("#preview").innerHTML = ""; }
      toast("노트 삭제됨");
    };
    $("#btn-new-note").onclick = function () {
      var name = prompt("새 노트 제목", "Untitled");
      if (!name) return;
      var folder = app.studentFilter ? "students/" + app.studentFilter + "/" : "";
      var fmStudent = app.studentFilter ? "student: " + app.studentFilter + "\ncategory: general\ntags: []\nstrength: 0.5\n" : "";
      var content = (fmStudent ? "---\n" + fmStudent + "---\n\n" : "") + "# " + name + "\n\n";
      openNote(Store.createNote(folder + name + ".md", content));
    };
    $("#search").addEventListener("input", renderTree);
    $("#filter-student").onchange = function () { app.studentFilter = this.value; renderTree(); };

    $("#graph-show-tags").onchange = showGraph;
    $("#amoeba-student").onchange = function () { computeLineage(this.value); };
    $("#btn-evolve").onclick = function () {
      if (!app.lineage) return;
      if (app.gen < app.lineage.snapshots.length - 1) { app.gen++; renderGen(); }
      else toast("이미 최종 세대까지 진화했습니다 (안정 상태)");
    };
    $("#btn-evolve-reset").onclick = function () { app.gen = 0; renderGen(); };
    $("#gen-slider").addEventListener("input", function () { app.gen = +this.value; renderGen(); });

    $("#btn-new-student").onclick = function () {
      var name = prompt("학생 이름");
      if (!name) return;
      var goal = prompt("목표 (선택)", "") || "";
      Store.ensureStudent(name, { goal: goal, level: prompt("레벨 (선택)", "") || "—" });
      refreshStudentSelectors(); renderStudents();
      toast("학생 추가: " + name);
    };

    $("#btn-import").onclick = function () { $("#file-input").click(); };
    $("#file-input").onchange = function () { handleFiles(this.files); this.value = ""; };
    $("#btn-export").onclick = exportJSON;
    $("#btn-help").onclick = openHelp;
    $$("[data-close]").forEach(function (b) { b.onclick = function () { $("#modal-help").classList.add("hidden"); }; });
    $("#modal-help").addEventListener("click", function (e) { if (e.target === this) this.classList.add("hidden"); });

    window.addEventListener("resize", function () {
      if (app.view === "graph" && app.graph) { app.graph.resize(); app.graph.draw(); }
      if (app.view === "amoeba" && app.amoeba) app.amoeba.resize();
    });

    setMode("split");
  }

  function openHelp() {
    var md = window.HELP_MD || "# 도움말\n준비 중입니다.";
    var r = MD.render(md, function () { return true; });
    $("#help-content").innerHTML = r.html;
    $("#modal-help").classList.remove("hidden");
  }

  // ---- utils ------------------------------------------------------------
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function toast(msg) {
    var t = document.createElement("div");
    t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = "0"; t.style.transition = "opacity .4s"; }, 1600);
    setTimeout(function () { t.remove(); }, 2100);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
