(function () {
  'use strict';
  var THREE = window.THREE;

  var FORMAT = 'alldogs-mesh';
  var VERSION = 1;
  var ATLAS_SIZE = 1024;
  var ATLAS_TILE = 32;

  function vec(x, y, z) {
    return { x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0 };
  }

  function copyVec(v) {
    return vec(v && v.x, v && v.y, v && v.z);
  }

  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function eulerQuat(rotation) {
    var r = rotation || {};
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (Number(r.x) || 0) * Math.PI / 180,
      (Number(r.y) || 0) * Math.PI / 180,
      (Number(r.z) || 0) * Math.PI / 180,
      'YXZ'
    ));
  }

  function axisExtents(part) {
    var s = part.size || {};
    var hx = Math.abs(Number(s.x) || 0) / 2;
    var hy = Math.abs(Number(s.y) || 0) / 2;
    var hz = Math.abs(Number(s.z) || 0) / 2;
    if (part.type === 'plane') hz = 0.001;

    var q = eulerQuat(part.rotation);
    var m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    var e = m.elements;
    return {
      x: Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz,
      y: Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz,
      z: Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz
    };
  }

  function partAabb(part) {
    var p = part.position || {};
    var e = axisExtents(part);
    return {
      min: { x: p.x - e.x, y: p.y - e.y, z: p.z - e.z },
      max: { x: p.x + e.x, y: p.y + e.y, z: p.z + e.z }
    };
  }

  function closestOnAabb(point, box) {
    return {
      x: clamp(point.x, box.min.x, box.max.x),
      y: clamp(point.y, box.min.y, box.max.y),
      z: clamp(point.z, box.min.z, box.max.z)
    };
  }

  function centerOf(box) {
    return {
      x: (box.min.x + box.max.x) / 2,
      y: (box.min.y + box.max.y) / 2,
      z: (box.min.z + box.max.z) / 2
    };
  }

  function midpoint(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      z: (a.z + b.z) / 2
    };
  }

  function sanitizeName(raw, fallback) {
    var n = String(raw == null ? '' : raw)
      .replace(/[\\/:*?"<>|.]+/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[-\s]+|[-.\s]+$/g, '');
    return n || fallback || 'mesh';
  }

  class MeshModel {
    constructor(opts) {
      opts = opts || {};
      this.listeners = [];
      this.hitbox = { width: 0.6, height: 1.8, depth: 0.6 };
      this.name = 'my_mesh';
      this.kind = 'mob';
      this.ai = 'zombie';
      this.solid = false;
      this.atlas = { size: ATLAS_SIZE, tile: ATLAS_TILE };
      this.parts = [];
      this.joints = [];
      this._nextPart = 1;
      this._nextJoint = 1;
      this._slotCount = 0;
      this._freeSlots = [];
      this.lastError = '';

      if (opts.hitbox) this.setHitbox(opts.hitbox, false);
    }

    onChange(fn) {
      if (typeof fn === 'function') this.listeners.push(fn);
      return this;
    }

    emit(reason) {
      for (var i = 0; i < this.listeners.length; i++) {
        try { this.listeners[i](reason || null, this); } catch (err) {}
      }
    }

    setHitbox(patch, emit) {
      patch = patch || {};
      this.hitbox.width = Math.max(0.05, num(patch.width, this.hitbox.width));
      this.hitbox.height = Math.max(0.05, num(patch.height, this.hitbox.height));
      this.hitbox.depth = Math.max(0.05, num(patch.depth, this.hitbox.depth));
      if (emit !== false) this.emit('hitbox');
      return this;
    }

    setName(name) {
      this.name = sanitizeName(name, 'mesh');
      this.emit('name');
    }

    setKind(kind) {
      this.kind = kind === 'static' ? 'static' : 'mob';
      if (this.kind === 'static') this.ai = null;
      else if (!this.ai) this.ai = 'zombie';
      this.emit('kind');
    }

    setAI(id) {
      this.ai = id || null;
      this.emit('ai');
    }

    setSolid(on) {
      this.solid = !!on;
      this.emit('solid');
    }

    allocateSlots(count) {
      var out = [];
      while (out.length < count && this._freeSlots.length) {
        out.push(this._freeSlots.pop());
      }
      while (out.length < count) {
        var limit = (this.atlas.size / this.atlas.tile) * (this.atlas.size / this.atlas.tile);
        if (this._slotCount >= limit) throw new Error('atlas full');
        out.push(this._slotCount++);
      }
      return out;
    }

    releaseSlots(slots) {
      if (!Array.isArray(slots)) return;
      for (var i = 0; i < slots.length; i++) {
        var slot = slots[i];
        if (typeof slot !== 'number') continue;
        if (this._freeSlots.indexOf(slot) < 0) this._freeSlots.push(slot);
      }
    }

    slotCountUsed() {
      var count = 0;
      for (var i = 0; i < this.parts.length; i++) {
        count += (this.parts[i].slots || []).length;
      }
      return count;
    }

    getPart(id) {
      for (var i = 0; i < this.parts.length; i++) {
        if (this.parts[i].id === id) return this.parts[i];
      }
      return null;
    }

    getJoint(id) {
      for (var i = 0; i < this.joints.length; i++) {
        if (this.joints[i].id === id) return this.joints[i];
      }
      return null;
    }

    jointForChild(partId) {
      for (var i = 0; i < this.joints.length; i++) {
        if (this.joints[i].child === partId) return this.joints[i];
      }
      return null;
    }

    childJoints(partId) {
      var out = [];
      for (var i = 0; i < this.joints.length; i++) {
        if (this.joints[i].parent === partId) out.push(this.joints[i]);
      }
      return out;
    }

    addPart(type, opts) {
      opts = opts || {};
      type = type === 'plane' ? 'plane' : 'box';
      var size = opts.size || (
        type === 'plane'
          ? { x: 0.5, y: 0.5, z: 0 }
          : { x: 0.5, y: 0.5, z: 0.5 }
      );
      var slots;
      try {
        slots = this.allocateSlots(type === 'plane' ? 1 : 6);
      } catch (err) {
        this.lastError = 'The texture atlas is full. Delete a part to free slots.';
        return null;
      }
      var part = {
        id: 'part_' + (this._nextPart++),
        name: opts.name || (type === 'plane' ? 'Plane' : 'Box') + ' ' + (this._nextPart - 1),
        type: type,
        size: {
          x: Math.max(0.01, num(size.x, 0.5)),
          y: Math.max(0.01, num(size.y, 0.5)),
          z: type === 'plane' ? 0 : Math.max(0.01, num(size.z, 0.5))
        },
        position: opts.position
          ? copyVec(opts.position)
          : { x: 0, y: this.hitbox.height / 2, z: 0 },
        rotation: opts.rotation ? copyVec(opts.rotation) : { x: 0, y: 0, z: 0 },
        anchored: !!opts.anchored,
        slots: slots
      };
      this.parts.push(part);
      this.emit('part');
      return part;
    }

    removePart(id) {
      var part = this.getPart(id);
      if (!part) return null;

      for (var i = this.joints.length - 1; i >= 0; i--) {
        var j = this.joints[i];
        if (j.child === id || j.parent === id) this.joints.splice(i, 1);
      }

      var idx = this.parts.indexOf(part);
      if (idx >= 0) this.parts.splice(idx, 1);
      this.releaseSlots(part.slots);
      this.emit('part');
      return part;
    }

    duplicatePart(id, opts) {
      opts = opts || {};
      var src = this.getPart(id);
      if (!src) return null;
      var slots;
      try {
        slots = this.allocateSlots(src.slots.length);
      } catch (err) {
        this.lastError = 'The texture atlas is full. Delete a part to free slots.';
        return null;
      }
      var part = {
        id: 'part_' + (this._nextPart++),
        name: String(src.name || 'Part') + ' copy',
        type: src.type,
        size: copyVec(src.size),
        position: {
          x: src.position.x + (opts.offset ? opts.offset.x : 0.15),
          y: src.position.y + (opts.offset ? opts.offset.y : 0),
          z: src.position.z + (opts.offset ? opts.offset.z : 0)
        },
        rotation: copyVec(src.rotation),
        anchored: false,
        slots: slots
      };
      this.parts.push(part);
      this.emit('part');
      return part;
    }

    updatePart(id, patch) {
      var part = this.getPart(id);
      if (!part) return null;
      patch = patch || {};

      if (patch.name !== undefined) part.name = String(patch.name).slice(0, 60) || part.name;

      if (patch.size) {
        part.size.x = Math.max(0.01, num(patch.size.x, part.size.x));
        part.size.y = Math.max(0.01, num(patch.size.y, part.size.y));
        if (part.type !== 'plane') part.size.z = Math.max(0.01, num(patch.size.z, part.size.z));
        else part.size.z = 0;
      }

      if (patch.position) {
        var next = {
          x: num(patch.position.x, part.position.x),
          y: num(patch.position.y, part.position.y),
          z: num(patch.position.z, part.position.z)
        };
        var dx = next.x - part.position.x;
        var dy = next.y - part.position.y;
        var dz = next.z - part.position.z;
        part.position = next;

        // Connected pivots sit on the parent's surface, so they travel with a
        // moved parent. The child's own rest transform stays where the user
        // placed it.
        if (dx || dy || dz) {
          for (var i = 0; i < this.joints.length; i++) {
            var j = this.joints[i];
            if (j.parent === id) {
              j.pivot.x += dx;
              j.pivot.y += dy;
              j.pivot.z += dz;
            }
          }
        }
      }

      if (patch.rotation) {
        part.rotation.x = num(patch.rotation.x, part.rotation.x);
        part.rotation.y = num(patch.rotation.y, part.rotation.y);
        part.rotation.z = num(patch.rotation.z, part.rotation.z);
      }

      if (patch.anchored !== undefined) {
        var wasAnchored = part.anchored;
        part.anchored = !!patch.anchored;
        if (part.anchored && !wasAnchored) {
          for (var k = this.joints.length - 1; k >= 0; k--) {
            if (this.joints[k].child === id) this.joints.splice(k, 1);
          }
        }
      }

      this.emit('part');
      return part;
    }

    wouldCycle(parentId, childId) {
      var seen = {};
      var currentId = parentId;
      while (currentId && !seen[currentId]) {
        if (currentId === childId) return true;
        seen[currentId] = true;
        var incoming = this.jointForChild(currentId);
        currentId = incoming && incoming.parent ? incoming.parent : null;
      }
      return false;
    }

    defaultPivot(type, parent, child) {
      if (type !== 'connecting' || !parent) return copyVec(child.position);
      var a = partAabb(parent);
      var b = partAabb(child);
      var onA = closestOnAabb(centerOf(b), a);
      var onB = closestOnAabb(centerOf(a), b);
      return midpoint(onA, onB);
    }

    addJoint(opts) {
      opts = opts || {};
      var type = opts.type === 'floating' ? 'floating' : 'connecting';
      var child = this.getPart(opts.child);
      if (!child) {
        this.lastError = 'Choose a child part for the joint.';
        return null;
      }
      if (child.anchored) {
        this.lastError = 'Anchored parts cannot move, so they cannot be joint children.';
        return null;
      }
      if (this.jointForChild(child.id)) {
        this.lastError = 'That part already has a joint. Remove the old joint first.';
        return null;
      }

      var parent = null;
      if (type === 'connecting') {
        parent = this.getPart(opts.parent);
        if (!parent) {
          this.lastError = 'Choose a parent part for a connecting joint.';
          return null;
        }
        if (parent.id === child.id) {
          this.lastError = 'A connecting joint needs two different parts.';
          return null;
        }
        if (this.wouldCycle(parent.id, child.id)) {
          this.lastError = 'That connection would create a loop.';
          return null;
        }
      }

      var joint = {
        id: 'joint_' + (this._nextJoint++),
        type: type,
        parent: parent ? parent.id : null,
        child: child.id,
        pivot: opts.pivot ? copyVec(opts.pivot) : this.defaultPivot(type, parent, child),
        axis: opts.axis === 'x' || opts.axis === 'z' ? opts.axis : 'y',
        amplitude: num(opts.amplitude, 15),
        speed: num(opts.speed, 1.2),
        phase: num(opts.phase, 0)
      };
      this.joints.push(joint);
      this.emit('joint');
      return joint;
    }

    updateJoint(id, patch) {
      var joint = this.getJoint(id);
      if (!joint) return null;
      patch = patch || {};
      if (patch.pivot) {
        joint.pivot.x = num(patch.pivot.x, joint.pivot.x);
        joint.pivot.y = num(patch.pivot.y, joint.pivot.y);
        joint.pivot.z = num(patch.pivot.z, joint.pivot.z);
      }
      if (patch.axis !== undefined) {
        joint.axis = patch.axis === 'x' || patch.axis === 'z' ? patch.axis : 'y';
      }
      if (patch.amplitude !== undefined) joint.amplitude = num(patch.amplitude, joint.amplitude);
      if (patch.speed !== undefined) joint.speed = num(patch.speed, joint.speed);
      if (patch.phase !== undefined) joint.phase = num(patch.phase, joint.phase);
      this.emit('joint');
      return joint;
    }

    removeJoint(id) {
      var idx = -1;
      for (var i = 0; i < this.joints.length; i++) {
        if (this.joints[i].id === id) { idx = i; break; }
      }
      if (idx < 0) return null;
      var joint = this.joints.splice(idx, 1)[0];
      this.emit('joint');
      return joint;
    }

    bounds() {
      if (!this.parts.length) {
        return { min: { x: -0.3, y: 0, z: -0.3 }, max: { x: 0.3, y: 1.8, z: 0.3 } };
      }
      var min = { x: Infinity, y: Infinity, z: Infinity };
      var max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (var i = 0; i < this.parts.length; i++) {
        var b = partAabb(this.parts[i]);
        min.x = Math.min(min.x, b.min.x);
        min.y = Math.min(min.y, b.min.y);
        min.z = Math.min(min.z, b.min.z);
        max.x = Math.max(max.x, b.max.x);
        max.y = Math.max(max.y, b.max.y);
        max.z = Math.max(max.z, b.max.z);
      }
      return { min: min, max: max };
    }

    reset(opts) {
      opts = opts || {};
      this.parts.length = 0;
      this.joints.length = 0;
      this._nextPart = 1;
      this._nextJoint = 1;
      this._slotCount = 0;
      this._freeSlots.length = 0;
      this.hitbox = { width: 0.6, height: 1.8, depth: 0.6 };
      this.name = opts.name || 'my_mesh';
      this.kind = 'mob';
      this.ai = 'zombie';
      this.solid = false;
      this.emit('reset');
    }

    toJSON() {
      var parts = [];
      for (var i = 0; i < this.parts.length; i++) {
        var p = this.parts[i];
        parts.push({
          id: p.id,
          name: p.name,
          type: p.type,
          size: copyVec(p.size),
          position: copyVec(p.position),
          rotation: copyVec(p.rotation),
          anchored: !!p.anchored,
          slots: (p.slots || []).slice()
        });
      }
      var joints = [];
      for (var j = 0; j < this.joints.length; j++) {
        var q = this.joints[j];
        joints.push({
          id: q.id,
          type: q.type,
          parent: q.parent || null,
          child: q.child,
          pivot: copyVec(q.pivot),
          axis: q.axis,
          amplitude: q.amplitude,
          speed: q.speed,
          phase: q.phase
        });
      }
      return {
        format: FORMAT,
        version: VERSION,
        name: sanitizeName(this.name, 'mesh'),
        kind: this.kind,
        ai: this.kind === 'mob' ? (this.ai || null) : null,
        solid: this.kind === 'static' ? !!this.solid : false,
        hitbox: {
          width: this.hitbox.width,
          height: this.hitbox.height,
          depth: this.hitbox.depth
        },
        atlas: { size: this.atlas.size, tile: this.atlas.tile },
        parts: parts,
        joints: joints
      };
    }

    fromJSON(raw) {
      if (!raw || typeof raw !== 'object') return false;
      this.parts.length = 0;
      this.joints.length = 0;
      this._nextPart = 1;
      this._nextJoint = 1;
      this._slotCount = 0;
      this._freeSlots.length = 0;

      this.name = sanitizeName(raw.name, 'mesh');
      this.kind = raw.kind === 'static' ? 'static' : 'mob';
      this.ai = raw.ai || (this.kind === 'mob' ? 'zombie' : null);
      this.solid = !!raw.solid;
      if (raw.hitbox) {
        this.hitbox.width = Math.max(0.05, num(raw.hitbox.width, 0.6));
        this.hitbox.height = Math.max(0.05, num(raw.hitbox.height, 1.8));
        this.hitbox.depth = Math.max(0.05, num(raw.hitbox.depth, 0.6));
      }

      var maxSlot = -1;
      var parts = Array.isArray(raw.parts) ? raw.parts : [];
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i] || {};
        var type = p.type === 'plane' ? 'plane' : 'box';
        var slots = Array.isArray(p.slots) ? p.slots.slice(0, type === 'plane' ? 1 : 6) : [];
        while (slots.length < (type === 'plane' ? 1 : 6)) slots.push(-1);
        for (var s = 0; s < slots.length; s++) {
          if (slots[s] < 0) {
            slots[s] = this.allocateSlots(1)[0];
          }
          if (slots[s] > maxSlot) maxSlot = slots[s];
        }
        var part = {
          id: p.id || 'part_' + (this._nextPart++),
          name: p.name || (type === 'plane' ? 'Plane' : 'Box'),
          type: type,
          size: vec(p.size && p.size.x, p.size && p.size.y, p.size && p.size.z),
          position: vec(p.position && p.position.x, p.position && p.position.y, p.position && p.position.z),
          rotation: vec(p.rotation && p.rotation.x, p.rotation && p.rotation.y, p.rotation && p.rotation.z),
          anchored: !!p.anchored,
          slots: slots
        };
        part.size.x = Math.max(0.01, part.size.x);
        part.size.y = Math.max(0.01, part.size.y);
        if (type === 'plane') part.size.z = 0;
        else part.size.z = Math.max(0.01, part.size.z);
        this.parts.push(part);
        this._nextPart++;
      }

      var joints = Array.isArray(raw.joints) ? raw.joints : [];
      for (var j = 0; j < joints.length; j++) {
        var q = joints[j] || {};
        if (!q.child || !this.getPart(q.child)) continue;
        this.joints.push({
          id: q.id || 'joint_' + (this._nextJoint++),
          type: q.type === 'floating' ? 'floating' : 'connecting',
          parent: q.parent && this.getPart(q.parent) ? q.parent : null,
          child: q.child,
          pivot: vec(q.pivot && q.pivot.x, q.pivot && q.pivot.y, q.pivot && q.pivot.z),
          axis: q.axis === 'x' || q.axis === 'z' ? q.axis : 'y',
          amplitude: num(q.amplitude, 15),
          speed: num(q.speed, 1.2),
          phase: num(q.phase, 0)
        });
        this._nextJoint++;
      }

      this._slotCount = Math.max(this._slotCount, maxSlot + 1);
      this.emit('reset');
      return true;
    }
  }

  MeshModel.FORMAT = FORMAT;
  MeshModel.VERSION = VERSION;
  MeshModel.sanitizeName = sanitizeName;
  MeshModel.partAabb = partAabb;
  MeshModel.eulerQuat = eulerQuat;
  window.MeshModel = MeshModel;
})();
