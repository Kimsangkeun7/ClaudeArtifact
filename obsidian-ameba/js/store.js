/* store.js — persistence + in-memory model.
   A "note" = { id, path, title, content (full md incl frontmatter), updated }.
   Frontmatter (student, category, tags, strength, date, session, type) is parsed on demand. */
(function () {
  "use strict";

  var KEY = "obsidian-ameba/v1";

  var state = {
    notes: {},     // id -> note
    students: {},  // name -> { name, level, goal, color, createdAt }
    activeId: null
  };

  var listeners = [];
  function emit() { listeners.forEach(function (f) { f(state); }); }
  function subscribe(f) { listeners.push(f); }

  function uid() { return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        notes: state.notes, students: state.students, activeId: state.activeId
      }));
    } catch (e) { console.warn("save failed", e); }
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      state.notes = data.notes || {};
      state.students = data.students || {};
      state.activeId = data.activeId || null;
      return Object.keys(state.notes).length > 0;
    } catch (e) { return false; }
  }

  // --- Notes -------------------------------------------------------------
  function meta(note) {
    var fm = MD.parseFrontmatter(note.content).data;
    return fm;
  }
  function title(note) {
    // first H1, else filename
    var m = /^#\s+(.+)$/m.exec(MD.parseFrontmatter(note.content).body);
    if (m) return m[1].trim();
    return note.path.replace(/.*\//, "").replace(/\.md$/, "");
  }

  function allNotes() {
    return Object.keys(state.notes).map(function (id) { return state.notes[id]; });
  }

  function createNote(path, content) {
    var id = uid();
    state.notes[id] = { id: id, path: path, content: content || "# 새 노트\n\n", updated: Date.now() };
    save(); emit();
    return id;
  }

  function updateNote(id, content) {
    if (!state.notes[id]) return;
    state.notes[id].content = content;
    state.notes[id].updated = Date.now();
    save(); emit();
  }

  function deleteNote(id) {
    delete state.notes[id];
    if (state.activeId === id) state.activeId = null;
    save(); emit();
  }

  function setActive(id) { state.activeId = id; save(); }

  function noteByName(name) {
    name = name.toLowerCase();
    var list = allNotes();
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (title(n).toLowerCase() === name) return n;
      var base = n.path.replace(/.*\//, "").replace(/\.md$/, "").toLowerCase();
      if (base === name) return n;
    }
    return null;
  }

  // --- Students ----------------------------------------------------------
  var PALETTE = ["#7c6cff", "#4ec9a0", "#e2a04a", "#e35d6a", "#5aa9e6", "#c792ea", "#f78c6c", "#79b8ff"];
  function ensureStudent(name, opts) {
    if (!name) return;
    if (!state.students[name]) {
      var idx = Object.keys(state.students).length % PALETTE.length;
      state.students[name] = {
        name: name,
        level: (opts && opts.level) || "—",
        goal: (opts && opts.goal) || "",
        color: (opts && opts.color) || PALETTE[idx],
        createdAt: Date.now()
      };
      save();
    } else if (opts) {
      Object.assign(state.students[name], opts);
      save();
    }
    return state.students[name];
  }
  function allStudents() {
    return Object.keys(state.students).map(function (k) { return state.students[k]; });
  }
  function studentColor(name) {
    return (state.students[name] && state.students[name].color) || "#888";
  }

  // notes belonging to a student
  function notesForStudent(name) {
    return allNotes().filter(function (n) { return meta(n).student === name; });
  }

  // sync students from note frontmatter
  function syncStudents() {
    allNotes().forEach(function (n) {
      var s = meta(n).student;
      if (s) ensureStudent(s);
    });
  }

  function exportJSON() {
    return JSON.stringify({ notes: state.notes, students: state.students }, null, 2);
  }
  function importJSON(json) {
    var data = JSON.parse(json);
    if (data.notes) Object.assign(state.notes, data.notes);
    if (data.students) Object.assign(state.students, data.students);
    syncStudents(); save(); emit();
  }

  window.Store = {
    state: state, subscribe: subscribe, emit: emit, save: save, load: load,
    meta: meta, title: title, allNotes: allNotes,
    createNote: createNote, updateNote: updateNote, deleteNote: deleteNote,
    setActive: setActive, noteByName: noteByName,
    ensureStudent: ensureStudent, allStudents: allStudents, studentColor: studentColor,
    notesForStudent: notesForStudent, syncStudents: syncStudents,
    exportJSON: exportJSON, importJSON: importJSON, uid: uid
  };
})();
