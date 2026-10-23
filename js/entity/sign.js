(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  var BOARD_W = 0.55;
  var BOARD_H = 0.45;
  var BOARD_T = 0.1;
  var POST_W = 0.1;
  var POST_H = 0.6;
  var POST_T = 0.1;
  var BOARD_CY = 0.82;
  var HALF = { x: 0.32, y: 0.62, z: 0.24 };
  var MAX_LINES = 4;

  var _woodGeo = null;
  var _postGeo = null;

  function woodGeo() {
    if (!_woodGeo) _woodGeo = new THREE.BoxGeometry(BOARD_W, BOARD_H, BOARD_T);
    return _woodGeo;
  }

  function postGeo() {
    if (!_postGeo) _postGeo = new THREE.BoxGeometry(POST_W, POST_H, POST_T);
    return _postGeo;
  }

  function fitLines(src, font, maxW, max, g) {
    g.font = font;
    var out = [];
    for (var i = 0; i < src.length && out.length < max; i++) {
      var ln = String(src[i]);
      if (ln.length === 0) {
        out.push(' ');
        continue;
      }
      var words = ln.split(' ');
      var cur = '';
      for (var j = 0; j < words.length && out.length < max; j++) {
        var w = words[j];
        if (w.length === 0) {
          if (cur !== '') cur += ' ';
          continue;
        }
        var test = cur === '' ? w : cur + ' ' + w;
        if (cur !== '' && g.measureText(test).width > maxW) {
          out.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      if (cur !== '') out.push(cur);
    }
    return out;
  }

  class SignEntity extends AllDogs.Entity {
    constructor(opts) {
      opts = opts || {};
      super('sign', opts);
      this.itemId = 'sign';
      this.text = (Array.isArray(opts.text) ? opts.text : ['Sign']).slice(0, MAX_LINES);
      this.yaw = opts.yaw || 0;
      this.groundY = opts.pos ? opts.pos.y : 0;
      this.halfExtents = HALF;
      this.pos.y = this.groundY + BOARD_CY;

      this._canvas = document.createElement('canvas');
      this._canvas.width = 512;
      this._canvas.height = 256;
      this._tex = new THREE.CanvasTexture(this._canvas);
      this._tex.colorSpace = THREE.SRGBColorSpace;

      this.buildMesh();
      this.renderText();
    }

    buildMesh() {
      var wood = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
      var postMat = new THREE.MeshLambertMaterial({ color: 0x5d3a17 });
      var faceMat = new THREE.MeshLambertMaterial({ map: this._tex });

      var board = new THREE.Mesh(woodGeo(), [
        wood, wood, wood, wood, faceMat, faceMat
      ]);

      var post = new THREE.Mesh(postGeo(), postMat);
      post.position.set(0, -BOARD_CY + POST_H / 2, 0);

      this.mesh = new THREE.Group();
      this.mesh.add(board, post);
      this.mesh.rotation.order = 'YXZ';
      this.mesh.rotation.y = this.yaw;
    }

    renderText() {
      var W = this._canvas.width;
      var H = this._canvas.height;
      var g = this._canvas.getContext('2d');
      g.clearRect(0, 0, W, H);

      g.fillStyle = '#8a5a2b';
      g.fillRect(0, 0, W, H);

      g.strokeStyle = 'rgba(62, 38, 14, 0.4)';
      g.lineWidth = 3;
      for (var y = 0; y < H; y += 42) {
        g.beginPath();
        g.moveTo(8, y);
        g.lineTo(W - 8, y);
        g.stroke();
      }

      g.strokeStyle = '#5d3a17';
      g.lineWidth = 12;
      g.strokeRect(6, 6, W - 12, H - 12);

      var font = 'bold 40px "Courier New", monospace';
      var lines = fitLines(this.text, font, W - 96, MAX_LINES, g);
      g.fillStyle = '#ffeecc';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      var lh = 52;
      var startY = (H - (lines.length - 1) * lh) / 2;
      for (var i = 0; i < lines.length; i++) {
        g.fillText(lines[i], W / 2, startY + i * lh);
      }

      this._tex.needsUpdate = true;
    }

    setText(lines) {
      this.text = (Array.isArray(lines) ? lines : [lines]).slice(0, MAX_LINES);
      this.renderText();
    }

    savePos() {
      return { x: this.pos.x, y: this.groundY, z: this.pos.z };
    }

    interact(ctx) {
      if (ctx && ctx.openSignEditor) ctx.openSignEditor(this);
    }
  }

  AllDogs.entities.register('sign', SignEntity);
})();