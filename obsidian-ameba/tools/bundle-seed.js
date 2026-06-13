/* Regenerate js/seed.js from the /vault markdown files.
   Usage:  node tools/bundle-seed.js   (run from the obsidian-ameba dir) */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "vault");
const out = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp);
    else if (e.name.endsWith(".md")) {
      const rel = path.relative(root, fp).split(path.sep).join("/");
      out.push({ path: rel, content: fs.readFileSync(fp, "utf8") });
    }
  }
}
walk(root);
const banner = "/* seed.js — auto-generated from /vault by tools/bundle-seed.js. Embedded demo vault\n" +
  "   so the app works standalone on first load (no import needed). */\n";
const dest = path.join(__dirname, "..", "js", "seed.js");
fs.writeFileSync(dest, banner + "window.SEED = " + JSON.stringify(out) + ";\n");
console.log("Bundled " + out.length + " notes into js/seed.js (" + (fs.statSync(dest).size / 1024).toFixed(1) + " KB)");
