(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var MAX_LINES = 4;

  class SignEditor {
    constructor() {
      this.el = document.getElementById('sign-editor');
      this.textarea = document.getElementById('sign-text');
      this.saveBtn = document.getElementById('sign-save');
      this.entity = null;
      this.active = false;
      this.onClose = null;
      var self = this;

      this.saveBtn.addEventListener('click', function (e) {
        e.preventDefault();
        self.commit();
      });

      this.textarea.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          self.commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          self.cancel();
        }
      });

      this.el.addEventListener('click', function (e) {
        if (e.target === self.el) self.cancel();
      });
    }

    open(entity) {
      this.entity = entity;
      this.textarea.value = (entity.text || []).join('\n');
      this.el.hidden = false;
      this.active = true;
      this.textarea.focus();
      this.textarea.select();
    }

    close() {
      this.el.hidden = true;
      this.active = false;
      this.entity = null;
    }

    commit() {
      var raw = this.textarea.value.split('\n');
      var lines = [];
      for (var i = 0; i < raw.length && lines.length < MAX_LINES; i++) {
        lines.push(raw[i].replace(/\s+$/, ''));
      }
      if (this.entity) this.entity.setText(lines);
      if (this.onCommit) this.onCommit(this.entity, lines);
      if (this.onClose) this.onClose();
    }

    cancel() {
      if (this.onClose) this.onClose();
    }
  }

  AllDogs.SignEditor = SignEditor;
})();