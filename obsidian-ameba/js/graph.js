/* graph.js — force-directed graph of notes (canvas). */
(function () {
  "use strict";

  function Graph(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = opts || {};
    this.nodes = []; this.edges = [];
    this.raf = null; this.running = false;
    this.hover = null; this.dragging = null;
    this.tx = 0; this.ty = 0; this.scale = 1;
    this._bind();
  }

  Graph.prototype.setData = function (model) {
    var self = this;
    var prev = {}; this.nodes.forEach(function (n) { prev[n.id] = n; });
    var W = this.canvas.clientWidth || 800, H = this.canvas.clientHeight || 600;
    this.nodes = model.nodes.map(function (nd) {
      var p = prev[nd.id];
      return Object.assign({}, nd, {
        x: p ? p.x : W / 2 + (Math.random() - 0.5) * 300,
        y: p ? p.y : H / 2 + (Math.random() - 0.5) * 300,
        vx: 0, vy: 0,
        r: 5 + Math.min(10, nd.degree * 1.6)
      });
    });
    var byId = {}; this.nodes.forEach(function (n) { byId[n.id] = n; });
    this.edges = model.edges.map(function (e) { return { a: byId[e.a], b: byId[e.b], kind: e.kind, w: e.w }; })
      .filter(function (e) { return e.a && e.b; });
    this.alpha = 1;
    this.start();
  };

  Graph.prototype.resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  Graph.prototype.start = function () {
    if (this.running) return;
    this.running = true; this.alpha = Math.max(this.alpha || 0, 0.9);
    var self = this;
    (function loop() { self.tick(); self.raf = requestAnimationFrame(loop); })();
  };
  Graph.prototype.stop = function () { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); };

  Graph.prototype.tick = function () {
    var n = this.nodes, e = this.edges;
    var W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    var cx = W / 2, cy = H / 2;
    var a = this.alpha;
    // repulsion
    for (var i = 0; i < n.length; i++) {
      var A = n[i];
      for (var j = i + 1; j < n.length; j++) {
        var B = n[j];
        var dx = A.x - B.x, dy = A.y - B.y;
        var d2 = dx * dx + dy * dy + 0.01;
        var f = 2600 / d2;
        var d = Math.sqrt(d2);
        var fx = (dx / d) * f, fy = (dy / d) * f;
        A.vx += fx; A.vy += fy; B.vx -= fx; B.vy -= fy;
      }
      // gravity to center
      A.vx += (cx - A.x) * 0.0016;
      A.vy += (cy - A.y) * 0.0016;
    }
    // springs
    e.forEach(function (ed) {
      var dx = ed.b.x - ed.a.x, dy = ed.b.y - ed.a.y;
      var d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      var rest = ed.kind === "link" ? 70 : 110;
      var f = (d - rest) * 0.02 * (ed.kind === "link" ? 1.4 : 0.7);
      var fx = (dx / d) * f, fy = (dy / d) * f;
      ed.a.vx += fx; ed.a.vy += fy; ed.b.vx -= fx; ed.b.vy -= fy;
    });
    n.forEach(function (A) {
      if (A === this.dragging) { A.vx = 0; A.vy = 0; return; }
      A.x += A.vx * a * 0.5; A.y += A.vy * a * 0.5;
      A.vx *= 0.82; A.vy *= 0.82;
    }, this);
    this.alpha *= 0.992;
    if (this.alpha < 0.03 && !this.dragging) this.stop();
    this.draw();
  };

  Graph.prototype.draw = function () {
    var ctx = this.ctx, W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(this.tx, this.ty); ctx.scale(this.scale, this.scale);
    // edges
    this.edges.forEach(function (e) {
      ctx.strokeStyle = e.kind === "link" ? "rgba(138,169,255,0.35)" : "rgba(124,108,255,0.14)";
      ctx.lineWidth = e.kind === "link" ? 1.2 : 0.8;
      ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
    });
    // nodes
    var hover = this.hover;
    this.nodes.forEach(function (nd) {
      var color = nd.student ? Store.studentColor(nd.student) : (nd.type === "concept" ? "#5aa9e6" : "#9a9a9a");
      ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.globalAlpha = nd === hover ? 1 : 0.92; ctx.fill();
      ctx.globalAlpha = 1;
      if (nd === hover || nd.r > 9 || nd === this.dragging) {
        ctx.fillStyle = "#dcddde"; ctx.font = "11px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(nd.label.slice(0, 22), nd.x, nd.y - nd.r - 5);
      }
    }, this);
    ctx.restore();
  };

  Graph.prototype._screenToWorld = function (mx, my) {
    return { x: (mx - this.tx) / this.scale, y: (my - this.ty) / this.scale };
  };
  Graph.prototype._pick = function (mx, my) {
    var p = this._screenToWorld(mx, my);
    for (var i = this.nodes.length - 1; i >= 0; i--) {
      var nd = this.nodes[i];
      var dx = nd.x - p.x, dy = nd.y - p.y;
      if (dx * dx + dy * dy <= (nd.r + 4) * (nd.r + 4)) return nd;
    }
    return null;
  };

  Graph.prototype._bind = function () {
    var self = this, c = this.canvas;
    c.addEventListener("mousemove", function (ev) {
      var r = c.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      if (self.dragging) {
        var p = self._screenToWorld(mx, my);
        self.dragging.x = p.x; self.dragging.y = p.y; self.start(); return;
      }
      var hit = self._pick(mx, my);
      self.hover = hit; c.style.cursor = hit ? "pointer" : "default";
      if (!self.running) self.draw();
    });
    c.addEventListener("mousedown", function (ev) {
      var r = c.getBoundingClientRect();
      self.dragging = self._pick(ev.clientX - r.left, ev.clientY - r.top);
      if (self.dragging) self._moved = false;
      else self._pan = { x: ev.clientX, y: ev.clientY, tx: self.tx, ty: self.ty };
    });
    window.addEventListener("mousemove", function (ev) {
      if (self._pan) {
        self.tx = self._pan.tx + (ev.clientX - self._pan.x);
        self.ty = self._pan.ty + (ev.clientY - self._pan.y);
        if (!self.running) self.draw();
      }
      if (self.dragging) self._moved = true;
    });
    window.addEventListener("mouseup", function (ev) {
      if (self.dragging && !self._moved && self.opts.onOpen) self.opts.onOpen(self.dragging.id);
      self.dragging = null; self._pan = null;
    });
    c.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      var r = c.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      var before = self._screenToWorld(mx, my);
      self.scale *= ev.deltaY < 0 ? 1.1 : 0.9;
      self.scale = Math.max(0.2, Math.min(4, self.scale));
      var after = self._screenToWorld(mx, my);
      self.tx += (after.x - before.x) * self.scale;
      self.ty += (after.y - before.y) * self.scale;
      if (!self.running) self.draw();
    }, { passive: false });
  };

  window.GraphView = Graph;
})();
