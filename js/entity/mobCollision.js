(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  // Simple rigid-body separation for the player and every living mob. Only
  // horizontal overlap is resolved so creatures never get launched upward or
  // tipped onto their sides. The broadphase is a uniform grid in the XZ plane;
  // the solver then runs a few Gauss-Seidel passes over the candidate pairs.
  var CELL_SIZE = 1.5;
  var ITERATIONS = 3;
  // Cap the number of pair resolutions per frame. A dense horde can otherwise
  // produce thousands of contacts and spike the frame time. Unprocessed pairs
  // are picked up on the next frame, and the window rotates so every pair gets
  // a turn.
  var MAX_RESOLVE_STEPS = 1024;
  var SLOP = 0.0005;
  var EPS = 1e-6;

  var _bodies = [];
  var _cells = new Map();
  var _pairs = [];
  var _pairKeys = new Set();
  var _moved = [];
  var _pairCursor = 0;

  function isDynamicBody(entity) {
    return !!entity &&
      entity.alive !== false &&
      entity.pos &&
      typeof entity.overlapsAt === 'function' &&
      entity.mass > 0;
  }

  function boundsOverlap(a, b) {
    return a.min.x < b.max.x && a.max.x > b.min.x &&
      a.min.y < b.max.y && a.max.y > b.min.y &&
      a.min.z < b.max.z && a.max.z > b.min.z;
  }

  function markMoved(body) {
    if (!body._collisionMoved) {
      body._collisionMoved = true;
      _moved.push(body);
    }
  }

  // Try to shift a body horizontally, rejecting any step that would push it
  // into solid voxels or a static entity collider. Axis-only fallbacks keep
  // bodies sliding along walls instead of stopping dead when a diagonal move
  // is blocked.
  function tryMove(body, dx, dz, world) {
    if (Math.abs(dx) <= EPS && Math.abs(dz) <= EPS) return;
    var px = body.pos.x;
    var pz = body.pos.z;
    var py = body.pos.y;

    if (dx !== 0 && dz !== 0) {
      if (!body.overlapsAt(world, px + dx, py, pz + dz)) {
        body.pos.x = px + dx;
        body.pos.z = pz + dz;
        markMoved(body);
        return;
      }
      if (!body.overlapsAt(world, px + dx, py, pz)) {
        body.pos.x = px + dx;
        markMoved(body);
      }
      if (!body.overlapsAt(world, body.pos.x, py, pz + dz)) {
        body.pos.z = pz + dz;
        markMoved(body);
      }
      return;
    }

    if (dx !== 0) {
      if (!body.overlapsAt(world, px + dx, py, pz)) {
        body.pos.x = px + dx;
        markMoved(body);
      }
      return;
    }

    if (!body.overlapsAt(world, px, py, pz + dz)) {
      body.pos.z = pz + dz;
      markMoved(body);
    }
  }

  function resolvePair(a, b, world) {
    var ba = a.bounds;
    var bb = b.bounds;

    var overlapX = Math.min(ba.max.x, bb.max.x) - Math.max(ba.min.x, bb.min.x);
    var overlapY = Math.min(ba.max.y, bb.max.y) - Math.max(ba.min.y, bb.min.y);
    var overlapZ = Math.min(ba.max.z, bb.max.z) - Math.max(ba.min.z, bb.min.z);
    if (overlapX <= SLOP || overlapY <= SLOP || overlapZ <= SLOP) return;

    // Separate along the axis that requires the smallest correction.
    var axis = overlapX <= overlapZ ? 'x' : 'z';
    var overlap = axis === 'x' ? overlapX : overlapZ;
    var push = overlap - SLOP;

    var delta = b.pos[axis] - a.pos[axis];
    var sign;
    if (delta > EPS) sign = 1;
    else if (delta < -EPS) sign = -1;
    else sign = a._collisionOrder < b._collisionOrder ? 1 : -1;

    var invA = 1 / a.mass;
    var invB = 1 / b.mass;
    var invSum = invA + invB;
    if (invSum <= 0) return;
    var shareA = invA / invSum;
    var shareB = invB / invSum;

    var moveA = -sign * push * shareA;
    var moveB = sign * push * shareB;
    if (axis === 'x') {
      tryMove(a, moveA, 0, world);
      tryMove(b, moveB, 0, world);
    } else {
      tryMove(a, 0, moveA, world);
      tryMove(b, 0, moveB, world);
    }

    // Inelastic collision impulse: cancel the closing velocity along the
    // separation normal. Position correction already does most of the work;
    // the impulse stops bodies from repeatedly driving into the same overlap.
    var nx = axis === 'x' ? sign : 0;
    var nz = axis === 'z' ? sign : 0;
    var avx = a.vel ? a.vel.x : 0;
    var avz = a.vel ? a.vel.z : 0;
    var bvx = b.vel ? b.vel.x : 0;
    var bvz = b.vel ? b.vel.z : 0;
    var closing = (bvx - avx) * nx + (bvz - avz) * nz;
    if (closing < 0) {
      var impulse = -closing / invSum;
      if (a.vel) {
        a.vel.x -= impulse * invA * nx;
        a.vel.z -= impulse * invA * nz;
      }
      if (b.vel) {
        b.vel.x += impulse * invB * nx;
        b.vel.z += impulse * invB * nz;
      }
    }
  }

  function collectPairs() {
    _cells.clear();
    _pairs.length = 0;
    _pairKeys.clear();

    var count = _bodies.length;
    for (var i = 0; i < count; i++) {
      var body = _bodies[i];
      body._collisionOrder = i;
      var b = body.bounds;
      body._collisionBounds = b;
      var x0 = Math.floor(b.min.x / CELL_SIZE);
      var x1 = Math.floor(b.max.x / CELL_SIZE);
      var z0 = Math.floor(b.min.z / CELL_SIZE);
      var z1 = Math.floor(b.max.z / CELL_SIZE);
      for (var cx = x0; cx <= x1; cx++) {
        for (var cz = z0; cz <= z1; cz++) {
          var key = cx + ',' + cz;
          var list = _cells.get(key);
          if (!list) {
            list = [];
            _cells.set(key, list);
          }
          list.push(body);
        }
      }
    }

    // Walking each cell's list lets us find every nearby pair once. The key set
    // removes duplicates for bodies that share more than one cell, and the
    // exact AABB test rejects distant bodies that merely share a broadphase
    // cell.
    _cells.forEach(function (list) {
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        var ba = a._collisionBounds;
        for (var j = i + 1; j < list.length; j++) {
          var b = list[j];
          var ia = a._collisionOrder;
          var ib = b._collisionOrder;
          var key = ia < ib ? ia * count + ib : ib * count + ia;
          if (_pairKeys.has(key)) continue;
          _pairKeys.add(key);
          if (!boundsOverlap(ba, b._collisionBounds)) continue;
          _pairs.push(a, b);
        }
      }
    });
  }

  function update(dt, game) {
    if (!game || !game.world) return false;
    var world = game.world;
    var entities = game.entityManager && game.entityManager.entities;
    _bodies.length = 0;
    _moved.length = 0;

    var player = game.player;
    if (isDynamicBody(player)) _bodies.push(player);

    if (entities) {
      for (var i = 0; i < entities.length; i++) {
        var entity = entities[i];
        if (entity === player) continue;
        if (isDynamicBody(entity)) _bodies.push(entity);
      }
    }

    if (_bodies.length < 2) return false;

    collectPairs();
    if (!_pairs.length) {
      _pairCursor = 0;
      return false;
    }

    var pairCount = _pairs.length >> 1;
    var passes = ITERATIONS;
    if (pairCount * passes > MAX_RESOLVE_STEPS) {
      passes = Math.max(1, Math.floor(MAX_RESOLVE_STEPS / pairCount));
    }
    var window = Math.min(pairCount, MAX_RESOLVE_STEPS);
    var start = pairCount > MAX_RESOLVE_STEPS ? _pairCursor % pairCount : 0;

    for (var pass = 0; pass < passes; pass++) {
      for (var n = 0; n < window; n++) {
        var index = start + n;
        if (index >= pairCount) index -= pairCount;
        var p = index << 1;
        resolvePair(_pairs[p], _pairs[p + 1], world);
      }
    }
    if (pairCount > MAX_RESOLVE_STEPS) {
      _pairCursor = (start + window) % pairCount;
    } else {
      _pairCursor = 0;
    }

    for (var m = 0; m < _moved.length; m++) {
      var moved = _moved[m];
      moved._collisionMoved = false;
      if (typeof moved.syncMesh === 'function') moved.syncMesh();
    }
    return _moved.length > 0;
  }

  AllDogs.mobCollision = {
    update: update,
    settings: {
      cellSize: CELL_SIZE,
      iterations: ITERATIONS,
      maxResolveSteps: MAX_RESOLVE_STEPS,
      slop: SLOP
    }
  };
})();
