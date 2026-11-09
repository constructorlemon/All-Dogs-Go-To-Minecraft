(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  var C = AllDogs.constants || {};
  var GRAVITY = C.GRAVITY || 28;
  var MAX_FALL_SPEED = C.MAX_FALL_SPEED || -48;
  var EPS = 1e-4;

  var DEFAULTS = {
    width: 0.6,
    height: 1.8,
    mass: 1,
    maxHealth: 20,
    speed: 2,
    jumpHeight: 1.3,
    stopDistance: 0.8,
    gravity: GRAVITY,
    maxFallSpeed: MAX_FALL_SPEED,
    pathInterval: 0.8,
    pathHeight: 2,
    pathMaxNodes: 300,
    pathMaxDistance: 20,
    pathMaxDrop: 4,
    pathGoalRadius: 1.35
  };

  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    return 0;
  }

  function fallbackMesh(mob) {
    var geo = new THREE.BoxGeometry(mob.width, mob.height, mob.width);
    var mat = new THREE.MeshLambertMaterial({ color: 0x9b3d3d });
    return new THREE.Mesh(geo, mat);
  }

  // Base class for every moving creature. Entity.pos is the feet position; the
  // bounds getter grows upward from there, unlike the static entities which
  // mostly place their centre at pos.
  class MobEntity extends AllDogs.Entity {
    constructor(type, opts) {
      opts = opts || {};
      super(type, opts);

      var schema = AllDogs.entitySchemas ? AllDogs.entitySchemas.get(type) : null;
      var cfg = (schema && schema.mob) || {};

      this.schema = schema || null;
      this.width = Math.max(0.1, pick(opts.width, cfg.width, DEFAULTS.width));
      this.height = Math.max(0.1, pick(opts.height, cfg.height, DEFAULTS.height));
      this.mass = Math.max(0.01, pick(opts.mass, cfg.mass, DEFAULTS.mass));
      this.halfExtents = { x: this.width / 2, y: this.height / 2, z: this.width / 2 };
      this.meshYOffset = pick(opts.meshYOffset, cfg.meshYOffset, this.height / 2);

      this.maxHealth = Math.max(1, pick(opts.maxHealth, cfg.maxHealth, DEFAULTS.maxHealth));
      this.health = this.maxHealth;
      this.speed = Math.max(0, pick(opts.speed, cfg.speed, DEFAULTS.speed));
      this.gravity = Math.max(0, pick(opts.gravity, cfg.gravity, DEFAULTS.gravity));
      this.maxFallSpeed = pick(opts.maxFallSpeed, cfg.maxFallSpeed, DEFAULTS.maxFallSpeed);
      this.jumpHeight = Math.max(0, pick(opts.jumpHeight, cfg.jumpHeight, DEFAULTS.jumpHeight));
      this.stopDistance = Math.max(0, pick(opts.stopDistance, cfg.stopDistance, DEFAULTS.stopDistance));

      this.pathInterval = Math.max(0.05, pick(opts.pathInterval, cfg.pathInterval, DEFAULTS.pathInterval));
      this.pathHeight = Math.max(1, pick(opts.pathHeight, cfg.pathHeight, DEFAULTS.pathHeight));
      this.pathMaxNodes = Math.max(16, pick(opts.pathMaxNodes, cfg.pathMaxNodes, DEFAULTS.pathMaxNodes));
      this.pathMaxDistance = Math.max(2, pick(opts.pathMaxDistance, cfg.pathMaxDistance, DEFAULTS.pathMaxDistance));
      this.pathMaxDrop = Math.max(0, pick(opts.pathMaxDrop, cfg.pathMaxDrop, DEFAULTS.pathMaxDrop));
      this.pathGoalRadius = Math.max(0.25, pick(opts.pathGoalRadius, cfg.pathGoalRadius, DEFAULTS.pathGoalRadius));

      this.path = null;
      this.pathIndex = 0;
      this.pathGoal = null;
      this.pathAge = 0;
      this.pathCooldown = Math.random() * this.pathInterval;
      this.pathQueued = false;

      // Navigation intent. Legacy schemas drive the mob through `target`; GOAP
      // schemas call moveTo/stopMoving and let their actions read nav.arrived.
      this.nav = {
        active: false,
        x: 0, y: 0, z: 0,
        radius: this.stopDistance,
        distance: Infinity,
        arrived: false
      };
      this.navTarget = null;
      this.brain = null;

      this.onGround = false;
      this.hurtTime = 0;
      this.deadTime = 0;
      this.yaw = pick(opts.yaw, 0);
      this._blockedX = false;
      this._blockedZ = false;
      this._jumpLock = 0;

      // Path smoothing and line-of-sight caches. These keep the per-frame cost
      // of following a path low even when hundreds of mobs are active.
      this._steerNode = null;
      this._steerIndex = -1;
      this._steerPath = null;
      this._steerTimer = 0;
      this._losClear = false;
      this._losTimer = 0;

      // GOAP is opt-in. Schemas without `goap` keep using target/tick exactly
      // as before; schemas with it get a reusable brain and navigation API.
      if (schema && schema.goap && AllDogs.goap && AllDogs.goap.createBrain) {
        try { this.brain = AllDogs.goap.createBrain(this, schema.goap); }
        catch (err) { this.brain = null; }
      }

      var mesh = null;
      if (schema && typeof schema.buildMesh === 'function') {
        try { mesh = schema.buildMesh(this); } catch (err) { mesh = null; }
      }
      this.mesh = mesh || fallbackMesh(this);
      if (this.mesh.rotation) this.mesh.rotation.order = 'YXZ';
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
          y: this.pos.y + this.height,
          z: this.pos.z + this.halfExtents.z
        }
      };
    }

    savePos() {
      return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
    }

    syncMesh() {
      if (!this.mesh) return;
      this.mesh.position.set(this.pos.x, this.pos.y + this.meshYOffset, this.pos.z);
      if (this.mesh.rotation) this.mesh.rotation.y = this.yaw;
    }

    // Swept AABB test against solid voxels and entity colliders. The small
    // epsilon keeps a mob standing exactly on an integer Y from colliding with
    // the block below it.
    overlapsAt(world, x, y, z) {
      if (!world) return false;
      var hw = this.width / 2;
      var minX = x - hw;
      var maxX = x + hw;
      var minZ = z - hw;
      var maxZ = z + hw;
      var minY = y;
      var maxY = y + this.height;

      var x0 = Math.floor(minX + EPS);
      var x1 = Math.floor(maxX - EPS);
      var z0 = Math.floor(minZ + EPS);
      var z1 = Math.floor(maxZ - EPS);
      var y0 = Math.floor(minY + EPS);
      var y1 = Math.floor(maxY - EPS);

      for (var yy = y0; yy <= y1; yy++) {
        for (var xx = x0; xx <= x1; xx++) {
          for (var zz = z0; zz <= z1; zz++) {
            if (world.isSolid(xx, yy, zz)) return true;
          }
        }
      }
      return world.collidesAABB(minX, minY, minZ, maxX, maxY, maxZ);
    }

    jump() {
      if (!this.onGround || this._jumpLock > 0) return false;
      this.vel.y = Math.sqrt(2 * this.gravity * this.jumpHeight);
      this.onGround = false;
      this._jumpLock = 0.15;
      return true;
    }

    // Navigation API used by GOAP actions and other behavior code. moveTo is
    // intentionally cheap: it only records the intent and lets the normal mob
    // update reuse the existing A* and direct-chase steering.
    moveTo(x, y, z, opts) {
      x = Number(x);
      y = Number(y);
      z = Number(z);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return false;
      opts = opts || {};
      var radius = Number(opts.radius);
      if (!isFinite(radius) || radius < 0) radius = this.stopDistance;

      this.navTarget = { x: x, y: y, z: z };
      this.nav.active = true;
      this.nav.x = x;
      this.nav.y = y;
      this.nav.z = z;
      this.nav.radius = radius;
      this.nav.arrived = false;
      var dx = x - this.pos.x;
      var dz = z - this.pos.z;
      this.nav.distance = Math.sqrt(dx * dx + dz * dz);

      if (opts.resetPath) {
        this.path = null;
        this.pathIndex = 0;
        this.pathGoal = null;
        this.pathCooldown = 0;
      }
      return true;
    }

    stopMoving() {
      this.navTarget = null;
      this.nav.active = false;
      this.nav.arrived = false;
      this.nav.distance = Infinity;
      this.path = null;
      this.pathIndex = 0;
      this.pathGoal = null;
      this.pathCooldown = 0;
      this.vel.x = 0;
      this.vel.z = 0;
    }

    isNavigating() {
      return !!(this.nav.active && this.navTarget);
    }

    moveAxis(axis, delta, world) {
      if (!delta) return true;
      var prev = this.pos[axis];
      this.pos[axis] = prev + delta;
      if (!this.overlapsAt(world, this.pos.x, this.pos.y, this.pos.z)) return true;
      this.pos[axis] = prev;
      if (axis === 'x') this._blockedX = true;
      else if (axis === 'z') this._blockedZ = true;
      return false;
    }

    moveVertical(dt, world) {
      this.vel.y -= this.gravity * dt;
      if (this.vel.y < this.maxFallSpeed) this.vel.y = this.maxFallSpeed;

      var prev = this.pos.y;
      this.pos.y += this.vel.y * dt;
      if (this.overlapsAt(world, this.pos.x, this.pos.y, this.pos.z)) {
        var falling = this.vel.y < 0;
        this.pos.y = prev;
        this.vel.y = 0;
        this.onGround = falling;
      } else {
        this.onGround = false;
      }
    }

    moveHorizontal(dt, world) {
      this._blockedX = false;
      this._blockedZ = false;
      this.moveAxis('x', this.vel.x * dt, world);
      this.moveAxis('z', this.vel.z * dt, world);
      if ((this._blockedX || this._blockedZ) && this.onGround) this.jump();
    }

    resolveTarget(game) {
      var schema = this.schema;
      if (!schema || typeof schema.target !== 'function') return null;
      var target = null;
      try { target = schema.target(this, game); } catch (err) { return null; }
      if (!target) return null;
      if (target.pos) return target.pos;
      if (isFinite(target.x) && isFinite(target.z)) return target;
      return null;
    }

    requestPath(target) {
      if (!AllDogs.pathfinder || !target) return;
      var goal = this.pathGoal;
      var moved = !goal
        || Math.abs(goal.x - target.x) + Math.abs(goal.z - target.z) > 0.75;
      if (!moved && this.path && this.path.length) {
        this.pathCooldown = this.pathInterval * 0.5;
        return;
      }

      // Keep far-away mobs on a lazier repath cycle; closer mobs need fresher
      // paths to actually connect with the player.
      var dx = target.x - this.pos.x;
      var dz = target.z - this.pos.z;
      var dist = Math.sqrt(dx * dx + dz * dz);
      this.repathDelay = this.pathInterval * (dist > 12 ? 2.2 : dist > 6 ? 1.5 : 1);
      if (!AllDogs.pathfinder.request(this, target.x, target.y, target.z)) {
        this.pathCooldown = this.repathDelay;
      }
    }

    // True when the mob's body can walk from where it stands to (tx, tz) in a
    // straight line. Heights may change by one block along the way, which the
    // auto-jump already handles. This is the line-of-sight test used to smooth
    // the grid path and to chase a visible target directly.
    walkClear(world, tx, tz) {
      if (!world) return false;
      var dx = tx - this.pos.x;
      var dz = tz - this.pos.z;
      var distSq = dx * dx + dz * dz;
      if (distSq < 1e-6) return true;

      var dist = Math.sqrt(distSq);
      var baseY = Math.round(this.pos.y);
      var steps = Math.max(1, Math.ceil(dist / 0.4));

      for (var i = 1; i <= steps; i++) {
        var t = i / steps;
        var x = this.pos.x + dx * t;
        var z = this.pos.z + dz * t;
        var bx = Math.floor(x + EPS);
        var bz = Math.floor(z + EPS);
        var ok = false;
        for (var dy = 1; dy >= -1; dy--) {
          var y = baseY + dy;
          if (y < 1) continue;
          if (!world.isSolid(bx, y - 1, bz)) continue;
          if (this.overlapsAt(world, x, y, z)) continue;
          ok = true;
          break;
        }
        if (!ok) return false;
      }
      return true;
    }

    // Walk the current A* path. Returns the next horizontal direction and
    // whether the mob should jump because the next node is higher. Rather than
    // steering at the very next cell centre (which stair-steps across uneven
    // terrain), look ahead to the furthest node with a clear straight line and
    // aim there. The look-ahead is throttled because the LOS sampling is the
    // expensive part of path following.
    followPath(world) {
      if (!this.path || this.pathIndex >= this.path.length) return null;

      var guard = this.path.length + 1;
      while (guard-- > 0) {
        while (this.pathIndex < this.path.length) {
          var node = this.path[this.pathIndex];
          var nx = node.x + 0.5 - this.pos.x;
          var nz = node.z + 0.5 - this.pos.z;
          if (nx * nx + nz * nz <= 0.2 && Math.abs(node.y - this.pos.y) <= 1.05) {
            this.pathIndex++;
            continue;
          }
          break;
        }
        if (this.pathIndex >= this.path.length) return null;

        if (this._steerPath !== this.path) {
          this._steerPath = this.path;
          this._steerNode = null;
          this._steerTimer = 0;
        }

        if (this._steerTimer <= 0 || !this._steerNode) {
          var chosenIndex = this.pathIndex;
          var limit = Math.min(this.path.length, this.pathIndex + 6);
          for (var i = this.pathIndex + 1; i < limit; i++) {
            var cand = this.path[i];
            if (Math.abs(cand.y - this.pos.y) > 1.05) break;
            if (!this.walkClear(world, cand.x + 0.5, cand.z + 0.5)) break;
            chosenIndex = i;
          }
          this._steerIndex = chosenIndex;
          this._steerNode = this.path[chosenIndex];
          this._steerTimer = 0.12;
        }

        var chosen = this._steerNode;
        var dx = chosen.x + 0.5 - this.pos.x;
        var dz = chosen.z + 0.5 - this.pos.z;
        if (dx * dx + dz * dz > 0.2) return { node: chosen, dx: dx, dz: dz };

        // Horizontally on top of the waypoint but a different height means it
        // can never be reached (we were pushed or fell); consume and look on.
        if (this._steerIndex > this.pathIndex) this.pathIndex = this._steerIndex;
        else this.pathIndex++;
        this._steerNode = null;
        this._steerTimer = 0;
      }
      return null;
    }

    update(dt, game) {
      if (!this.alive) return;
      var world = game && game.world;
      if (!world) return;

      if (this.hurtTime > 0) this.hurtTime = Math.max(0, this.hurtTime - dt);
      if (this._jumpLock > 0) this._jumpLock = Math.max(0, this._jumpLock - dt);
      if (this._steerTimer > 0) this._steerTimer = Math.max(0, this._steerTimer - dt);
      if (this._losTimer > 0) this._losTimer = Math.max(0, this._losTimer - dt);
      this.pathAge += dt;
      if (this.pathCooldown > 0) this.pathCooldown = Math.max(0, this.pathCooldown - dt);

      // Brains run before steering so an action can set the navigation target
      // for this same frame. A paused brain returns immediately, which is the
      // cheap idle path for large populations.
      if (this.brain) {
        try { this.brain.update(dt, game); } catch (err) {}
      }

      var target = this.brain ? this.navTarget : this.resolveTarget(game);
      if (!this.brain && this.schema && typeof this.schema.tick === 'function') {
        try { this.schema.tick(this, dt, game, target); } catch (err) {}
      }

      var dirX = 0;
      var dirZ = 0;
      var wantJump = false;
      var stopDistance = this.nav.active ? this.nav.radius : this.stopDistance;

      if (target) {
        if (this.pathCooldown <= 0 && !this.pathQueued) this.requestPath(target);

        var tx = target.x - this.pos.x;
        var tz = target.z - this.pos.z;
        var dist = Math.sqrt(tx * tx + tz * tz);
        this.nav.distance = dist;
        this.nav.arrived = !!(this.nav.active && dist <= stopDistance);

        // A visible target can be chased in a straight line and is much less
        // prone to the side-to-side correction a grid path causes. The LOS
        // result is cached briefly so a dense horde does not re-sample every
        // frame. Beyond a short range, rely on the path instead.
        var direct = false;
        if (dist <= 6) {
          if (this._losTimer <= 0) {
            this._losClear = this.walkClear(world, target.x, target.z);
            this._losTimer = 0.12;
          }
          direct = this._losClear;
        }

        if (direct) {
          if (dist > stopDistance && dist > 1e-5) {
            dirX = tx / dist;
            dirZ = tz / dist;
          }
          if (target.y > this.pos.y + 0.55) wantJump = true;
        } else {
          var nav = this.followPath(world);
          if (nav) {
            var len = Math.sqrt(nav.dx * nav.dx + nav.dz * nav.dz);
            if (len > 1e-5) {
              dirX = nav.dx / len;
              dirZ = nav.dz / len;
            }
            if (nav.node.y > this.pos.y + 0.55) wantJump = true;
          } else if (dist > 1e-5) {
            // No usable path yet (or the partial path ran out): chase directly.
            dirX = tx / dist;
            dirZ = tz / dist;
            if (dist < 2.5 && target.y > this.pos.y + 0.55) wantJump = true;
          }
        }

        if (dirX !== 0 || dirZ !== 0) {
          this.yaw = Math.atan2(dirX, dirZ);
        }
      } else if (this.nav.active) {
        this.nav.distance = Infinity;
        this.nav.arrived = false;
      }

      this.vel.x = dirX * this.speed;
      this.vel.z = dirZ * this.speed;

      if (wantJump && this.onGround) this.jump();

      this.moveHorizontal(dt, world);
      this.moveVertical(dt, world);
    }

    damage(amount, source) {
      if (!this.alive) return false;
      amount = Number(amount);
      if (!isFinite(amount) || amount <= 0) return false;
      this.health -= amount;
      this.hurtTime = 0.3;
      if (this.schema && typeof this.schema.onHurt === 'function') {
        try { this.schema.onHurt(this, source); } catch (err) {}
      }
      if (this.health <= 0) {
        this.health = 0;
        this.die(source);
      }
      return true;
    }

    die(source) {
      if (!this.alive) return;
      this.alive = false;
      this.path = null;
      this.pathQueued = false;
      if (this.brain) this.brain.stop();
      if (this.schema && typeof this.schema.onDeath === 'function') {
        try { this.schema.onDeath(this, source); } catch (err) {}
      }
    }

    interact(ctx) {
      if (this.schema && typeof this.schema.onInteract === 'function') {
        try { this.schema.onInteract({ game: ctx, entity: this }); } catch (err) {}
      }
    }

    onSpawn(manager) {
      if (this.schema && typeof this.schema.onSpawn === 'function') {
        try { this.schema.onSpawn({ entity: this, manager: manager }); } catch (err) {}
      }
    }

    onRemoved(manager) {
      this.pathQueued = false;
      if (this.brain) {
        this.brain.stop();
        this.brain = null;
      }
      if (this.schema && typeof this.schema.onRemoved === 'function') {
        try { this.schema.onRemoved({ entity: this, manager: manager }); } catch (err) {}
      }
    }
  }

  AllDogs.MobEntity = MobEntity;
  AllDogs.entities.MobEntity = MobEntity;
})();
