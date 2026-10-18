(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  class TestingZone extends AllDogs.Zone {
    constructor() {
      super('testing', 'Testing Zone');
    }

    heightAt(x, z) {
      return AllDogs.worldgen.heightAt(x, z);
    }

    generate(world) {
      world.clear();
      var sy = AllDogs.worldgen.heightAt(0, 0);
      this.spawn = { x: 0.5, y: sy + 3, z: 0.5 };
    }

    entities() {
      var x = Math.floor(this.spawn.x) + 4;
      var z = Math.floor(this.spawn.z);
      var gy = this.heightAt(x, z) + 1;
      var dx = this.spawn.x - (x + 0.5);
      var dz = this.spawn.z - (z + 0.5);
      var cx = x + 3;
      var cz = z + 3;
      return [
        {
          type: 'sign',
          pos: { x: x + 0.5, y: gy, z: z + 0.5 },
          text: ['All Dogs Go', 'To Minecraft'],
          yaw: Math.atan2(-dx, -dz)
        },
        {
          type: 'chest',
          pos: { x: cx + 0.5, y: this.heightAt(cx, cz) + 1, z: cz + 0.5 },
          yaw: Math.atan2(this.spawn.x - (cx + 0.5), this.spawn.z - (cz + 0.5))
        }
      ];
    }
  }

  AllDogs.TestingZone = TestingZone;
})();
