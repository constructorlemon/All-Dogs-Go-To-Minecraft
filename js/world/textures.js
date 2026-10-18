(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  var S = 16;

  function canvas16() {
    var c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    return [c, c.getContext('2d')];
  }

  function lcg(seed) {
    var s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function shade(ctx, base, spread, rand) {
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var v = Math.round(rand() * spread) - Math.round(spread / 2);
        var r = Math.max(0, Math.min(255, base[0] + v));
        var g = Math.max(0, Math.min(255, base[1] + v));
        var b = Math.max(0, Math.min(255, base[2] + v));
        ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  function speck(ctx, rand, color, n) {
    ctx.fillStyle = color;
    for (var i = 0; i < n; i++) {
      ctx.fillRect(Math.floor(rand() * S), Math.floor(rand() * S), 1, 1);
    }
  }

  function dirt() {
    var c = canvas16();
    shade(c[1], [122, 82, 48], 18, lcg(201));
    speck(c[1], lcg(202), 'rgba(92,60,32,0.6)', 18);
    speck(c[1], lcg(203), 'rgba(150,105,64,0.5)', 14);
    return c[0];
  }

  function grassTop() {
    var c = canvas16();
    shade(c[1], [92, 145, 60], 16, lcg(701));
    speck(c[1], lcg(702), 'rgba(56,105,38,0.6)', 22);
    speck(c[1], lcg(703), 'rgba(140,180,90,0.35)', 10);
    return c[0];
  }

  function grassSide() {
    var c = canvas16();
    shade(c[1], [122, 82, 48], 18, lcg(222));
    var r = lcg(333);
    for (var x = 0; x < S; x++) {
      var edge = 3 + Math.floor(r() * 2);
      for (var y = 0; y <= edge; y++) {
        c[1].fillStyle = y === edge ? 'rgb(48,84,34)' : 'rgb(92,145,60)';
        c[1].fillRect(x, y, 1, 1);
      }
    }
    return c[0];
  }

  function stone() {
    var c = canvas16();
    shade(c[1], [132, 132, 132], 14, lcg(404));
    var r = lcg(505);
    for (var i = 0; i < 14; i++) {
      var v = 30 + Math.floor(r() * 40);
      c[1].fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      c[1].fillRect(Math.floor(r() * S), Math.floor(r() * S), 1 + Math.floor(r() * 2), 1 + Math.floor(r() * 2));
    }
    return c[0];
  }

  function logSide() {
    var c = canvas16();
    var ctx = c[1];
    var r = lcg(606);
    for (var x = 0; x < S; x++) {
      var v = Math.round(r() * 14) - 7;
      var base = 96 + v;
      ctx.fillStyle = 'rgb(' + base + ',' + Math.round(base * 0.62) + ',' + Math.round(base * 0.36) + ')';
      ctx.fillRect(x, 0, 1, S);
    }
    for (var i = 0; i < 12; i++) {
      ctx.fillStyle = 'rgba(58,38,22,0.7)';
      ctx.fillRect(Math.floor(r() * S), Math.floor(r() * S), 1, 1 + Math.floor(r() * 3));
    }
    return c[0];
  }

  function logTop() {
    var c = canvas16();
    var ctx = c[1];
    ctx.fillStyle = 'rgb(198,161,108)';
    ctx.fillRect(0, 0, S, S);
    var r = lcg(707);
    for (var k = 0; k < 6; k++) {
      var t = 1 + k + Math.floor(r() * 2);
      ctx.fillStyle = k % 2 ? 'rgb(170,130,82)' : 'rgb(148,110,66)';
      ctx.fillRect(t, 0, 1, S);
      ctx.fillRect(S - 1 - t, 0, 1, S);
      ctx.fillRect(0, t, S, 1);
      ctx.fillRect(0, S - 1 - t, S, 1);
    }
    speck(ctx, lcg(808), 'rgba(120,88,52,0.5)', 14);
    return c[0];
  }

  function leaves() {
    var c = canvas16();
    shade(c[1], [60, 118, 42], 22, lcg(909));
    c[1].globalCompositeOperation = 'destination-out';
    var r = lcg(1001);
    for (var i = 0; i < 10; i++) {
      c[1].fillStyle = 'rgba(0,0,0,1)';
      c[1].fillRect(Math.floor(r() * S), Math.floor(r() * S), 2, 2);
    }
    c[1].globalCompositeOperation = 'source-over';
    return c[0];
  }

  function planks() {
    var c = canvas16();
    var ctx = c[1];
    shade(ctx, [188, 147, 92], 16, lcg(1102));
    var r = lcg(1203);
    for (var b = 0; b < 4; b++) {
      var y0 = b * 4;
      if (r() > 0.4) {
        ctx.fillStyle = 'rgb(128,92,52)';
        ctx.fillRect(0, y0 + 3, S, 1);
      }
      ctx.fillStyle = 'rgb(128,92,52)';
      for (var i = 0; i < 3; i++) {
        ctx.fillRect(Math.floor(r() * S), y0, 1, 1 + Math.floor(r() * 3));
      }
    }
    speck(ctx, lcg(1304), 'rgba(96,64,34,0.3)', 16);
    return c[0];
  }

  function sand() {
    var c = canvas16();
    shade(c[1], [221, 199, 124], 12, lcg(1405));
    speck(c[1], lcg(1406), 'rgba(190,165,95,0.5)', 14);
    return c[0];
  }

  function bedrock() {
    var c = canvas16();
    var ctx = c[1];
    shade(ctx, [52, 52, 52], 10, lcg(1506));
    var r = lcg(1607);
    for (var i = 0; i < 16; i++) {
      var v = 70 + Math.floor(r() * 80);
      ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      ctx.fillRect(Math.floor(r() * S), Math.floor(r() * S), 1, 1);
    }
    return c[0];
  }

  var TEXTURE_FACTORIES = {
    dirt: dirt,
    stone: stone,
    planks: planks,
    leaves: leaves,
    sand: sand,
    bedrock: bedrock
  };

  function canvasTexture(cv) {
    var t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  var _mats = {};
  var PLAIN_BOX = new THREE.BoxGeometry(1, 1, 1);

  var MOD_FACES = {};

  function fallbackCanvas() {
    var c = canvas16();
    var ctx = c[1];
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#000000';
    for (var y = 0; y < S; y += 4) {
      for (var x = 0; x < S; x += 4) {
        if ((x + y) % 8 === 0) ctx.fillRect(x, y, 4, 4);
      }
    }
    return c[0];
  }

  function hasAlpha(cv) {
    var d = cv.getContext('2d').getImageData(0, 0, S, S).data;
    for (var i = 3; i < d.length; i += 4) {
      if (d[i] < 255) return true;
    }
    return false;
  }

  function occludesTexture(key) {
    if (key === 'leaves') return false;
    var fs = MOD_FACES[key];
    if (fs) {
      for (var i = 0; i < fs.length; i++) {
        if (hasAlpha(fs[i])) return false;
      }
      return true;
    }
    return true;
  }

  function materialFromMap(map) {
    var mat = new THREE.MeshLambertMaterial({ map: map });
    if (hasAlpha(map.image)) {
      mat.transparent = true;
      mat.alphaTest = 0.5;
      mat.side = THREE.DoubleSide;
    }
    return mat;
  }

  var FACE_FACTORIES = {
    'grass_top': grassTop,
    'grass_side': grassSide,
    'log_top': logTop,
    'log_side': logSide
  };

  function getMaterial(key) {
    if (!_mats[key]) {
      var mat;
      if (key.indexOf('#') >= 0) {
        var parts = key.split('#');
        var faces = MOD_FACES[parts[0]];
        var cv = faces && faces[Number(parts[1])] ? faces[Number(parts[1])] : fallbackCanvas();
        mat = materialFromMap(canvasTexture(cv));
      } else {
        var factory = FACE_FACTORIES[key] || TEXTURE_FACTORIES[key];
        var map = canvasTexture(factory ? factory() : fallbackCanvas());
        mat = new THREE.MeshLambertMaterial({ map: map });
        if (key === 'leaves') {
          mat.transparent = true;
          mat.alphaTest = 0.5;
          mat.side = THREE.DoubleSide;
        }
      }
      _mats[key] = mat;
    }
    return _mats[key];
  }

  function getGeometry(key) {
    return PLAIN_BOX;
  }

  function registerModTexture(key, faces) {
    MOD_FACES[key] = faces;
  }

  AllDogs.textures = {
    getGeometry: getGeometry,
    getMaterial: getMaterial,
    occludesTexture: occludesTexture,
    registerModTexture: registerModTexture
  };
})();