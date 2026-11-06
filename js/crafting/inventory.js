(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var DEFAULT_CAPACITY = 36;
  var CREATIVE_STACK = 999;

  class Inventory {
    constructor(options) {
      var init = null;
      if (typeof options === 'number') {
        this.capacity = options;
      } else {
        this.capacity = DEFAULT_CAPACITY;
        init = options;
      }
      this.slots = new Array(this.capacity).fill(null);
      this.creative = false;
      if (init) {
        for (var id in init) this.add(id, init[id]);
      }
    }

    setCreative() {
      this.creative = true;
      var blocks = AllDogs.blocks;
      var ITEMS = blocks.ITEMS;
      var order = blocks.ITEM_ORDER || [];
      var ids = [];
      var seen = Object.create(null);
      function push(id) {
        if (!ITEMS[id] || seen[id]) return;
        seen[id] = true;
        ids.push(id);
      }
      for (var i = 0; i < order.length; i++) push(order[i]);
      for (var id in ITEMS) push(id);
      this.capacity = Math.max(this.capacity, ids.length);
      this.slots = new Array(this.capacity).fill(null);
      for (var j = 0; j < ids.length; j++) {
        this.slots[j] = { id: ids[j], qty: CREATIVE_STACK };
      }
    }

    indexOf(itemId) {
      for (var i = 0; i < this.slots.length; i++) {
        var s = this.slots[i];
        if (s && s.id === itemId) return i;
      }
      return -1;
    }

    findEmpty() {
      for (var i = 0; i < this.slots.length; i++) {
        if (!this.slots[i]) return i;
      }
      return -1;
    }

    add(itemId, qty) {
      if (qty === undefined) qty = 1;
      var i = this.indexOf(itemId);
      if (i < 0) i = this.findEmpty();
      if (i < 0) return false;
      var s = this.slots[i];
      if (s) s.qty += qty;
      else this.slots[i] = { id: itemId, qty: qty };
      return true;
    }

    remove(itemId, qty) {
      if (qty === undefined) qty = 1;
      if (this.creative) return;
      for (var i = 0; i < this.slots.length && qty > 0; i++) {
        var s = this.slots[i];
        if (s && s.id === itemId) {
          var take = Math.min(s.qty, qty);
          s.qty -= take;
          qty -= take;
          if (s.qty <= 0) this.slots[i] = null;
        }
      }
    }

    count(itemId) {
      var total = 0;
      for (var i = 0; i < this.slots.length; i++) {
        var s = this.slots[i];
        if (s && s.id === itemId) total += s.qty;
      }
      return total;
    }

    canHold(itemId) {
      if (this.creative) return true;
      return this.indexOf(itemId) >= 0 || this.findEmpty() >= 0;
    }

    entries() {
      var out = [];
      for (var i = 0; i < this.slots.length; i++) {
        var s = this.slots[i];
        if (s) out.push([s.id, s.qty]);
      }
      return out;
    }

    usedSlots() {
      var used = 0;
      for (var i = 0; i < this.slots.length; i++) {
        if (this.slots[i]) used++;
      }
      return used;
    }

    get(index) {
      return this.slots[index] || null;
    }

    set(index, slot) {
      if (index < 0 || index >= this.slots.length) return;
      this.slots[index] = slot;
    }

    move(from, to, count) {
      if (from < 0 || to < 0 || from >= this.slots.length || to >= this.slots.length) return false;
      if (from === to) return false;
      var a = this.slots[from];
      if (!a) return false;
      var b = this.slots[to];
      var n = count === undefined ? a.qty : Math.min(count, a.qty);
      if (n <= 0) return false;
      if (b && b.id !== a.id) {
        if (n < a.qty) return false;
        this.slots[from] = b;
        this.slots[to] = a;
        return true;
      }
      if (b) {
        b.qty += n;
      } else {
        this.slots[to] = { id: a.id, qty: n };
      }
      a.qty -= n;
      if (a.qty <= 0) this.slots[from] = null;
      return true;
    }

    take(index, count) {
      if (index < 0 || index >= this.slots.length) return null;
      var a = this.slots[index];
      if (!a || !(count > 0)) return null;
      var amt = Math.min(count, a.qty);
      var out = { id: a.id, qty: amt };
      a.qty -= amt;
      if (a.qty <= 0) this.slots[index] = null;
      return out;
    }

    swap(from, to) {
      if (from < 0 || to < 0 || from >= this.slots.length || to >= this.slots.length) return;
      var tmp = this.slots[from];
      this.slots[from] = this.slots[to];
      this.slots[to] = tmp;
    }
  }

  AllDogs.Inventory = Inventory;
})();