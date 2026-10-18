(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var BLOCK = Object.freeze({
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    LOG: 4,
    PLANKS: 5,
    LEAVES: 6,
    SAND: 7,
    BEDROCK: 8
  });

  var LOG_X = 9;
  var LOG_Z = 10;

  var BLOCK_DEFS = {
    [BLOCK.GRASS]:   { name: 'Grass',     texture: 'grass',   breakable: true,  placeable: false, needsTool: null, drop: 'dirt' },
    [BLOCK.DIRT]:    { name: 'Dirt',      texture: 'dirt',    breakable: true,  placeable: true,  needsTool: null, drop: 'dirt' },
    [BLOCK.STONE]:   { name: 'Stone',     texture: 'stone',   breakable: true,  placeable: true,  needsTool: 'pickaxe', drop: 'stone' },
    [BLOCK.LOG]:     { name: 'Wood Log',  texture: 'log',     breakable: true,  placeable: true,  needsTool: null, drop: 'log', axis: 'y' },
    [BLOCK.PLANKS]:  { name: 'Planks',    texture: 'planks',  breakable: true,  placeable: true,  needsTool: null, drop: 'planks' },
    [BLOCK.LEAVES]:  { name: 'Leaves',    texture: 'leaves',  breakable: true,  placeable: true,  needsTool: null, drop: 'leaves' },
    [BLOCK.SAND]:    { name: 'Sand',      texture: 'sand',    breakable: true,  placeable: true,  needsTool: null, drop: 'sand' },
    [BLOCK.BEDROCK]: { name: 'Bedrock',   texture: 'bedrock', breakable: false, placeable: false, needsTool: null, drop: null },
    [LOG_X]:         { name: 'Wood Log',  texture: 'log',     breakable: true,  placeable: true,  needsTool: null, drop: 'log', axis: 'x', variantOf: BLOCK.LOG },
    [LOG_Z]:         { name: 'Wood Log',  texture: 'log',     breakable: true,  placeable: true,  needsTool: null, drop: 'log', axis: 'z', variantOf: BLOCK.LOG }
  };

  var ITEM_ORDER = ['dirt', 'stone', 'log', 'planks', 'leaves', 'sand', 'clay', 'sign', 'chest', 'stick', 'pickaxe'];

  var ITEMS = {
    dirt:    { name: 'Dirt',           place: BLOCK.DIRT,    category: 'block' },
    stone:   { name: 'Stone',          place: BLOCK.STONE,   category: 'block' },
    log:     { name: 'Wood Log',       place: BLOCK.LOG,     category: 'block' },
    planks:  { name: 'Planks',         place: BLOCK.PLANKS,  category: 'block' },
    leaves:  { name: 'Leaves',         place: BLOCK.LEAVES,  category: 'block' },
    sand:    { name: 'Sand',           place: BLOCK.SAND,    category: 'block' },
    clay:    { name: 'Clay',           place: null,          category: 'item' },
    sign:    { name: 'Sign',           place: 'sign',        category: 'block' },
    chest:   { name: 'Chest',          place: 'chest',       category: 'block' },
    stick:   { name: 'Stick',          place: null,          category: 'item' },
    pickaxe: { name: 'Wooden Pickaxe', place: null,          category: 'tool' }
  };

  var RESERVED_TEX = {
    dirt: 1, stone: 1, planks: 1, leaves: 1, sand: 1, bedrock: 1,
    grass: 1, log: 1, grass_top: 1, grass_side: 1, log_top: 1, log_side: 1,
    stick: 1, pickaxe: 1
  };

  var _nextId = 100;
  var _keyToId = null;

  function rebuildKeyMap() {
    _keyToId = {};
    for (var id in BLOCK_DEFS) {
      var d = BLOCK_DEFS[id];
      if (d && !d.variantOf) _keyToId[d.texture] = Number(id);
      else if (d && d.variantOf) _keyToId[d.texture] = Number(d.variantOf);
    }
    _keyToId['grass_top'] = _keyToId['grass'];
    _keyToId['grass_side'] = _keyToId['grass'];
    _keyToId['log_top'] = _keyToId['log'];
    _keyToId['log_side'] = _keyToId['log'];
  }

  function keyToId(key) {
    if (!_keyToId) rebuildKeyMap();
    var base = String(key).split('#')[0];
    return _keyToId[base];
  }

  var STRAIGHT_ZONE = 0.36;

  function variantId(baseId, axis) {
    for (var id in BLOCK_DEFS) {
      var d = BLOCK_DEFS[id];
      if (d && d.variantOf === baseId && d.axis === axis) return Number(id);
    }
    return baseId;
  }

  function yawVariantId(baseId, yaw) {
    var q = ((Math.round(yaw) % 4) + 4) % 4;
    for (var id in BLOCK_DEFS) {
      var d = BLOCK_DEFS[id];
      if (d && d.yawOf === baseId && d.yaw === q) return Number(id);
    }
    return baseId;
  }

  function yawFromFacing(dx, dz) {
    var dir = Math.abs(dx) > Math.abs(dz) ? [dx < 0 ? -1 : 1, 0] : [0, dz < 0 ? -1 : 1];
    for (var q = 0; q < 4; q++) {
      var f = rotateY([0, 0, -1], q);
      if (f[0] === dir[0] && f[2] === dir[1]) return q;
    }
    return 0;
  }

  function rotateY(d, turns) {
    var x = d[0], y = d[1], z = d[2];
    for (var i = 0; i < ((turns % 4) + 4) % 4; i++) {
      var nx = z;
      z = -x;
      x = nx;
    }
    return [x, y, z];
  }

  function isAxisVariant(id) {
    var d = BLOCK_DEFS[id];
    return !!(d && d.axis);
  }

  function axisFromHit(onX, onY, onZ, faceAxis, axisOnly) {
    if (axisOnly) return 'y';
    var dx = onX - 0.5, dy = onY - 0.5, dz = onZ - 0.5;
    if (faceAxis === 'x') dx = 0;
    else if (faceAxis === 'z') dz = 0;
    else dy = 0;
    var ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    if (ax >= ay && ax >= az && ax > STRAIGHT_ZONE) return 'x';
    if (ay >= ax && ay >= az && ay > STRAIGHT_ZONE) return 'y';
    if (az >= ax && az >= ay && az > STRAIGHT_ZONE) return 'z';
    return faceAxis || 'y';
  }

  function uniqueKey(name) {
    var k = name;
    var n = 1;
    while (RESERVED_TEX[k] || ITEMS[k]) {
      k = name + ' ' + n;
      n++;
    }
    return k;
  }

  function modDef(key, extra) {
    var def = {
      name: key,
      texture: key,
      breakable: true,
      placeable: true,
      needsTool: null,
      drop: key,
      mod: true
    };
    if (extra) for (var k in extra) def[k] = extra[k];
    return def;
  }

  function registerModTextureKey(name, rotation) {
    var key = uniqueKey(name);
    var mode = normalizeRotation(rotation);
    var id = _nextId++;
    BLOCK_DEFS[id] = modDef(key, mode === 'rotY' ? { axis: 'y', directional: true, axisOnly: true, yaw: 0 } : mode === 'rot' ? { axis: 'y', directional: true } : null);
    if (mode === 'rot') {
      BLOCK_DEFS[_nextId] = modDef(key, { axis: 'x', variantOf: id, directional: true });
      _nextId++;
      BLOCK_DEFS[_nextId] = modDef(key, { axis: 'z', variantOf: id, directional: true });
      _nextId++;
    }
    if (mode === 'rotY') {
      for (var yq = 1; yq < 4; yq++) {
        BLOCK_DEFS[_nextId] = modDef(key, { axis: 'y', directional: true, axisOnly: true, yaw: yq, yawOf: id });
        _nextId++;
      }
    }
    ITEMS[key] = { name: key, place: id, category: 'block' };
    if (ITEM_ORDER.indexOf(key) < 0) ITEM_ORDER.push(key);
    _keyToId = null;
    return key;
  }

  function normalizeRotation(rotation) {
    if (rotation === true || rotation === 'rot') return 'rot';
    if (rotation === 'rotY' || rotation === 'y') return 'rotY';
    return 'none';
  }

  function rotationOfKey(key) {
    for (var id in BLOCK_DEFS) {
      var d = BLOCK_DEFS[id];
      if (d && d.texture === key && d.directional) return d.axisOnly ? 'rotY' : 'rot';
    }
    return 'none';
  }

  function isDirectionalKey(key) {
    for (var id in BLOCK_DEFS) {
      var d = BLOCK_DEFS[id];
      if (d && d.texture === key && d.directional) return true;
    }
    return false;
  }

  function isModTextureKey(key) {
    for (var id in BLOCK_DEFS) {
      var def = BLOCK_DEFS[id];
      if (def && def.mod && def.texture === key) return true;
    }
    return false;
  }

  function orderEntries(entries) {
    return entries.slice().sort(function (a, b) {
      var ia = ITEM_ORDER.indexOf(a[0]);
      var ib = ITEM_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }

  function attachSchema(textureKey, schema) {
    if (!textureKey || !schema) return;
    for (var id in BLOCK_DEFS) {
      var d = BLOCK_DEFS[id];
      if (d && d.texture === textureKey) d.schema = schema;
    }
  }

  AllDogs.blocks = {
    BLOCK: BLOCK,
    BLOCK_DEFS: BLOCK_DEFS,
    ITEMS: ITEMS,
    ITEM_ORDER: ITEM_ORDER,
    orderEntries: orderEntries,
    keyToId: keyToId,
    registerModTextureKey: registerModTextureKey,
    isModTextureKey: isModTextureKey,
    isDirectionalKey: isDirectionalKey,
    rotationOfKey: rotationOfKey,
    variantId: variantId,
    yawVariantId: yawVariantId,
    yawFromFacing: yawFromFacing,
    isAxisVariant: isAxisVariant,
    axisFromHit: axisFromHit,
    attachSchema: attachSchema
  };
})();