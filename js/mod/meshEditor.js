(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;
  var sanitizeName = window.MeshModel.sanitizeName;

  var COLORS = [
    '#6f9a57', '#8fb96d', '#456b3a', '#3d5c34', '#a98b62', '#7f6547', '#5c7fa3', '#8b6fa8'
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function round(v) {
    var n = Number(v) || 0;
    return Math.round(n * 1000) / 1000;
  }

  function readNum(el, fallback) {
    if (!el) return fallback;
    var raw = String(el.value == null ? '' : el.value).trim();
    if (!raw) return fallback;
    var n = Number(raw);
    return isFinite(n) ? n : fallback;
  }

  function setInput(el, value) {
    if (!el) return;
    if (document.activeElement === el) return;
    var text = String(round(value));
    if (el.value !== text) el.value = text;
  }

  function setSelect(el, value) {
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.value !== value) el.value = value;
  }

  function fillSelect(el, items, value) {
    if (!el) return;
    el.innerHTML = '';
    for (var i = 0; i < items.length; i++) {
      var opt = document.createElement('option');
      opt.value = items[i].value;
      opt.textContent = items[i].label;
      el.appendChild(opt);
    }
    if (value !== undefined && value !== null) el.value = String(value);
    if (!el.value && el.options.length) el.selectedIndex = 0;
  }

  class MeshEditor {
    constructor() {
      var self = this;
      this.mode = 'model';
      this.tool = 'select';
      this.paintTool = 'brush';
      this.selectedPart = null;
      this.selectedJoint = null;
      this._partOptionsSig = '';
      this._aiBuilt = false;
      this._pendingPaint = false;
      this._flashTimer = null;

      this.model = new window.MeshModel();
      this.atlas = new window.AtlasPainter({ size: 1024, tile: 32 });
      this.viewport = new window.MeshViewport($('mesh-stage'), this.model, this.atlas);

      this.viewport.onSelect = function (partId) {
        self.selectedPart = partId || null;
        if (partId) self.selectedJoint = null;
        self.refresh();
      };

      this.viewport.onTransform = function (partId, patch) {
        self.model.updatePart(partId, patch);
      };

      this.viewport.onPaintStart = function (cell) {
        if (cell) {
          self._pendingPaint = false;
          self.atlas.beginStroke(cell);
        } else {
          self._pendingPaint = true;
        }
      };

      this.viewport.onPaintMove = function (cell) {
        if (self._pendingPaint) {
          if (!cell) return;
          self._pendingPaint = false;
          self.atlas.beginStroke(cell);
          return;
        }
        self.atlas.continueStroke(cell);
      };

      this.viewport.onPaintEnd = function () {
        self._pendingPaint = false;
        self.atlas.endStroke();
      };

      this.atlas.onChange = function () {
        self._drawFlat();
        self._updatePaintUI();
      };

      this.atlas.onPick = function (hex) {
        var color = $('mesh-color');
        if (color) color.value = hex;
      };

      this.atlas.onStroke = function () {
        self._updatePaintUI();
      };

      this._bindPaintAtlas();
      this._bindUI();

      this.model.onChange(function () { self.refresh(); });

      this._buildStarter();
      this.setMode('model');
      this.refresh();
    }

    _buildStarter() {
      var model = this.model;
      model.reset();
      model.hitbox = { width: 0.6, height: 1.8, depth: 0.6 };
      model.name = 'my_mesh';

      var body = model.addPart('box', {
        name: 'Body',
        size: { x: 0.5, y: 0.7, z: 0.28 },
        position: { x: 0, y: 1.1, z: 0 }
      });
      var head = model.addPart('box', {
        name: 'Head',
        size: { x: 0.42, y: 0.42, z: 0.42 },
        position: { x: 0, y: 1.66, z: 0 }
      });
      var left = model.addPart('box', {
        name: 'Left leg',
        size: { x: 0.18, y: 0.75, z: 0.2 },
        position: { x: -0.14, y: 0.375, z: 0 }
      });
      var right = model.addPart('box', {
        name: 'Right leg',
        size: { x: 0.18, y: 0.75, z: 0.2 },
        position: { x: 0.14, y: 0.375, z: 0 }
      });

      if (body) this._fillPart(body, COLORS[0]);
      if (head) this._fillPart(head, COLORS[1]);
      if (left) this._fillPart(left, COLORS[2]);
      if (right) this._fillPart(right, COLORS[3]);

      if (body && head) {
        model.addJoint({
          type: 'connecting', parent: body.id, child: head.id,
          axis: 'y', amplitude: 6, speed: 1.3
        });
      }
      if (body && left) {
        model.addJoint({
          type: 'connecting', parent: body.id, child: left.id,
          axis: 'x', amplitude: 16, speed: 2.2, phase: 0
        });
      }
      if (body && right) {
        model.addJoint({
          type: 'connecting', parent: body.id, child: right.id,
          axis: 'x', amplitude: 16, speed: 2.2, phase: 180
        });
      }

      if (body) this.viewport.select(body.id);
      else this.viewport.select(null);
      this.selectedPart = body ? body.id : null;
      this.selectedJoint = null;
    }

    _fillPart(part, hex) {
      if (!part || !part.slots) return;
      var rgba = this.atlas.hexToRgba(hex);
      for (var i = 0; i < part.slots.length; i++) {
        this.atlas.fillSlot(part.slots[i], rgba);
      }
    }

    _bindPaintAtlas() {
      var self = this;
      var flat = $('mesh-flat');
      if (!flat) return;
      flat.width = 512;
      flat.height = 512;
      var painting = false;

      function cellOf(e) {
        return self.atlas.cellFromFlatEvent(e, flat);
      }

      flat.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 && e.button !== 1) return;
        try { flat.setPointerCapture(e.pointerId); } catch (err) {}
        painting = true;
        self.atlas.beginStroke(cellOf(e));
        e.preventDefault();
      });

      flat.addEventListener('pointermove', function (e) {
        if (!painting) return;
        self.atlas.continueStroke(cellOf(e));
      });

      function end() {
        painting = false;
        self.atlas.endStroke();
      }

      flat.addEventListener('pointerup', end);
      flat.addEventListener('pointercancel', end);
    }

    _bindUI() {
      var self = this;

      var modeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-mesh-mode]'));
      modeButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.setMode(btn.getAttribute('data-mesh-mode'));
        });
      });

      $('mesh-add-box').addEventListener('click', function () { self.addPart('box'); });
      $('mesh-add-plane').addEventListener('click', function () { self.addPart('plane'); });

      var toolButtons = Array.prototype.slice.call(document.querySelectorAll('[data-mesh-tool]'));
      toolButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.tool = btn.getAttribute('data-mesh-tool');
          toolButtons.forEach(function (other) {
            other.classList.toggle('active', other === btn);
          });
          self.viewport.setTool(self.tool);
        });
      });

      $('mesh-duplicate').addEventListener('click', function () { self.duplicateSelected(); });
      $('mesh-delete-part').addEventListener('click', function () { self.deleteSelected(); });
      $('mesh-delete-part2').addEventListener('click', function () { self.deleteSelected(); });

      $('mesh-add-connecting').addEventListener('click', function () { self.addJoint('connecting'); });
      $('mesh-add-floating').addEventListener('click', function () { self.addJoint('floating'); });

      $('mesh-preview').addEventListener('change', function () {
        self.viewport.setPreview(this.checked);
      });

      $('mesh-show-joints').addEventListener('change', function () {
        self.viewport.setShowJoints(this.checked);
      });

      $('mesh-frame-all').addEventListener('click', function () { self.viewport.frameAll(); });
      $('mesh-reset-view').addEventListener('click', function () { self.resetView(); });
      $('mesh-new').addEventListener('click', function () { self.clearMesh(); });

      var hbFields = [
        ['mesh-hb-w', 'width'],
        ['mesh-hb-h', 'height'],
        ['mesh-hb-d', 'depth']
      ];
      hbFields.forEach(function (pair) {
        var el = $(pair[0]);
        el.addEventListener('input', function () {
          var patch = {};
          patch[pair[1]] = readNum(el, self.model.hitbox[pair[1]]);
          self.model.setHitbox(patch);
        });
      });

      $('mesh-parts-list').addEventListener('click', function (e) {
        var row = e.target.closest ? e.target.closest('[data-part-id]') : null;
        if (!row) return;
        self.viewport.select(row.getAttribute('data-part-id'));
      });

      $('mesh-joints-list').addEventListener('click', function (e) {
        var row = e.target.closest ? e.target.closest('[data-joint-id]') : null;
        if (!row) return;
        self.selectJoint(row.getAttribute('data-joint-id'));
      });

      $('mesh-part-fields').addEventListener('input', function (e) {
        self.applyPartInspector(e.target);
      });

      $('mesh-joint-fields').addEventListener('input', function (e) {
        self.applyJointInspector(e.target);
      });

      $('mesh-fit-hitbox').addEventListener('click', function () { self.fitHitbox(); });

      $('mesh-delete-joint').addEventListener('click', function () {
        if (!self.selectedJoint) return;
        var joint = self.model.removeJoint(self.selectedJoint);
        self.selectedJoint = null;
        if (joint) self.flash('Removed joint.');
      });

      $('mesh-name').addEventListener('input', function () {
        self.model.name = sanitizeName(this.value, 'mesh');
        self._syncExport();
      });
      $('mesh-name').addEventListener('blur', function () {
        this.value = sanitizeName(this.value, 'mesh');
        self.model.name = this.value;
        self._syncExport();
        self._updateHeader();
      });

      $('mesh-kind').addEventListener('change', function () {
        self.model.setKind(this.value);
      });

      $('mesh-ai').addEventListener('change', function () {
        self.model.setAI(this.value);
      });

      $('mesh-solid').addEventListener('change', function () {
        self.model.setSolid(this.checked);
      });

      $('mesh-export').addEventListener('click', function () { self.exportZip(); });

      this._bindPaintTools();

      document.addEventListener('keydown', function (e) {
        var tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        var mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (self.mode === 'paint') {
            if (e.shiftKey) self.atlas.redo();
            else self.atlas.undo();
          }
          return;
        }
        if (mod && e.key.toLowerCase() === 'y') {
          if (self.mode === 'paint') {
            e.preventDefault();
            self.atlas.redo();
          }
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (self.mode === 'model' && self.selectedPart) {
            e.preventDefault();
            self.deleteSelected();
          }
          return;
        }
        if (e.key === 'Escape') {
          self.selectedJoint = null;
          self.viewport.select(null);
          return;
        }
        if (e.key.toLowerCase() === 'f' && self.mode === 'model') {
          self.viewport.focusSelected();
        }
      });

      window.addEventListener('resize', function () { self._drawFlat(); });
      document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }

    _bindPaintTools() {
      var self = this;
      var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-paint-tool]'));
      buttons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.paintTool = btn.getAttribute('data-paint-tool');
          self.atlas.tool = self.paintTool;
          buttons.forEach(function (other) {
            other.classList.toggle('active', other === btn);
          });
        });
      });
      this.atlas.tool = this.paintTool;

      $('mesh-color').addEventListener('input', function () {
        self.atlas.brushRgba = self.atlas.hexToRgba(this.value);
      });

      var size = $('mesh-size');
      var sizeLabel = $('mesh-size-label');
      size.addEventListener('input', function () {
        self.atlas.brushSize = parseInt(size.value, 10);
        sizeLabel.textContent = size.value;
      });

      var grain = $('mesh-grain');
      var grainLabel = $('mesh-grain-label');
      grain.addEventListener('input', function () {
        self.atlas.grain = parseInt(grain.value, 10) / 100;
        grainLabel.textContent = grain.value + '%';
      });

      $('mesh-blend').addEventListener('change', function () {
        self.atlas.blend = this.value;
      });

      $('mesh-shape-fill').addEventListener('click', function () {
        self.atlas.shapeFill = true;
        $('mesh-shape-fill').classList.add('active');
        $('mesh-shape-outline').classList.remove('active');
      });
      $('mesh-shape-outline').addEventListener('click', function () {
        self.atlas.shapeFill = false;
        $('mesh-shape-outline').classList.add('active');
        $('mesh-shape-fill').classList.remove('active');
      });

      $('mesh-paint-undo').addEventListener('click', function () { self.atlas.undo(); });
      $('mesh-paint-redo').addEventListener('click', function () { self.atlas.redo(); });
      $('mesh-paint-clear').addEventListener('click', function () {
        if (!window.confirm('Clear every face of the texture atlas?')) return;
        self.atlas.clearAll();
      });
    }

    setMode(mode) {
      this.mode = mode === 'paint' ? 'paint' : 'model';
      var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-mesh-mode]'));
      buttons.forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-mesh-mode') === mode);
      });
      $('mesh-model-tools').hidden = this.mode !== 'model';
      $('mesh-paint-tools').hidden = this.mode !== 'paint';
      $('mesh-model-panel').hidden = this.mode !== 'model';
      $('mesh-paint-panel').hidden = this.mode !== 'paint';
      this.viewport.setMode(this.mode);
      if (this.mode === 'paint') this._drawFlat();
    }

    addPart(type) {
      var part = this.model.addPart(type);
      if (!part) {
        this.flash(this.model.lastError || 'Could not add that part.', true);
        return;
      }
      this._fillPart(part, COLORS[(this.model.parts.length - 1) % COLORS.length]);
      this.viewport.select(part.id);
      this.setMode('model');
      this.flash('Added ' + part.name + '.');
    }

    duplicateSelected() {
      if (!this.selectedPart) {
        this.flash('Select a part to duplicate.', true);
        return;
      }
      var src = this.model.getPart(this.selectedPart);
      var copy = this.model.duplicatePart(this.selectedPart);
      if (!copy || !src) {
        this.flash(this.model.lastError || 'Could not duplicate part.', true);
        return;
      }
      for (var i = 0; i < src.slots.length && i < copy.slots.length; i++) {
        this.atlas.copySlot(src.slots[i], copy.slots[i]);
      }
      this.viewport.select(copy.id);
      this.flash('Duplicated part.');
    }

    deleteSelected() {
      if (!this.selectedPart) return;
      var part = this.model.removePart(this.selectedPart);
      if (!part) return;
      for (var i = 0; i < part.slots.length; i++) this.atlas.clearSlot(part.slots[i]);
      this.selectedPart = null;
      this.viewport.select(null);
      this.flash('Deleted ' + part.name + '.');
    }

    addJoint(type) {
      var parentId = $('mesh-joint-parent').value;
      var childId = $('mesh-joint-child').value;
      if (!childId) {
        this.flash('Add a child part first.', true);
        return;
      }
      var joint = this.model.addJoint({
        type: type,
        parent: type === 'connecting' ? parentId : null,
        child: childId,
        axis: $('mesh-joint-axis').value,
        amplitude: readNum($('mesh-joint-amplitude'), 15),
        speed: readNum($('mesh-joint-speed'), 1.2)
      });
      if (!joint) {
        this.flash(this.model.lastError || 'Could not add joint.', true);
        return;
      }
      this.selectJoint(joint.id);
      this.flash((type === 'connecting' ? 'Connected ' : 'Floating joint added for ') +
        (this.model.getPart(childId) ? this.model.getPart(childId).name : childId) + '.');
    }

    selectJoint(id) {
      this.viewport.select(null);
      this.selectedJoint = id || null;
      this.selectedPart = null;
      this.refresh();
    }

    fitHitbox() {
      if (!this.selectedPart) return;
      var part = this.model.getPart(this.selectedPart);
      if (!part) return;
      var hb = this.model.hitbox;
      this.model.updatePart(part.id, {
        anchored: true,
        size: { x: hb.width, y: hb.height, z: part.type === 'plane' ? 0 : hb.depth },
        position: { x: 0, y: hb.height / 2, z: 0 },
        rotation: { x: 0, y: 0, z: 0 }
      });
      this.flash('Fitted ' + part.name + ' to the hitbox.');
    }

    applyPartInspector(target) {
      if (!this.selectedPart) return;
      var part = this.model.getPart(this.selectedPart);
      if (!part) return;
      if (target && target.id === 'mesh-part-name') {
        this.model.updatePart(part.id, { name: target.value });
        return;
      }
      if (target && target.id === 'mesh-part-anchored') {
        this.model.updatePart(part.id, { anchored: target.checked });
        return;
      }
      var patch = {
        size: {
          x: readNum($('mesh-part-sx'), part.size.x),
          y: readNum($('mesh-part-sy'), part.size.y),
          z: part.type === 'plane' ? 0 : readNum($('mesh-part-sz'), part.size.z)
        },
        position: {
          x: readNum($('mesh-part-px'), part.position.x),
          y: readNum($('mesh-part-py'), part.position.y),
          z: readNum($('mesh-part-pz'), part.position.z)
        },
        rotation: {
          x: readNum($('mesh-part-rx'), part.rotation.x),
          y: readNum($('mesh-part-ry'), part.rotation.y),
          z: readNum($('mesh-part-rz'), part.rotation.z)
        }
      };
      this.model.updatePart(part.id, patch);
    }

    applyJointInspector(target) {
      if (!this.selectedJoint) return;
      var joint = this.model.getJoint(this.selectedJoint);
      if (!joint) return;
      this.model.updateJoint(joint.id, {
        pivot: {
          x: readNum($('mesh-joint-px'), joint.pivot.x),
          y: readNum($('mesh-joint-py'), joint.pivot.y),
          z: readNum($('mesh-joint-pz'), joint.pivot.z)
        },
        axis: $('mesh-joint-edit-axis').value,
        amplitude: readNum($('mesh-joint-edit-amplitude'), joint.amplitude),
        speed: readNum($('mesh-joint-edit-speed'), joint.speed)
      });
    }

    resetView() {
      this.viewport.target.set(0, this.model.hitbox.height / 2, 0);
      this.viewport.spherical.radius = 4.2;
      this.viewport.spherical.theta = 0.65;
      this.viewport.spherical.phi = 1.15;
      this.viewport._applyCamera();
    }

    clearMesh() {
      if (!window.confirm('Clear all parts, joints and painted textures?')) return;
      this.selectedPart = null;
      this.selectedJoint = null;
      this._partOptionsSig = '';
      this.viewport.selectedPart = null;
      this.model.reset();
      this.atlas.clearAll();
      this.atlas.undoStack.length = 0;
      this.atlas.redoStack.length = 0;
      this.refresh();
      this.flash('Mesh cleared.');
    }

    refresh() {
      this._syncPartOptions();
      this._renderParts();
      this._renderJoints();
      this._syncHitbox();
      this._syncPartInspector();
      this._syncJointInspector();
      this._syncExport();
      this._updateHeader();
      this._updatePaintUI();
      if (this.mode === 'paint') this._drawFlat();
    }

    _syncPartOptions() {
      var parent = $('mesh-joint-parent');
      var child = $('mesh-joint-child');
      var sig = this.model.parts.map(function (p) { return p.id + ':' + p.name; }).join('|');
      if (sig !== this._partOptionsSig) {
        this._partOptionsSig = sig;
        var items = this.model.parts.map(function (p) {
          return { value: p.id, label: p.name + (p.anchored ? ' (anchored)' : '') };
        });
        var oldParent = parent.value;
        var oldChild = child.value;
        fillSelect(parent, items, oldParent);
        fillSelect(child, items, oldChild);
      }

      if (this.selectedPart) {
        var incoming = this.model.jointForChild(this.selectedPart);
        if (incoming && incoming.parent) setSelect(parent, incoming.parent);
        setSelect(child, this.selectedPart);
      }
    }

    _renderParts() {
      var list = $('mesh-parts-list');
      list.innerHTML = '';
      if (!this.model.parts.length) {
        var empty = document.createElement('div');
        empty.className = 'mod-note';
        empty.textContent = 'No parts yet. Add a box or a plane.';
        list.appendChild(empty);
        return;
      }
      for (var i = 0; i < this.model.parts.length; i++) {
        var part = this.model.parts[i];
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'mesh-item' + (part.id === this.selectedPart ? ' active' : '');
        row.setAttribute('data-part-id', part.id);

        var name = document.createElement('span');
        name.className = 'mesh-item-name';
        name.textContent = part.name;
        row.appendChild(name);

        var meta = document.createElement('span');
        meta.className = 'mesh-item-meta';
        meta.textContent = part.type + (part.anchored ? ' · anchored' : '') +
          ' · ' + (part.slots ? part.slots.length : 0) + ' faces';
        row.appendChild(meta);

        list.appendChild(row);
      }
    }

    _renderJoints() {
      var list = $('mesh-joints-list');
      list.innerHTML = '';
      if (!this.model.joints.length) {
        var empty = document.createElement('div');
        empty.className = 'mod-note';
        empty.textContent = 'No joints yet. Connected parts animate around their pivot.';
        list.appendChild(empty);
        return;
      }
      for (var i = 0; i < this.model.joints.length; i++) {
        var joint = this.model.joints[i];
        var child = this.model.getPart(joint.child);
        var parent = joint.parent ? this.model.getPart(joint.parent) : null;
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'mesh-item' + (joint.id === this.selectedJoint ? ' active' : '');
        row.setAttribute('data-joint-id', joint.id);

        var name = document.createElement('span');
        name.className = 'mesh-item-name';
        name.textContent = (parent ? parent.name : 'World') + ' \u2192 ' + (child ? child.name : joint.child);
        row.appendChild(name);

        var meta = document.createElement('span');
        meta.className = 'mesh-item-meta';
        meta.textContent = joint.type + ' · ' + joint.axis + ' · ' +
          round(joint.amplitude) + '\u00b0 @ ' + round(joint.speed);
        row.appendChild(meta);

        list.appendChild(row);
      }
    }

    _syncHitbox() {
      setInput($('mesh-hb-w'), this.model.hitbox.width);
      setInput($('mesh-hb-h'), this.model.hitbox.height);
      setInput($('mesh-hb-d'), this.model.hitbox.depth);
    }

    _syncPartInspector() {
      var part = this.selectedPart ? this.model.getPart(this.selectedPart) : null;
      $('mesh-part-empty').hidden = !!part;
      $('mesh-part-fields').hidden = !part;
      if (!part) return;

      setInput($('mesh-part-sx'), part.size.x);
      setInput($('mesh-part-sy'), part.size.y);
      setInput($('mesh-part-sz'), part.size.z);
      setInput($('mesh-part-px'), part.position.x);
      setInput($('mesh-part-py'), part.position.y);
      setInput($('mesh-part-pz'), part.position.z);
      setInput($('mesh-part-rx'), part.rotation.x);
      setInput($('mesh-part-ry'), part.rotation.y);
      setInput($('mesh-part-rz'), part.rotation.z);
      if (document.activeElement !== $('mesh-part-name')) $('mesh-part-name').value = part.name;
      $('mesh-part-anchored').checked = !!part.anchored;
      $('mesh-part-sz').disabled = part.type === 'plane';
    }

    _syncJointInspector() {
      var joint = this.selectedJoint ? this.model.getJoint(this.selectedJoint) : null;
      $('mesh-joint-empty').hidden = !!joint;
      $('mesh-joint-fields').hidden = !joint;
      if (!joint) return;

      var child = this.model.getPart(joint.child);
      var parent = joint.parent ? this.model.getPart(joint.parent) : null;
      var summary = (parent ? parent.name : 'World') + ' \u2192 ' + (child ? child.name : joint.child) +
        ' (' + joint.type + ')';
      $('mesh-joint-summary').textContent = summary;

      setInput($('mesh-joint-px'), joint.pivot.x);
      setInput($('mesh-joint-py'), joint.pivot.y);
      setInput($('mesh-joint-pz'), joint.pivot.z);
      setSelect($('mesh-joint-edit-axis'), joint.axis);
      setInput($('mesh-joint-edit-amplitude'), joint.amplitude);
      setInput($('mesh-joint-edit-speed'), joint.speed);
    }

    _syncExport() {
      var name = sanitizeName(this.model.name, 'mesh');
      setInput($('mesh-name'), name);
      setSelect($('mesh-kind'), this.model.kind);
      $('mesh-ai-row').hidden = this.model.kind !== 'mob';
      $('mesh-solid-row').hidden = this.model.kind !== 'static';

      if (!this._aiBuilt) {
        var ais = AllDogs.meshAI ? AllDogs.meshAI.list() : [];
        if (!ais.length) ais = [{ id: 'zombie', name: 'Zombie' }];
        var items = ais.map(function (ai) {
          return { value: ai.id, label: ai.name };
        });
        if (this.model.kind === 'mob') items.push({ value: '', label: 'No AI (stands still)' });
        fillSelect($('mesh-ai'), items, this.model.ai || 'zombie');
        this._aiBuilt = true;
      }
      if (this.model.kind === 'mob') {
        setSelect($('mesh-ai'), this.model.ai || 'zombie');
      }
      $('mesh-ai').disabled = this.model.kind !== 'mob';
      $('mesh-solid').checked = !!this.model.solid;
      $('mesh-export-name').textContent = name + '.zip';
    }

    _updateHeader() {
      if (this._flashTimer) return;
      var el = $('mesh-header-status');
      if (!el) return;
      el.classList.remove('mesh-status-error');
      el.textContent =
        this.model.parts.length + ' part' + (this.model.parts.length === 1 ? '' : 's') +
        ' \u00b7 ' + this.model.joints.length + ' joint' + (this.model.joints.length === 1 ? '' : 's') +
        ' \u00b7 ' + this.model.slotCountUsed() + ' face tiles \u00b7 ' +
        (this.model.kind === 'mob' ? 'mob' : 'static');
    }

    _updatePaintUI() {
      var used = this.model.slotCountUsed();
      var status = $('mesh-paint-status');
      if (status) {
        status.textContent = used + ' face tile' + (used === 1 ? '' : 's') +
          ' used \u00b7 ' + this.model.parts.length + ' part' +
          (this.model.parts.length === 1 ? '' : 's');
      }
      var undo = $('mesh-paint-undo');
      var redo = $('mesh-paint-redo');
      if (undo) undo.disabled = !this.atlas.canUndo();
      if (redo) redo.disabled = !this.atlas.canRedo();
    }

    _drawFlat() {
      var flat = $('mesh-flat');
      if (!flat || this.mode !== 'paint') return;
      var g = flat.getContext('2d');
      var size = flat.width;
      var source = this.atlas.snapshotCanvas();
      g.clearRect(0, 0, size, size);
      g.imageSmoothingEnabled = false;
      g.drawImage(source, 0, 0, size, size);

      var step = size / this.atlas.cols;
      g.strokeStyle = 'rgba(255,255,255,0.16)';
      g.lineWidth = 1;
      g.beginPath();
      for (var col = 1; col < this.atlas.cols; col++) {
        g.moveTo(Math.round(col * step) + 0.5, 0);
        g.lineTo(Math.round(col * step) + 0.5, size);
      }
      for (var row = 1; row < this.atlas.rows; row++) {
        g.moveTo(0, Math.round(row * step) + 0.5);
        g.lineTo(size, Math.round(row * step) + 0.5);
      }
      g.stroke();

      if (this.selectedPart) {
        var part = this.model.getPart(this.selectedPart);
        if (part && part.slots) {
          g.strokeStyle = '#9dff6a';
          g.lineWidth = 2;
          for (var i = 0; i < part.slots.length; i++) {
            var slot = part.slots[i];
            var x = (slot % this.atlas.cols) * step;
            var y = Math.floor(slot / this.atlas.cols) * step;
            g.strokeRect(Math.round(x) + 1, Math.round(y) + 1, Math.round(step) - 2, Math.round(step) - 2);
          }
        }
      }
    }

    flash(message, isError) {
      var el = $('mesh-header-status');
      if (!el) return;
      if (this._flashTimer) clearTimeout(this._flashTimer);
      el.textContent = message;
      el.classList.toggle('mesh-status-error', !!isError);
      var self = this;
      this._flashTimer = setTimeout(function () {
        self._flashTimer = null;
        self._updateHeader();
      }, 3500);
    }

    exportZip() {
      var self = this;
      var model = this.model.toJSON();
      if (!model.parts.length) {
        this.flash('Add at least one part before exporting.', true);
        return;
      }
      if (model.kind === 'mob' && !model.ai) {
        this.flash('Choose an inherited AI for the mob.', true);
        return;
      }

      var folder = sanitizeName(this.model.name, 'mesh');
      model.name = folder;
      var readme = [
        'All Dogs Go To Minecraft mesh export',
        '',
        'Name: ' + folder,
        'Type: ' + model.kind + (model.kind === 'mob' ? ' (AI: ' + model.ai + ')' : ''),
        'Hitbox: ' + round(model.hitbox.width) + ' x ' + round(model.hitbox.height) + ' x ' + round(model.hitbox.depth),
        '',
        'To install:',
        '1. Unzip the "' + folder + '" folder into mods/mobs/.',
        '2. Run: node tools/scanmods.js',
        '3. Reload the game.',
        ''
      ].join('\n');

      var canvas = this.atlas.snapshotCanvas();
      canvas.toBlob(function (blob) {
        if (!blob) {
          self.flash('Could not encode the texture.', true);
          return;
        }
        blob.arrayBuffer().then(function (buffer) {
          var zip = new window.MeshZip.ZipWriter();
          zip.add(folder + '/model.json', JSON.stringify(model, null, 2));
          zip.add(folder + '/texture.png', new Uint8Array(buffer));
          zip.add(folder + '/README.txt', readme);

          var url = URL.createObjectURL(zip.blob());
          var a = document.createElement('a');
          a.href = url;
          a.download = folder + '.zip';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
          self.flash('Exported ' + folder + '.zip (' + model.parts.length + ' parts).');
        }).catch(function () {
          self.flash('Could not build the ZIP file.', true);
        });
      }, 'image/png');
    }
  }

  window.MeshEditor = MeshEditor;
  window.meshEditor = new MeshEditor();
})();
