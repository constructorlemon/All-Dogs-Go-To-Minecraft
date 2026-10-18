(function () {
  'use strict';
  var THREE = window.THREE;

  var FACE = 16;
  var GUTTER = 2;
  var PITCH = FACE + GUTTER;
  var COLS = 3;
  var ROWS = 2;
  var W = PITCH * COLS;
  var H = PITCH * ROWS;

  function cellOf(face) {
    return { x: (face % COLS) * PITCH, y: Math.floor(face / COLS) * PITCH };
  }

  function faceFromNormal(x, y, z) {
    if (x > 0.5) return 0;
    if (x < -0.5) return 1;
    if (y > 0.5) return 2;
    if (y < -0.5) return 3;
    if (z > 0.5) return 4;
    return 5;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  class TextureEditor {
    constructor() {
      this.run();
    }

    run() {
      var self = this;

      this.tool = 'brush';
      this.brushRgba = this.hexToRgba('#8b5a2b');
      this.brushSize = 2;
      this.grain = 0.7;
      this.blend = 'normal';
      this.shapeFill = true;
      this.autoRotate = true;
      this.interacting = false;
      this.blockName = 'block_texture';
      this.rotation = 'none';
      this.undoStack = [];
      this.redoStack = [];
      this.maxUndo = 80;
      this._anchor = null;
      this._strokeBase = null;

      this.pixels = new Uint8ClampedArray(W * H * 4);

      this.canvas = document.createElement('canvas');
      this.canvas.width = W;
      this.canvas.height = H;
      this.ctx = this.canvas.getContext('2d');

      this.texture = new THREE.DataTexture(new Uint8Array(W * H * 4), W, H, THREE.RGBAFormat);
      this.texture.magFilter = THREE.NearestFilter;
      this.texture.minFilter = THREE.NearestFilter;
      this.texture.generateMipmaps = false;
      this.texture.needsUpdate = true;

      this.stage = document.getElementById('stage');
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.stage.appendChild(this.renderer.domElement);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x3a3f47);

      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
      this.camera.position.set(2.3, 1.5, 2.7);
      this.camera.lookAt(0, 0, 0);

      var hemi = new THREE.HemisphereLight(0xffffff, 0x8a8578, 1.0);
      var sun = new THREE.DirectionalLight(0xffffff, 1.15);
      sun.position.set(3, 5, 4);
      this.scene.add(hemi, sun);

      this.geo = this.buildCubeGeometry();
      this.material = new THREE.MeshLambertMaterial({ map: this.texture });
      this.cube = new THREE.Mesh(this.geo, this.material);
      this._transparent = false;
      this.cube.rotation.x = -0.45;
      this.cube.rotation.y = 0.55;
      this.cube.scale.setScalar(1.35);
      this.scene.add(this.cube);
      this.addFaceLabels();

      this.raycaster = new THREE.Raycaster();
      this._ndc = new THREE.Vector2();

      this.flat = document.getElementById('mod-flat');
      this.flat.width = W;
      this.flat.height = H;
      this.fctx = this.flat.getContext('2d');

      this._seen = new Uint8Array(FACE * FACE);

      this._bindTools();
      this._bindPointer();
      this.release();
      this.refreshExportName();
      window.addEventListener('resize', function () { self.release(); });
      this.invalidate();
      this._loop();
    }

    addFaceLabels() {
      var defs = [
        { text: 'Right', pos: [0.53, 0, 0] },
        { text: 'Left', pos: [-0.53, 0, 0] },
        { text: 'Top', pos: [0, 0.53, 0] },
        { text: 'Bottom', pos: [0, -0.53, 0] },
        { text: 'Back', pos: [0, 0, 0.53] },
        { text: 'Forward', pos: [0, 0, -0.53] }
      ];
      for (var i = 0; i < defs.length; i++) {
        var sprite = this.makeLabel(defs[i].text);
        sprite.position.set(defs[i].pos[0], defs[i].pos[1], defs[i].pos[2]);
        this.cube.add(sprite);
      }
    }

    makeLabel(text) {
      var c = document.createElement('canvas');
      c.width = 128;
      c.height = 64;
      var g = c.getContext('2d');
      g.clearRect(0, 0, 128, 64);
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(6, 14, 116, 36);
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 2;
      g.strokeRect(6, 14, 116, 36);
      g.fillStyle = '#ffffff';
      g.font = 'bold 26px "Courier New", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 64, 33);
      var tex = new THREE.CanvasTexture(c);
      tex.minFilter = THREE.LinearFilter;
      var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
      var sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.5, 0.25, 1);
      return sprite;
    }

    buildCubeGeometry() {
      var geo = new THREE.BoxGeometry(1, 1, 1);
      var nrm = geo.attributes.normal.array;
      var uv = geo.attributes.uv.array;
      var n = uv.length / 2;
      for (var i = 0; i < n; i++) {
        var cell = cellOf(faceFromNormal(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]));
        var u = uv[i * 2];
        var vv = uv[i * 2 + 1];
        uv[i * 2] = (cell.x + u * FACE) / W;
        uv[i * 2 + 1] = (cell.y + (1 - vv) * FACE) / H;
      }
      geo.attributes.uv.needsUpdate = true;
      return geo;
    }

    release() {
      var w = this.stage.clientWidth || 240;
      var h = this.stage.clientHeight || 220;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    makeImageData() {
      var id = this.ctx.createImageData(W, H);
      id.data.set(this.pixels);
      return id;
    }

    faceTransparency() {
      var out = [];
      for (var f = 0; f < 6; f++) {
        var c = cellOf(f);
        var has = false;
        for (var y = 0; y < FACE && !has; y++) {
          for (var x = 0; x < FACE; x++) {
            if (this.pixels[((c.y + y) * W + (c.x + x)) * 4 + 3] < 255) {
              has = true;
              break;
            }
          }
        }
        if (has) out.push(f);
      }
      return out;
    }

    updateTransparency() {
      var faces = this.faceTransparency();
      var t = faces.length > 0;
      if (t !== this._transparent) {
        this._transparent = t;
        this.material.transparent = t;
        this.material.alphaTest = t ? 0.5 : 0;
        this.material.side = t ? THREE.DoubleSide : THREE.FrontSide;
        this.material.needsUpdate = true;
      }
      var el = document.getElementById('mod-status');
      if (!el) return;
      if (t) {
        var names = ['Right', 'Left', 'Top', 'Bottom', 'Back', 'Forward'];
        el.textContent = 'Transparent block \u2014 see-through faces: ' +
          faces.map(function (f) { return names[f]; }).join(', ');
        el.classList.add('mod-status-transparent');
      } else {
        el.textContent = 'Opaque block (no transparency)';
        el.classList.remove('mod-status-transparent');
      }
    }

    setPixel(wx, wy, rgba) {
      var i = (wy * W + wx) * 4;
      this.pixels[i] = rgba[0];
      this.pixels[i + 1] = rgba[1];
      this.pixels[i + 2] = rgba[2];
      this.pixels[i + 3] = rgba[3];
    }

    getPixel(wx, wy) {
      var i = (wy * W + wx) * 4;
      return Array.prototype.slice.call(this.pixels, i, i + 4);
    }

    blendChannel(d, s) {
      if (this.blend === 'multiply') return (d * s) / 255;
      if (this.blend === 'lighten') return d > s ? d : s;
      if (this.blend === 'darken') return d < s ? d : s;
      return s;
    }

    blendInto(p, i, rgba) {
      if (rgba[3] === 0 || this.blend === 'normal' || p[i + 3] === 0) {
        p[i] = rgba[0];
        p[i + 1] = rgba[1];
        p[i + 2] = rgba[2];
        p[i + 3] = rgba[3];
        return;
      }
      var a = rgba[3] / 255;
      p[i] = Math.round(p[i] * (1 - a) + this.blendChannel(p[i], rgba[0]) * a);
      p[i + 1] = Math.round(p[i + 1] * (1 - a) + this.blendChannel(p[i + 1], rgba[1]) * a);
      p[i + 2] = Math.round(p[i + 2] * (1 - a) + this.blendChannel(p[i + 2], rgba[2]) * a);
      p[i + 3] = Math.max(p[i + 3], rgba[3]);
    }

    blendPixel(wx, wy, rgba) {
      this.blendInto(this.pixels, (wy * W + wx) * 4, rgba);
    }

    hexToRgba(hex) {
      var v = parseInt(hex.slice(1), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
    }

    rgbToHex(r, g, b) {
      return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    }

    cellPixelFromAtlas(fx, fy) {
      if (fx < 0 || fy < 0 || fx >= W || fy >= H) return null;
      var col = Math.floor(fx / PITCH);
      var row = Math.floor(fy / PITCH);
      if (col >= COLS || row >= ROWS) return null;
      var x0 = col * PITCH;
      var y0 = row * PITCH;
      if (fx >= x0 + FACE || fy >= y0 + FACE) return null;
      return { face: row * COLS + col, x: fx - x0, y: fy - y0 };
    }

    cellFromFlatEvent(e) {
      var r = this.flat.getBoundingClientRect();
      var fx = Math.floor(((e.clientX - r.left) / r.width) * W);
      var fy = Math.floor(((e.clientY - r.top) / r.height) * H);
      return this.cellPixelFromAtlas(fx, fy);
    }

    currentRgba() {
      if (this.tool === 'eraser') return [0, 0, 0, 0];
      return this.brushRgba;
    }

    paintPixel(cell, rgba) {
      if (this.tool === 'texture') { this.paintGrain(cell, rgba); return; }
      var origin = cellOf(cell.face);
      var x = cell.x;
      var y = cell.y;
      var r = Math.max(0, this.brushSize - 1);
      var minX = Math.max(0, x - r);
      var maxX = Math.min(FACE - 1, x + r);
      var minY = Math.max(0, y - r);
      var maxY = Math.min(FACE - 1, y + r);
      var r2 = r * r + 0.25;
      for (var gy = minY; gy <= maxY; gy++) {
        for (var gx = minX; gx <= maxX; gx++) {
          var dx = gx - x;
          var dy = gy - y;
          if (dx * dx + dy * dy > r2) continue;
          this.blendPixel(origin.x + gx, origin.y + gy, rgba);
        }
      }
    }

    paintGrain(cell, rgba) {
      var origin = cellOf(cell.face);
      var r = Math.max(0, this.brushSize - 1);
      var r2 = r * r + 0.25;
      for (var gy = Math.max(0, cell.y - r); gy <= Math.min(FACE - 1, cell.y + r); gy++) {
        for (var gx = Math.max(0, cell.x - r); gx <= Math.min(FACE - 1, cell.x + r); gx++) {
          var dx = gx - cell.x;
          var dy = gy - cell.y;
          if (dx * dx + dy * dy > r2) continue;
          if (Math.random() > this.grain) continue;
          var f = 1 + (Math.random() * 2 - 1) * 0.4;
          this.blendPixel(origin.x + gx, origin.y + gy, [
            clamp(Math.round(rgba[0] * f), 0, 255),
            clamp(Math.round(rgba[1] * f), 0, 255),
            clamp(Math.round(rgba[2] * f), 0, 255),
            255
          ]);
        }
      }
    }

    stroke(cell, last) {
      if (!last || last.face !== cell.face || (last.x === cell.x && last.y === cell.y)) {
        this.paintPixel(cell, this.currentRgba());
        return { face: cell.face, x: cell.x, y: cell.y };
      }
      var x0 = last.x, y0 = last.y, x1 = cell.x, y1 = cell.y;
      var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      var err = dx - dy, x = x0, y = y0;
      for (;;) {
        this.paintPixel({ face: cell.face, x: x, y: y }, this.currentRgba());
        if (x === x1 && y === y1) break;
        var e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
      return { face: cell.face, x: cell.x, y: cell.y };
    }

    fill(cell, rgba) {
      var origin = cellOf(cell.face);
      var stack = [[cell.x, cell.y]];
      this._seen.fill(0);
      var p = this.pixels;
      var si0 = (origin.y + cell.y) * W + (origin.x + cell.x);
      var target = [p[si0 * 4], p[si0 * 4 + 1], p[si0 * 4 + 2], p[si0 * 4 + 3]];
      while (stack.length) {
        var cur = stack.pop();
        var gx = cur[0], gy = cur[1];
        if (gx < 0 || gx >= FACE || gy < 0 || gy >= FACE) continue;
        if (this._seen[gy * FACE + gx]) continue;
        this._seen[gy * FACE + gx] = 1;
        var i = ((origin.y + gy) * W + (origin.x + gx)) * 4;
        if (p[i] !== target[0] || p[i + 1] !== target[1] || p[i + 2] !== target[2] || p[i + 3] !== target[3]) continue;
        this.blendInto(p, i, rgba);
        stack.push([gx + 1, gy], [gx - 1, gy], [gx, gy + 1], [gx, gy - 1]);
      }
    }

    pick(cell) {
      var origin = cellOf(cell.face);
      var px = this.getPixel(origin.x + cell.x, origin.y + cell.y);
      var r = px[0], g = px[1], b = px[2];
      if (px[3] < 8) { r = 255; g = 255; b = 255; }
      this.brushRgba = [r, g, b, 255];
      document.getElementById('mod-color').value = this.rgbToHex(r, g, b);
    }

    applyHit(cell, last) {
      if (!cell) return last;
      if (this.tool === 'circle' || this.tool === 'square') return last;
      if (this.tool === 'fill') {
        this.fill(cell, this.currentRgba());
        this.invalidate();
        return null;
      }
      if (this.tool === 'pick') {
        this.pick(cell);
        return null;
      }
      var next = this.stroke(cell, last);
      this.invalidate();
      return next;
    }

    beginStroke(cell) {
      this.lastPaint = null;
      this._anchor = null;
      this._strokeBase = null;
      if (!cell) return;
      if (this.tool === 'pick') {
        this.pick(cell);
        this.invalidate();
        return;
      }
      this.pushUndo();
      if (this.tool === 'circle' || this.tool === 'square') {
        this._anchor = cell;
        this._strokeBase = this.pixels.slice();
        this.drawShape(cell, cell);
        this.invalidate();
        return;
      }
      this.lastPaint = this.applyHit(cell, null);
    }

    continueStroke(cell) {
      if (this._anchor) {
        if (!cell || cell.face !== this._anchor.face) return;
        this.pixels.set(this._strokeBase);
        this.drawShape(this._anchor, cell);
        this.invalidate();
        return;
      }
      if (this.tool === 'pick') {
        if (cell) { this.pick(cell); this.invalidate(); }
        return;
      }
      this.lastPaint = this.applyHit(cell, this.lastPaint);
    }

    endStroke() {
      this._anchor = null;
      this._strokeBase = null;
      this.lastPaint = null;
      this.interacting = false;
    }

    drawShape(a, b) {
      var origin = cellOf(a.face);
      var rgba = this.currentRgba();
      var x0 = Math.min(a.x, b.x);
      var x1 = Math.max(a.x, b.x);
      var y0 = Math.min(a.y, b.y);
      var y1 = Math.max(a.y, b.y);
      var cx = (x0 + x1) / 2;
      var cy = (y0 + y1) / 2;
      var rx = (x1 - x0) / 2 + 0.5;
      var ry = (y1 - y0) / 2 + 0.5;
      var outline = !this.shapeFill;
      var thick = 2 / Math.max(rx, ry);
      for (var gy = y0; gy <= y1; gy++) {
        for (var gx = x0; gx <= x1; gx++) {
          var on;
          if (this.tool === 'square') {
            var edge = (gx === x0 || gx === x1 || gy === y0 || gy === y1);
            on = outline ? edge : true;
          } else {
            var dx = (gx - cx) / rx;
            var dy = (gy - cy) / ry;
            var v = Math.sqrt(dx * dx + dy * dy);
            on = outline ? (v <= 1 && v >= 1 - thick) : v <= 1;
          }
          if (on) this.blendPixel(origin.x + gx, origin.y + gy, rgba);
        }
      }
    }

    pushUndo() {
      this.undoStack.push(this.pixels.slice());
      if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
      this.redoStack.length = 0;
      this.updateUndoButtons();
    }

    undo() {
      if (!this.undoStack.length) return;
      this.redoStack.push(this.pixels.slice());
      this.pixels.set(this.undoStack.pop());
      this.invalidate();
      this.updateUndoButtons();
    }

    redo() {
      if (!this.redoStack.length) return;
      this.undoStack.push(this.pixels.slice());
      this.pixels.set(this.redoStack.pop());
      this.invalidate();
      this.updateUndoButtons();
    }

    updateUndoButtons() {
      var u = document.getElementById('mod-undo');
      var r = document.getElementById('mod-redo');
      if (u) u.disabled = !this.undoStack.length;
      if (r) r.disabled = !this.redoStack.length;
    }

    paintCell(face, gx, gy, rgba) {
      this.paintPixel({ face: face, x: gx, y: gy }, rgba);
      this.invalidate();
    }

    fillCell(face, gx, gy, rgba) {
      this.fill({ face: face, x: gx, y: gy }, rgba);
      this.invalidate();
    }

    sampleCell(face, gx, gy) {
      var origin = cellOf(face);
      return this.getPixel(origin.x + gx, origin.y + gy);
    }

    clearPixels() {
      this.pushUndo();
      this.pixels.fill(0);
      this.invalidate();
    }

    invalidate() {
      this.texture.image.data.set(this.pixels);
      this.texture.needsUpdate = true;
      this.ctx.putImageData(this.makeImageData(), 0, 0);
      this.refreshFlat();
      this.updateTransparency();
    }

    refreshFlat() {
      var c = this.fctx;
      c.clearRect(0, 0, W, H);
      c.drawImage(this.canvas, 0, 0);
      c.strokeStyle = 'rgba(255,255,255,0.22)';
      c.lineWidth = 1;
      c.beginPath();
      for (var col = 0; col < COLS; col++) {
        c.moveTo(col * PITCH + FACE, 0);
        c.lineTo(col * PITCH + FACE, H);
      }
      for (var row = 0; row < ROWS; row++) {
        c.moveTo(0, row * PITCH + FACE);
        c.lineTo(W, row * PITCH + FACE);
      }
      c.stroke();
    }

    sanitizeName(raw) {
      var n = String(raw == null ? '' : raw)
        .replace(/[\\/:*?"<>|.]+/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^[-\s]+|[-.\s]+$/g, '');
      return n || 'block_texture';
    }

    rotationSuffix() {
      return this.rotation === 'rot' ? '_rot' : this.rotation === 'rotY' ? '_rotY' : '';
    }

    exportFileName() {
      var base = this.sanitizeName(this.blockName).replace(/_rot$/i, '').replace(/_rotY$/i, '').replace(/[-\s]+$/, '');
      if (!base) base = 'block_texture';
      return base + this.rotationSuffix() + '.png';
    }

    refreshExportName() {
      var file = this.exportFileName();
      var el = document.getElementById('mod-export-name');
      if (el) el.textContent = file;
      var btn = document.getElementById('mod-download');
      if (btn) btn.textContent = 'Download ' + file;
    }

    setBlockName(raw) {
      this.blockName = this.sanitizeName(raw);
      this.refreshExportName();
    }

    setRotation(mode) {
      this.rotation = mode === 'rot' || mode === 'rotY' ? mode : 'none';
      this.refreshExportName();
    }

    applyFileName(fileName) {
      var base = String(fileName || '').replace(/\.[^.]+$/, '');
      var rotY = /_rotY$/i.test(base);
      var rot = !rotY && /_rot$/i.test(base);
      if (rotY) base = base.replace(/_rotY$/i, '');
      else if (rot) base = base.replace(/_rot$/i, '');
      var input = document.getElementById('mod-name');
      if (input) input.value = this.sanitizeName(base);
      this.blockName = this.sanitizeName(base);
      var sel = document.getElementById('mod-rot');
      var mode = rotY ? 'rotY' : rot ? 'rot' : 'none';
      if (sel) sel.value = mode;
      this.rotation = mode;
      this.refreshExportName();
    }

    loadFromFile(file) {
      var self = this;
      if (!file) return;
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        var g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.clearRect(0, 0, W, H);
        g.drawImage(img, 0, 0, W, H);
        self.pushUndo();
        self.pixels.set(g.getImageData(0, 0, W, H).data);
        self.applyFileName(file.name);
        self.invalidate();
        URL.revokeObjectURL(url);
        var el = document.getElementById('mod-status');
        if (el) el.title = 'Loaded ' + file.name;
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        var el = document.getElementById('mod-status');
        if (el) el.textContent = 'Could not read that image file';
      };
      img.src = url;
    }

    download() {
      var self = this;
      this.canvas.toBlob(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = self.exportFileName();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      });
    }

    _bindTools() {
      var self = this;
      var btns = Array.prototype.slice.call(document.querySelectorAll('.mod-tool-btn[data-tool]'));
      btns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.tool = btn.dataset.tool;
          btns.forEach(function (b) { b.classList.toggle('active', b === btn); });
        });
      });

      var color = document.getElementById('mod-color');
      color.addEventListener('input', function () { self.brushRgba = self.hexToRgba(color.value); });

      var size = document.getElementById('mod-size');
      var label = document.getElementById('mod-size-label');
      size.addEventListener('input', function () {
        self.brushSize = parseInt(size.value, 10);
        label.textContent = size.value;
      });

      var grain = document.getElementById('mod-grain');
      var grainLabel = document.getElementById('mod-grain-label');
      grain.addEventListener('input', function () {
        self.grain = parseInt(grain.value, 10) / 100;
        grainLabel.textContent = grain.value + '%';
      });

      var blend = document.getElementById('mod-blend');
      blend.addEventListener('change', function () { self.blend = blend.value; });

      var fillBtn = document.getElementById('mod-shape-fill');
      var outlineBtn = document.getElementById('mod-shape-outline');
      fillBtn.addEventListener('click', function () {
        self.shapeFill = true;
        fillBtn.classList.add('active');
        outlineBtn.classList.remove('active');
      });
      outlineBtn.addEventListener('click', function () {
        self.shapeFill = false;
        outlineBtn.classList.add('active');
        fillBtn.classList.remove('active');
      });

      document.getElementById('mod-rotate').addEventListener('click', function () {
        self.autoRotate = !self.autoRotate;
        this.textContent = 'Auto-rotate: ' + (self.autoRotate ? 'on' : 'off');
      });

      document.getElementById('mod-clear').addEventListener('click', function () {
        self.clearPixels();
      });

      document.getElementById('mod-undo').addEventListener('click', function () { self.undo(); });
      document.getElementById('mod-redo').addEventListener('click', function () { self.redo(); });

      document.getElementById('mod-download').addEventListener('click', function () {
        self.download();
      });

      var name = document.getElementById('mod-name');
      name.addEventListener('input', function () { self.setBlockName(name.value); });
      name.addEventListener('blur', function () {
        name.value = self.sanitizeName(name.value);
        self.setBlockName(name.value);
      });

      var rot = document.getElementById('mod-rot');
      rot.addEventListener('change', function () { self.setRotation(rot.value); });

      var upload = document.getElementById('mod-upload');
      upload.addEventListener('change', function () {
        self.loadFromFile(upload.files && upload.files[0]);
        upload.value = '';
      });

      document.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        var k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) self.redo(); else self.undo();
        } else if (k === 'y') {
          e.preventDefault();
          self.redo();
        }
      });

      var flat = this.flat;
      var previewing = false;
      flat.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 && e.button !== 1) return;
        try { flat.setPointerCapture(e.pointerId); } catch (err) {}
        previewing = true;
        self.interacting = true;
        self.beginStroke(self.cellFromFlatEvent(e));
      });
      flat.addEventListener('pointermove', function (e) {
        if (!previewing) return;
        self.continueStroke(self.cellFromFlatEvent(e));
      });
      flat.addEventListener('pointerup', function () { previewing = false; self.endStroke(); });
      flat.addEventListener('pointercancel', function () { previewing = false; self.endStroke(); });
    }

    _bindPointer() {
      var self = this;
      var canvas = this.renderer.domElement;
      var painting = false;
      var rotating = false;
      var lastX = 0, lastY = 0;
      this.lastPaint = null;

      function ndc(e) {
        var r = canvas.getBoundingClientRect();
        self._ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      }

      function hitCell() {
        self.raycaster.setFromCamera(self._ndc, self.camera);
        var hits = self.raycaster.intersectObjects([self.cube], false);
        if (!hits.length) return null;
        var hit = hits[0];
        if (hit.distance > 12) return null;
        var uv = hit.uv;
        if (!uv) return null;
        var fx = clamp(Math.floor(uv.x * W), 0, W - 1);
        var fy = clamp(Math.floor(uv.y * H), 0, H - 1);
        return self.cellPixelFromAtlas(fx, fy);
      }

      canvas.addEventListener('pointerdown', function (e) {
        if (e.button === 2) {
          rotating = true;
          lastX = e.clientX;
          lastY = e.clientY;
          self.interacting = true;
          e.preventDefault();
          return;
        }
        if (e.button !== 0 && e.button !== 1) return;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        painting = true;
        self.interacting = true;
        ndc(e);
        self.beginStroke(hitCell());
      });

      canvas.addEventListener('pointermove', function (e) {
        if (rotating) {
          self.cube.rotation.y += (e.clientX - lastX) * 0.008;
          self.cube.rotation.x += (e.clientY - lastY) * 0.008;
          lastX = e.clientX;
          lastY = e.clientY;
          return;
        }
        if (!painting) return;
        ndc(e);
        self.continueStroke(hitCell());
      });

      canvas.addEventListener('pointerup', function () {
        painting = false;
        rotating = false;
        self.endStroke();
      });
      canvas.addEventListener('pointercancel', function () {
        painting = false;
        rotating = false;
        self.endStroke();
      });

      document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }

    _loop() {
      var self = this;
      requestAnimationFrame(function () { self._loop(); });
      if (this.autoRotate && !this.interacting) {
        this.cube.rotation.y += 0.006;
      }
      this.renderer.render(this.scene, this.camera);
    }
  }

  window.ModTextureEditor = TextureEditor;
  window.textureEditor = new TextureEditor();
})();