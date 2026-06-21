/* Headless test of the Amoeba engine against the seed vault.
   Usage:  node tools/test-engine.js   (run from the obsidian-ameba dir) */
const fs = require("fs");
const path = require("path");
const store = {};
global.localStorage = { getItem: k => store[k] || null, setItem: (k, v) => store[k] = v, removeItem: k => delete store[k] };
global.window = global;            // so `window.X = ...` becomes a global
global.document = { addEventListener() {} };
function load(f) { eval(fs.readFileSync(path.join(__dirname, "..", f), "utf8")); }
["js/markdown.js", "js/store.js", "js/vault.js", "js/amoeba.js", "js/seed.js"].forEach(load);

window.SEED.forEach(f => Store.createNote(f.path.replace(/^vault\//, ""), f.content));
Store.syncStudents();

let ok = true;
Store.allStudents().forEach(s => {
  const notes = Store.notesForStudent(s.name);
  const lin = Amoeba.lineage(notes, 8);
  const first = lin.snapshots[0], last = lin.snapshots[lin.snapshots.length - 1];
  const events = lin.snapshots.flatMap(x => x.events.map(e => e.type));
  console.log(`\n=== ${s.name} ===  notes=${notes.length} gens=${lin.snapshots.length}`);
  console.log(` traits ${first.traits.length} → ${last.traits.length}   score ${first.score} → ${last.score}`);
  console.log(` converge=${events.filter(e => e === "converge").length} diverge=${events.filter(e => e === "diverge").length}`);
  console.log(" final:", last.traits.map(t => `${t.label}(${t.category},m${t.members.length})`).join(" | "));
  if (last.traits.length >= first.traits.length) { console.log(" !! expected convergence"); ok = false; }
  if (last.score < first.score) { console.log(" !! expected score to rise"); ok = false; }
});
console.log("\n" + (ok ? "PASS — all students converged and matured." : "FAIL"));
process.exit(ok ? 0 : 1);
