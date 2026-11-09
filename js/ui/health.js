(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var HEALTH_MAX = AllDogs.constants.PLAYER_MAX_HEALTH || 100;

  class HealthBar {
    constructor() {
      this.root = document.getElementById('health');
      this.fill = this.root ? this.root.querySelector('.health-fill') : null;
    }

    update(player) {
      if (!this.root || !this.fill || !player) return;
      var max = player.maxHealth || HEALTH_MAX;
      var f = Math.max(0, Math.min(1, player.health / max));
      this.fill.style.width = (f * 100).toFixed(1) + '%';
    }
  }

  AllDogs.HealthBar = HealthBar;
})();
