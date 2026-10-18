(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  function rayBox(origin, dir, min, max) {
    var tmin = 0;
    var tmax = Infinity;
    for (var c = 0; c < 3; c++) {
      var o = c === 0 ? origin.x : c === 1 ? origin.y : origin.z;
      var d = c === 0 ? dir.x : c === 1 ? dir.y : dir.z;
      var lo = c === 0 ? min.x : c === 1 ? min.y : min.z;
      var hi = c === 0 ? max.x : c === 1 ? max.y : max.z;
      if (Math.abs(d) < 1e-8) {
        if (o < lo || o > hi) return -1;
      } else {
        var inv = 1 / d;
        var t1 = (lo - o) * inv;
        var t2 = (hi - o) * inv;
        if (t1 > t2) {
          var tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return -1;
      }
    }
    return tmin < 0 ? 0 : tmin;
  }

  class EntityManager {
    constructor(scene) {
      this.scene = scene;
      this.group = new THREE.Group();
      if (scene) scene.add(this.group);
      this.entities = [];
      this._nextId = 1;
      this._origin = new THREE.Vector3();
      this._dir = new THREE.Vector3();
    }

    create(type, opts) {
      return AllDogs.entities.create(type, opts);
    }

    add(entity) {
      if (!entity) return entity;
      if (entity.id == null) entity.id = this._nextId++;
      entity.manager = this;
      this.entities.push(entity);
      if (entity.mesh) this.group.add(entity.mesh);
      if (entity.onSpawn) entity.onSpawn(this);
      return entity;
    }

    remove(entity) {
      var idx = this.entities.indexOf(entity);
      if (idx < 0) return;
      this.entities.splice(idx, 1);
      if (entity.onRemoved) entity.onRemoved(this);
      if (entity.mesh) this.group.remove(entity.mesh);
    }

    clear() {
      for (var i = this.entities.length - 1; i >= 0; i--) this.remove(this.entities[i]);
    }

    update(dt, ctx) {
      for (var i = this.entities.length - 1; i >= 0; i--) {
        var e = this.entities[i];
        if (!e.alive) {
          this.remove(e);
          continue;
        }
        e.update(dt, ctx);
        e.syncMesh();
      }
    }

    raycast(camera, maxDistance) {
      camera.updateMatrixWorld();
      this._origin.setFromMatrixPosition(camera.matrixWorld);
      camera.getWorldDirection(this._dir);

      var best = -1;
      var bestEntity = null;
      for (var i = 0; i < this.entities.length; i++) {
        var e = this.entities[i];
        var b = e.bounds;
        var t = rayBox(
          this._origin, this._dir,
          new THREE.Vector3(b.min.x, b.min.y, b.min.z),
          new THREE.Vector3(b.max.x, b.max.y, b.max.z)
        );
        if (t < 0 || t > maxDistance) continue;
        if (best < 0 || t < best) {
          best = t;
          bestEntity = e;
        }
      }
      return bestEntity ? { entity: bestEntity, distance: best } : null;
    }
  }

  AllDogs.EntityManager = EntityManager;
})();