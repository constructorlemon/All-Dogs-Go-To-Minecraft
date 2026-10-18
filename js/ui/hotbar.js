(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var blocks = AllDogs.blocks;
  var ITEMS = blocks.ITEMS;
  var HOTBAR_SIZE = AllDogs.constants ? AllDogs.constants.HOTBAR_SIZE : 9;

  class Hotbar {
    constructor() {
      this.el = document.getElementById('hotbar');
      this.onSelectIndex = null;
      var self = this;
      this.el.addEventListener('click', function (e) {
        var cell = e.target.closest('[data-slot]');
        if (cell && self.onSelectIndex) self.onSelectIndex(+cell.dataset.slot);
      });
    }

    render(slots, selectedId) {
      var html = '';
      for (var i = 0; i < HOTBAR_SIZE; i++) {
        var s = slots && slots[i];
        if (!s) {
          html += '<div class="slot empty" data-slot="' + i + '"></div>';
          continue;
        }
        var id = s.id;
        var qty = s.qty;
        var item = ITEMS[id];
        var selected = id === selectedId ? ' selected' : '';
        html += '<div class="slot' + selected + '" data-slot="' + i +
          '" data-id="' + id + '" data-qty="' + qty + '">' +
          '<img class="icon" src="' + AllDogs.iconDataUrl(id) + '" alt="' + item.name + '" draggable="false" />' +
          '<span class="count">' + qty + '</span>' +
          '<span class="name">' + item.name + '</span>' +
          '</div>';
      }
      this.el.innerHTML = html;
    }
  }

  AllDogs.Hotbar = Hotbar;
})();