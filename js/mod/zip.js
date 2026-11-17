(function () {
  'use strict';

  // Minimal ZIP writer: stored (uncompressed) entries only. This is deliberate:
  // exported meshes are tiny, and a store-only archive needs no external
  // dependency while remaining readable by every unzip tool the game expects.

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      else out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
    return new Uint8Array(out);
  }

  function decodeUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(bytes);
    }
    var text = '';
    for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(text)); } catch (err) { return text; }
  }

  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined' || typeof Response === 'undefined') {
      return Promise.reject(new Error(
        'zip: this browser cannot decompress ZIP entries. Re-save the mesh as a stored ZIP.'
      ));
    }
    var stream = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buffer) {
      return new Uint8Array(buffer);
    });
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') return utf8(data);
    if (data && data.buffer) return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    throw new Error('zip: unsupported entry data');
  }

  function u16(value) {
    var b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, value & 0xffff, true);
    return b;
  }

  function u32(value) {
    var b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value >>> 0, true);
    return b;
  }

  function dosDateTime(date) {
    var d = date || new Date();
    var year = Math.max(1980, d.getFullYear());
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    var day = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xffff, date: day & 0xffff };
  }

  function join(parts) {
    var total = 0;
    for (var i = 0; i < parts.length; i++) total += parts[i].length;
    var out = new Uint8Array(total);
    var offset = 0;
    for (var j = 0; j < parts.length; j++) {
      out.set(parts[j], offset);
      offset += parts[j].length;
    }
    return out;
  }

  class ZipWriter {
    constructor() {
      this.entries = [];
    }

    add(name, data) {
      var safe = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!safe) throw new Error('zip: empty entry name');
      this.entries.push({ name: safe, data: toBytes(data) });
      return this;
    }

    bytes() {
      var stamp = dosDateTime(new Date());
      var locals = [];
      var central = [];
      var offset = 0;

      for (var i = 0; i < this.entries.length; i++) {
        var entry = this.entries[i];
        var name = utf8(entry.name);
        var crc = crc32(entry.data);
        var size = entry.data.length;

        var local = join([
          u32(0x04034b50),
          u16(20),          // version needed
          u16(0x0800),      // UTF-8 names
          u16(0),           // stored
          u16(stamp.time),
          u16(stamp.date),
          u32(crc),
          u32(size),
          u32(size),
          u16(name.length),
          u16(0),
          name,
          entry.data
        ]);
        locals.push(local);

        central.push(join([
          u32(0x02014b50),
          u16(20),          // version made by
          u16(20),          // version needed
          u16(0x0800),
          u16(0),
          u16(stamp.time),
          u16(stamp.date),
          u32(crc),
          u32(size),
          u32(size),
          u16(name.length),
          u16(0),           // extra
          u16(0),           // comment
          u16(0),           // disk
          u16(0),           // internal attributes
          u32(0),           // external attributes
          u32(offset),
          name
        ]));
        offset += local.length;
      }

      var centralBytes = join(central);
      var end = join([
        u32(0x06054b50),
        u16(0),
        u16(0),
        u16(this.entries.length),
        u16(this.entries.length),
        u32(centralBytes.length),
        u32(offset),
        u16(0)
      ]);

      return join(locals.concat([centralBytes, end]));
    }

    blob(type) {
      return new Blob([this.bytes()], { type: type || 'application/zip' });
    }
  }

  class ZipReader {
    constructor(data) {
      this.bytes = toBytes(data);
      this.view = new DataView(
        this.bytes.buffer,
        this.bytes.byteOffset,
        this.bytes.byteLength
      );
      this._entries = null;
    }

    _parse() {
      if (this._entries) return this._entries;
      var bytes = this.bytes;
      var view = this.view;
      if (bytes.length < 22) throw new Error('zip: file is too small');

      var eocd = -1;
      var lowest = Math.max(0, bytes.length - 65557);
      for (var i = bytes.length - 22; i >= lowest; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
          eocd = i;
          break;
        }
      }
      if (eocd < 0) throw new Error('zip: no central directory found');

      var count = view.getUint16(eocd + 10, true);
      var cdSize = view.getUint32(eocd + 12, true);
      var cdOffset = view.getUint32(eocd + 16, true);
      if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
        throw new Error('zip: ZIP64 archives are not supported');
      }
      if (cdOffset + cdSize > bytes.length) {
        throw new Error('zip: central directory is out of range');
      }

      var entries = [];
      var p = cdOffset;
      for (var n = 0; n < count; n++) {
        if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) {
          throw new Error('zip: damaged central directory');
        }
        var nameLen = view.getUint16(p + 28, true);
        var extraLen = view.getUint16(p + 30, true);
        var commentLen = view.getUint16(p + 32, true);
        var nameStart = p + 46;
        var nameEnd = nameStart + nameLen;
        if (nameEnd > bytes.length) throw new Error('zip: damaged entry name');

        entries.push({
          name: decodeUtf8(bytes.subarray(nameStart, nameEnd)),
          method: view.getUint16(p + 10, true),
          flags: view.getUint16(p + 8, true),
          crc: view.getUint32(p + 16, true),
          compressedSize: view.getUint32(p + 20, true),
          size: view.getUint32(p + 24, true),
          localOffset: view.getUint32(p + 42, true)
        });
        p = nameEnd + extraLen + commentLen;
      }

      this._entries = entries;
      return entries;
    }

    entries() {
      return this._parse().map(function (entry) {
        return {
          name: entry.name,
          size: entry.size,
          compressedSize: entry.compressedSize,
          method: entry.method
        };
      });
    }

    names() {
      var out = [];
      var entries = this._parse();
      for (var i = 0; i < entries.length; i++) {
        var name = entries[i].name;
        if (name && name.charAt(name.length - 1) !== '/') out.push(name);
      }
      return out;
    }

    find(name) {
      var target = String(name == null ? '' : name)
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (!target) return null;
      var entries = this._parse();
      var lower = target.toLowerCase();
      var i;
      for (i = 0; i < entries.length; i++) {
        if (entries[i].name === target) return entries[i];
      }
      for (i = 0; i < entries.length; i++) {
        if (entries[i].name.toLowerCase() === lower) return entries[i];
      }
      return null;
    }

    has(name) {
      return !!this.find(name);
    }

    read(name) {
      var entry = name && typeof name === 'object' ? name : this.find(name);
      if (!entry) {
        return Promise.reject(new Error('zip: missing entry ' + name));
      }
      if (entry.name.charAt(entry.name.length - 1) === '/') {
        return Promise.resolve(new Uint8Array(0));
      }

      var bytes = this.bytes;
      var view = this.view;
      var p = entry.localOffset;
      if (p + 30 > bytes.length || view.getUint32(p, true) !== 0x04034b50) {
        return Promise.reject(new Error('zip: damaged local header for ' + entry.name));
      }
      var nameLen = view.getUint16(p + 26, true);
      var extraLen = view.getUint16(p + 28, true);
      var start = p + 30 + nameLen + extraLen;
      var end = start + entry.compressedSize;
      if (start > bytes.length || end > bytes.length) {
        return Promise.reject(new Error('zip: entry data is out of range for ' + entry.name));
      }

      var raw = bytes.subarray(start, end);
      var pending;
      if (entry.method === 0) pending = Promise.resolve(raw);
      else if (entry.method === 8) pending = inflateRaw(raw);
      else {
        return Promise.reject(new Error(
          'zip: unsupported compression method ' + entry.method + ' for ' + entry.name
        ));
      }

      return pending.then(function (data) {
        if (data.length !== entry.size) {
          throw new Error('zip: size mismatch for ' + entry.name);
        }
        if (crc32(data) !== entry.crc) {
          throw new Error('zip: checksum mismatch for ' + entry.name);
        }
        return data;
      });
    }

    text(name) {
      return this.read(name).then(function (data) {
        return decodeUtf8(data);
      });
    }
  }

  window.MeshZip = {
    ZipWriter: ZipWriter,
    ZipReader: ZipReader,
    crc32: crc32,
    utf8: utf8
  };
})();
