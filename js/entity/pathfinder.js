(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var C = AllDogs.constants || {};
  var WORLD_HEIGHT = C.WORLD_HEIGHT || 64;
  var SQRT2 = Math.SQRT2;
  var SEARCH_OFFSET = 64;
  var SEARCH_SPAN = 128;

  function now() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
  }

  // Small binary min-heap with lazy deletion. Entries store their own g value so
  // an out-of-date entry can be skipped when a better route was found later.
  function Heap() {
    this.items = [];
    this.f = [];
    this.g = [];
  }

  Heap.prototype.push = function (item, f, g) {
    var i = this.items.length;
    this.items.push(item);
    this.f.push(f);
    this.g.push(g);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (this.f[p] <= f) break;
      this.items[i] = this.items[p];
      this.f[i] = this.f[p];
      this.g[i] = this.g[p];
      i = p;
    }
    this.items[i] = item;
    this.f[i] = f;
    this.g[i] = g;
  };

  Heap.prototype.pop = function () {
    var n = this.items.length;
    if (n === 0) return null;
    var topItem = this.items[0];
    var topF = this.f[0];
    var topG = this.g[0];
    n--;
    if (n > 0) {
      var item = this.items[n];
      var f = this.f[n];
      var g = this.g[n];
      this.items.pop();
      this.f.pop();
      this.g.pop();
      var i = 0;
      while (true) {
        var l = i * 2 + 1;
        var r = l + 1;
        var best = i;
        var bestF = f;
        if (l < n && this.f[l] < bestF) { best = l; bestF = this.f[l]; }
        if (r < n && this.f[r] < bestF) { best = r; bestF = this.f[r]; }
        if (best === i) break;
        this.items[i] = this.items[best];
        this.f[i] = this.f[best];
        this.g[i] = this.g[best];
        i = best;
      }
      this.items[i] = item;
      this.f[i] = f;
      this.g[i] = g;
    } else {
      this.items.pop();
      this.f.pop();
      this.g.pop();
    }
    return { item: topItem, f: topF, g: topG };
  };

  Heap.prototype.size = function () {
    return this.items.length;
  };

  function canPass(world, x, y, z, height) {
    for (var i = 0; i < height; i++) {
      if (world.isSolid(x, y + i, z)) return false;
    }
    return true;
  }

  function canStand(world, x, y, z, height) {
    if (y <= 0 || y + height > WORLD_HEIGHT) return false;
    if (!world.isSolid(x, y - 1, z)) return false;
    return canPass(world, x, y, z, height);
  }

  // Choose the closest walkable level for a neighbouring column: same level,
  // one block up, then a short drop. This matches the way a two-block-tall mob
  // can step/jump up and fall.
  function neighborY(world, x, z, fromY, height, maxDrop) {
    if (canStand(world, x, fromY, z, height)) return fromY;
    if (canStand(world, x, fromY + 1, z, height)) return fromY + 1;
    for (var y = fromY - 1; y >= fromY - maxDrop; y--) {
      if (canStand(world, x, y, z, height)) return y;
    }
    return -1;
  }

  function heuristic(x, y, z, gx, gy, gz) {
    var dx = Math.abs(x - gx);
    var dz = Math.abs(z - gz);
    var dy = Math.abs(y - gy);
    var diag = dx < dz ? dx : dz;
    return (dx + dz) + (SQRT2 - 2) * diag + dy * 0.3;
  }

  function nodeKey(nx, nz, ny, sx, sz) {
    return ((nx - sx + SEARCH_OFFSET) * SEARCH_SPAN +
      (nz - sz + SEARCH_OFFSET)) * 64 + ny;
  }

  function opt(a, b, c) {
    if (a !== undefined && a !== null) return a;
    if (b !== undefined && b !== null) return b;
    return c;
  }

  var DIRS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];

  // A single A* search. It is deliberately bounded by node count and search
  // radius so one expensive mob can never stall the whole simulation. When the
  // goal cannot be reached within the budget, the best frontier node is returned
  // as a partial path so the mob can keep making progress and repath later.
  function findPath(world, startX, startY, startZ, goalX, goalY, goalZ, opts) {
    opts = opts || {};
    var height = Math.max(1, opts.height || 2);
    var maxNodes = opts.maxNodes || 300;
    var maxDistance = opts.maxDistance || 20;
    var maxDrop = opts.maxDrop === undefined ? 4 : opts.maxDrop;
    var goalRadius = opts.goalRadius || 1.35;
    var goalRadiusSq = goalRadius * goalRadius;

    var sx = Math.floor(startX);
    var sy = Math.floor(startY + 0.01);
    var sz = Math.floor(startZ);
    var gx = Math.floor(goalX);
    var gy = Math.floor(goalY + 0.01);
    var gz = Math.floor(goalZ);

    var startKey = nodeKey(sx, sz, sy, sx, sz);
    var start = {
      x: sx, y: sy, z: sz, g: 0,
      f: heuristic(sx, sy, sz, gx, gy, gz),
      parent: null, closed: false
    };
    var nodes = new Map();
    nodes.set(startKey, start);
    var heap = new Heap();
    heap.push(start, start.f, 0);

    var best = start;
    var bestH = start.f;
    var goal = null;
    var visited = 0;

    while (heap.size() > 0) {
      var entry = heap.pop();
      var cur = entry.item;
      if (!cur || cur.closed) continue;
      if (entry.g !== cur.g) continue;
      cur.closed = true;
      visited++;

      var h = heuristic(cur.x, cur.y, cur.z, gx, gy, gz);
      if (h < bestH) {
        bestH = h;
        best = cur;
      }

      var hdx = cur.x - gx;
      var hdz = cur.z - gz;
      if (hdx * hdx + hdz * hdz <= goalRadiusSq && Math.abs(cur.y - gy) <= 1) {
        goal = cur;
        break;
      }

      if (visited >= maxNodes) break;

      for (var d = 0; d < DIRS.length; d++) {
        var dx = DIRS[d][0];
        var dz = DIRS[d][1];
        var nx = cur.x + dx;
        var nz = cur.z + dz;

        if (Math.abs(nx - sx) + Math.abs(nz - sz) > maxDistance) continue;

        var ny = neighborY(world, nx, nz, cur.y, height, maxDrop);
        if (ny < 0) continue;

        if (dx !== 0 && dz !== 0) {
          // Do not cut through a solid corner.
          if (!canPass(world, cur.x + dx, ny, cur.z, height)) continue;
          if (!canPass(world, cur.x, ny, cur.z + dz, height)) continue;
        }

        var step = (dx !== 0 && dz !== 0) ? SQRT2 : 1;
        var dy = ny > cur.y ? ny - cur.y : cur.y - ny;
        var ng = cur.g + step + dy * 0.35 + (ny > cur.y ? 0.3 : 0);

        var key = nodeKey(nx, nz, ny, sx, sz);
        var n = nodes.get(key);
        if (!n) {
          n = {
            x: nx, y: ny, z: nz, g: ng,
            f: ng + heuristic(nx, ny, nz, gx, gy, gz),
            parent: cur, closed: false
          };
          nodes.set(key, n);
          heap.push(n, n.f, ng);
        } else if (ng < n.g) {
          n.g = ng;
          n.parent = cur;
          n.f = ng + heuristic(nx, ny, nz, gx, gy, gz);
          heap.push(n, n.f, ng);
        }
      }
    }

    var end = goal || (best !== start ? best : null);
    if (!end) return [];

    var path = [];
    var walk = end;
    while (walk && walk.parent) {
      path.push({ x: walk.x, y: walk.y, z: walk.z });
      walk = walk.parent;
    }
    path.reverse();
    return path;
  }

  function Pathfinder() {
    this.queue = [];
    this.head = 0;
    this.budgetMs = 3;
    this.maxSearches = 16;
    this.maxNodes = 300;
    this.maxDistance = 20;
    this.maxPending = 256;
    this.stats = { searches: 0, queued: 0, rejected: 0, lastMs: 0 };
  }

  Pathfinder.prototype.request = function (entity, targetX, targetY, targetZ, opts) {
    if (!entity || entity.pathQueued) return false;
    if (!isFinite(targetX) || !isFinite(targetZ)) return false;
    // Under a large horde the queue can never be fully served, so cap it and
    // let the rejected mobs keep their previous path or direct-chase instead of
    // growing memory without bound.
    if (this.queue.length - this.head >= this.maxPending) {
      this.stats.rejected++;
      return false;
    }
    entity.pathQueued = true;
    this.queue.push({
      entity: entity,
      x: targetX,
      y: isFinite(targetY) ? targetY : entity.pos.y,
      z: targetZ,
      opts: opts || null
    });
    this.stats.queued++;
    return true;
  };

  Pathfinder.prototype.update = function (dt, game) {
    if (!game || !game.world) return;
    if (this.head >= this.queue.length) {
      this.queue.length = 0;
      this.head = 0;
      this.stats.lastMs = 0;
      return;
    }

    var world = game.world;
    var start = now();
    var searched = 0;

    while (this.head < this.queue.length && searched < this.maxSearches) {
      // Always run at least one search per frame so progress never stalls.
      if (searched > 0 && now() - start >= this.budgetMs) break;
      var req = this.queue[this.head++];
      var entity = req.entity;
      if (!entity) continue;
      entity.pathQueued = false;
      if (!entity.alive) continue;

      var opts = req.opts || {};
      var path = findPath(
        world,
        entity.pos.x, entity.pos.y, entity.pos.z,
        req.x, req.y, req.z,
        {
          height: opt(opts.height, entity.pathHeight, 2),
          maxNodes: opt(opts.maxNodes, entity.pathMaxNodes, this.maxNodes),
          maxDistance: opt(opts.maxDistance, entity.pathMaxDistance, this.maxDistance),
          maxDrop: opt(opts.maxDrop, entity.pathMaxDrop, 4),
          goalRadius: opt(opts.goalRadius, entity.pathGoalRadius, 1.35)
        }
      );

      entity.path = path;
      entity.pathIndex = 0;
      entity.pathGoal = { x: req.x, y: req.y, z: req.z };
      entity.pathAge = 0;
      entity.pathCooldown = (entity.repathDelay || entity.pathInterval || 1) *
        (0.85 + Math.random() * 0.3);
      this.stats.searches++;
      searched++;
    }

    this.stats.lastMs = now() - start;
    if (this.head >= this.queue.length) {
      this.queue.length = 0;
      this.head = 0;
    }
  };

  Pathfinder.prototype.pending = function () {
    return this.queue.length - this.head;
  };

  AllDogs.Pathfinder = Pathfinder;
  AllDogs.pathfinder = new Pathfinder();
  AllDogs.pathfinder.findPath = findPath;
})();
