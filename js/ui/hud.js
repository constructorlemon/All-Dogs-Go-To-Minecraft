(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  class Hud {
    constructor() {
      this.zoneLabel = document.getElementById('zone-label');
      this.hintEl = document.getElementById('hint');
      this.overlay = document.getElementById('overlay');
      this.overlayText = document.getElementById('overlay-text');
      this.baseHint = '';
      this.flashTimer = null;
    }

    setZone(name) {
      this.zoneLabel.textContent = 'Zone: ' + name;
    }

    setBaseHint(text) {
      this.baseHint = text;
      this.setHint(text);
    }

    setHint(text) {
      this.hintEl.textContent = text;
    }

    flash(text) {
      this.hintEl.textContent = text;
      if (this.flashTimer) clearTimeout(this.flashTimer);
      var self = this;
      this.flashTimer = setTimeout(function () { self.setHint(self.baseHint); }, 2500);
    }

    showOverlay(text) {
      this.overlay.hidden = false;
      this.overlayText.textContent = text;
    }

    hideOverlay() {
      this.overlay.hidden = true;
    }
  }

  AllDogs.Hud = Hud;
})();