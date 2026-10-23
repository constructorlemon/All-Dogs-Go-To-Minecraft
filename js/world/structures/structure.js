(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var blocks = AllDogs.blocks;
  var BLOCK = blocks.BLOCK;
  var BLOCK_DEFS = blocks.BLOCK_DEFS;
  var CHUNK = AllDogs.constants.CHUNK_SIZE;

  var defs = {};
  var order = [];

  function resolveBlock(name) {
    if (typeof name === 'number') return name;
    if (name === null || name === undefined) return BLOCK.AIR;
    if (BLOCK[name] !== undefined) return BLOCK[name];
    for (var id in BLOCK_DEFS) {
      var d = BLOCK_DEFS[id];
      if (d && d.texture === name && !d.variantOf && d.yawOf == null) return Number(id);
    }
    var item = blocks.ITEMS[name];
    if (item && typeof item.place === 'number') return item.place;
    return BLOCK.AIR;
  }

  function hash(x, z, k) {
    return AllDogs.worldgen.hash2(
      (x | 0) * 7919 + (k | 0) * 104729 + 17,
      (z | 0) * 6271 + (k | 0) * 1299709 + 41
    );
  }

  function rotate(lx, lz, size, turns) {
    var c = (size - 1) / 2;
    var dx = lx - c;
    var dz = lz - c;
    var t = ((turns % 4) + 4) % 4;
    for (var i = 0; i < t; i++) {
      var nx = dz;
      dz = -dx;
      dx = nx;
    }
    return { x: dx + c, z: dz + c };
  }

  function compileVariant(variant) {
    if (variant._ids) return variant;
    var legend = variant.legend || {};
    var ids = {};
    for (var ch in legend) ids[ch] = resolveBlock(legend[ch]);
    var layers = [];
    for (var y = 0; y < variant.layers.length; y++) {
      var rows = variant.layers[y];
      var plane = [];
      for (var z = 0; z < rows.length; z++) {
        var row = rows[z];
        var xs = [];
        for (var x = 0; x < row.length; x++) {
          xs.push(ids[row.charAt(x)] || BLOCK.AIR);
        }
        plane.push(xs);
      }
      layers.push(plane);
    }
    variant._ids = layers;
    return variant;
  }

  function register(name, def) {
    def.name = name;
    def.maxSize = 0;
    for (var i = 0; i < def.variants.length; i++) {
      var v = def.variants[i];
      if (!v.size) v.size = v.layers[0][0].length;
      v.height = v.layers.length;
      if (v.size > def.maxSize) def.maxSize = v.size;
    }
    def.maxRadius = def.maxSize + 2;
    defs[name] = def;
    order.push(name);
    return def;
  }

  function treesAt(x, z, h) {
    for (var y = h - 2; y <= h + 10; y++) {
      if (AllDogs.worldgen.treeBlockAt(x, y, z) !== BLOCK.AIR) return true;
    }
    return false;
  }

  function validate(def, variant, ox, oz) {
    var size = variant.size;
    var minH = Infinity;
    var maxH = -Infinity;
    for (var x = ox - 1; x <= ox + size; x++) {
      for (var z = oz - 1; z <= oz + size; z++) {
        var h = AllDogs.worldgen.heightAt(x, z);
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
        if (AllDogs.worldgen.isSandPatch(x, z)) return null;
        if (treesAt(x, z, h)) return null;
      }
    }
    var limit = def.flatness == null ? 1 : def.flatness;
    if (maxH - minH > limit) return null;
    return maxH;
  }

  function cellPlacement(def, gx, gz) {
    var sp = def.spawn;
    var ccx = gx * sp.spacing + sp.spacing / 2;
    var ccz = gz * sp.spacing + sp.spacing / 2;
    if (AllDogs.worldgen.fbm(ccx * sp.regionScale, ccz * sp.regionScale, sp.regionOctaves || 3) < sp.regionThreshold) {
      return null;
    }
    for (var k = 0; k < sp.attempts; k++) {
      if (hash(gx, gz, k) > sp.density) continue;
      var ox = gx * sp.spacing + Math.floor(hash(gx + 101, gz, k) * sp.spacing);
      var oz = gz * sp.spacing + Math.floor(hash(gx, gz + 203, k) * sp.spacing);
      if (sp.safeRadius) {
        var half = def.maxSize / 2;
        var scx = ox + half;
        var scz = oz + half;
        if (scx * scx + scz * scz < sp.safeRadius * sp.safeRadius) continue;
      }
      var vi = Math.floor(hash(ox, oz, 7) * def.variants.length);
      if (vi >= def.variants.length) vi = def.variants.length - 1;
      var variant = def.variants[vi];
      var base = validate(def, variant, ox, oz);
      if (base === null) continue;
      var turns = Math.floor(hash(ox, oz, 9) * 4) % 4;
      return { def: def, variant: variant, x: ox, z: oz, base: base, turns: turns, size: variant.size };
    }
    return null;
  }

  function cellCenter(x, z) {
    return { x: x, z: z };
  }

  var placementCache = new Map();
  var PLACEMENT_CACHE_MAX = 4096;
  var CACHE_RADIUS = 8;
  var CACHE_VERSION = 1;
  var CACHE_KEY = 'adsgtm.placements';

  function defsSignature() {
    var parts = [];
    for (var d = 0; d < order.length; d++) {
      var def = defs[order[d]];
      var sizes = [];
      for (var v = 0; v < def.variants.length; v++) sizes.push(def.variants[v].size);
      var sp = def.spawn || {};
      parts.push(order[d] + ':' + def.maxSize + ':' + sizes.join('.') + ':' + (sp.spacing || 0) + ':' + (sp.attempts || 0));
    }
    return parts.join('|');
  }

  function serializePlacements(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var vi = p.def.variants.indexOf(p.variant);
      out.push([p.def.name, vi, p.x, p.z, p.base, p.turns]);
    }
    return out;
  }

  function hydratePlacements(recs) {
    var out = [];
    for (var i = 0; i < recs.length; i++) {
      var rec = recs[i];
      var def = defs[rec[0]];
      if (!def) continue;
      var variant = def.variants[rec[1]] || def.variants[0];
      out.push({ def: def, variant: variant, x: rec[2], z: rec[3], base: rec[4], turns: rec[5], size: variant.size });
    }
    return out;
  }

  function exportCache(seed) {
    var data = {};
    for (var pair of placementCache) data[pair[0]] = serializePlacements(pair[1]);
    return { v: CACHE_VERSION, seed: seed, defs: defsSignature(), radius: CACHE_RADIUS, data: data };
  }

  function importCache(obj, seed) {
    if (!obj || obj.v !== CACHE_VERSION) return false;
    if (obj.seed !== seed || obj.defs !== defsSignature()) return false;
    placementCache.clear();
    for (var key in obj.data) placementCache.set(key, hydratePlacements(obj.data[key]));
    return true;
  }

  function precomputeAround(radius, budgetMs, state) {
    if (!state) state = { i: 0 };
    var side = radius * 2 + 1;
    var start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var now = function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
    while (state.i < side * side) {
      var idx = state.i;
      var cx = (idx % side) - radius;
      var cz = Math.floor(idx / side) - radius;
      placements(cx, cz);
      state.i++;
      if (now() - start > budgetMs) break;
    }
    state.total = side * side;
    return state.i >= state.total;
  }

  function placements(cx, cz) {
    var ckey = cx + ',' + cz;
    var cached = placementCache.get(ckey);
    if (cached) return cached;
    var out = [];
    var x0 = cx * CHUNK;
    var z0 = cz * CHUNK;
    for (var d = 0; d < order.length; d++) {
      var def = defs[order[d]];
      if (!def || !def.spawn) continue;
      var sp = def.spawn;
      var r = def.maxRadius;
      var gxMin = Math.floor((x0 - r) / sp.spacing);
      var gxMax = Math.floor((x0 + CHUNK - 1 + r) / sp.spacing);
      var gzMin = Math.floor((z0 - r) / sp.spacing);
      var gzMax = Math.floor((z0 + CHUNK - 1 + r) / sp.spacing);
      for (var gx = gxMin; gx <= gxMax; gx++) {
        for (var gz = gzMin; gz <= gzMax; gz++) {
          var p = cellPlacement(def, gx, gz);
          if (!p) continue;
          if (p.x > x0 + CHUNK - 1 || p.x + p.size - 1 < x0) continue;
          if (p.z > z0 + CHUNK - 1 || p.z + p.size - 1 < z0) continue;
          out.push(p);
        }
      }
    }
    if (placementCache.size >= PLACEMENT_CACHE_MAX) placementCache.clear();
    placementCache.set(ckey, out);
    return out;
  }

  function directionalId(id, turns) {
    var d = BLOCK_DEFS[id];
    if (!d || !d.directional) return id;
    var base = d.yawOf != null ? d.yawOf : id;
    var yaw = (((turns + (d.yaw || 0)) % 4) + 4) % 4;
    var vid = blocks.yawVariantId(base, yaw);
    return vid || id;
  }

  function stamp(world, data, cx, cz) {
    var list = placements(cx, cz);
    if (!list.length) return;
    var cx0 = cx * CHUNK;
    var cz0 = cz * CHUNK;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var layers = compileVariant(p.variant)._ids;
      for (var ly = 0; ly < layers.length; ly++) {
        var plane = layers[ly];
        for (var lz = 0; lz < plane.length; lz++) {
          var row = plane[lz];
          for (var lx = 0; lx < row.length; lx++) {
            var id = row[lx];
            if (!id) continue;
            var rr = rotate(lx, lz, p.size, p.turns);
            world.putLocal(data, cx0, cz0, p.x + rr.x, p.base + ly, p.z + rr.z, directionalId(id, p.turns));
          }
        }
      }
    }
  }

  function entitiesFor(cx, cz) {
    var out = [];
    var list = placements(cx, cz);
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (Math.floor(p.x / CHUNK) !== cx || Math.floor(p.z / CHUNK) !== cz) continue;
      if (typeof p.def.entities !== 'function') continue;
      var made = p.def.entities(p);
      for (var j = 0; j < made.length; j++) out.push(made[j]);
    }
    return out;
  }

  AllDogs.structures = {
    register: register,
    get: function (name) { return defs[name] || null; },
    names: function () { return order.slice(); },
    resolveBlock: resolveBlock,
    rotate: rotate,
    placements: placements,
    stamp: stamp,
    entitiesFor: entitiesFor,
    precomputeAround: precomputeAround,
    exportCache: exportCache,
    importCache: importCache,
    cacheKey: CACHE_KEY,
    cacheRadius: CACHE_RADIUS
  };
})();
