(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  class ZoneManager {
    constructor(world) {
      this.world = world;
      this.zones = new Map();
      this.current = null;
    }

    register(zone) {
      this.zones.set(zone.id, zone);
    }

    enter(id) {
      if (this.current) this.current.onLeave();
      var zone = this.zones.get(id);
      if (!zone) return null;
      this.world.clear();
      zone.generate(this.world);
      zone.onEnter();
      this.current = zone;
      return zone;
    }

    update(dt) {
      if (this.current) this.current.onUpdate(dt);
    }

    name() {
      return this.current ? this.current.name : 'Unknown Zone';
    }
  }

  AllDogs.ZoneManager = ZoneManager;
})();