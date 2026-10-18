(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var STAMINA_MAX = AllDogs.constants.STAMINA_MAX;

  var LEVELS = [
    { at: 0, color: '#e0403f' },
    { at: 0.25, color: '#ffe14d' },
    { at: 0.5, color: '#ff9c2e' },
    { at: 0.75, color: '#5ad247' }
  ];

  class StaminaBar {
    constructor() {
      this.root = document.getElementById('stamina');
      this.fill = this.root.querySelector('.stamina-fill');
    }

    update(player) {
      var f = Math.max(0, Math.min(1, player.stamina / STAMINA_MAX));
      this.fill.style.width = (f * 100).toFixed(1) + '%';
      this.fill.style.background = this.colorFor(f);
      if (player.exhausted) this.root.classList.add('exhausted');
      else this.root.classList.remove('exhausted');
      if (player.charging) this.root.classList.add('charging');
      else this.root.classList.remove('charging');
    }

    colorFor(f) {
      var color = LEVELS[0].color;
      for (var i = 0; i < LEVELS.length; i++) {
        if (f >= LEVELS[i].at) color = LEVELS[i].color;
        else break;
      }
      return color;
    }
  }

  AllDogs.StaminaBar = StaminaBar;
})();