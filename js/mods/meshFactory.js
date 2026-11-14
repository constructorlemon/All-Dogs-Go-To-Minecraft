(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  var ATLAS_SIZE = 1024;
  var ATLAS_TILE = 32;
  var DEG = Math.PI / 180;
  var AXES = {
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, 1, 0),
    z: new THREE.Vector3(0, 0, 1)
  };
  var ONE = new THREE.Vector3(1, 1, 1);

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function vecOf(v, fallback) {
    v = v || {};
    fallback = fallback || {};
    return {
      x: num(v.x, num(fallback.x, 0)),
      y: num(v.y, num(fallback.y, 0)),
      z: num(v.z, num(fallback.z, 0))
    };
  }

  function quatOf(rotation) {
    var r = rotation || {};
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
      num(r.x, 0) * DEG,
      num(r.y, 0) * DEG,
      num(r.z, 0) * DEG,
      'YXZ'
    ));
  }

  function normalizeModel(raw) {
    raw = raw && typeof raw === 'object'
      ? JSON.parse(JSON.stringify(raw))
      : {};

    var model = {
      format: raw.format || 'alldogs-mesh',
      version: num(raw.version, 1),
      name: raw.name || 'mesh',
      kind: raw.kind === 'static' ? 'static' : 'mob',
      ai: raw.ai || null,
      solid: !!raw.solid,
      hitbox: {
        width: Math.max(0.05, num(raw.hitbox && raw.hitbox.width, 0.6)),
        height: Math.max(0.05, num(raw.hitbox && raw.hitbox.height, 1.8)),
        depth: Math.max(0.05, num(raw.hitbox && raw.hitbox.depth, 0.6))
      },
      atlas: {
        size: Math.max(64, num(raw.atlas && raw.atlas.size, ATLAS_SIZE)),
        tile: Math.max(8, num(raw.atlas && raw.atlas.tile, ATLAS_TILE))
      },
      parts: [],
      joints: []
    };

    var parts = Array.isArray(raw.parts) ? raw.parts : [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i] || {};
      var type = p.type === 'plane' ? 'plane' : 'box';
      var size = vecOf(p.size, { x: 0.5, y: 0.5, z: 0.5 });
      if (type === 'plane') size.z = 0;
      var slots = Array.isArray(p.slots) ? p.slots.slice(0, type === 'plane' ? 1 : 6) : [];
      while (slots.length < (type === 'plane' ? 1 : 6)) slots.push(0);
      for (var s = 0; s < slots.length; s++) slots[s] = Math.max(0, Math.floor(num(slots[s], 0)));
      model.parts.push({
        id: String(p.id || ('part_' + (i + 1))),
        name: String(p.name || (type === 'plane' ? 'Plane' : 'Box')),
        type: type,
        size: {
          x: Math.max(0.01, size.x),
          y: Math.max(0.01, size.y),
          z: type === 'plane' ? 0 : Math.max(0.01, size.z)
        },
        position: vecOf(p.position),
        rotation: vecOf(p.rotation),
        anchored: !!p.anchored,
        slots: slots
      });
    }

    var byId = {};
    for (var b = 0; b < model.parts.length; b++) byId[model.parts[b].id] = model.parts[b];

    var joints = Array.isArray(raw.joints) ? raw.joints : [];
    for (var j = 0; j < joints.length; j++) {
      var q = joints[j] || {};
      if (!q.child || !byId[q.child]) continue;
      var type = q.type === 'floating' ? 'floating' : 'connecting';
      var parent = q.parent && byId[q.parent] ? String(q.parent) : null;
      if (type === 'connecting' && !parent) type = 'floating';
      model.joints.push({
        id: String(q.id || ('joint_' + (j + 1))),
        type: type,
        parent: type === 'connecting' ? parent : null,
        child: String(q.child),
        pivot: vecOf(q.pivot, byId[q.child].position),
        axis: q.axis === 'x' || q.axis === 'z' ? q.axis : 'y',
        amplitude: num(q.amplitude, 15),
        speed: num(q.speed, 1.2),
        phase: num(q.phase, 0)
      });
    }

    return model;
  }

  function faceFromNormal(x, y, z) {
    if (x > 0.5) return 0;
    if (x < -0.5) return 1;
    if (y > 0.5) return 2;
    if (y < -0.5) return 3;
    if (z > 0.5) return 4;
    return 5;
  }

  function remapUVs(geometry, slots, atlas) {
    var uv = geometry.attributes.uv;
    var normal = geometry.attributes.normal;
    if (!uv) return;
    var size = atlas.size;
    var tile = atlas.tile;
    var cols = Math.max(1, Math.floor(size / tile));
    var inset = 0.5;
    var span = Math.max(1, tile - 1);

    for (var i = 0; i < uv.count; i++) {
      var slot;
      if (normal) {
        slot = slots[faceFromNormal(normal.getX(i), normal.getY(i), normal.getZ(i))] || 0;
      } else {
        slot = slots[0] || 0;
      }
      var cellX = (slot % cols) * tile;
      var cellY = Math.floor(slot / cols) * tile;
      var u = uv.getX(i);
      var v = uv.getY(i);
      uv.setXY(
        i,
        (cellX + inset + u * span) / size,
        (cellY + inset + (1 - v) * span) / size
      );
    }
    uv.needsUpdate = true;
  }

  function buildGeometry(part, atlas) {
    var geometry;
    if (part.type === 'plane') {
      geometry = new THREE.PlaneGeometry(part.size.x, part.size.y);
      geometry.translate(0, 0, 0);
    } else {
      geometry = new THREE.BoxGeometry(
        Math.max(0.001, part.size.x),
        Math.max(0.001, part.size.y),
        Math.max(0.001, part.size.z)
      );
    }
    remapUVs(geometry, part.slots || [], atlas);
    return geometry;
  }

  function materialFor(texture, doubleSided) {
    return new THREE.MeshLambertMaterial({
      map: texture,
      alphaTest: 0.5,
      transparent: false,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide
    });
  }

  function buildRig(rawModel, texture) {
    var model = normalizeModel(rawModel);
    var atlas = model.atlas;
    var root = new THREE.Group();
    root.name = 'mesh-rig:' + model.name;

    var partsById = {};
    var i;
    for (i = 0; i < model.parts.length; i++) partsById[model.parts[i].id] = model.parts[i];

    var incoming = {};
    for (i = 0; i < model.joints.length; i++) {
      var j = model.joints[i];
      if (!j.parent) continue;
      incoming[j.child] = j;
    }

    var jointsByParent = {};
    for (i = 0; i < model.joints.length; i++) {
      var jj = model.joints[i];
      if (!jj.parent) continue;
      if (!jointsByParent[jj.parent]) jointsByParent[jj.parent] = [];
      jointsByParent[jj.parent].push(jj);
    }

    var materialFront = materialFor(texture, false);
    var materialDouble = materialFor(texture, true);
    var groups = {};
    var meshes = [];
    var animators = [];
    var attached = {};

    function addPart(part) {
      var group = new THREE.Group();
      group.userData.partId = part.id;
      var mesh = new THREE.Mesh(
        buildGeometry(part, atlas),
        part.type === 'plane' ? materialDouble : materialFront
      );
      mesh.userData.partId = part.id;
      mesh.userData.meshPart = part;
      mesh.userData.slot = (part.slots || [])[0] || 0;
      group.add(mesh);
      groups[part.id] = group;
      meshes.push(mesh);
      attached[part.id] = true;
      return group;
    }

    function attachChildren(parentPart, parentGroup) {
      var list = jointsByParent[parentPart.id] || [];
      for (var n = 0; n < list.length; n++) {
        attachJoint(list[n], parentGroup, parentPart);
      }
    }

    function attachJoint(joint, parentGroup, parentPart) {
      var child = partsById[joint.child];
      if (!child || attached[child.id] || child.anchored) return;
      var childGroup = addPart(child);
      var pivotGroup = new THREE.Group();
      var pivot = new THREE.Vector3(joint.pivot.x, joint.pivot.y, joint.pivot.z);

      if (parentPart) {
        var parentQuat = quatOf(parentPart.rotation);
        var parentInv = new THREE.Matrix4().compose(
          new THREE.Vector3(parentPart.position.x, parentPart.position.y, parentPart.position.z),
          parentQuat,
          ONE
        ).invert();
        var pivotLocal = pivot.clone().applyMatrix4(parentInv);
        var childLocal = new THREE.Vector3(child.position.x, child.position.y, child.position.z)
          .applyMatrix4(parentInv);
        pivotGroup.position.copy(pivotLocal);
        childGroup.position.copy(childLocal.sub(pivotLocal));
        childGroup.quaternion.copy(parentQuat.clone().invert().multiply(quatOf(child.rotation)));
      } else {
        pivotGroup.position.copy(pivot);
        childGroup.position.set(
          child.position.x - pivot.x,
          child.position.y - pivot.y,
          child.position.z - pivot.z
        );
        childGroup.quaternion.copy(quatOf(child.rotation));
      }

      pivotGroup.add(childGroup);
      parentGroup.add(pivotGroup);

      animators.push({
        joint: joint,
        pivotGroup: pivotGroup,
        axis: AXES[joint.axis] || AXES.y,
        amplitude: num(joint.amplitude, 15) * DEG,
        speed: num(joint.speed, 1.2),
        phase: num(joint.phase, 0) * DEG
      });

      attachChildren(child, childGroup);
    }

    // Root parts: anything without an incoming joint, plus anchored parts.
    for (i = 0; i < model.parts.length; i++) {
      var part = model.parts[i];
      if (attached[part.id]) continue;
      if (!part.anchored && incoming[part.id]) continue;
      var group = addPart(part);
      group.position.set(part.position.x, part.position.y, part.position.z);
      group.quaternion.copy(quatOf(part.rotation));
      root.add(group);
      attachChildren(part, group);
    }

    // Floating joints have no parent part and hang directly from the model root.
    for (i = 0; i < model.joints.length; i++) {
      var fj = model.joints[i];
      if (fj.type !== 'floating' || attached[fj.child]) continue;
      attachJoint(fj, root, null);
    }

    // Defensive: a malformed joint graph must never hide a part.
    for (i = 0; i < model.parts.length; i++) {
      var orphan = model.parts[i];
      if (attached[orphan.id]) continue;
      var orphanGroup = addPart(orphan);
      orphanGroup.position.set(orphan.position.x, orphan.position.y, orphan.position.z);
      orphanGroup.quaternion.copy(quatOf(orphan.rotation));
      root.add(orphanGroup);
    }

    function update(seconds) {
      var t = num(seconds, 0);
      for (var a = 0; a < animators.length; a++) {
        var item = animators[a];
        var angle = item.amplitude * Math.sin(t * item.speed + item.phase);
        item.pivotGroup.quaternion.setFromAxisAngle(item.axis, angle);
      }
    }

    function reset() {
      for (var a = 0; a < animators.length; a++) {
        animators[a].pivotGroup.quaternion.identity();
      }
    }

    reset();

    return {
      root: root,
      model: model,
      parts: model.parts,
      groups: groups,
      meshes: meshes,
      animators: animators,
      update: update,
      reset: reset
    };
  }

  function slug(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'mesh';
  }

  var registry = {};
  var order = [];

  function copySchemaSource(baseSchema) {
    var out = {};
    if (!baseSchema) return out;
    var keys = ['target', 'tick', 'goap', 'onHurt', 'onDeath', 'onSpawn', 'onRemoved', 'onInteract'];
    for (var i = 0; i < keys.length; i++) {
      if (baseSchema[keys[i]] !== undefined) out[keys[i]] = baseSchema[keys[i]];
    }
    return out;
  }

  function makeStaticClass(type, model, texture) {
    var hb = model.hitbox;
    return class MeshStaticEntity extends AllDogs.Entity {
      constructor(opts) {
        super(type, opts);
        this.halfExtents = { x: hb.width / 2, y: hb.height / 2, z: hb.depth / 2 };
        this.solidBlock = !!model.solid;
        this.meshYOffset = 0;
        this.rig = buildRig(model, texture);
        this.mesh = this.rig.root;
        this._rigTime = 0;
      }

      get bounds() {
        return {
          min: {
            x: this.pos.x - this.halfExtents.x,
            y: this.pos.y,
            z: this.pos.z - this.halfExtents.z
          },
          max: {
            x: this.pos.x + this.halfExtents.x,
            y: this.pos.y + this.halfExtents.y * 2,
            z: this.pos.z + this.halfExtents.z
          }
        };
      }

      update(dt) {
        if (!this.rig) return;
        this._rigTime += dt || 0;
        this.rig.update(this._rigTime);
      }
    };
  }

  function makeMobClass(type) {
    return class MeshMobEntity extends AllDogs.MobEntity {
      constructor(opts) {
        super(type, opts);
        var schema = AllDogs.entitySchemas ? AllDogs.entitySchemas.get(type) : null;
        var hb = schema && schema.meshHitbox ? schema.meshHitbox : null;
        if (hb) {
          this.halfExtents = { x: hb.width / 2, y: hb.height / 2, z: hb.depth / 2 };
        }
        this.meshYOffset = 0;
        this._rigTime = 0;
      }

      update(dt, ctx) {
        super.update(dt, ctx);
        if (!this.rig) return;
        this._rigTime += dt || 0;
        this.rig.update(this._rigTime);
      }
    };
  }

  function register(rawModel, texture, opts) {
    opts = opts || {};
    var model = normalizeModel(rawModel);
    var baseName = opts.name || model.name || 'mesh';
    var type = 'mesh_' + slug(baseName);
    if (registry[type]) {
      var suffix = 2;
      while (registry['mesh_' + slug(baseName) + '_' + suffix]) suffix++;
      type = 'mesh_' + slug(baseName) + '_' + suffix;
    }

    var entry = {
      type: type,
      name: baseName,
      kind: model.kind,
      ai: model.kind === 'mob' ? (model.ai || null) : null,
      model: model,
      texture: texture,
      ctor: null,
      schema: null
    };

    if (AllDogs.Entity && AllDogs.MobEntity) {
      if (model.kind === 'mob') {
        var baseSchema = model.ai && AllDogs.entitySchemas
          ? AllDogs.entitySchemas.get(model.ai)
          : null;
        var inherited = copySchemaSource(baseSchema);
        var schema = {
          name: model.name,
          mob: Object.assign({}, baseSchema && baseSchema.mob ? baseSchema.mob : {}, {
            width: model.hitbox.width,
            height: model.hitbox.height,
            meshYOffset: 0
          }),
          meshHitbox: model.hitbox,
          buildMesh: function (mob) {
            var rig = buildRig(model, texture);
            if (mob) mob.rig = rig;
            return rig.root;
          }
        };
        for (var key in inherited) schema[key] = inherited[key];
        entry.schema = schema;
        entry.ctor = makeMobClass(type);
        AllDogs.entitySchemas.register(type, schema);
      } else {
        entry.ctor = makeStaticClass(type, model, texture);
      }
      AllDogs.entities.register(type, entry.ctor);
    }

    registry[type] = entry;
    order.push(type);
    return entry;
  }

  function list(kind) {
    var out = [];
    for (var i = 0; i < order.length; i++) {
      var entry = registry[order[i]];
      if (!entry) continue;
      if (kind && entry.kind !== kind) continue;
      out.push(entry);
    }
    return out;
  }

  AllDogs.meshFactory = {
    buildRig: buildRig,
    buildGeometry: buildGeometry,
    normalizeModel: normalizeModel,
    register: register,
    get: function (type) { return registry[type] || null; },
    list: list,
    slug: slug
  };
})();
