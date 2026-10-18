(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var DEFAULT_CAPACITY = 36;

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
      this._catalog = null;
      if (init) {
        for (var id in init) this.add(id, init[id]);
      }
    }

    setCreative() {
      this.creative = true;
      var ITEMS = AllDogs.blocks.ITEMS;
      var catalog = [];
      for (var id in ITEMS) {
        var it = ITEMS[id];
        if (it && it.place != null) catalog.push({ id: id, qty: 999 });
      }
      this._catalog = catalog;
    }

    catalog() {
      return this.creative ? this._catalog : null;
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
      if (this.creative) return true;
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
      if (this.creative && this._catalog) {
        for (var i = 0; i < this._catalog.length; i++) {
          if (this._catalog[i].id === itemId) return this._catalog[i].qty;
        }
        return 0;
      }
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
      if (this.creative && this._catalog) {
        return this._catalog.map(function (c) { return [c.id, c.qty]; });
      }
      var out = [];
      for (var i = 0; i < this.slots.length; i++) {
        var s = this.slots[i];
        if (s) out.push([s.id, s.qty]);
      }
      return out;
    }

    usedSlots() {
      if (this.creative && this._catalog) return this._catalog.length;
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