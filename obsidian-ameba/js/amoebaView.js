/* amoebaView.js — organic visualization of one generation's traits.
   Each trait is a "nucleus" cell inside a wobbling amoeba membrane; size = strength,
   color = category, satellite dots = member observations. */
(function () {
  "use strict";

  var CAT_COLOR = {
    grammar: "#7c6cff", pronunciation: "#e2a04a", vocabulary: "#4ec9a0",
    fluency: "#5aa9e6", listening: "#c792ea", writing: "#f78c6c",
    confidence: "#79b8ff", errors: "#e35d6a", goals: "#9ae6b4",
    interests: "#f6c177", general: "#9a9a9a"
  };
  function catColor(c) { return CAT_COLOR[c] || "#9a9a9a"; }

  function AmoebaView(canvas, opts) {
    this.canvas = canvas; this.ctx = canvas.getContext("2d");
    this.opts = opts || {}; this.cells = []; this.t = 0; this.raf = null;
    this.hover = null; this.snapshot = null;
    this._bind();
  }

  AmoebaView.prototype.resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  AmoebaView.prototype.setSnapshot = function (snap) {
    var W = this.canvas.clientWidth || 700, H = this.canvas.clientHeight || 500;
    var prev = {}; this.cells.forEach(function (c) { prev[c.id] = c; });
    var traits = snap.traits.slice().sort(function (a, b) { return b.strength - a.strength; });
    var n = traits.length;
    this.cells = traits.map(function (t, i) {
      var p = prev[t.id];
      var ang = (i / Math.max(1, n)) * Math.PI * 2;
      var rad = n === 1 ? 0 : (60 + (i % 3) * 46);
      return {
        id: t.id, trait: t,
        x: p ? p.x : W / 2 + Math.cos(ang) * rad,
        y: p ? p.y : H / 2 + Math.sin(ang) * rad * 0.8,
        tx: W / 2 + Math.cos(ang) * rad,
        ty: H / 2 + Math.sin(ang) * rad * 0.8,
        r: 14 + t.strength * 34 + Math.min(20, (t.members.length - 1) * 3),
        color: catColor(t.category),
        phase: Math.random() * 6.28
      };
    });
    this.snapshot = snap;
    this.start();
  };

  AmoebaView.prototype.start = function () {
    if (this._running) return; this._running = true;
    var self = this;
    (function loop() { self.draw(); self.raf = requestAnimationFrame(loop); })();
  };
  AmoebaView.prototype.stop = function () { this._running = false; if (this.raf) cancelAnimationFrame(this.raf); };

  AmoebaView.prototype.draw = function () {
    var ctx = this.ctx, W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    this.t += 0.016;
    ctx.clearRect(0, 0, W, H);
    if (!this.cells.length) {
      ctx.fillStyle = "#6a6a6a"; ctx.font = "14px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("노트가 없습니다. 학생 노트를 추가하거나 볼트를 가져오세요.", W / 2, H / 2);
      return;
    }
    // ease toward layout targets + gentle float
    this.cells.forEach(function (c) {
      c.x += (c.tx - c.x) * 0.06;
      c.y += (c.ty - c.y) * 0.06;
    });

    // outer membrane: blobby hull around all cells
    this._drawMembrane(ctx);

    // links between same-category cells (faint web)
    for (var i = 0; i < this.cells.length; i++)
      for (var j = i + 1; j < this.cells.length; j++) {
        var a = this.cells[i], b = this.cells[j];
        if (a.trait.category === b.trait.category) {
          ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }

    // cells
    var self = this;
    this.cells.forEach(function (c) {
      var wob = Math.sin(self.t * 1.4 + c.phase) * 2.2;
      var r = c.r + wob;
      // satellites = member observations orbiting
      var mn = Math.min(c.trait.members.length, 12);
      for (var k = 0; k < mn; k++) {
        var ang = self.t * 0.5 + (k / mn) * Math.PI * 2 + c.phase;
        var orb = r + 9;
        ctx.beginPath();
        ctx.arc(c.x + Math.cos(ang) * orb, c.y + Math.sin(ang) * orb, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = c.color; ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
      }
      // nucleus
      var grad = ctx.createRadialGradient(c.x - r * 0.3, c.y - r * 0.3, r * 0.2, c.x, c.y, r);
      grad.addColorStop(0, lighten(c.color));
      grad.addColorStop(1, c.color);
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad; ctx.fill();
      if (c === self.hover) { ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke(); }
      // label
      ctx.fillStyle = "#fff"; ctx.font = (c.r > 26 ? "12px" : "10px") + " sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var lbl = c.trait.label || c.trait.category;
      if (c.r > 18) ctx.fillText(lbl.slice(0, 14), c.x, c.y);
    });

    // HUD: generation + score
    if (this.snapshot) {
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = "12px sans-serif";
      ctx.fillText("Gen " + this.snapshot.gen + " · 특질 " + this.cells.length +
        "개 · 고도화 " + this.snapshot.score, 14, H - 14);
    }
  };

  AmoebaView.prototype._drawMembrane = function (ctx) {
    var cx = 0, cy = 0; this.cells.forEach(function (c) { cx += c.x; cy += c.y; });
    cx /= this.cells.length; cy /= this.cells.length;
    var maxR = 40; this.cells.forEach(function (c) {
      var d = Math.hypot(c.x - cx, c.y - cy) + c.r; if (d > maxR) maxR = d;
    });
    maxR += 26;
    ctx.beginPath();
    var steps = 48;
    for (var i = 0; i <= steps; i++) {
      var a = (i / steps) * Math.PI * 2;
      var wob = Math.sin(a * 3 + this.t) * 10 + Math.cos(a * 5 - this.t * 0.7) * 7;
      var rr = maxR + wob;
      var x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.92;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(124,108,255,0.07)";
    ctx.fill();
    ctx.strokeStyle = "rgba(167,139,250,0.25)"; ctx.lineWidth = 1.5; ctx.stroke();
  };

  AmoebaView.prototype._bind = function () {
    var self = this, c = this.canvas;
    c.addEventListener("mousemove", function (ev) {
      var r = c.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      self.hover = null;
      for (var i = self.cells.length - 1; i >= 0; i--) {
        var cl = self.cells[i];
        if (Math.hypot(cl.x - mx, cl.y - my) <= cl.r) { self.hover = cl; break; }
      }
      c.style.cursor = self.hover ? "pointer" : "default";
    });
    c.addEventListener("click", function () {
      if (self.hover && self.opts.onPick) self.opts.onPick(self.hover.trait);
    });
  };

  function lighten(hex) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, (n >> 16) + 60), g = Math.min(255, ((n >> 8) & 255) + 60), b = Math.min(255, (n & 255) + 60);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  window.AmoebaView = AmoebaView;
  window.AmoebaView.catColor = catColor;
})();
