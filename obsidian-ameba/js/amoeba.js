/* amoeba.js — the Amoeba evolution engine.
 *
 * Idea: each student is a living "amoeba" made of cells (observations from notes).
 * Across generations the cells CONVERGE (융합/수렴) into higher-order traits and
 * DIVERGE (분기/발산) into specialized sub-traits, while weak/stale signal DECAYS
 * (도태). The structure's refinement is scored as a "maturity / 천재 지수".
 *
 * The engine is deterministic and incremental: evolve() advances exactly one
 * generation and snapshots the whole state so a timeline slider can replay it.
 */
(function () {
  "use strict";

  // Stopwords to ignore when extracting keywords from note text.
  var STOP = ("the a an and or but of to in on for with at by is are was were be been " +
    "this that these those he she it they we you i his her their our your my me him them " +
    "as so if then than too very can will would should could not no yes do does did has have " +
    "had get got make made use used about into out up down over under again still also more most " +
    "student session today week last next time uses good bad keeps keep often tends tend").split(/\s+/);
  var STOPSET = {}; STOP.forEach(function (w) { STOPSET[w] = 1; });

  // Tunables
  var CFG = {
    startThreshold: 0.60,   // convergence similarity threshold at gen 1
    minThreshold: 0.32,     // floor; below this no more merging
    thresholdStep: 0.045,   // threshold loosens each generation
    categoryBonus: 0.22,    // similarity boost for same category
    divergeFloor: 3,        // a trait needs >= this many cells to consider splitting
    divergeSpread: 0.50,    // intra-trait dissimilarity above which it splits
    decay: 0.035,           // strength lost per generation when not reinforced
    cullFloor: 0.12,        // traits weaker than this are culled (도태)
    maxMergesPerGen: 3      // keep evolution gradual & watchable
  };

  // --- keyword extraction & vectors -------------------------------------
  function keywordsFromNote(note) {
    var fm = Store.meta(note);
    var kw = {};
    // Tags dominate the signal (they're the tutor's own labels).
    (Array.isArray(fm.tags) ? fm.tags : []).forEach(function (t) {
      kw[norm(t)] = (kw[norm(t)] || 0) + 4.0;
    });
    // Body words add only mild texture, and only the few most salient ones,
    // so they don't dilute the tag-driven cosine similarity.
    var body = MD.parseFrontmatter(note.content).body
      .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, " $1 ")  // unwrap wikilinks
      .replace(/[#>*_`\-]/g, " ").toLowerCase();
    var counts = {};
    (body.match(/[a-z][a-z'\-]{2,}/g) || []).forEach(function (w) {
      w = norm(w);
      if (STOPSET[w] || w.length < 4) return;
      counts[w] = (counts[w] || 0) + 1;
    });
    Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })
      .slice(0, 6).forEach(function (w) { kw[w] = (kw[w] || 0) + 0.5; });
    return kw;
  }
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9\-]/g, "").replace(/s$/, ""); }

  function cellsFromNotes(notes) {
    return notes.map(function (n) {
      var fm = Store.meta(n);
      var text = MD.parseFrontmatter(n.content).body.replace(/[#>*_`]/g, "").trim();
      return {
        id: n.id,
        members: [n.id],
        label: shortLabel(fm, text),
        category: fm.category || "general",
        vec: keywordsFromNote(n),
        strength: typeof fm.strength === "number" ? fm.strength : 0.55,
        session: fm.session || 0,
        text: text.split("\n")[0].slice(0, 120),
        born: 0
      };
    });
  }

  function shortLabel(fm, text) {
    if (Array.isArray(fm.tags) && fm.tags.length) return fm.tags.slice(0, 2).join(" · ");
    var firstLine = text.split("\n")[0].replace(/^#+\s*/, "");
    return firstLine.slice(0, 30) || (fm.category || "관찰");
  }

  // --- similarity --------------------------------------------------------
  function cosine(a, b) {
    var dot = 0, na = 0, nb = 0, k;
    for (k in a) { na += a[k] * a[k]; if (b[k]) dot += a[k] * b[k]; }
    for (k in b) nb += b[k] * b[k];
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
  function similarity(c1, c2) {
    var s = cosine(c1.vec, c2.vec);
    if (c1.category === c2.category) s += CFG.categoryBonus;
    return Math.min(1, s);
  }
  function mergeVec(a, b, wa, wb) {
    var out = {}, k;
    for (k in a) out[k] = a[k] * wa;
    for (k in b) out[k] = (out[k] || 0) + b[k] * wb;
    return out;
  }

  // dominant category among member cells (weighted by strength)
  function dominantCategory(cells) {
    var tally = {};
    cells.forEach(function (c) { tally[c.category] = (tally[c.category] || 0) + c.strength; });
    var best = "general", bv = -1;
    Object.keys(tally).forEach(function (k) { if (tally[k] > bv) { bv = tally[k]; best = k; } });
    return best;
  }
  function topKeywords(vec, n) {
    return Object.keys(vec).sort(function (a, b) { return vec[b] - vec[a]; }).slice(0, n || 4);
  }

  // --- one evolution step -----------------------------------------------
  function step(traits, gen) {
    traits = traits.map(cloneTrait);
    var events = [];
    var threshold = Math.max(CFG.minThreshold, CFG.startThreshold - CFG.thresholdStep * (gen - 1));

    // 1) CONVERGENCE — greedily merge most-similar pairs above threshold.
    var merges = 0;
    while (merges < CFG.maxMergesPerGen) {
      var best = null, bi = -1, bj = -1;
      for (var i = 0; i < traits.length; i++) {
        for (var j = i + 1; j < traits.length; j++) {
          var s = similarity(traits[i], traits[j]);
          if (s >= threshold && (!best || s > best)) { best = s; bi = i; bj = j; }
        }
      }
      if (!best) break;
      var A = traits[bi], B = traits[bj];
      var merged = {
        id: A.id,
        members: A.members.concat(B.members),
        subCells: (A.subCells || [A]).concat(B.subCells || [B]),
        vec: mergeVec(A.vec, B.vec, A.strength, B.strength),
        strength: Math.min(1, (A.strength + B.strength) * 0.62 + 0.1), // synergy bump
        category: A.strength >= B.strength ? A.category : B.category,
        session: Math.max(A.session, B.session),
        born: Math.min(A.born, B.born),
        text: A.text
      };
      merged.category = dominantCategory(merged.subCells);
      merged.label = topKeywords(merged.vec, 2).join(" · ");
      traits.splice(bj, 1); traits.splice(bi, 1, merged);
      events.push({ type: "converge", label: merged.label, n: merged.members.length });
      merges++;
    }

    // 2) DIVERGENCE — a broad, over-merged trait splits into specialized
    //    sub-traits. The trick: ignore the generic tag shared by everyone
    //    (e.g. "pronunciation") and look at the distinguishing tags
    //    underneath (e.g. "th-sound" vs "r-l-distinction"). Stripping the
    //    shared tag from the children also keeps them from re-merging.
    var diverged = [];
    var splits = 0;
    traits.forEach(function (t) {
      var subs = t.subCells || [t];
      if (splits < 2 && subs.length >= CFG.divergeFloor) {
        var common = commonTags(subs);
        var stripped = subs.map(function (c) { return { ref: c, vec: stripKeys(c.vec, common) }; });
        if (spreadVec(stripped) >= CFG.divergeSpread) {
          var parts = twoMeansVec(stripped);
          if (parts && parts[0].length >= 2 && parts[1].length >= 2) {
            var c1 = condense(parts[0].map(pick("ref")), t.born, t.id + "a", common);
            var c2 = condense(parts[1].map(pick("ref")), t.born, t.id + "b", common);
            diverged.push(c1, c2);
            events.push({ type: "diverge", label: c1.label + " ⟂ " + c2.label });
            splits++;
            return;
          }
        }
      }
      diverged.push(t);
    });
    traits = diverged;

    // 3) DECAY & CULL (도태) — unreinforced signal fades.
    traits.forEach(function (t) {
      var reinforce = Math.min(0.06, 0.012 * (t.members.length - 1)); // bigger clusters persist
      t.strength = clamp(t.strength - CFG.decay + reinforce, 0, 1);
    });
    var survivors = traits.filter(function (t) {
      var dead = t.strength < CFG.cullFloor && t.members.length <= 1;
      if (dead) events.push({ type: "decay", label: t.label });
      return !dead;
    });

    return { traits: survivors, events: events, threshold: threshold };
  }

  function condense(cells, born, id, stripCommon) {
    var vec = {}, str = 0;
    cells.forEach(function (c) {
      var cv = c.vec;
      for (var k in cv) { if (stripCommon && stripCommon[k]) continue; vec[k] = (vec[k] || 0) + cv[k]; }
      str += c.strength;
    });
    if (!Object.keys(vec).length) cells.forEach(function (c) { for (var k in c.vec) vec[k] = (vec[k] || 0) + c.vec[k]; });
    return {
      id: id,
      members: flatten(cells.map(function (c) { return c.members; })),
      subCells: cells,
      vec: vec,
      strength: clamp(str / cells.length + 0.05, 0, 1),
      category: dominantCategory(cells),
      session: Math.max.apply(null, cells.map(function (c) { return c.session; })),
      born: born,
      label: topKeywords(vec, 2).join(" · "),
      text: cells[0].text
    };
  }

  // tags shared by a majority of the sub-cells (the "generic" label)
  function commonTags(cells) {
    var n = cells.length, count = {};
    cells.forEach(function (c) { for (var k in c.vec) if (c.vec[k] >= 1) count[k] = (count[k] || 0) + 1; });
    var common = {};
    Object.keys(count).forEach(function (k) { if (count[k] >= Math.ceil(n * 0.6)) common[k] = 1; });
    return common;
  }
  function stripKeys(vec, keys) {
    var out = {}; for (var k in vec) if (!keys[k]) out[k] = vec[k];
    return out;
  }
  function pick(field) { return function (o) { return o[field]; }; }

  // intra-group dissimilarity on already-built vectors (1 - avg pairwise cosine)
  function spreadVec(items) {
    if (items.length < 2) return 0;
    var sum = 0, cnt = 0;
    for (var i = 0; i < items.length; i++)
      for (var j = i + 1; j < items.length; j++) { sum += cosine(items[i].vec, items[j].vec); cnt++; }
    return 1 - sum / cnt;
  }
  // 2-means over pre-built {vec} items, returns [groupA, groupB] of items
  function twoMeansVec(items) {
    var a = 0, b = 1, worst = -1;
    for (var i = 0; i < items.length; i++)
      for (var j = i + 1; j < items.length; j++) {
        var d = 1 - cosine(items[i].vec, items[j].vec);
        if (d > worst) { worst = d; a = i; b = j; }
      }
    var ca = items[a].vec, cb = items[b].vec, g1, g2;
    for (var iter = 0; iter < 5; iter++) {
      g1 = []; g2 = [];
      items.forEach(function (it) { (cosine(it.vec, ca) >= cosine(it.vec, cb) ? g1 : g2).push(it); });
      if (!g1.length || !g2.length) return null;
      ca = centroid(g1.map(pick("vec"))); cb = centroid(g2.map(pick("vec")));
    }
    return [g1, g2];
  }

  // centroid of an array of sparse vectors
  function centroid(vecs) {
    var v = {}; vecs.forEach(function (cv) { for (var k in cv) v[k] = (v[k] || 0) + cv[k]; });
    var n = vecs.length; for (var k in v) v[k] /= n; return v;
  }

  // --- maturity score & recommendations ---------------------------------
  function scoreOf(traits, totalCells) {
    if (!traits.length) return 0;
    var consolidated = traits.filter(function (t) { return t.members.length > 1; }).length;
    var cats = {}; traits.forEach(function (t) { cats[t.category] = 1; });
    var coverage = Object.keys(cats).length;
    var avgStrength = traits.reduce(function (s, t) { return s + t.strength; }, 0) / traits.length;
    var compression = totalCells ? 1 - traits.length / totalCells : 0; // how much it converged
    var raw = consolidated * 8 + coverage * 6 + avgStrength * 30 + compression * 40;
    return Math.min(100, Math.round(raw));
  }

  function recommendations(traits) {
    // weakness-weighted priority: low strength + many members + recent
    var ranked = traits.slice().map(function (t) {
      var priority = (1 - t.strength) * 0.5 + Math.min(1, t.members.length / 5) * 0.3 + (t.session / 12) * 0.2;
      return { t: t, p: priority };
    }).sort(function (x, y) { return y.p - x.p; }).slice(0, 3);

    return ranked.map(function (r) {
      var t = r.t;
      var kws = topKeywords(t.vec, 3);
      return {
        focus: t.label,
        category: t.category,
        action: lessonAction(t.category, kws),
        confidence: Math.round(t.strength * 100)
      };
    });
  }
  function lessonAction(cat, kws) {
    var k = kws.join(", ");
    var map = {
      grammar: "타깃 드릴 + 오류 교정 글쓰기로 «" + k + "» 정확도 강화",
      pronunciation: "미니멀 페어 청취·섀도잉으로 «" + k + "» 발음 교정",
      vocabulary: "맥락형 어휘·콜로케이션 확장: «" + k + "»",
      fluency: "타임드 스피킹 / 즉흥 발화로 «" + k + "» 유창성 훈련",
      listening: "받아쓰기·정독 청취로 «" + k + "» 강화",
      writing: "구조화 작문 + 피드백 루프: «" + k + "»",
      confidence: "저부담 발화 환경에서 «" + k + "» 자신감 빌드업",
      errors: "반복 오류 «" + k + "» 집중 교정 세션",
      goals: "목표 «" + k + "» 기준 커리큘럼 재정렬",
      interests: "관심사 «" + k + "» 소재로 몰입형 수업 설계",
      general: "«" + k + "» 관련 통합 복습"
    };
    return map[cat] || map.general;
  }

  // --- public: run the full lineage up to N generations -----------------
  function lineage(notes, maxGen) {
    maxGen = maxGen || 8;
    var cells = cellsFromNotes(notes);
    var gen0 = cells.map(function (c) { return Object.assign(cloneTrait(c), { subCells: [c] }); });
    var snapshots = [{
      gen: 0, traits: gen0,
      events: [{ type: "ingest", label: cells.length + "개 관찰 유입" }],
      score: scoreOf(gen0, cells.length),
      recommendations: recommendations(gen0),
      threshold: CFG.startThreshold
    }];
    var current = gen0;
    for (var g = 1; g <= maxGen; g++) {
      var r = step(current, g);
      current = r.traits;
      snapshots.push({
        gen: g, traits: current, events: r.events,
        score: scoreOf(current, cells.length),
        recommendations: recommendations(current),
        threshold: r.threshold
      });
      // Stop once the threshold has bottomed out AND the structure has settled
      // (no events for two consecutive generations) — otherwise keep loosening.
      var settled = !r.events.length && !snapshots[g - 1].events.length;
      if (r.threshold <= CFG.minThreshold && settled) break;
    }
    return { snapshots: snapshots, totalCells: cells.length };
  }

  function cloneTrait(t) {
    return {
      id: t.id, members: t.members.slice(), label: t.label, category: t.category,
      vec: Object.assign({}, t.vec), strength: t.strength, session: t.session,
      text: t.text, born: t.born || 0,
      subCells: t.subCells ? t.subCells.slice() : undefined
    };
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function flatten(a) { return a.reduce(function (x, y) { return x.concat(y); }, []); }

  window.Amoeba = {
    lineage: lineage, topKeywords: topKeywords, CFG: CFG, cellsFromNotes: cellsFromNotes
  };
})();
