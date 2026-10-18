(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  var C = AllDogs.constants;
  var DROP_LIFETIME = 300;
  var PICKUP_DELAY = 3;
  var DROP_SIZE = 0.35;
  var BOB_AMPLITUDE = 0.06;
  var BOB_SPEED = 2.4;
  var SPIN_SPEED = 1.2;

  var _geo = null;

  function dropGeometry() {
    if (!_geo) _geo = new THREE.BoxGeometry(1, 1, 1);
    return _geo;
  }

  class Drops {
    constructor() {
      this.group = new THREE.Group();
      this.stacks = [];
      this._tex = {};
      this._mat = {};
    }

    _groundY(x, z, world, fromY) {
      for (var y = fromY - 1; y >= 0; y--) {
        if (world.isSolid(x, y, z)) return y + 1;
        var top = world.solidAABBTopAt(x, y, z);
        if (top !== null) return top;
      }
      return null;
    }

    _material(itemId) {
      if (!this._mat[itemId]) {
        var t = new THREE.CanvasTexture(AllDogs.iconCanvas(itemId));
        t.magFilter = THREE.NearestFilter;
        t.minFilter = THREE.NearestFilter;
        t.colorSpace = THREE.SRGBColorSpace;
        this._mat[itemId] = new THREE.MeshLambertMaterial({ map: t });
      }
      return this._mat[itemId];
    }

    drop(itemId, qty, x, z, world, time, fromY) {
      var xi = Math.floor(x);
      var zi = Math.floor(z);
      var gy = this._groundY(xi, zi, world, fromY);
      if (gy === null) return false;

      for (var i = 0; i < this.stacks.length; i++) {
        var s = this.stacks[i];
        if (s.itemId === itemId && Math.abs(s.cellX - xi) <= 1 && Math.abs(s.cellZ - zi) <= 1) {
          s.qty += qty;
          s.spawnTime = time;
          s.expiresAt = time + DROP_LIFETIME;
          return true;
        }
      }

      var mesh = new THREE.Mesh(dropGeometry(), this._material(itemId));
      mesh.scale.setScalar(DROP_SIZE);
      mesh.position.set(
        xi + 0.5 + (Math.random() - 0.5) * 0.4,
        gy + DROP_SIZE / 2 + 0.05,
        zi + 0.5 + (Math.random() - 0.5) * 0.4
      );
      this.group.add(mesh);

      this.stacks.push({
        itemId: itemId,
        qty: qty,
        cellX: xi,
        cellZ: zi,
        baseY: mesh.position.y,
        phase: Math.random() * Math.PI * 2,
        mesh: mesh,
        spawnTime: time,
        expiresAt: time + DROP_LIFETIME
      });
      return true;
    }

    pickupNear(x, y, z, radius, time, canTake) {
      var out = [];
      for (var i = this.stacks.length - 1; i >= 0; i--) {
        var s = this.stacks[i];
        if (time - s.spawnTime < PICKUP_DELAY) continue;
        if (canTake && !canTake(s.itemId, s.qty)) continue;
        var dx = s.mesh.position.x - x;
        var dz = s.mesh.position.z - z;
        var dy = s.baseY - y;
        if (dx * dx + dz * dz > radius * radius) continue;
        if (dy < -0.5 || dy > 3) continue;
        out.push({ itemId: s.itemId, qty: s.qty });
        this.group.remove(s.mesh);
        this.stacks.splice(i, 1);
      }
      return out;
    }

    update(dt, time) {
      for (var i = this.stacks.length - 1; i >= 0; i--) {
        var s = this.stacks[i];
        if (time >= s.expiresAt) {
          this.group.remove(s.mesh);
          this.stacks.splice(i, 1);
          continue;
        }
        s.mesh.position.y = s.baseY + Math.sin(time * BOB_SPEED + s.phase) * BOB_AMPLITUDE;
        s.mesh.rotation.y += SPIN_SPEED * dt;
      }
    }
  }

  AllDogs.Drops = Drops;
})();