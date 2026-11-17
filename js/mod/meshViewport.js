(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  var AXES = {
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, 1, 0),
    z: new THREE.Vector3(0, 0, 1)
  };

  var AXIS_COLORS = {
    x: 0xff5555,
    y: 0x5fe06a,
    z: 0x5599ff
  };

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function tidy(v) {
    return Math.round((Number(v) || 0) * 1e9) / 1e9;
  }

  function snapTo(value, step) {
    var n = Number(value) || 0;
    var s = Number(step) || 0;
    if (!isFinite(n) || !isFinite(s) || s <= 0) return n;
    return tidy(Math.round(n / s) * s);
  }

  function partQuaternion(rotation) {
    var r = rotation || {};
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (Number(r.x) || 0) * Math.PI / 180,
      (Number(r.y) || 0) * Math.PI / 180,
      (Number(r.z) || 0) * Math.PI / 180,
      'YXZ'
    ));
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
      this._jointHelperGroup = null;
      this._jointHelpers = [];
      this._gizmo = null;
      this._gizmoHandles = {};
      this._gizmoLines = {};
      this._gizmoLength = 0.6;
      this._gizmoActiveAxis = null;
      this._rotateGizmo = null;
      this._rotateRings = {};
      this._rotatePickRings = {};
      this._rotateLength = 0.6;
      this._rotateActiveAxis = null;
      this.transformSpace = 'local';
      this.snapEnabled = true;
      this.snapTranslate = 0.1;
      this.snapRotate = 10;
      this.showJoints = true;
      this._drag = null;
      this._pointer = { ndc: new THREE.Vector2() };
      this._raycaster = new THREE.Raycaster();
      this._previewStart = 0;
      this._previewTime = 0;

      this._buildGizmo();
      this._buildRotateGizmo();

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

    _buildGizmo() {
      var self = this;
      var group = new THREE.Group();
      group.name = 'mesh-transform-gizmo';
      group.renderOrder = 1000;

      ['x', 'y', 'z'].forEach(function (axis) {
        var dir = AXES[axis];
        var color = AXIS_COLORS[axis];

        var lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          dir.clone()
        ]);
        var lineMat = new THREE.LineBasicMaterial({
          color: color,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          depthWrite: false
        });
        var line = new THREE.Line(lineGeo, lineMat);
        line.userData.gizmoAxis = axis;
        line.renderOrder = 1001;
        group.add(line);
        self._gizmoLines[axis] = line;

        var handle = new THREE.Mesh(
          new THREE.PlaneGeometry(0.2, 0.2),
          new THREE.MeshBasicMaterial({
            color: color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.95,
            depthTest: false,
            depthWrite: false
          })
        );
        handle.position.copy(dir);
        handle.userData.gizmoAxis = axis;
        handle.renderOrder = 1002;
        group.add(handle);
        self._gizmoHandles[axis] = handle;
      });

      group.visible = false;
      this.scene.add(group);
      this._gizmo = group;
    }

    _buildRotateGizmo() {
      var self = this;
      var group = new THREE.Group();
      group.name = 'mesh-rotate-gizmo';

      ['x', 'y', 'z'].forEach(function (axis) {
        var color = AXIS_COLORS[axis];
        var visual = new THREE.Mesh(
          new THREE.TorusGeometry(1, 0.035, 8, 64),
          new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
            depthWrite: false
          })
        );
        var pick = new THREE.Mesh(
          new THREE.TorusGeometry(1, 0.11, 8, 48),
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false
          })
        );

        [visual, pick].forEach(function (ring) {
          if (axis === 'x') ring.rotation.y = Math.PI / 2;
          else if (axis === 'y') ring.rotation.x = Math.PI / 2;
          ring.userData.rotateAxis = axis;
          ring.renderOrder = 1003;
          group.add(ring);
        });

        self._rotateRings[axis] = visual;
        self._rotatePickRings[axis] = pick;
      });

      group.visible = false;
      this.scene.add(group);
      this._rotateGizmo = group;
    }

    _updateGizmo() {
      if (!this._gizmo || !this._rotateGizmo) return;
      var part = this.selectedPart ? this.model.getPart(this.selectedPart) : null;
      var modelMode = this.mode === 'model' && !!part && !!this.rig;
      var moveActive = modelMode && (this.tool === 'move' || this.tool === 'scale');
      var rotateActive = modelMode && this.tool === 'rotate';

      this._gizmo.visible = moveActive;
      this._rotateGizmo.visible = rotateActive;

      var group = modelMode ? this.rig.groups[part.id] : null;
      if ((moveActive || rotateActive) && !group) {
        this._gizmo.visible = false;
        this._rotateGizmo.visible = false;
        return;
      }

      var center = new THREE.Vector3();
      if (group) group.getWorldPosition(center);

      var self = this;
      if (moveActive) {
        this._gizmo.position.copy(center);
        var length = clamp(this.spherical.radius * 0.16, 0.22, 1.6);
        this._gizmoLength = length;
        this._gizmo.scale.setScalar(length);
        if (this.transformSpace === 'world') {
          this._gizmo.quaternion.identity();
        } else {
          this._gizmo.quaternion.copy(partQuaternion(part.rotation));
        }

        var hideZ = this.tool === 'scale' && part.type === 'plane';
        this._gizmoLines.z.visible = !hideZ;
        this._gizmoHandles.z.visible = !hideZ;

        var parentQuat = this._gizmo.quaternion;
        ['x', 'y', 'z'].forEach(function (axis) {
          var handle = self._gizmoHandles[axis];
          if (!handle) return;
          handle.quaternion.copy(parentQuat).invert().multiply(self.camera.quaternion);
          var s = self._gizmoActiveAxis === axis ? 1.35 : 1;
          handle.scale.setScalar(s);
        });
      }

      if (rotateActive) {
        this._rotateGizmo.position.copy(center);
        var rotateLength = clamp(this.spherical.radius * 0.2, 0.3, 2.0);
        this._rotateLength = rotateLength;
        this._rotateGizmo.scale.setScalar(rotateLength);
        if (this.transformSpace === 'world') {
          this._rotateGizmo.quaternion.identity();
        } else {
          this._rotateGizmo.quaternion.copy(partQuaternion(part.rotation));
        }

        ['x', 'y', 'z'].forEach(function (axis) {
          var ring = self._rotateRings[axis];
          if (!ring) return;
          ring.scale.setScalar(self._rotateActiveAxis === axis ? 1.06 : 1);
        });
      }
    }

    _pickGizmoAxis(e) {
      if (!this._gizmo || !this._gizmo.visible) return null;
      var targets = [];
      for (var axis in this._gizmoHandles) {
        var handle = this._gizmoHandles[axis];
        if (handle.visible) targets.push(handle);
        var line = this._gizmoLines[axis];
        if (line && line.visible) targets.push(line);
      }
      if (!targets.length) return null;

      this._gizmo.updateMatrixWorld(true);
      this._rayFromEvent(e);
      this._raycaster.params.Line.threshold = this._gizmoLength * 0.1;
      var hits = this._raycaster.intersectObjects(targets, false);
      if (!hits.length) return null;
      var center = this._gizmo.position;
      for (var i = 0; i < hits.length; i++) {
        var point = hits[i].point;
        if (point && point.distanceTo(center) < this._gizmoLength * 0.35) continue;
        return hits[i].object.userData.gizmoAxis || null;
      }
      return null;
    }

    _pickRotateAxis(e) {
      if (!this._rotateGizmo || !this._rotateGizmo.visible) return null;
      var targets = [];
      for (var axis in this._rotatePickRings) {
        var ring = this._rotatePickRings[axis];
        if (ring && ring.visible) targets.push(ring);
      }
      if (!targets.length) return null;

      this._rotateGizmo.updateMatrixWorld(true);
      this._rayFromEvent(e);
      var hits = this._raycaster.intersectObjects(targets, false);
      if (!hits.length) return null;
      return hits[0].object.userData.rotateAxis || null;
    }

    setTransformSpace(space) {
      this.transformSpace = space === 'world' ? 'world' : 'local';
      this._updateGizmo();
    }

    setRotateSpace(space) {
      this.setTransformSpace(space);
    }

    get rotateSpace() {
      return this.transformSpace;
    }

    set rotateSpace(space) {
      this.transformSpace = space === 'world' ? 'world' : 'local';
    }

    setSnapping(on) {
      this.snapEnabled = !!on;
    }

    setSnapStep(step) {
      var n = Number(step);
      if (isFinite(n) && n > 0) this.snapTranslate = n;
    }

    setSnapAngle(degrees) {
      var n = Number(degrees);
      if (isFinite(n) && n > 0) this.snapRotate = n;
    }

    setShowJoints(on) {
      this.showJoints = !!on;
      this._updateHelperVisibility();
    }

    _updateHelperVisibility() {
      var modelMode = this.mode === 'model';
      if (this._hitboxHelper) this._hitboxHelper.visible = modelMode;
      if (this._selectionHelper) this._selectionHelper.visible = modelMode;
      if (this._jointHelperGroup) this._jointHelperGroup.visible = modelMode && this.showJoints;
      this._updateGizmo();
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
      this._updateGizmo();
      if (typeof this.onSelect === 'function') this.onSelect(this.selectedPart);
    }

    setTool(tool) {
      this.tool = tool || 'select';
      this.renderer.domElement.style.cursor = this.mode === 'paint' ? 'crosshair' : 'default';
      this._gizmoActiveAxis = null;
      this._rotateActiveAxis = null;
      this._updateGizmo();
    }

    setMode(mode) {
      this.mode = mode === 'paint' ? 'paint' : 'model';
      this.setTool(this.tool);
      this._updateHelperVisibility();
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
      this._buildJointHelpers();
      this._updateGizmo();
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

    _buildJointHelpers() {
      if (this._jointHelperGroup) {
        this.scene.remove(this._jointHelperGroup);
        disposeObject(this._jointHelperGroup);
        this._jointHelperGroup = null;
      }
      this._jointHelpers = [];
      if (!this.rig || !this.model.joints.length) return;

      var group = new THREE.Group();
      group.name = 'mesh-joint-helpers';
      var animators = {};
      for (var a = 0; a < this.rig.animators.length; a++) {
        var animator = this.rig.animators[a];
        if (animator.joint && animator.joint.id) animators[animator.joint.id] = animator;
      }

      for (var i = 0; i < this.model.joints.length; i++) {
        var joint = this.model.joints[i];
        var anim = animators[joint.id] || null;
        var parentGroup = joint.parent ? this.rig.groups[joint.parent] : null;
        var childGroup = this.rig.groups[joint.child] || null;

        var line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(),
            new THREE.Vector3()
          ]),
          new THREE.LineBasicMaterial({
            color: 0xffd23f,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
            depthWrite: false
          })
        );
        line.renderOrder = 997;

        var sphere = new THREE.Mesh(
          new THREE.SphereGeometry(1, 12, 8),
          new THREE.MeshBasicMaterial({
            color: 0xffd23f,
            transparent: true,
            opacity: 0.98,
            depthTest: false,
            depthWrite: false
          })
        );
        sphere.renderOrder = 998;

        group.add(line);
        group.add(sphere);
        this._jointHelpers.push({
          joint: joint,
          animator: anim,
          parentGroup: parentGroup,
          childGroup: childGroup,
          line: line,
          sphere: sphere
        });
      }

      group.visible = this.mode === 'model' && this.showJoints;
      this._jointHelperGroup = group;
      this.scene.add(group);
      this._updateJointHelperPositions();
    }

    _updateJointHelperPositions() {
      if (!this._jointHelperGroup || !this._jointHelperGroup.visible) return;
      var radius = clamp(this.spherical.radius * 0.022, 0.025, 0.12);
      var pivot = new THREE.Vector3();
      var parent = new THREE.Vector3();
      var child = new THREE.Vector3();

      for (var i = 0; i < this._jointHelpers.length; i++) {
        var item = this._jointHelpers[i];
        var anim = item.animator;
        if (anim && anim.pivotGroup) {
          anim.pivotGroup.getWorldPosition(pivot);
        } else {
          pivot.set(item.joint.pivot.x, item.joint.pivot.y, item.joint.pivot.z);
        }

        if (item.childGroup) item.childGroup.getWorldPosition(child);
        else child.copy(pivot);

        var points = [];
        if (item.parentGroup) {
          item.parentGroup.getWorldPosition(parent);
          points.push(parent.clone());
        }
        points.push(pivot.clone());
        points.push(child.clone());
        item.line.geometry.setFromPoints(points);

        item.sphere.position.copy(pivot);
        item.sphere.scale.setScalar(radius);
      }
    }

    _beginAxisTransform(kind, partId, axis, e) {
      var part = this.model.getPart(partId);
      if (!part || !AXES[axis]) return false;
      var dir = AXES[axis].clone();
      if (this.transformSpace === 'local') {
        dir.applyQuaternion(partQuaternion(part.rotation));
      }
      dir.normalize();

      var center = new THREE.Vector3(part.position.x, part.position.y, part.position.z);
      var point = this._axisPoint(center, dir, e);
      if (!point) return false;

      this._drag = {
        kind: kind === 'scale' ? 'axis-scale' : 'axis-move',
        axis: axis,
        axisDir: dir.clone(),
        space: this.transformSpace,
        partId: partId,
        startPos: { x: part.position.x, y: part.position.y, z: part.position.z },
        startSize: { x: part.size.x, y: part.size.y, z: part.size.z },
        planePoint: center.clone(),
        startPoint: point.clone(),
        gizmoLength: Math.max(0.01, this._gizmoLength)
      };
      this._gizmoActiveAxis = axis;
      this._updateGizmo();
      return true;
    }

    _beginRotateTransform(partId, axis, e) {
      var part = this.model.getPart(partId);
      var dir = AXES[axis];
      if (!part || !dir) return false;

      var startQuat = partQuaternion(part.rotation);
      var worldAxis = this.transformSpace === 'world'
        ? dir.clone()
        : dir.clone().applyQuaternion(startQuat);
      worldAxis.normalize();
      var center = new THREE.Vector3(part.position.x, part.position.y, part.position.z);
      var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(worldAxis, center);
      var point = new THREE.Vector3();
      if (!this._rayFromEvent(e).intersectPlane(plane, point)) return false;

      var startVec = point.clone().sub(center);
      if (startVec.lengthSq() < 1e-8) return false;
      startVec.normalize();

      this._drag = {
        kind: 'rotate-ring',
        partId: partId,
        axis: axis,
        worldAxis: worldAxis,
        center: center,
        lastVec: startVec,
        totalAngle: 0,
        startQuat: startQuat
      };
      this._rotateActiveAxis = axis;
      this._updateGizmo();
      return true;
    }

    _beginTransform(kind, partId, e, found) {
      var part = this.model.getPart(partId);
      if (!part) return false;
      if (kind === 'rotate') return false;

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
        startSize: { x: part.size.x, y: part.size.y, z: part.size.z },
        planeNormal: normal.clone(),
        planePoint: point.clone(),
        startPoint: point.clone()
      };
      return true;
    }

    _axisPoint(center, axisDir, e) {
      // Closest point on the infinite axis line to the pointer ray. This stays
      // stable even when the camera lies in the plane spanned by the axis and
      // the view direction (where a ray-plane hit would be degenerate).
      var ray = this._rayFromEvent(e);
      var w = ray.origin.clone().sub(center);
      var b = ray.direction.dot(axisDir);
      var denom = 1 - b * b;
      if (denom < 1e-6) return null;
      var t = (axisDir.dot(w) - ray.direction.dot(w) * b) / denom;
      return center.clone().addScaledVector(axisDir, t);
    }

    _axisDragPoint(d, e) {
      return this._axisPoint(d.planePoint, d.axisDir, e);
    }

    _moveTransform(e) {
      var d = this._drag;
      if (!d) return;
      var onTransform = typeof this.onTransform === 'function';

      if (d.kind === 'rotate-ring') {
        var rotatePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(d.worldAxis, d.center);
        var rotatePoint = new THREE.Vector3();
        if (!this._rayFromEvent(e).intersectPlane(rotatePlane, rotatePoint)) return;
        var vec = rotatePoint.clone().sub(d.center);
        if (vec.lengthSq() < 1e-8) return;
        vec.normalize();
        var cross = new THREE.Vector3().crossVectors(d.lastVec, vec);
        var step = Math.atan2(cross.dot(d.worldAxis), clamp(d.lastVec.dot(vec), -1, 1));
        d.totalAngle += step;
        d.lastVec.copy(vec);

        var angle = d.totalAngle;
        if (this.snapEnabled && this.snapRotate > 0) {
          angle = snapTo(angle * 180 / Math.PI, this.snapRotate) * Math.PI / 180;
        }
        d.appliedAngle = angle;

        var quat = new THREE.Quaternion()
          .setFromAxisAngle(d.worldAxis, angle)
          .multiply(d.startQuat);
        var euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
        if (onTransform) {
          this.onTransform(d.partId, {
            rotation: {
              x: tidy(euler.x * 180 / Math.PI),
              y: tidy(euler.y * 180 / Math.PI),
              z: tidy(euler.z * 180 / Math.PI)
            }
          });
        }
        return;
      }

      if (d.kind === 'axis-move' || d.kind === 'axis-scale') {
        var axisPoint = this._axisDragPoint(d, e);
        if (!axisPoint) return;
        var amount = axisPoint.clone().sub(d.startPoint).dot(d.axisDir);

        if (d.kind === 'axis-move') {
          if (this.snapEnabled) amount = snapTo(amount, this.snapTranslate);
          if (onTransform) {
            this.onTransform(d.partId, {
              position: {
                x: tidy(d.startPos.x + d.axisDir.x * amount),
                y: tidy(d.startPos.y + d.axisDir.y * amount),
                z: tidy(d.startPos.z + d.axisDir.z * amount)
              }
            });
          }
          return;
        }

        var factor = clamp(1 + amount / (d.gizmoLength * 2), 0.05, 20);
        var size = { x: d.startSize.x, y: d.startSize.y, z: d.startSize.z };
        if (e.shiftKey) {
          size.x *= factor;
          size.y *= factor;
          size.z *= factor;
        } else {
          size[d.axis] = d.startSize[d.axis] * factor;
        }
        if (onTransform) this.onTransform(d.partId, { size: size });
        return;
      }

      if (d.kind === 'move') {
        var ray = this._rayFromEvent(e);
        var normal = d.planeNormal;
        if (e.shiftKey) {
          normal = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        }
        var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, d.planePoint);
        var point = new THREE.Vector3();
        if (!ray.intersectPlane(plane, point)) return;
        var dx = point.x - d.startPoint.x;
        var dy = point.y - d.startPoint.y;
        var dz = point.z - d.startPoint.z;
        if (this.snapEnabled) {
          dx = snapTo(dx, this.snapTranslate);
          dy = snapTo(dy, this.snapTranslate);
          dz = snapTo(dz, this.snapTranslate);
        }
        var pos = {
          x: tidy(d.startPos.x + dx),
          y: tidy(d.startPos.y + dy),
          z: tidy(d.startPos.z + dz)
        };
        if (onTransform) this.onTransform(d.partId, { position: pos });
        return;
      }

      var dx = e.clientX - d.startX;
      var dy = e.clientY - d.startY;
      if (d.kind === 'scale') {
        var factor = clamp(1 + (dx - dy) * 0.012, 0.05, 20);
        if (onTransform) {
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

        var rotateAxis = self.tool === 'rotate' ? self._pickRotateAxis(e) : null;
        if (rotateAxis && self.selectedPart &&
            self._beginRotateTransform(self.selectedPart, rotateAxis, e)) {
          return;
        }

        var gizmoAxis = self._pickGizmoAxis(e);
        if (gizmoAxis && self.selectedPart &&
            (self.tool === 'move' || self.tool === 'scale') &&
            self._beginAxisTransform(self.tool, self.selectedPart, gizmoAxis, e)) {
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
        if (self._gizmoActiveAxis) {
          self._gizmoActiveAxis = null;
          self._updateGizmo();
        }
        if (self._rotateActiveAxis) {
          self._rotateActiveAxis = null;
          self._updateGizmo();
        }
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
      this._updateGizmo();
      this._updateJointHelperPositions();
      this.renderer.render(this.scene, this.camera);
    }
  }

  AllDogs.MeshViewport = MeshViewport;
  window.MeshViewport = MeshViewport;
})();
