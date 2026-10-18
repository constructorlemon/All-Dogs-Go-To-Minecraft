(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var C_DOUBLE_TAP_MS = AllDogs.constants.DOUBLE_TAP_MS;

  var MAX_LOOK_STEP = 0.8;

  class Input {
    constructor(canvas) {
      this.canvas = canvas;
      this.keys = new Set();
      this.pressed = new Set();
      this.lookX = 0;
      this.lookY = 0;
      this.wheelDelta = 0;
      this.locked = false;
      this.onLockChange = null;
      this.graceUntil = 0;
      this.modPressAt = 0;
      this.modReleaseAt = 0;
      this.lastWPress = 0;
      this.wDouble = false;
    }

    listen() {
      var isEditable = function (t) {
        return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      };

      window.addEventListener('keydown', (e) => {
        if (isEditable(e.target)) return;
        var isCtrl = e.ctrlKey || this.keys.has('ControlLeft') || this.keys.has('ControlRight');
        if (e.code === 'Space' || e.code === 'Tab' || e.code === 'F3') e.preventDefault();
        if (this.locked && isCtrl) e.preventDefault();
        if (!e.repeat) {
          if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') this.modPressAt = performance.now();
          if (e.code === 'KeyW') {
            var now = performance.now();
            this.wDouble = now - this.lastWPress < C_DOUBLE_TAP_MS;
            this.lastWPress = now;
          }
        }
        this.keys.add(e.code);
        if (!e.repeat) this.pressed.add(e.code);
      });

      document.addEventListener(
        'keydown',
        (e) => {
          if (isEditable(e.target)) return;
          var isCtrl = e.ctrlKey || this.keys.has('ControlLeft') || this.keys.has('ControlRight');
          if (this.locked && isCtrl) e.preventDefault();
        },
        true
      );

      window.addEventListener('keyup', (e) => {
        if (isEditable(e.target)) return;
        if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') {
          this.modReleaseAt = performance.now();
        }
        if (e.code === 'KeyW') this.wDouble = false;
        this.keys.delete(e.code);
      });
      window.addEventListener('blur', () => this.keys.clear());

      document.addEventListener('mousemove', (e) => {
        if (!this.locked) return;
        if (performance.now() < this.graceUntil) return;
        var mx = e.movementX || 0;
        var my = e.movementY || 0;
        if (!isFinite(mx) || !isFinite(my)) return;
        if (Math.abs(mx) > 2048 || Math.abs(my) > 2048) return;
        this.lookX += mx;
        this.lookY += my;
      });

      this.canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.wheelDelta += Math.sign(e.deltaY);
      }, { passive: false });

      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === this.canvas;
        this.resetLook();
        if (this.locked) this.graceUntil = performance.now() + 150;
        if (this.onLockChange) this.onLockChange(this.locked);
      });

      window.addEventListener('pagehide', () => {
        if (document.pointerLockElement) document.exitPointerLock();
        this.keys.clear();
      });

      this.canvas.addEventListener('pointerlockerror', () => {
        if (this.onLockChange) this.onLockChange(false);
      });
    }

    requestLock() {
      this.resetLook();
      this.graceUntil = performance.now() + 150;
      try {
        var p = this.canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        this.locked = false;
      }
    }

    releaseLock() {
      this.resetLook();
      if (document.pointerLockElement) document.exitPointerLock();
    }

    isDown(code) {
      return this.keys.has(code);
    }

    consumePressed(code) {
      if (this.pressed.has(code)) {
        this.pressed.delete(code);
        return true;
      }
      return false;
    }

    resetLook() {
      this.lookX = 0;
      this.lookY = 0;
    }

    takeLook(sensitivity) {
      var x = this.lookX * sensitivity;
      var y = this.lookY * sensitivity;
      this.lookX = 0;
      this.lookY = 0;
      if (!isFinite(x)) x = 0;
      if (!isFinite(y)) y = 0;
      var mag = Math.hypot(x, y);
      if (mag > MAX_LOOK_STEP) {
        var scale = MAX_LOOK_STEP / mag;
        x *= scale;
        y *= scale;
      }
      return { x: x, y: y };
    }

    takeWheel() {
      var d = this.wheelDelta;
      this.wheelDelta = 0;
      return d;
    }
  }

  AllDogs.Input = Input;
})();