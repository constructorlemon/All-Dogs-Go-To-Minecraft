(function () {
  'use strict';
  var THREE = window.THREE;

  var DEFAULTS = {
    size: 1024,
    tile: 32
  };

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // Shared atlas painter used by the mesh editor. A mesh has many faces, so the
  // familiar block-editor tools operate on a fixed grid of 32x32 tiles inside
  // one atlas texture. Each mesh face owns a stable slot in that grid.
  class AtlasPainter {
    constructor(opts) {
      opts = opts || {};
      this.size = opts.size || DEFAULTS.size;
      this.tile = opts.tile || DEFAULTS.tile;
      this.cols = Math.floor(this.size / this.tile);
      this.rows = Math.floor(this.size / this.tile);
      this.capacity = this.cols * this.rows;

      this.tool = 'brush';
      this.brushRgba = this.hexToRgba('#8b5a2b');
      this.brushSize = 2;
      this.grain = 0.7;
      this.blend = 'normal';
      this.shapeFill = true;
      this.autoRotate = false;

      this.onChange = null;
      this.onPick = null;
      this.onStroke = null;

      this.undoStack = [];
      this.redoStack = [];
      this.maxUndo = 80;
      this._anchor = null;
      this._strokeBase = null;

      this.pixels = new Uint8ClampedArray(this.size * this.size * 4);

      this.canvas = document.createElement('canvas');
      this.canvas.width = this.size;
      this.canvas.height = this.size;
      this.ctx = this.canvas.getContext('2d');

      this.texture = new THREE.DataTexture(
        new Uint8Array(this.size * this.size * 4),
        this.size,
        this.size,
        THREE.RGBAFormat
      );
      this.texture.magFilter = THREE.NearestFilter;
      this.texture.minFilter = THREE.NearestFilter;
      this.texture.generateMipmaps = false;
      this.texture.needsUpdate = true;

      this._seen = new Uint8Array(this.tile * this.tile);
      this._dirty = true;
    }

    regionOfSlot(slot) {
      slot = Number(slot) || 0;
      return {
        x: (slot % this.cols) * this.tile,
        y: Math.floor(slot / this.cols) * this.tile,
        w: this.tile,
        h: this.tile
      };
    }

    slotAtPixel(fx, fy) {
      if (fx < 0 || fy < 0 || fx >= this.size || fy >= this.size) return null;
      var col = Math.floor(fx / this.tile);
      var row = Math.floor(fy / this.tile);
      if (col >= this.cols || row >= this.rows) return null;
      return {
        slot: row * this.cols + col,
        x: fx - col * this.tile,
        y: fy - row * this.tile
      };
    }

    cellFromAtlasPixel(fx, fy) {
      return this.slotAtPixel(fx, fy);
    }

    cellFromFlatEvent(e, canvas) {
      var r = canvas.getBoundingClientRect();
      var fx = Math.floor(((e.clientX - r.left) / r.width) * this.size);
      var fy = Math.floor(((e.clientY - r.top) / r.height) * this.size);
      return this.slotAtPixel(fx, fy);
    }

    setPixel(fx, fy, rgba) {
      if (fx < 0 || fy < 0 || fx >= this.size || fy >= this.size) return;
      var i = (fy * this.size + fx) * 4;
      this.pixels[i] = rgba[0];
      this.pixels[i + 1] = rgba[1];
      this.pixels[i + 2] = rgba[2];
      this.pixels[i + 3] = rgba[3];
      this._dirty = true;
    }

    getPixel(fx, fy) {
      if (fx < 0 || fy < 0 || fx >= this.size || fy >= this.size) return [0, 0, 0, 0];
      var i = (fy * this.size + fx) * 4;
      return [
        this.pixels[i],
        this.pixels[i + 1],
        this.pixels[i + 2],
        this.pixels[i + 3]
      ];
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

    blendPixel(fx, fy, rgba) {
      if (fx < 0 || fy < 0 || fx >= this.size || fy >= this.size) return;
      this.blendInto(this.pixels, (fy * this.size + fx) * 4, rgba);
      this._dirty = true;
    }

    hexToRgba(hex) {
      var v = parseInt(String(hex || '#000000').slice(1), 16);
      if (isNaN(v)) v = 0;
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
    }

    rgbToHex(r, g, b) {
      return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    }

    currentRgba() {
      if (this.tool === 'eraser') return [0, 0, 0, 0];
      return this.brushRgba;
    }

    fillSlot(slot, rgba) {
      var region = this.regionOfSlot(slot);
      for (var y = 0; y < region.h; y++) {
        for (var x = 0; x < region.w; x++) {
          this.setPixel(region.x + x, region.y + y, rgba);
        }
      }
      this.invalidate();
    }

    clearSlot(slot) {
      this.fillSlot(slot, [0, 0, 0, 0]);
    }

    copySlot(fromSlot, toSlot) {
      var a = this.regionOfSlot(fromSlot);
      var b = this.regionOfSlot(toSlot);
      if (a.x === b.x && a.y === b.y) return;
      var src = this.pixels.slice();
      for (var y = 0; y < this.tile; y++) {
        for (var x = 0; x < this.tile; x++) {
          var si = ((a.y + y) * this.size + (a.x + x)) * 4;
          var di = ((b.y + y) * this.size + (b.x + x)) * 4;
          this.pixels[di] = src[si];
          this.pixels[di + 1] = src[si + 1];
          this.pixels[di + 2] = src[si + 2];
          this.pixels[di + 3] = src[si + 3];
        }
      }
      this.invalidate();
    }

    paintPixel(cell, rgba) {
      if (!cell) return;
      if (this.tool === 'texture') {
        this.paintGrain(cell, rgba);
        return;
      }
      var region = this.regionOfSlot(cell.slot);
      var r = Math.max(0, this.brushSize - 1);
      var r2 = r * r + 0.25;
      for (var gy = Math.max(0, cell.y - r); gy <= Math.min(this.tile - 1, cell.y + r); gy++) {
        for (var gx = Math.max(0, cell.x - r); gx <= Math.min(this.tile - 1, cell.x + r); gx++) {
          var dx = gx - cell.x;
          var dy = gy - cell.y;
          if (dx * dx + dy * dy > r2) continue;
          this.blendPixel(region.x + gx, region.y + gy, rgba);
        }
      }
    }

    paintGrain(cell, rgba) {
      var region = this.regionOfSlot(cell.slot);
      var r = Math.max(0, this.brushSize - 1);
      var r2 = r * r + 0.25;
      for (var gy = Math.max(0, cell.y - r); gy <= Math.min(this.tile - 1, cell.y + r); gy++) {
        for (var gx = Math.max(0, cell.x - r); gx <= Math.min(this.tile - 1, cell.x + r); gx++) {
          var dx = gx - cell.x;
          var dy = gy - cell.y;
          if (dx * dx + dy * dy > r2) continue;
          if (Math.random() > this.grain) continue;
          var f = 1 + (Math.random() * 2 - 1) * 0.4;
          this.blendPixel(region.x + gx, region.y + gy, [
            clamp(Math.round(rgba[0] * f), 0, 255),
            clamp(Math.round(rgba[1] * f), 0, 255),
            clamp(Math.round(rgba[2] * f), 0, 255),
            255
          ]);
        }
      }
    }

    stroke(cell, last) {
      if (!last || last.slot !== cell.slot || (last.x === cell.x && last.y === cell.y)) {
        this.paintPixel(cell, this.currentRgba());
        return { slot: cell.slot, x: cell.x, y: cell.y };
      }
      var x0 = last.x, y0 = last.y, x1 = cell.x, y1 = cell.y;
      var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      var err = dx - dy, x = x0, y = y0;
      for (;;) {
        this.paintPixel({ slot: cell.slot, x: x, y: y }, this.currentRgba());
        if (x === x1 && y === y1) break;
        var e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
      return { slot: cell.slot, x: cell.x, y: cell.y };
    }

    fill(cell, rgba) {
      var region = this.regionOfSlot(cell.slot);
      var stack = [[cell.x, cell.y]];
      this._seen.fill(0);
      var p = this.pixels;
      var si0 = (region.y + cell.y) * this.size + (region.x + cell.x);
      var target = [p[si0 * 4], p[si0 * 4 + 1], p[si0 * 4 + 2], p[si0 * 4 + 3]];
      while (stack.length) {
        var cur = stack.pop();
        var gx = cur[0], gy = cur[1];
        if (gx < 0 || gx >= this.tile || gy < 0 || gy >= this.tile) continue;
        if (this._seen[gy * this.tile + gx]) continue;
        this._seen[gy * this.tile + gx] = 1;
        var i = ((region.y + gy) * this.size + (region.x + gx)) * 4;
        if (p[i] !== target[0] || p[i + 1] !== target[1] || p[i + 2] !== target[2] || p[i + 3] !== target[3]) continue;
        this.blendInto(p, i, rgba);
        this._dirty = true;
        stack.push([gx + 1, gy], [gx - 1, gy], [gx, gy + 1], [gx, gy - 1]);
      }
    }

    pick(cell) {
      var region = this.regionOfSlot(cell.slot);
      var px = this.getPixel(region.x + cell.x, region.y + cell.y);
      var r = px[0], g = px[1], b = px[2];
      if (px[3] < 8) { r = 255; g = 255; b = 255; }
      this.brushRgba = [r, g, b, 255];
      if (typeof this.onPick === 'function') this.onPick(this.rgbToHex(r, g, b));
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
      } else {
        this.lastPaint = this.applyHit(cell, null);
      }
      this._notifyStroke();
    }

    continueStroke(cell) {
      if (this._anchor) {
        if (!cell || cell.slot !== this._anchor.slot) return;
        this.pixels.set(this._strokeBase);
        this.drawShape(this._anchor, cell);
        this.invalidate();
        return;
      }
      if (this.tool === 'pick') {
        if (cell) {
          this.pick(cell);
          this.invalidate();
        }
        return;
      }
      this.lastPaint = this.applyHit(cell, this.lastPaint);
    }

    endStroke() {
      this._anchor = null;
      this._strokeBase = null;
      this.lastPaint = null;
    }

    drawShape(a, b) {
      var region = this.regionOfSlot(a.slot);
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
          if (on) this.blendPixel(region.x + gx, region.y + gy, rgba);
        }
      }
    }

    pushUndo() {
      this.undoStack.push(this.pixels.slice());
      if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
      this.redoStack.length = 0;
      this._notifyStroke();
    }

    undo() {
      if (!this.undoStack.length) return;
      this.redoStack.push(this.pixels.slice());
      this.pixels.set(this.undoStack.pop());
      this.invalidate();
      this._notifyStroke();
    }

    redo() {
      if (!this.redoStack.length) return;
      this.undoStack.push(this.pixels.slice());
      this.pixels.set(this.redoStack.pop());
      this.invalidate();
      this._notifyStroke();
    }

    canUndo() {
      return this.undoStack.length > 0;
    }

    canRedo() {
      return this.redoStack.length > 0;
    }

    clearAll() {
      this.pushUndo();
      this.pixels.fill(0);
      this.invalidate();
    }

    _notifyStroke() {
      if (typeof this.onStroke === 'function') this.onStroke();
    }

    invalidate() {
      this._dirty = true;
      this.texture.image.data.set(this.pixels);
      this.texture.needsUpdate = true;
      this.ctx.putImageData(this.makeImageData(), 0, 0);
      if (typeof this.onChange === 'function') this.onChange();
    }

    makeImageData() {
      var id = this.ctx.createImageData(this.size, this.size);
      id.data.set(this.pixels);
      return id;
    }

    snapshotCanvas() {
      if (this._dirty) {
        this.ctx.putImageData(this.makeImageData(), 0, 0);
        this._dirty = false;
      }
      return this.canvas;
    }
  }

  AtlasPainter.DEFAULTS = DEFAULTS;
  window.AtlasPainter = AtlasPainter;
})();
