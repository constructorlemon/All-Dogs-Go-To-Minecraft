(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var BLOCK = AllDogs.blocks.BLOCK;
  var WORLD_HEIGHT = AllDogs.constants.WORLD_HEIGHT;

  var TREE_MIN_GROUND = 4;

  var SEED = AllDogs.constants.SEED || 0;
  var SEED_X = 0;
  var SEED_Z = 0;

  function setSeed(value) {
    var n = Number(value);
    if (!isFinite(n)) n = AllDogs.constants.SEED || 0;
    SEED = n | 0;
    SEED_X = (SEED * 374761393) | 0;
    SEED_Z = (SEED * 668265263) | 0;
  }

  function getSeed() {
    return SEED;
  }

  setSeed(SEED);

  function hash2(x, z) {
    var h = (Math.imul((x | 0) + SEED_X, 374761393) + Math.imul((z | 0) + SEED_Z, 668265263)) | 0;
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  function smoothNoise(x, z) {
    var ix = Math.floor(x);
    var iz = Math.floor(z);
    var fx = x - ix;
    var fz = z - iz;
    var sx = fx * fx * (3 - 2 * fx);
    var sz = fz * fz * (3 - 2 * fz);
    var a = hash2(ix, iz);
    var b = hash2(ix + 1, iz);
    var c = hash2(ix, iz + 1);
    var d = hash2(ix + 1, iz + 1);
    var top = a + (b - a) * sx;
    var bottom = c + (d - c) * sx;
    return top + (bottom - top) * sz;
  }

  function fbm(x, z, octaves) {
    var total = 0;
    var amp = 1;
    var norm = 0;
    for (var i = 0; i < octaves; i++) {
      total += smoothNoise(x * Math.pow(2, i), z * Math.pow(2, i)) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return total / norm;
  }

  function heightAt(x, z) {
    var n = fbm(x * 0.03, z * 0.03, 4);
    var h = Math.round(4 + (n - 0.5) * 12);
    if (h < 1) h = 1;
    if (h > WORLD_HEIGHT - 8) h = WORLD_HEIGHT - 8;
    return h;
  }

  function isSandPatch(x, z) {
    return hash2(x * 3 + 77, z * 3 + 11) > 0.995;
  }

  function hasTree(x, z) {
    if (heightAt(x, z) < TREE_MIN_GROUND) return false;
    return hash2(x * 5 + 31, z * 5 + 57) > 0.975;
  }

  function trunkHeight(x, z) {
    return 4 + Math.floor(hash2(x * 11 + 17, z * 11 + 29) * 3);
  }

  function treeBlockAt(x, y, z) {
    for (var tx = x - 2; tx <= x + 2; tx++) {
      for (var tz = z - 2; tz <= z + 2; tz++) {
        if (!hasTree(tx, tz)) continue;
        var ground = heightAt(tx, tz);
        var trunk = trunkHeight(tx, tz);
        var top = ground + trunk;
        if (x === tx && z === tz && y > ground && y <= top) return BLOCK.LOG;
        var dy = y - top;
        if (dy < -1 || dy > 2) continue;
        var rad = dy <= 0 ? 2 : dy === 1 ? 1 : 0;
        if (Math.abs(x - tx) <= rad && Math.abs(z - tz) <= rad) return BLOCK.LEAVES;
      }
    }
    return BLOCK.AIR;
  }

  function blockAt(x, y, z) {
    if (y < 0) return BLOCK.BEDROCK;
    if (y >= WORLD_HEIGHT) return BLOCK.AIR;
    var h = heightAt(x, z);
    if (y <= h) {
      if (y === 0) return BLOCK.BEDROCK;
      if (y === h) return isSandPatch(x, z) ? BLOCK.SAND : BLOCK.GRASS;
      if (y > h - 3) return BLOCK.DIRT;
      return BLOCK.STONE;
    }
    return treeBlockAt(x, y, z);
  }

  AllDogs.worldgen = {
    setSeed: setSeed,
    getSeed: getSeed,
    hash2: hash2,
    fbm: fbm,
    heightAt: heightAt,
    isSandPatch: isSandPatch,
    hasTree: hasTree,
    trunkHeight: trunkHeight,
    treeBlockAt: treeBlockAt,
    blockAt: blockAt
  };
})();
