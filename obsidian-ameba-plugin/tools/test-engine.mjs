import esbuild from "esbuild";
import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
const __d = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__d, "_engine.cjs");
await esbuild.build({ entryPoints: [path.join(__d, "../src/engine.ts")], outfile: out, bundle: true, format: "cjs", platform: "node", logLevel: "error" });
const E = await import("file://" + out);
const vaultDir = path.join(__d, "../../obsidian-ameba/vault");
function walk(d){ return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{const p=path.join(d,e.name); return e.isDirectory()?walk(p):(e.name.endsWith(".md")?[p]:[]);}); }
function fm(text){ const m=/^---\n([\s\S]*?)\n---\n?/.exec(text); const d={}; let body=text; if(m){body=text.slice(m[0].length); m[1].split("\n").forEach(l=>{const mm=/^([\w-]+):\s*(.*)$/.exec(l); if(!mm)return; let v=mm[2].trim(); if(v[0]==="["){v=v.slice(1,-1).split(",").map(s=>s.trim()).filter(Boolean);} else if(/^-?\d+(\.\d+)?$/.test(v)) v=parseFloat(v); d[mm[1]]=v;});} return {d,body}; }
const byStudent={};
for(const f of walk(vaultDir)){ const {d,body}=fm(fs.readFileSync(f,"utf8")); if(d.student==null) continue;
  (byStudent[d.student] ||= []).push({ path:f, title:path.basename(f), student:String(d.student), category:typeof d.category==="string"?d.category:"general", tags:Array.isArray(d.tags)?d.tags:[], strength:typeof d.strength==="number"?d.strength:0.55, session:d.session||0, body }); }
let ok=true;
for(const [name,notes] of Object.entries(byStudent)){
  let cells = E.cellsFromNotes(notes); const start=cells.length; let merges=0,splits=0;
  for(let iter=0; iter<200; iter++){ let acted=false;
    for(const c of cells){ if(E.shouldSplit(c)){ const p=E.split(c); if(p){ cells=cells.filter(x=>x!==c).concat(p); splits++; acted=true; break; } } }
    if(acted) continue;
    let bi=-1,bj=-1,bs=0;
    for(let i=0;i<cells.length;i++)for(let j=i+1;j<cells.length;j++){ if(E.shouldMerge(cells[i],cells[j])){ const s=E.similarity(cells[i],cells[j]); if(s>bs){bs=s;bi=i;bj=j;} } }
    if(bi>=0){ const m=E.merge(cells[bi],cells[bj]); cells=cells.filter((_,k)=>k!==bi&&k!==bj).concat(m); merges++; acted=true; }
    if(!acted) break; }
  const sc=E.score(cells,start);
  console.log(`\n=== ${name} ===  notes=${start} → traits=${cells.length}  merges=${merges} splits=${splits} score=${sc}`);
  console.log(" final:", cells.map(c=>`${c.label}(${c.category},m${c.members.length})`).join(" | "));
  if(cells.length>=start){ console.log(" !! no convergence"); ok=false; } }
fs.unlinkSync(out);
console.log("\n"+(ok?"PASS":"FAIL"));

// --- AI(semantic) path smoke test with fabricated embeddings ---------------
{
  const E2 = E;
  E2.setAI(true, 0.6);
  // build a tag vocabulary -> notes sharing tags get similar embeddings
  const vocab = {};
  for (const notes of Object.values(byStudent)) for (const n of notes) (n.tags||[]).forEach(t=>{ if(!(t in vocab)) vocab[t]=Object.keys(vocab).length; });
  const dim = Math.max(4, Object.keys(vocab).length);
  const embByPath = {};
  for (const notes of Object.values(byStudent)) for (const n of notes) {
    const v = new Array(dim).fill(0.0);
    (n.tags||[]).forEach(t=>{ v[vocab[t]] = 1; });
    v[ (n.category.length) % dim ] += 0.3;   // category nudge
    embByPath[n.path] = v;
  }
  let aiOk = true;
  for (const [name, notes] of Object.entries(byStudent)) {
    let cells = E2.cellsFromNotes(notes, embByPath); const start = cells.length; let merges=0, splits=0;
    for (let iter=0; iter<200; iter++){ let acted=false;
      for (const c of cells){ if (E2.shouldSplit(c)){ const p=E2.split(c); if(p){ cells=cells.filter(x=>x!==c).concat(p); splits++; acted=true; break; } } }
      if (acted) continue;
      let bi=-1,bj=-1,bs=0;
      for (let i=0;i<cells.length;i++)for(let j=i+1;j<cells.length;j++){ if(E2.shouldMerge(cells[i],cells[j])){ const s=E2.similarity(cells[i],cells[j]); if(s>bs){bs=s;bi=i;bj=j;} } }
      if (bi>=0){ const m=E2.merge(cells[bi],cells[bj]); if(!m.emb){ console.log(" !! merged cell lost embedding"); aiOk=false; } cells=cells.filter((_,k)=>k!==bi&&k!==bj).concat(m); merges++; acted=true; }
      if (!acted) break; }
    console.log(`[AI] ${name}: ${start} → ${cells.length} (merges=${merges} splits=${splits}) score=${E2.score(cells,start)}`);
    if (cells.length>=start) { console.log(" !! AI path no convergence"); aiOk=false; }
  }
  console.log("[AI] " + (aiOk?"PASS":"FAIL"));
  if (!aiOk) process.exit(1);
}

process.exit(0);
