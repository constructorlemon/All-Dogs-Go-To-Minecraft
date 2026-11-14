(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  class PauseMenu {
    constructor(game) {
      this.game = game;
      this.visible = false;

      this.el = document.createElement('div');
      this.el.id = 'pause-menu';
      this.el.className = 'pause-menu hidden';

      var panel = document.createElement('div');
      panel.className = 'pause-panel';

      var title = document.createElement('div');
      title.className = 'pause-title';
      title.textContent = 'Paused';
      panel.appendChild(title);

      var self = this;
      this.addButton(panel, 'Resume', function () { self.close(); });
      this.addButton(panel, 'Save World', function () { self.game.saveWorld(); });
      this.addButton(panel, 'Instructions', function () {
        window.location.href = 'controls.html';
      });
      this.addButton(panel, 'Main Menu', function () {
        window.location.href = 'index.html';
      });

      this.status = document.createElement('div');
      this.status.className = 'pause-status';
      panel.appendChild(this.status);

      this.meshActions = document.createElement('div');
      this.meshActions.className = 'pause-meshes';
      panel.appendChild(this.meshActions);

      this.el.appendChild(panel);
      document.body.appendChild(this.el);
    }

    addButton(parent, label, handler) {
      var btn = document.createElement('button');
      btn.className = 'pause-btn';
      btn.textContent = label;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        handler();
      });
      parent.appendChild(btn);
    }

    rebuildMeshActions() {
      if (!this.meshActions) return;
      this.meshActions.innerHTML = '';
      var factory = AllDogs.meshFactory;
      var list = factory && factory.list ? factory.list() : [];
      if (!list.length) {
        this.meshActions.hidden = true;
        return;
      }
      this.meshActions.hidden = false;
      var title = document.createElement('div');
      title.className = 'pause-mesh-title';
      title.textContent = 'Spawn mesh';
      this.meshActions.appendChild(title);

      var self = this;
      for (var i = 0; i < list.length; i++) {
        (function (entry) {
          var label = 'Spawn ' + entry.name + (entry.kind === 'mob' ? ' (mob)' : '');
          self.addButton(self.meshActions, label, function () { self.spawnMesh(entry.type); });
        })(list[i]);
      }
    }

    spawnMesh(type) {
      var factory = AllDogs.meshFactory;
      var entry = factory && factory.get ? factory.get(type) : null;
      if (!entry) return;
      var player = this.game.player;
      var dist = 2.2;
      var dx = -Math.sin(player.yaw) * dist;
      var dz = -Math.cos(player.yaw) * dist;
      var opts = {
        pos: {
          x: player.pos.x + dx,
          y: player.pos.y + 0.05,
          z: player.pos.z + dz
        },
        yaw: player.yaw + Math.PI
      };
      var entity = this.game.entityManager.create(type, opts);
      if (!entity) {
        this.status.textContent = 'Could not spawn ' + entry.name + '.';
        return;
      }
      this.game.entityManager.add(entity);
      this.close();
      this.game.hud.flash('Spawned ' + entry.name + '.');
    }

    open() {
      if (this.visible) return;
      this.visible = true;
      this.status.textContent = '';
      this.rebuildMeshActions();
      this.el.classList.remove('hidden');
      this.game.hud.hideOverlay();
      this.game.input.releaseLock();
    }

    close() {
      if (!this.visible) return;
      this.visible = false;
      this.el.classList.add('hidden');
      this.game.hud.hideOverlay();
      this.game.input.requestLock();
    }

    toggle() {
      if (this.visible) this.close();
      else this.open();
    }
  }

  AllDogs.PauseMenu = PauseMenu;
})();
