(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  var W = 0.875;
  var BODY_H = 0.5625;
  var LID_H = 0.3125;
  var HALF = { x: 0.4375, y: 0.4375, z: 0.4375 };
  var MAX_OPEN = 1.75;
  var OPEN_SPEED = 5.5;

  var _geo = {};

  function box(w, h, d) {
    var k = w + 'x' + h + 'x' + d;
    if (!_geo[k]) _geo[k] = new THREE.BoxGeometry(w, h, d);
    return _geo[k];
  }

  var _mats = {};

  function material(key) {
    if (!_mats[key]) {
      var c = document.createElement('canvas');
      if (key === 'latch') {
        c.width = 16;
        c.height = 16;
      } else {
        c.width = 64;
        c.height = 48;
      }
      drawWood(c.getContext('2d'), key, c.width, c.height);
      var t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      _mats[key] = new THREE.MeshLambertMaterial({ map: t });
    }
    return _mats[key];
  }

  function drawWood(g, key, w, h) {
    var i;
    if (key === 'latch') {
      g.fillStyle = '#5d3a17';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(43, 26, 10, 0.5)';
      for (i = 0; i < 24; i++) g.fillRect(Math.floor(Math.random() * w), Math.floor(Math.random() * h), 1, 1);
      return;
    }
    g.fillStyle = '#b08a50';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(94, 66, 30, 0.6)';
    for (var x = 0; x <= w; x += 8) g.fillRect(x, 0, 2, h);
    for (i = 0; i < 110; i++) {
      g.fillStyle = 'rgba(' + (132 + Math.floor(Math.random() * 34)) + ',' + (90 + Math.floor(Math.random() * 26)) + ',50,0.3)';
      g.fillRect(Math.floor(Math.random() * w), Math.floor(Math.random() * h), 1, 1);
    }
    if (key === 'body') {
      g.fillStyle = 'rgba(88, 60, 26, 0.85)';
      g.fillRect(0, 16, w, 2);
      g.fillRect(0, 32, w, 2);
      g.fillRect(0, 46, w, 2);
    } else {
      g.fillStyle = '#7a5730';
      g.fillRect(0, 34, w, 8);
      g.fillStyle = 'rgba(88, 60, 26, 0.85)';
      g.fillRect(0, 42, w, 2);
      g.fillRect(0, 28, w, 2);
      g.fillStyle = '#c7a069';
      g.fillRect(0, 0, w, 2);
    }
  }

  class ChestEntity extends AllDogs.Entity {
    constructor(opts) {
      opts = opts || {};
      super('chest', opts);
      this.itemId = 'chest';
      this.solidBlock = true;
      this.halfExtents = HALF;
      this.yaw = opts.yaw || 0;
      this.open = false;
      this.angle = 0;

      this.buildMesh();
    }

    get bounds() {
      return {
        min: { x: this.pos.x - HALF.x, y: this.pos.y, z: this.pos.z - HALF.z },
        max: { x: this.pos.x + HALF.x, y: this.pos.y + W, z: this.pos.z + HALF.z }
      };
    }

    buildMesh() {
      var body = new THREE.Mesh(box(W, BODY_H, W), material('body'));
      body.position.set(0, BODY_H / 2, 0);

      var lid = new THREE.Mesh(box(W, LID_H, W), material('lid'));
      lid.position.set(0, LID_H / 2, W / 2);

      var latch = new THREE.Mesh(box(0.125, 0.125, 0.125), material('latch'));
      latch.position.set(0.5, 0.0625, 0.9375);

      this.pivot = new THREE.Group();
      this.pivot.position.set(0, BODY_H, -W / 2);
      this.pivot.add(lid, latch);
      this.pivot.rotation.x = 0;

      this.mesh = new THREE.Group();
      this.mesh.add(body, this.pivot);
      this.mesh.rotation.order = 'YXZ';
      this.mesh.rotation.y = this.yaw;
    }

    update(dt) {
      var target = this.open ? MAX_OPEN : 0;
      var diff = target - this.angle;
      if (Math.abs(diff) < 0.001) {
        this.angle = target;
      } else {
        this.angle += Math.sign(diff) * Math.min(Math.abs(diff), OPEN_SPEED * dt);
      }
      this.pivot.rotation.x = -this.angle;
    }

    interact(ctx) {
      this.open = !this.open;
    }
  }

  AllDogs.entities.register('chest', ChestEntity);
})();