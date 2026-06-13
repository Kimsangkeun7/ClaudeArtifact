/* vault.js — link graph utilities over Store. */
(function () {
  "use strict";

  function outLinks(note) {
    var body = MD.parseFrontmatter(note.content).body;
    var links = [];
    var re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, m;
    while ((m = re.exec(body))) links.push(m[1].trim());
    return links;
  }

  // backlinks: notes that link to the given note (by title or filename)
  function backlinks(note) {
    var targetTitle = Store.title(note).toLowerCase();
    var base = note.path.replace(/.*\//, "").replace(/\.md$/, "").toLowerCase();
    var res = [];
    Store.allNotes().forEach(function (n) {
      if (n.id === note.id) return;
      var links = outLinks(n).map(function (l) { return l.toLowerCase(); });
      if (links.indexOf(targetTitle) !== -1 || links.indexOf(base) !== -1) {
        // grab a context line
        var body = MD.parseFrontmatter(n.content).body;
        var ctx = "";
        body.split("\n").some(function (line) {
          if (/\[\[/.test(line) && new RegExp("\\[\\[\\s*(" + escapeReg(targetTitle) + "|" + escapeReg(base) + ")", "i").test(line)) {
            ctx = line.replace(/[#>*_]/g, "").trim(); return true;
          }
          return false;
        });
        res.push({ note: n, ctx: ctx });
      }
    });
    return res;
  }

  function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // Build a graph model: nodes (notes) + edges (wikilinks + shared tags)
  function buildGraph(opts) {
    opts = opts || {};
    var notes = Store.allNotes();
    var nodes = notes.map(function (n) {
      var fm = Store.meta(n);
      return {
        id: n.id,
        label: Store.title(n),
        student: fm.student || null,
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        type: fm.type || (fm.student ? "session" : "note"),
        degree: 0
      };
    });
    var byId = {};
    nodes.forEach(function (nd) { byId[nd.id] = nd; });

    var edges = [];
    var seen = {};
    function addEdge(a, b, kind) {
      if (a === b) return;
      var key = a < b ? a + "|" + b : b + "|" + a;
      if (seen[key]) { seen[key].w += 1; return; }
      var e = { a: a, b: b, kind: kind, w: 1 };
      seen[key] = e; edges.push(e);
      byId[a].degree++; byId[b].degree++;
    }

    // wikilink edges
    notes.forEach(function (n) {
      outLinks(n).forEach(function (l) {
        var t = Store.noteByName(l);
        if (t) addEdge(n.id, t.id, "link");
      });
    });
    // shared-tag edges
    if (opts.tags !== false) {
      for (var i = 0; i < nodes.length; i++) {
        for (var j = i + 1; j < nodes.length; j++) {
          var shared = nodes[i].tags.filter(function (t) { return nodes[j].tags.indexOf(t) !== -1; });
          if (shared.length >= 2) addEdge(nodes[i].id, nodes[j].id, "tag");
        }
      }
    }
    return { nodes: nodes, edges: edges };
  }

  function search(query) {
    query = query.toLowerCase().trim();
    if (!query) return Store.allNotes();
    return Store.allNotes().filter(function (n) {
      var fm = Store.meta(n);
      var hay = (n.content + " " + (fm.tags || []).join(" ") + " " + (fm.student || "")).toLowerCase();
      return hay.indexOf(query) !== -1;
    });
  }

  window.Vault = {
    outLinks: outLinks, backlinks: backlinks, buildGraph: buildGraph, search: search
  };
})();
