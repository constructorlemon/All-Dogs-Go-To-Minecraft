(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  class MainDebug {
    constructor() {
      this.visible = false;

      this.el = document.createElement('div');
      this.el.id = 'main-debug';
      this.el.className = 'main-debug hidden';
      var self = this;
      this.el.addEventListener('click', function () { self.hide(); });

      var head = document.createElement('div');
      head.className = 'main-debug-head';
      head.textContent = 'Modding Tools';
      this.el.appendChild(head);

      var hint = document.createElement('div');
      hint.className = 'main-debug-hint';
      hint.textContent = 'Build your own blocks and items.';
      this.el.appendChild(hint);

      this.actions = document.createElement('div');
      this.actions.className = 'debug-actions';
      this.addAction('Add texture', 'mod_textures.html');
      this.addAction('Add meshes', 'mod_meshes.html');
      this.el.appendChild(this.actions);

      document.body.appendChild(this.el);
    }

    addAction(label, href) {
      var btn = document.createElement('button');
      btn.className = 'debug-btn';
      btn.textContent = label;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        window.location.href = href;
      });
      this.actions.appendChild(btn);
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
  }

  AllDogs.MainDebug = MainDebug;
})();