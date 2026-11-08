(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  class TestingZone extends AllDogs.Zone {
    constructor() {
      super('testing', 'Testing Zone');
      this.world = null;
    }

    heightAt(x, z) {
      return AllDogs.worldgen.heightAt(x, z);
    }

    generate(world) {
      world.clear();
      this.world = world;
      var sy = AllDogs.worldgen.heightAt(0, 0);
      this.spawn = { x: 0.5, y: sy + 3, z: 0.5 };
    }

    // Pick a nearby column whose two-block body height is clear. This keeps the
    // test zombies out of trees and houses even though the zone is generated.
    clearSpawn(world, x, z) {
      for (var r = 0; r <= 3; r++) {
        for (var dx = -r; dx <= r; dx++) {
          for (var dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            var sx = x + dx;
            var sz = z + dz;
            var gy = this.heightAt(sx, sz);
            if (!world.isSolid(sx, gy, sz)) continue;
            if (world.isSolid(sx, gy + 1, sz) || world.isSolid(sx, gy + 2, sz)) continue;
            return { x: sx + 0.5, y: gy + 1, z: sz + 0.5 };
          }
        }
      }
      var fallbackY = this.heightAt(x, z) + 1;
      return { x: x + 0.5, y: fallbackY, z: z + 0.5 };
    }

    entities() {
      var world = this.world;
      var x = Math.floor(this.spawn.x) + 4;
      var z = Math.floor(this.spawn.z);
      var gy = this.heightAt(x, z) + 1;
      var dx = this.spawn.x - (x + 0.5);
      var dz = this.spawn.z - (z + 0.5);
      var cx = x + 3;
      var cz = z + 3;
      var list = [
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

      var spots = [
        { x: x - 3, z: z - 2 },
        { x: x - 5, z: z + 2 },
        { x: x - 2, z: z + 4 }
      ];
      for (var i = 0; i < spots.length; i++) {
        var pos = world
          ? this.clearSpawn(world, spots[i].x, spots[i].z)
          : { x: spots[i].x + 0.5, y: this.heightAt(spots[i].x, spots[i].z) + 1, z: spots[i].z + 0.5 };
        list.push({ type: 'zombie', pos: pos });
      }
      return list;
    }
  }

  AllDogs.TestingZone = TestingZone;
})();
