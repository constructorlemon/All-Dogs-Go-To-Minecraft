'use strict';
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var root = path.resolve(__dirname, '..');
var textureDir = path.join(root, 'mods', 'texture');
var mobDir = path.join(root, 'mods', 'mobs');
var outDir = path.join(root, 'js', 'mods');
var outFile = path.join(outDir, 'manifest.js');

var PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(buf) {
  if (buf.length < PNG_SIG.length || !buf.slice(0, 8).equals(PNG_SIG)) {
    throw new Error('not a png');
  }
  var w, h, bitDepth, colorType;
  var idat = [];
  var i = 8;
  while (i + 8 <= buf.length) {
    var len = buf.readUInt32BE(i);
    var type = buf.toString('ascii', i + 4, i + 8);
    if (type === 'IHDR') {
      w = buf.readUInt32BE(i + 8);
      h = buf.readUInt32BE(i + 12);
      bitDepth = buf[i + 16];
      colorType = buf[i + 17];
    } else if (type === 'IDAT') {
      idat.push(buf.slice(i + 8, i + 8 + len));
    } else if (type === 'IEND') {
      break;
    }
    i += 12 + len;
  }
  if (!w || !h || bitDepth !== 8) throw new Error('unsupported png header');
  var channels;
  if (colorType === 6) channels = 4;
  else if (colorType === 2) channels = 3;
  else if (colorType === 0) channels = 1;
  else throw new Error('unsupported png color type ' + colorType);

  var inflated = zlib.inflateSync(Buffer.concat(idat));
  var stride = w * channels;
  var bytesPerRow = stride + 1;
  var out = Buffer.alloc(w * h * channels);
  var prev = Buffer.alloc(stride);
  for (var y = 0; y < h; y++) {
    var f = inflated[y * bytesPerRow];
    var cur = Buffer.alloc(stride);
    for (var x = 0; x < stride; x++) {
      var a = x >= channels ? cur[x - channels] : 0;
      var b = prev[x];
      var c = x >= channels ? prev[x - channels] : 0;
      var v = inflated[y * bytesPerRow + 1 + x];
      if (f === 1) v = (v + a) & 0xff;
      else if (f === 2) v = (v + b) & 0xff;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (f === 4) {
        var p = a + b - c;
        var pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = v;
    }
    cur.copy(out, y * stride);
    prev.set(cur);
  }
  return { w: w, h: h, stride: stride, data: out };
}

function rgbaAt(dec, x, y) {
  var ch = dec.stride / dec.w;
  var base = y * dec.stride + x * ch;
  var r, g, b;
  if (ch === 3) {
    r = dec.data[base]; g = dec.data[base + 1]; b = dec.data[base + 2];
  } else if (ch === 1) {
    r = g = b = dec.data[base];
  } else {
    r = dec.data[base]; g = dec.data[base + 1]; b = dec.data[base + 2];
  }
  var a = ch === 4 ? dec.data[base + 3] : 255;
  return [r, g, b, a];
}

var FACE = 16;
var PITCH = 18;

function sliceFaces(dec) {
  var iw = dec.w, ih = dec.h;
  var pitch = Math.min(iw / 3, ih / 2);
  var face = Math.round((pitch * FACE) / PITCH);
  var faces = [];
  for (var f = 0; f < 6; f++) {
    var col = f % 3;
    var row = Math.floor(f / 3);
    var buf = Buffer.alloc(FACE * FACE * 4);
    for (var y = 0; y < FACE; y++) {
      for (var x = 0; x < FACE; x++) {
        var sx = Math.floor((x * face) / FACE);
        var sy = Math.floor((y * face) / FACE);
        var px = rgbaAt(dec, Math.min(iw - 1, Math.floor(col * pitch + sx)), Math.min(ih - 1, Math.floor(row * pitch + sy)));
        var o = (y * FACE + x) * 4;
        buf[o] = px[0]; buf[o + 1] = px[1]; buf[o + 2] = px[2]; buf[o + 3] = px[3];
      }
    }
    faces.push(buf.toString('base64'));
  }
  return faces;
}

function listFiles(dir, pred) {
  if (!fs.existsSync(dir)) return [];
  var out = [];
  var names = fs.readdirSync(dir).sort();
  for (var i = 0; i < names.length; i++) {
    var full = path.join(dir, names[i]);
    if (names[i].charAt(0) === '.') continue;
    if (!fs.statSync(full).isFile()) continue;
    if (pred(names[i])) out.push(names[i]);
  }
  return out;
}

var PNG_EXT = { '.png': 1, '.PNG': 1 };
var IMG_EXT = { '.jpg': 1, '.jpeg': 1, '.gif': 1, '.webp': 1 };

function rel(dirName, f) {
  return path.join('mods', dirName, f).replace(/\\/g, '/');
}

var textures = [];
listFiles(textureDir, function (f) { return /\.png$/i.test(f); }).forEach(function (f) {
  try {
    var dec = decodePng(fs.readFileSync(path.join(textureDir, f)));
    var name = path.basename(f, path.extname(f));
    textures.push({ file: f, name: name, path: rel('texture', f), faces: sliceFaces(dec) });
  } catch (e) {
    console.warn('skip ' + f + ': ' + e.message);
  }
});
listFiles(textureDir, function (f) { return IMG_EXT[path.extname(f).toLowerCase()] && !/\.png$/i.test(f); }).forEach(function (f) {
  console.warn('skip (unsupported format, use png): ' + f);
});

var mobs = [];
listFiles(mobDir, function (f) { return /\.json$/i.test(f); }).forEach(function (f) {
  mobs.push({ file: f, name: path.basename(f, '.json'), kind: 'json', path: rel('mobs', f) });
});

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, 'window.MOD_MANIFEST = ' + JSON.stringify({ textures: textures, mobs: mobs }) + ';\n');

console.log('manifest: ' + textures.length + ' texture(s), ' + mobs.length + ' mob(s)');