(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var S = 16;
  var PITCH = 18;

  function canvas16() {
    var c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    return c;
  }

  function canvasFromBase64(b64) {
    var raw = atob(b64);
    var arr = new Uint8ClampedArray(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    var c = canvas16();
    c.getContext('2d').putImageData(new ImageData(arr, S, S), 0, 0);
    return c;
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('failed to load ' + src)); };
      img.src = src;
    });
  }

  function sliceFromImage(img) {
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    var pitch = Math.min(iw / 3, ih / 2);
    var face = Math.round((pitch * S) / PITCH);
    var out = [];
    for (var f = 0; f < 6; f++) {
      var c = canvas16();
      var g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, (f % 3) * pitch, Math.floor(f / 3) * pitch, face, face, 0, 0, S, S);
      out.push(c);
    }
    return out;
  }

  function registerEntry(entry, faces) {
    var raw = String(entry.name || '');
    var rotY = /_rotY$/i.test(raw);
    var rot = !rotY && /_rot$/i.test(raw);
    var name = rotY ? raw.replace(/_rotY$/i, '') : rot ? raw.replace(/_rot$/i, '') : raw;
    var key = AllDogs.blocks.registerModTextureKey(name, rotY ? 'rotY' : rot ? 'rot' : 'none');
    AllDogs.textures.registerModTexture(key, faces);
    AllDogs.registerIconCanvas(key, faces[2] || faces[0]);
    return { key: key, name: name };
  }

  function loadSchema(name, key) {
    return new Promise(function (resolve) {
      if (!name) { resolve(false); return; }
      var prev = window.module;
      window.module = { exports: {} };
      var script = document.createElement('script');
      script.src = 'mods/schema/' + encodeURI(name) + '.js';
      script.onload = function () {
        var schema = window.module ? window.module.exports : null;
        window.module = prev;
        if (schema && AllDogs.blocks.attachSchema) AllDogs.blocks.attachSchema(key, schema);
        resolve(!!schema);
      };
      script.onerror = function () {
        window.module = prev;
        resolve(false);
      };
      document.head.appendChild(script);
    });
  }

  function registerWithFaces(entry) {
    var faces = [];
    for (var i = 0; i < 6; i++) faces.push(canvasFromBase64(entry.faces[i]));
    return registerEntry(entry, faces);
  }

  function registerWithImage(entry) {
    return loadImage(entry.path).then(function (img) {
      return registerEntry(entry, sliceFromImage(img));
    });
  }

  function ModLoader() {
    var self = this;
    this.textures = 0;
    this.mobs = 0;
    this.failed = 0;
    this.ready = this.scan().catch(function () {}).then(function () { return self; });
  }

  ModLoader.prototype.scan = function () {
    var self = this;
    var manifest = window.MOD_MANIFEST;
    var chain = Promise.resolve();
    if (manifest && manifest.textures) {
      for (var i = 0; i < manifest.textures.length; i++) {
        chain = chain.then((function (entry) {
          return function () {
            var work;
            if (entry.faces && entry.faces.length >= 6) {
              work = Promise.resolve().then(function () { return registerWithFaces(entry); });
            } else {
              work = registerWithImage(entry);
            }
            return work
              .then(function (res) {
                self.textures++;
                if (res && res.key) return loadSchema(res.name, res.key);
              })
              .catch(function () { self.failed++; });
          };
        })(manifest.textures[i]));
      }
    }
    return chain;
  };

  AllDogs.modLoader = new ModLoader();
})();
