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

    open() {
      if (this.visible) return;
      this.visible = true;
      this.status.textContent = '';
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
