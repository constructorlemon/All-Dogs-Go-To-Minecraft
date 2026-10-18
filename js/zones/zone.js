(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  class Zone {
    constructor(id, name) {
      this.id = id;
      this.name = name;
      this.spawn = { x: 0.5, y: 40, z: 0.5 };
    }

    generate(world) {}

    entities() {
      return [];
    }

    onEnter() {}

    onUpdate(dt) {}

    onLeave() {}

    canExit() {
      return true;
    }
  }

  AllDogs.Zone = Zone;
})();