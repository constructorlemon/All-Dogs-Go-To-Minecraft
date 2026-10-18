(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var WORLD_HEIGHT = AllDogs.constants.WORLD_HEIGHT;

  class DebugHud {
    constructor() {
      this.visible = false;

      this.el = document.createElement('div');
      this.el.id = 'debug';
      this.el.className = 'debug hidden';
      var self = this;
      this.el.addEventListener('click', function () { self.hide(); });

      this.list = document.createElement('div');
      this.el.appendChild(this.list);
      document.body.appendChild(this.el);

      this.vals = {};

      this.addRow('fps', 'FPS');
      this.addRow('pos', 'XYZ');
      this.addRow('cell', 'Block');
      this.addRow('state', 'State');
      this.addRow('chunk', 'Chunk');
      this.addRow('facing', 'Facing');
      this.addRow('world', 'World');
      this.addRow('chunks', 'Chunk meshes');
      this.addRow('render', 'Render');
      this.addRow('drops', 'Drops');
      this.addRow('entities', 'Entities');
      this.addRow('inventory', 'Inventory');
    }

    addRow(id, label) {
      var row = document.createElement('div');
      row.className = 'debug-row';
      var key = document.createElement('span');
      key.className = 'debug-key';
      key.textContent = label + ': ';
      var val = document.createElement('span');
      val.className = 'debug-val';
      row.appendChild(key);
      row.appendChild(val);
      this.list.appendChild(row);
      this.vals[id] = val;
    }

    setRow(id, text) {
      if (this.vals[id]) this.vals[id].textContent = text;
    }

    show() {
      this.visible = true;
      this.el.classList.remove('hidden');
    }

    hide() {
      this.visible = false;
      this.el.classList.add('hidden');
    }

    toggle() {
      if (this.visible) this.hide();
      else this.show();
      return this.visible;
    }

    update(game, dt) {
      if (!this.visible) return;

      var fps = Math.round(1 / Math.max(dt, 1e-4));
      this.setRow('fps', fps + '  (' + (dt * 1000).toFixed(1) + ' ms)');

      var p = game.player.pos;
      this.setRow('pos', this._f(p.x) + ' / ' + this._f(p.y) + ' / ' + this._f(p.z));
      this.setRow('cell', Math.floor(p.x) + ' / ' + Math.floor(p.y) + ' / ' + Math.floor(p.z));

      var pl = game.player;
      this.setRow('state', pl.state + '  h=' + pl.height().toFixed(1) + '  v=' + pl.vel.length().toFixed(1) + (pl.dashRemain > 0 ? '  DASH' : ''));

      var cx = Math.floor(p.x / game.chunkSize);
      var cz = Math.floor(p.z / game.chunkSize);
      this.setRow('chunk', '(' + cx + ', ' + cz + ')  ' + game.chunkSize + '-block chunks');

      var yawDeg = ((game.player.yaw * 180 / Math.PI) % 360 + 360) % 360;
      var pitchDeg = Math.round(game.player.pitch * 180 / Math.PI);
      this.setRow('facing', this._facing(game.player.yaw) + '  yaw ' + Math.round(yawDeg) + '\u00b0  pitch ' + pitchDeg + '\u00b0');

      this.setRow('world', 'infinite x ' + WORLD_HEIGHT + ' x infinite');

      var chunks = {};
      for (var i = 0; i < game.worldMeshes.length; i++) {
        var md = game.worldMeshes[i].userData;
        chunks[md.chunkX + ',' + md.chunkZ] = true;
      }
      this.setRow('chunks', game.worldMeshes.length + ' meshes / ' + Object.keys(chunks).length + ' chunks  r=' + game.renderDistance);

      var info = game.renderer.info.render;
      this.setRow('render', info.calls + ' calls, ' + info.triangles + ' tri');

      var total = 0;
      for (var j = 0; j < game.drops.stacks.length; j++) total += game.drops.stacks[j].qty;
      this.setRow('drops', game.drops.stacks.length + ' stacks (' + total + ' items)');

      var entries = game.inventory.entries();
      var sum = 0;
      for (var k = 0; k < entries.length; k++) sum += entries[k][1];
      this.setRow('inventory', entries.length + ' item types, ' + sum + ' total');

      this.setRow('entities', game.entityManager.entities.length);
    }

    _f(v) {
      return v.toFixed(2);
    }

    _facing(yaw) {
      var fx = -Math.sin(yaw);
      var fz = -Math.cos(yaw);
      if (Math.abs(fx) >= Math.abs(fz)) return fx >= 0 ? 'east (+X)' : 'west (-X)';
      return fz >= 0 ? 'south (+Z)' : 'north (-Z)';
    }
  }

  AllDogs.DebugHud = DebugHud;
})();