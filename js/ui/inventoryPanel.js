(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var blocks = AllDogs.blocks;
  var ITEMS = blocks.ITEMS;
  var HOTBAR_SIZE = AllDogs.constants ? AllDogs.constants.HOTBAR_SIZE : 9;

  function cellHtml(zone, slotIndex, id, qty, extraClass, selectedId) {
    var inner = '';
    if (id) {
      var item = ITEMS[id];
      var sel = id === selectedId ? ' selected' : '';
      inner =
        '<img src="' + AllDogs.iconDataUrl(id) + '" alt="' + item.name + '" draggable="false" />' +
        '<span class="i-count">' + qty + '</span>' +
        '<span class="i-name">' + item.name + '</span>';
      return '<div class="' + extraClass + sel + '" data-zone="' + zone + '" data-slot="' + slotIndex + '"' +
        ' data-id="' + id + '" data-qty="' + qty + '">' + inner + '</div>';
    }
    return '<div class="' + extraClass + '" data-zone="' + zone + '" data-slot="' + slotIndex + '"></div>';
  }

  function itemCardHtml(id, qty, slotIndex, selectedId) {
    var item = ITEMS[id];
    var sel = id === selectedId ? ' selected' : '';
    return '<div class="item-card' + sel + '" data-zone="inv" data-id="' + id + '" data-slot="' + slotIndex + '" data-qty="' + qty + '">' +
      '<img src="' + AllDogs.iconDataUrl(id) + '" alt="' + item.name + '" draggable="false" />' +
      '<span class="i-name">' + item.name + '</span>' +
      '<span class="i-count">' + qty + '</span>' +
      '</div>';
  }

  function emptySlotHtml(slotIndex) {
    return '<div class="empty-slot" data-zone="inv" data-slot="' + slotIndex + '"></div>';
  }

  function craftSlotHtml(inputs, i) {
    var s = inputs && inputs[i];
    var id = s ? s.id : null;
    var qty = s ? s.qty : null;
    return cellHtml('in', i, id, qty, 'craft-slot in in-' + i, null);
  }

  function craftOutputHtml(resolveResult, selectedId) {
    if (!resolveResult) return '<div class="craft-slot out" data-zone="out" data-slot="0"></div>';
    var out = resolveResult.output;
    var id = out[0];
    var qty = out[1];
    var item = ITEMS[id];
    return '<div class="craft-slot out has" data-zone="out" data-slot="0"' +
      ' data-id="' + id + '" data-qty="' + qty + '">' +
      '<img src="' + AllDogs.iconDataUrl(id) + '" alt="' + item.name + '" draggable="false" />' +
      '<span class="i-count">' + qty + '</span>' +
      '<span class="i-name">' + item.name + '</span>' +
      '</div>';
  }

  function craftAreaHtml(craftInputs, selectedId) {
    var resolved = AllDogs.crafting.resolve(craftInputs || [null, null, null]);
    return '<div class="inv-title">Crafting</div>' +
      '<div class="craft-area">' +
      '<div class="craft-stage">' +
      craftSlotHtml(craftInputs, 0) +
      craftSlotHtml(craftInputs, 1) +
      craftSlotHtml(craftInputs, 2) +
      '</div>' +
      craftOutputHtml(resolved, selectedId) +
      '</div>' +
      '<div class="craft-hint">Drag items from your inventory onto the corners. ' +
      'Click or drag the result to craft it.</div>';
  }

  function furnaceSlotHtml(furnaceSlots, idx) {
    var slot = furnaceSlots && furnaceSlots[idx] ? furnaceSlots[idx] : null;
    var id = slot ? slot.id : null;
    var qty = slot ? slot.qty : null;
    return cellHtml('furn', idx, id, qty, 'craft-slot furn in-' + idx, null);
  }

  function furnaceOutputHtml(furnaceOut) {
    if (!furnaceOut) return '<div class="craft-slot out" data-zone="furnout" data-slot="0"></div>';
    var id = furnaceOut[0];
    var qty = furnaceOut[1];
    var item = ITEMS[id];
    return '<div class="craft-slot out has" data-zone="furnout" data-slot="0"' +
      ' data-id="' + id + '" data-qty="' + qty + '">' +
      '<img src="' + AllDogs.iconDataUrl(id) + '" alt="' + item.name + '" draggable="false" />' +
      '<span class="i-count">' + qty + '</span>' +
      '<span class="i-name">' + item.name + '</span>' +
      '</div>';
  }

  function furnaceAreaHtml(furnaceSlots, furnaceOut, progress, selectedId) {
    var prog = (typeof progress === 'number') ? progress : 0;
    return '<div class="inv-title">Furnace</div>' +
      '<div class="craft-area">' +
      '<div class="craft-stage">' +
      furnaceSlotHtml(furnaceSlots, 0) +
      furnaceSlotHtml(furnaceSlots, 1) +
      '</div>' +
      furnaceOutputHtml(furnaceOut) +
      '</div>' +
      '<div class="craft-hint">Arrow: ' + Math.floor(prog * 100) + '% &nbsp; Dirt -> Clay</div>';
  }
  function ghostHtml(id, count) {
    return '<img src="' + AllDogs.iconDataUrl(id) + '" alt="" draggable="false" />' +
      '<span class="count">' + count + '</span>';
  }

  class InventoryPanel {
    constructor() {
      this.el = document.getElementById('inventory');
      this.hotbarEl = document.getElementById('hotbar');
      this.onSelect = null;
      this.onMove = null;
      this.onCraftOutput = null;
      this.onDistribute = null;
      this.draggable = true;
      this.drag = null;
      this.dragMoved = false;
      this.justDragged = false;
      this.ghost = null;
      this.splitTargets = [];
      var self = this;
      this.el.addEventListener('click', function (e) {
        if (self.justDragged) {
          self.justDragged = false;
          return;
        }
        var out = e.target.closest('[data-zone="out"]');
        if (out && self.onCraftOutput) {
          self.onCraftOutput();
          return;
        }
        var card = e.target.closest('[data-id]');
        if (card && self.onSelect) self.onSelect(card.dataset.id);
      });
      this.attachDrag(this.el);
      if (this.hotbarEl) this.attachDrag(this.hotbarEl);

      document.addEventListener('mousemove', function (e) {
        if (!self.drag) return;
        var dx = e.clientX - self.drag.x;
        var dy = e.clientY - self.drag.y;
        var mx = e.movementX || 0;
        var my = e.movementY || 0;
        self.dragMoved = self.dragMoved ||
          Math.abs(dx) > 4 || Math.abs(dy) > 4 ||
          Math.abs(mx) > 4 || Math.abs(my) > 4;
        if (!self.ghost) {
          self.ghost = document.createElement('div');
          self.ghost.className = 'inv-drag-ghost';
          document.body.appendChild(self.ghost);
        }
        if (!self.ghost.firstChild) {
          self.ghost.innerHTML = ghostHtml(self.drag.id, self.drag.count);
          self.ghost.style.display = '';
        }
        self.ghost.style.left = (e.clientX + 10) + 'px';
        self.ghost.style.top = (e.clientY + 10) + 'px';
        if (self.dragMoved) {
          if (e.shiftKey || e.ctrlKey) {
            var hit = document.elementFromPoint(e.clientX, e.clientY);
            var hovered = hit && hit.closest ? hit.closest('[data-slot]') : null;
            self.addSplitTarget(hovered, e.ctrlKey ? 'one' : 'split');
          } else {
            self.clearSplitSelection();
          }
        }
      });
      document.addEventListener('mouseup', function (e) {
        if (!self.drag) return;
        var from = self.drag.from;
        var fromZone = self.drag.zone;
        if (self.dragMoved) {
          self.justDragged = true;
          setTimeout(function () { self.justDragged = false; }, 0);
        }
        if ((e.shiftKey || e.ctrlKey) && self.splitTargets.length > 0) {
          if (self.onDistribute) {
            var targets = [];
            for (var i = 0; i < self.splitTargets.length; i++) {
              targets.push(+self.splitTargets[i].dataset.slot);
            }
            self.onDistribute(from, fromZone, targets, e.ctrlKey ? 'one' : 'split');
          }
          self.clearSplitSelection();
          self.drag = null;
          if (self.ghost) self.ghost.style.display = 'none';
          return;
        }
        var ok = false;
        if (self.dragMoved) {
          var hit = document.elementFromPoint(e.clientX, e.clientY);
          var cell = hit && hit.closest ? hit.closest('[data-slot]') : null;
          if (cell && self.onMove) {
            var to = +cell.dataset.slot;
            var toZone = cell.dataset.zone || 'inv';
            if (to !== from || toZone !== fromZone) {
              ok = !!self.onMove(from, fromZone, to, toZone, self.drag.count);
            }
          }
        }
        self.clearSplitSelection();
        self.drag = null;
        if (self.ghost) self.ghost.style.display = 'none';
      });
    }

    addSplitTarget(cell, mode) {
      if (!this.drag) return;
      this.splitMode = mode === 'one' ? 'one' : 'split';
      if (cell) {
        var zone = cell.dataset.zone || 'inv';
        var okZone = zone === 'inv';
        var okType = !(cell.dataset.id && cell.dataset.id !== this.drag.id);
        var okSource = !(cell.dataset.id && this.drag.zone === 'inv' && +cell.dataset.slot === this.drag.from);
        var isNew = this.splitTargets.indexOf(cell) === -1;
        if (okZone && okType && okSource && isNew) this.splitTargets.push(cell);
      }
      this.updateSplitPreview();
    }

    updateSplitPreview() {
      var n = this.drag ? this.drag.count : 0;
      var K = this.splitTargets.length;
      if (K === 0) return;
      var one = this.splitMode === 'one';
      var base = one ? 0 : Math.floor(n / K);
      var rem = one ? 0 : n - base * K;
      for (var i = 0; i < K; i++) {
        var cell = this.splitTargets[i];
        var share = one ? (i < n ? 1 : 0) : (base + (i < rem ? 1 : 0));
        cell.classList.add('split-target');
        this.setSplitBadge(cell, share);
      }
    }

    setSplitBadge(cell, share) {
      var badge = cell.querySelector ? cell.querySelector('.split-badge') : null;
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'split-badge';
        if (cell.appendChild) cell.appendChild(badge);
      }
      badge.textContent = String(share);
    }

    clearSplitSelection() {
      for (var i = 0; i < this.splitTargets.length; i++) {
        var cell = this.splitTargets[i];
        if (cell.classList) cell.classList.remove('split-target');
        var badge = cell.querySelector ? cell.querySelector('.split-badge') : null;
        if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
      }
      this.splitTargets = [];
    }

    attachDrag(root) {
      var self = this;
      root.addEventListener('mousedown', function (e) {
        if (e.button !== 0 || !self.draggable) return;
        var cell = e.target.closest('[data-slot]');
        if (!cell || !cell.dataset.id) return;
        self.clearSplitSelection();
        self.drag = {
          from: +cell.dataset.slot,
          zone: cell.dataset.zone || 'inv',
          id: cell.dataset.id,
          count: parseInt(cell.dataset.qty, 10) || 1,
          x: e.clientX,
          y: e.clientY
        };
        self.dragMoved = false;
        if (e.preventDefault) e.preventDefault();
        if (self.ghost) {
          self.ghost.innerHTML = '';
          self.ghost.style.display = 'none';
        }
      });
    }

    open(inventory, opts) {
      this.el.hidden = false;
      this.render(inventory, opts || {});
    }

    close() {
      this.el.hidden = true;
    }

    render(inventory, opts) {
      opts = opts || {};
      var creative = !!opts.creative;
      var selectedId = opts.selectedId;
      var craftInputs = opts.craftInputs || [null, null, null];
      this.draggable = !creative;

      var catalog = inventory.catalog();
      var title;
      var gridClass;
      var itemsHtml;
      var craftingHtml = '';
      if (opts && opts.mode === 'furnace') {
        title = 'Furnace';
        gridClass = 'inv-grid';
        var furnSlots = (opts.furnaceSlots || [null, null]);
        var furnOut = opts.furnaceOut || null;
        var furnProg = (typeof opts.furnaceProgress === 'number') ? opts.furnaceProgress : 0;
        var sc = inventory.capacity;
        if (!(sc > 0) || !isFinite(sc)) sc = 36;
        var start2 = Math.min(HOTBAR_SIZE, sc);
        var fcells = [];
        for (var i2 = start2; i2 < sc; i2++) {
          var s2 = inventory.get(i2);
          fcells.push(s2 ? itemCardHtml(s2.id, s2.qty, i2, selectedId) : emptySlotHtml(i2));
        }
        itemsHtml = fcells.join('');
        craftingHtml = furnaceAreaHtml(furnSlots, furnOut, furnProg, selectedId);
      } else if (creative && catalog) {
        title = 'Creative Inventory \u2014 scroll for more blocks';
        gridClass = 'inv-grid creative-grid';
        itemsHtml = catalog
          .map(function (entry, i) {
            return itemCardHtml(entry.id, entry.qty, i, selectedId);
          })
          .join('');
      } else {
        var slotCount = inventory.capacity;
        if (!(slotCount > 0) || !isFinite(slotCount)) slotCount = 36;
        title = 'Inventory (' + inventory.usedSlots() + '/' + slotCount + ' slots)';
        gridClass = 'inv-grid';
        var cells = [];
        var start = Math.min(HOTBAR_SIZE, slotCount);
        for (var i = start; i < slotCount; i++) {
          var slot = inventory.get(i);
          cells.push(slot ? itemCardHtml(slot.id, slot.qty, i, selectedId) : emptySlotHtml(i));
        }
        itemsHtml = cells.join('');
        craftingHtml = craftAreaHtml(craftInputs, selectedId);
      }

      this.el.innerHTML =
        '<div class="inv-window">' +
        (creative ? '' : craftingHtml) +
        (creative ? '' : '<div class="inv-title">' + title + '</div>') +
        '<div class="' + gridClass + '">' + itemsHtml + '</div>' +
        '<div class="inv-foot">Click an item to select it. Drag to move. Hold Shift and drag to split a stack evenly, Ctrl to place 1 in each square. Press E or click outside to close</div>' +
        '</div>';
    }
  }

  AllDogs.InventoryPanel = InventoryPanel;
})();





