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

  window.MeshZip = {
    ZipWriter: ZipWriter,
    crc32: crc32,
    utf8: utf8
  };
})();
