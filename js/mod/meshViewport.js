(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function disposeObject(obj) {
    if (!obj) return;
    obj.traverse(function (child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          for (var i = 0; i < child.material.length; i++) child.material[i].dispose();
        } else {
          child.material.dispose();
        }
      }
    });
  }

  class MeshViewport {
    constructor(container, model, atlas) {
      this.container = container;
      this.model = model;
      this.atlas = atlas;
      this.mode = 'model';
      this.tool = 'select';
      this.selectedPart = null;
      this.preview = false;
      this.onSelect = null;
      this.onTransform = null;
      this.onPaintStart = null;
      this.onPaintMove = null;
      this.onPaintEnd = null;

      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.appendChild(this.renderer.domElement);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x2a2f36);

      this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
      this.target = new THREE.Vector3(0, model.hitbox.height / 2, 0);
      this.spherical = { radius: 4.2, theta: 0.65, phi: 1.15 };
      this._applyCamera();

      var hemi = new THREE.HemisphereLight(0xffffff, 0x8a8578, 1.15);
      var sun = new THREE.DirectionalLight(0xffffff, 1.0);
      sun.position.set(4, 7, 5);
      var fill = new THREE.DirectionalLight(0xb9d4ff, 0.35);
      fill.position.set(-4, 2, -5);
      this.scene.add(hemi, sun, fill);

      this.grid = new THREE.GridHelper(10, 20, 0x6a7078, 0x3b4048);
      this.grid.position.y = 0;
      this.scene.add(this.grid);

      this.rig = null;
      this._selectionHelper = null;
      this._hitboxHelper = null;
      this._drag = null;
      this._pointer = { ndc: new THREE.Vector2() };
      this._raycaster = new THREE.Raycaster();
      this._previewStart = 0;
      this._previewTime = 0;

      var self = this;
      this._onModelChange = function () { self.rebuild(); };
      model.onChange(this._onModelChange);

      this._bindPointer();
      this._bindResize();
      this.rebuild();
      this.frameAll();
      this._loop();
    }

    _bindResize() {
      var self = this;
      this._resize = function () {
        var w = self.container.clientWidth || 320;
        var h = self.container.clientHeight || 240;
        self.renderer.setSize(w, h);
        self.camera.aspect = w / h;
        self.camera.updateProjectionMatrix();
      };
      window.addEventListener('resize', this._resize);
      if (typeof ResizeObserver !== 'undefined') {
        this._resizeObserver = new ResizeObserver(this._resize);
        this._resizeObserver.observe(this.container);
      }
      this._resize();
    }

    _applyCamera() {
      var s = this.spherical;
      var sinPhi = Math.sin(s.phi);
      this.camera.position.set(
        this.target.x + s.radius * sinPhi * Math.sin(s.theta),
        this.target.y + s.radius * Math.cos(s.phi),
        this.target.z + s.radius * sinPhi * Math.cos(s.theta)
      );
      this.camera.lookAt(this.target);
    }

    _ndcFromEvent(e, out) {
      var r = this.renderer.domElement.getBoundingClientRect();
      out = out || this._pointer.ndc;
      out.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -(((e.clientY - r.top) / r.height) * 2 - 1)
      );
      return out;
    }

    _rayFromEvent(e) {
      this._ndcFromEvent(e);
      this._raycaster.setFromCamera(this._pointer.ndc, this.camera);
      return this._raycaster.ray;
    }

    _hit(e) {
      if (!this.rig) return null;
      this._rayFromEvent(e);
      var hits = this._raycaster.intersectObject(this.rig.root, true);
      if (!hits.length) return null;
      var hit = hits[0];
      return {
        hit: hit,
        object: hit.object,
        partId: hit.object.userData ? hit.object.userData.partId : null,
        point: hit.point,
        uv: hit.uv
      };
    }

    pickCell(e) {
      var found = this._hit(e);
      if (!found || !found.uv) return null;
      var fx = clamp(Math.floor(found.uv.x * this.atlas.size), 0, this.atlas.size - 1);
      var fy = clamp(Math.floor(found.uv.y * this.atlas.size), 0, this.atlas.size - 1);
      return this.atlas.cellFromAtlasPixel(fx, fy);
    }

    select(partId) {
      this.selectedPart = partId || null;
      this._updateSelection();
      if (typeof this.onSelect === 'function') this.onSelect(this.selectedPart);
    }

    setTool(tool) {
      this.tool = tool || 'select';
      this.renderer.domElement.style.cursor = this.mode === 'paint' ? 'crosshair' : 'default';
    }

    setMode(mode) {
      this.mode = mode === 'paint' ? 'paint' : 'model';
      this.setTool(this.tool);
      if (this._hitboxHelper) this._hitboxHelper.visible = this.mode === 'model';
      if (this._selectionHelper) this._selectionHelper.visible = this.mode === 'model';
      this.renderer.domElement.style.cursor = this.mode === 'paint' ? 'crosshair' : 'default';
      this.scene.background.setHex(this.mode === 'paint' ? 0x262c33 : 0x2a2f36);
    }

    setPreview(on) {
      on = !!on;
      if (on === this.preview) return;
      this.preview = on;
      if (on) {
        this._previewStart = performance.now() - this._previewTime * 1000;
      } else if (this.rig) {
        this.rig.reset();
      }
    }

    rebuild() {
      if (this.rig) {
        this.scene.remove(this.rig.root);
        disposeObject(this.rig.root);
        this.rig = null;
      }
      if (this._selectionHelper) {
        this.scene.remove(this._selectionHelper);
        disposeObject(this._selectionHelper);
        this._selectionHelper = null;
      }
      this.rig = AllDogs.meshFactory.buildRig(this.model.toJSON(), this.atlas.texture);
      this.scene.add(this.rig.root);
      this._updateHitbox();
      this._updateSelection();
      if (this.preview) this.rig.update(this._previewTime);
    }

    _updateHitbox() {
      if (this._hitboxHelper) {
        this.scene.remove(this._hitboxHelper);
        disposeObject(this._hitboxHelper);
        this._hitboxHelper = null;
      }
      var hb = this.model.hitbox;
      var geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(hb.width, hb.height, hb.depth));
      var mat = new THREE.LineBasicMaterial({ color: 0x7fbf45, transparent: true, opacity: 0.55 });
      this._hitboxHelper = new THREE.LineSegments(geo, mat);
      this._hitboxHelper.position.set(0, hb.height / 2, 0);
      this._hitboxHelper.visible = this.mode === 'model';
      this.scene.add(this._hitboxHelper);
    }

    _updateSelection() {
      if (this._selectionHelper) {
        this.scene.remove(this._selectionHelper);
        disposeObject(this._selectionHelper);
        this._selectionHelper = null;
      }
      if (!this.selectedPart || !this.rig) return;
      var group = this.rig.groups[this.selectedPart];
      if (!group) return;
      var mesh = group.children[0];
      if (!mesh) return;
      this._selectionHelper = new THREE.BoxHelper(mesh, 0x9dff6a);
      this._selectionHelper.material.depthTest = false;
      this._selectionHelper.material.transparent = true;
      this._selectionHelper.material.opacity = 0.95;
      this._selectionHelper.renderOrder = 999;
      this._selectionHelper.visible = this.mode === 'model';
      this.scene.add(this._selectionHelper);
    }

    _beginTransform(kind, partId, e) {
      var part = this.model.getPart(partId);
      if (!part) return false;
      var ray = this._rayFromEvent(e);
      var center = new THREE.Vector3(part.position.x, part.position.y, part.position.z);
      var normal = new THREE.Vector3();
      if (kind === 'move' && e.shiftKey) {
        normal.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      } else {
        this.camera.getWorldDirection(normal);
      }
      var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);
      var point = new THREE.Vector3();
      ray.intersectPlane(plane, point);
      this._drag = {
        kind: kind,
        partId: partId,
        startX: e.clientX,
        startY: e.clientY,
        startPos: { x: part.position.x, y: part.position.y, z: part.position.z },
        startRot: { x: part.rotation.x, y: part.rotation.y, z: part.rotation.z },
        startSize: { x: part.size.x, y: part.size.y, z: part.size.z },
        planeNormal: normal.clone(),
        planePoint: point.clone(),
        startPoint: point.clone()
      };
      return true;
    }

    _moveTransform(e) {
      var d = this._drag;
      if (!d) return;
      if (d.kind === 'move') {
        var ray = this._rayFromEvent(e);
        var normal = d.planeNormal;
        if (e.shiftKey) {
          normal = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        }
        var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, d.planePoint);
        var point = new THREE.Vector3();
        if (!ray.intersectPlane(plane, point)) return;
        var pos = {
          x: d.startPos.x + point.x - d.startPoint.x,
          y: d.startPos.y + point.y - d.startPoint.y,
          z: d.startPos.z + point.z - d.startPoint.z
        };
        if (typeof this.onTransform === 'function') this.onTransform(d.partId, { position: pos });
        return;
      }
      var dx = e.clientX - d.startX;
      var dy = e.clientY - d.startY;
      if (d.kind === 'rotate') {
        if (typeof this.onTransform === 'function') {
          this.onTransform(d.partId, {
            rotation: {
              x: d.startRot.x + dy * 0.6,
              y: d.startRot.y + dx * 0.6,
              z: d.startRot.z
            }
          });
        }
      } else if (d.kind === 'scale') {
        var factor = clamp(1 + (dx - dy) * 0.012, 0.05, 20);
        if (typeof this.onTransform === 'function') {
          this.onTransform(d.partId, {
            size: {
              x: d.startSize.x * factor,
              y: d.startSize.y * factor,
              z: d.startSize.z * factor
            }
          });
        }
      }
    }

    _bindPointer() {
      var self = this;
      var canvas = this.renderer.domElement;
      var painting = false;

      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

      canvas.addEventListener('pointerdown', function (e) {
        if (e.button === 2) {
          try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
          self._drag = {
            kind: 'orbit',
            startX: e.clientX,
            startY: e.clientY,
            theta: self.spherical.theta,
            phi: self.spherical.phi
          };
          e.preventDefault();
          return;
        }
        if (e.button === 1) {
          try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
          self._drag = {
            kind: 'pan',
            startX: e.clientX,
            startY: e.clientY,
            target: self.target.clone()
          };
          e.preventDefault();
          return;
        }
        if (e.button !== 0) return;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}

        if (self.mode === 'paint') {
          painting = true;
          if (typeof self.onPaintStart === 'function') self.onPaintStart(self.pickCell(e));
          return;
        }

        var found = self._hit(e);
        if (!found || !found.partId) {
          self.select(null);
          self._drag = {
            kind: 'orbit',
            startX: e.clientX,
            startY: e.clientY,
            theta: self.spherical.theta,
            phi: self.spherical.phi
          };
          return;
        }

        if (self.selectedPart === found.partId && self.tool !== 'select') {
          self.select(found.partId);
          if (self._beginTransform(self.tool, found.partId, e)) return;
        }
        self.select(found.partId);
      });

      canvas.addEventListener('pointermove', function (e) {
        if (painting) {
          if (typeof self.onPaintMove === 'function') self.onPaintMove(self.pickCell(e));
          return;
        }
        var d = self._drag;
        if (!d) return;
        if (d.kind === 'orbit') {
          self.spherical.theta = d.theta - (e.clientX - d.startX) * 0.008;
          self.spherical.phi = clamp(d.phi - (e.clientY - d.startY) * 0.008, 0.08, Math.PI - 0.08);
          self._applyCamera();
          return;
        }
        if (d.kind === 'pan') {
          var scale = self.spherical.radius * 0.0018;
          var right = new THREE.Vector3().setFromMatrixColumn(self.camera.matrixWorld, 0);
          var up = new THREE.Vector3().setFromMatrixColumn(self.camera.matrixWorld, 1);
          self.target.copy(d.target);
          self.target.addScaledVector(right, -(e.clientX - d.startX) * scale);
          self.target.addScaledVector(up, (e.clientY - d.startY) * scale);
          self._applyCamera();
          return;
        }
        self._moveTransform(e);
      });

      function end(e) {
        if (painting) {
          painting = false;
          if (typeof self.onPaintEnd === 'function') self.onPaintEnd();
        }
        self._drag = null;
      }

      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);

      canvas.addEventListener('wheel', function (e) {
        e.preventDefault();
        self.spherical.radius = clamp(
          self.spherical.radius * Math.exp(e.deltaY * 0.001),
          0.6,
          40
        );
        self._applyCamera();
      }, { passive: false });
    }

    frameAll() {
      if (!this.rig) return;
      var box = new THREE.Box3().setFromObject(this.rig.root);
      if (box.isEmpty()) return;
      var center = new THREE.Vector3();
      var size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      this.target.copy(center);
      this.spherical.radius = Math.max(1, size.length() * 1.55);
      this._applyCamera();
    }

    focusSelected() {
      if (!this.rig || !this.selectedPart) {
        this.frameAll();
        return;
      }
      var group = this.rig.groups[this.selectedPart];
      if (!group) return;
      var box = new THREE.Box3().setFromObject(group.children[0] || group);
      var center = new THREE.Vector3();
      var size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      this.target.copy(center);
      this.spherical.radius = Math.max(0.8, size.length() * 2.2);
      this._applyCamera();
    }

    _loop() {
      var self = this;
      requestAnimationFrame(function () { self._loop(); });
      if (this.rig) {
        if (this.preview) {
          this._previewTime = (performance.now() - this._previewStart) / 1000;
          this.rig.update(this._previewTime);
        } else {
          this.rig.reset();
        }
      }
      if (this._selectionHelper && this._selectionHelper.visible) this._selectionHelper.update();
      this.renderer.render(this.scene, this.camera);
    }
  }

  AllDogs.MeshViewport = MeshViewport;
  window.MeshViewport = MeshViewport;
})();
