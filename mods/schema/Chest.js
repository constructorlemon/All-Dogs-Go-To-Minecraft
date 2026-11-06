(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var CAPACITY = 27;
  var HOTBAR_SIZE = AllDogs.constants ? AllDogs.constants.HOTBAR_SIZE : 9;
  var inventories = Object.create(null);

  function round(v) {
    return Math.round(v * 1000) / 1000;
  }

  function keyOfCoords(x, y, z) {
    return 'chest@' + round(x) + ',' + round(y) + ',' + round(z);
  }

  function keyOf(entity) {
    var p = entity && entity.pos ? entity.pos : { x: 0, y: 0, z: 0 };
    return keyOfCoords(p.x, p.y, p.z);
  }

  function emptySlots() {
    return new Array(CAPACITY).fill(null);
  }

  function recordFor(entity) {
    var p = entity.pos;
    var key = keyOf(entity);
    var rec = inventories[key];
    if (!rec) {
      rec = { x: round(p.x), y: round(p.y), z: round(p.z), slots: emptySlots() };
      inventories[key] = rec;
    }
    if (entity.chestSlots !== rec.slots) entity.chestSlots = rec.slots;
    return rec;
  }

  function normalizeSlots(raw) {
    var out = emptySlots();
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < CAPACITY && i < raw.length; i++) {
      var s = raw[i];
      if (!s) continue;
      var id = Array.isArray(s) ? s[0] : s.id;
      var qty = Array.isArray(s) ? s[1] : s.qty;
      id = id != null ? String(id) : null;
      qty = Number(qty) || 0;
      if (id && qty > 0) out[i] = { id: id, qty: qty };
    }
    return out;
  }

  function hasItems(slots) {
    for (var i = 0; i < slots.length; i++) {
      if (slots[i]) return true;
    }
    return false;
  }

  function firstEmpty(inv, start, end) {
    var cap = inv.capacity;
    if (end === undefined || end > cap) end = cap;
    for (var i = start; i < end; i++) {
      if (!inv.get(i)) return i;
    }
    return -1;
  }

  function firstChestItem(slots) {
    for (var i = 0; i < slots.length; i++) {
      if (slots[i]) return i;
    }
    return -1;
  }

  function firstAccepting(slots, itemId) {
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      if (!slot || slot.id === itemId) return i;
    }
    return -1;
  }

  function handleMove(game, slots, fromZone, fromIdx, toZone, toIdx, count) {
    if (fromZone === 'inv' && toZone === 'inv') {
      return game.inventory.move(fromIdx, toIdx, count);
    }
    if (fromZone === 'inv' && toZone === 'chest') {
      return game.moveInvToContainer(fromIdx, slots, toIdx, count);
    }
    if (fromZone === 'chest' && toZone === 'inv') {
      return game.moveContainerToInv(slots, fromIdx, toIdx, count);
    }
    if (fromZone === 'chest' && toZone === 'chest') {
      return game.moveContainerToContainer(slots, fromIdx, toIdx, count);
    }
    return false;
  }

  function quickMove(game, slots, zone, idx, hasItem, modifier) {
    if (!hasItem) {
      if (zone !== 'inv' || game.inventory.get(idx)) return false;
      var source = firstChestItem(slots);
      if (source < 0) return false;
      return game.moveContainerToInv(slots, source, idx);
    }

    if (zone === 'chest') {
      var target = firstEmpty(game.inventory, HOTBAR_SIZE);
      if (target < 0) target = firstEmpty(game.inventory, 0, HOTBAR_SIZE);
      if (target < 0) return false;
      return game.moveContainerToInv(slots, idx, target);
    }

    if (zone !== 'inv') return false;
    var src = game.inventory.get(idx);
    if (!src) return false;

    var preferChest = modifier !== 'ctrl';
    if (preferChest) {
      var chestSlot = firstAccepting(slots, src.id);
      if (chestSlot >= 0) return game.moveInvToContainer(idx, slots, chestSlot);
    }

    var invTarget = idx < HOTBAR_SIZE
      ? firstEmpty(game.inventory, HOTBAR_SIZE)
      : firstEmpty(game.inventory, 0, HOTBAR_SIZE);
    if (invTarget >= 0 && game.inventory.move(idx, invTarget)) return true;

    if (!preferChest) {
      var chestFallback = firstAccepting(slots, src.id);
      if (chestFallback >= 0) return game.moveInvToContainer(idx, slots, chestFallback);
    }
    return false;
  }

  function onSpawn(ctx) {
    if (ctx && ctx.entity) recordFor(ctx.entity);
  }

  function onInteract(ctx) {
    if (!ctx || !ctx.game || !ctx.entity) return;
    var game = ctx.game;
    var entity = ctx.entity;
    var rec = recordFor(entity);
    entity.open = true;
    var container = {
      kind: 'chest',
      title: 'Chest',
      zone: 'chest',
      capacity: CAPACITY,
      slots: rec.slots,
      entity: entity,
      handleMove: function (g, fromZone, fromIdx, toZone, toIdx, count) {
        return handleMove(g, rec.slots, fromZone, fromIdx, toZone, toIdx, count);
      },
      quickMove: function (g, zone, idx, hasItem, modifier) {
        return quickMove(g, rec.slots, zone, idx, hasItem, modifier);
      },
      onClose: function () {
        entity.open = false;
      }
    };
    if (typeof game.openContainerUI === 'function') {
      game.openContainerUI(container);
    } else {
      entity.open = !entity.open;
    }
  }

  function onDestroy(ctx) {
    if (!ctx || !ctx.game || !ctx.entity) return;
    var game = ctx.game;
    var entity = ctx.entity;
    var rec = recordFor(entity);
    var time = game.clock && typeof game.clock.getElapsedTime === 'function'
      ? game.clock.getElapsedTime() : 0;
    var fromY = entity.pos.y + 1;
    if (game.drops && typeof game.drops.drop === 'function' && game.world) {
      for (var i = 0; i < rec.slots.length; i++) {
        var slot = rec.slots[i];
        if (!slot) continue;
        game.drops.drop(slot.id, slot.qty, entity.pos.x, entity.pos.z, game.world, time, fromY);
        rec.slots[i] = null;
      }
    }
    entity.chestSlots = null;
    delete inventories[keyOf(entity)];
  }

  function serialize(game) {
    var out = [];
    for (var key in inventories) {
      var rec = inventories[key];
      if (!rec || !hasItems(rec.slots)) continue;
      var packed = [];
      for (var i = 0; i < CAPACITY; i++) {
        var slot = rec.slots[i];
        packed.push(slot ? [slot.id, slot.qty] : null);
      }
      out.push({ x: rec.x, y: rec.y, z: rec.z, slots: packed });
    }
    return out;
  }

  function load(game, records) {
    if (!Array.isArray(records)) return;
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (!rec) continue;
      var x = round(Number(rec.x) || 0);
      var y = round(Number(rec.y) || 0);
      var z = round(Number(rec.z) || 0);
      var key = keyOfCoords(x, y, z);
      var slots = normalizeSlots(rec.slots);
      var existing = inventories[key];
      if (existing) {
        existing.x = x;
        existing.y = y;
        existing.z = z;
        existing.slots = slots;
      } else {
        inventories[key] = { x: x, y: y, z: z, slots: slots };
      }
      if (game && game.entityManager && game.entityManager.entities) {
        var entities = game.entityManager.entities;
        for (var j = 0; j < entities.length; j++) {
          var e = entities[j];
          if (e.type === 'chest' && keyOf(e) === key) e.chestSlots = slots;
        }
      }
    }
  }

  function forget(x, y, z) {
    delete inventories[keyOfCoords(x, y, z)];
  }

  module.exports = {
    capacity: CAPACITY,
    onSpawn: onSpawn,
    onInteract: onInteract,
    onDestroy: onDestroy,
    serialize: serialize,
    load: load,
    forget: forget,
    keyOf: keyOf
  };
})();
