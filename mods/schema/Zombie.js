(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  var BODY_W = 0.6;
  var BODY_H = 1.8;
  var BODY_D = 0.6;
  var ATTACK_RANGE = 1.2;
  var ATTACK_DAMAGE = 6;
  var ATTACK_COOLDOWN_MS = 900;

  var _geo = null;
  var _mat = null;

  function nowMs() {
    return typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  }

  function bodyGeometry() {
    if (!_geo) _geo = new THREE.BoxGeometry(BODY_W, BODY_H, BODY_D);
    return _geo;
  }

  function bodyMaterial() {
    if (!_mat) _mat = new THREE.MeshLambertMaterial({ color: 0x2f5d2a });
    return _mat;
  }

  // The mesh is centred on its own origin; MobEntity.syncMesh lifts it by half
  // the body height so Entity.pos can stay at the zombie's feet.
  function buildMesh() {
    var mesh = new THREE.Mesh(bodyGeometry(), bodyMaterial());
    mesh.rotation.order = 'YXZ';
    return mesh;
  }

  // Legacy fallback used only if GOAP is unavailable or disabled.
  function target(mob, game) {
    var player = game && game.player;
    if (!player || !player.pos) return null;
    return { x: player.pos.x, y: player.pos.y, z: player.pos.z };
  }

  function currentTarget(mob) {
    return mob && mob.brain ? mob.brain.blackboard.target : null;
  }

  function horizontalDistanceSq(mob, target) {
    if (!target || !target.pos) return Infinity;
    var dx = target.pos.x - mob.pos.x;
    var dz = target.pos.z - mob.pos.z;
    return dx * dx + dz * dz;
  }

  function attackReady(mob) {
    var bb = mob && mob.brain ? mob.brain.blackboard : null;
    if (!bb) return true;
    return nowMs() >= (Number(bb.nextAttackAt) || 0);
  }

  function facts(mob, game) {
    var player = game && game.player;
    var hasPlayer = !!(player && player.pos);
    var current = currentTarget(mob);
    var inRange = current
      ? horizontalDistanceSq(mob, current) <= ATTACK_RANGE * ATTACK_RANGE
      : (hasPlayer && horizontalDistanceSq(mob, player) <= ATTACK_RANGE * ATTACK_RANGE);
    return {
      hasPlayer: hasPlayer,
      hasTarget: !!current,
      inRange: inRange,
      attackReady: attackReady(mob)
    };
  }

  var acquireTarget = {
    name: 'acquireTarget',
    cost: 1,
    pre: { hasPlayer: true, hasTarget: false },
    effects: { hasTarget: true },
    instant: true,
    run: function (mob, game) {
      var player = game && game.player;
      if (!player || !player.pos) return 'failed';
      if (mob.brain) mob.brain.blackboard.target = player;
      return true;
    }
  };

  var chaseTarget = {
    name: 'chaseTarget',
    cost: 1,
    pre: { hasTarget: true },
    effects: { inRange: true },
    timeout: 20,
    update: function (mob, dt, game) {
      var current = currentTarget(mob);
      if (!current || !current.pos) {
        if (mob.brain) mob.brain.blackboard.target = null;
        return 'failed';
      }

      var dx = current.pos.x - mob.pos.x;
      var dz = current.pos.z - mob.pos.z;
      var distSq = dx * dx + dz * dz;
      if (distSq <= ATTACK_RANGE * ATTACK_RANGE) {
        mob.stopMoving();
        if (distSq > 1e-8) mob.yaw = Math.atan2(dx, dz);
        return 'done';
      }

      mob.moveTo(current.pos.x, current.pos.y, current.pos.z, {
        radius: ATTACK_RANGE
      });
      return 'running';
    },
    stop: function (mob) {
      mob.stopMoving();
    }
  };

  var attackTarget = {
    name: 'attackTarget',
    cost: 1,
    pre: { hasTarget: true, inRange: true, attackReady: true },
    effects: { attackReady: false },
    instant: true,
    run: function (mob, game) {
      var current = currentTarget(mob);
      if (!current || !current.pos || typeof current.damage !== 'function') {
        return 'failed';
      }
      if (horizontalDistanceSq(mob, current) > ATTACK_RANGE * ATTACK_RANGE) {
        return 'failed';
      }

      var dx = current.pos.x - mob.pos.x;
      var dz = current.pos.z - mob.pos.z;
      if (dx * dx + dz * dz > 1e-8) mob.yaw = Math.atan2(dx, dz);

      current.damage(ATTACK_DAMAGE, mob);
      if (mob.brain) {
        mob.brain.blackboard.nextAttackAt = nowMs() + ATTACK_COOLDOWN_MS;
      }
      return true;
    }
  };

  var schema = {
    name: 'Zombie',
    mob: {
      width: BODY_W,
      height: BODY_H,
      maxHealth: 20,
      speed: 2.1,
      jumpHeight: 1.35,
      stopDistance: ATTACK_RANGE,
      pathInterval: 0.55,
      pathHeight: 2,
      pathMaxNodes: 300,
      pathMaxDistance: 20,
      pathMaxDrop: 4,
      pathGoalRadius: 1.4
    },
    buildMesh: buildMesh,
    target: target,
    goap: {
      // Idle pauses are counted in frames. A mob that is already in melee
      // range or has no plan sleeps for this long before checking its facts
      // again, so a large horde does no planner work most frames.
      idleTicks: 20,
      idleJitter: 20,
      noPlanPauseTicks: 45,
      goalPauseTicks: 5,
      facts: facts,
      goals: [
        {
          name: 'attack',
          priority: function (mob, game, state) {
            return state.hasTarget && state.inRange && state.attackReady ? 20 : -Infinity;
          },
          desired: { attackReady: false }
        },
        {
          name: 'hunt',
          priority: function (mob, game, state) {
            return state.hasPlayer ? 10 : -Infinity;
          },
          desired: { hasTarget: true, inRange: true }
        }
      ],
      actions: [acquireTarget, chaseTarget, attackTarget]
    },
    onHurt: function (mob) {
      if (mob && mob.brain) mob.brain.wake();
    }
  };

  class ZombieEntity extends AllDogs.MobEntity {
    constructor(opts) {
      super('zombie', opts);
      this.itemId = null;
    }
  }

  AllDogs.ZombieEntity = ZombieEntity;
  AllDogs.entities.register('zombie', ZombieEntity);

  // Register immediately as well as through the mod loader so entity creation
  // never depends on the async schema fetch finishing first.
  if (AllDogs.entitySchemas) AllDogs.entitySchemas.register('zombie', schema);

  if (typeof module !== 'undefined' && module.exports) module.exports = schema;
})();
