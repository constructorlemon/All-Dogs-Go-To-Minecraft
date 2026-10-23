(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  class Entity {
    constructor(type, opts) {
      opts = opts || {};
      this.type = type;
      this.id = null;
      this.manager = null;
      this.itemId = opts.itemId || null;
      this.pos = new THREE.Vector3();
      this.vel = new THREE.Vector3();
      this.halfExtents = opts.halfExtents || { x: 0.25, y: 0.5, z: 0.25 };
      this.alive = true;
      this.mesh = null;
      if (opts.pos) {
        this.pos.set(opts.pos.x, opts.pos.y, opts.pos.z);
        this.feet = this.pos.clone();
      }
    }

    get bounds() {
      return {
        min: {
          x: this.pos.x - this.halfExtents.x,
          y: this.pos.y - this.halfExtents.y,
          z: this.pos.z - this.halfExtents.z
        },
        max: {
          x: this.pos.x + this.halfExtents.x,
          y: this.pos.y + this.halfExtents.y,
          z: this.pos.z + this.halfExtents.z
        }
      };
    }

    savePos() {
      return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
    }

    update(dt, ctx) {}

    interact(ctx) {}

    syncMesh() {
      if (!this.mesh) return;
      this.mesh.position.copy(this.pos);
      if (this.yaw !== undefined) this.mesh.rotation.y = this.yaw;
    }

    onSpawn(manager) {}

    onRemoved(manager) {}

    remove() {
      this.alive = false;
    }
  }

  AllDogs.Entity = Entity;

  AllDogs.entities = {
    _types: {},
    Entity: Entity,
    register: function (type, ctor) {
      AllDogs.entities._types[type] = ctor;
    },
    create: function (type, opts) {
      var ctor = AllDogs.entities._types[type];
      return ctor ? new ctor(opts) : null;
    }
  };
})();