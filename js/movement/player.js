(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  var C = AllDogs.constants;
  var GRAVITY = C.GRAVITY;
  var MOVE_SPEED = C.MOVE_SPEED;
  var SPRINT_SPEED = C.SPRINT_SPEED;
  var MAX_FALL_SPEED = C.MAX_FALL_SPEED;
  var STEP_HEIGHT = C.STEP_HEIGHT;
  var PLAYER_HEIGHT = C.PLAYER_HEIGHT;
  var PLAYER_EYE = C.PLAYER_EYE;
  var PLAYER_HALF_WIDTH = C.PLAYER_HALF_WIDTH;
  var MOUSE_SENSITIVITY = C.MOUSE_SENSITIVITY;
  var MAX_PITCH = C.MAX_PITCH;
  var CROUCH_HEIGHT = C.CROUCH_HEIGHT;
  var CRAWL_HEIGHT = C.CRAWL_HEIGHT;
  var CROUCH_SPEED = C.CROUCH_SPEED;
  var CRAWL_SPEED = C.CRAWL_SPEED;
  var CROUCH_EYE = C.CROUCH_EYE;
  var CRAWL_EYE = C.CRAWL_EYE;
  var DOUBLE_TAP_MS = C.DOUBLE_TAP_MS;
  var TAP_TOGGLE_MS = C.TAP_TOGGLE_MS;
  var DASH_SPEED = C.DASH_SPEED;
  var DASH_UP_SPEED = C.DASH_UP_SPEED;
  var DASH_TIME = C.DASH_TIME;
  var JUMP_MIN_HEIGHT = C.JUMP_MIN_HEIGHT;
  var JUMP_HOLD_HEIGHT = C.JUMP_HOLD_HEIGHT;
  var JUMP_HOLD_HEIGHT_CROUCH = C.JUMP_HOLD_HEIGHT_CROUCH;
  var JUMP_CHARGE_SPEED = C.JUMP_CHARGE_SPEED;
  var JUMP_SPRINT_HEIGHT = C.JUMP_SPRINT_HEIGHT;
  var JUMP_BOOST_HEIGHT = C.JUMP_BOOST_HEIGHT;
  var STAMINA_MAX = C.STAMINA_MAX;
  var STAMINA_RUN_DRAIN = C.STAMINA_RUN_DRAIN;
  var STAMINA_WALK_REGEN = C.STAMINA_WALK_REGEN;
  var STAMINA_IDLE_REGEN = C.STAMINA_IDLE_REGEN;
  var STAMINA_JUMP_COST_PER_BLOCK = C.STAMINA_JUMP_COST_PER_BLOCK;
  var STAMINA_SPRINT_JUMP_MULTIPLIER = C.STAMINA_SPRINT_JUMP_MULTIPLIER;
  var STAMINA_SPRINT_JUMP_RAMP = C.STAMINA_SPRINT_JUMP_RAMP;
  var STAMINA_DASH_COST = C.STAMINA_DASH_COST;
  var STAMINA_JUMP_COST_BOOST_THRESHOLD = C.STAMINA_JUMP_COST_BOOST_THRESHOLD;
  var STAMINA_REGEN_DELAY = C.STAMINA_REGEN_DELAY;
  var STAMINA_REGEN_DELAY_BOOST = C.STAMINA_REGEN_DELAY_BOOST;
  var STAMINA_AIR_REGEN_SCALE = C.STAMINA_AIR_REGEN_SCALE;

  var TAU = Math.PI * 2;

var _fwd = new THREE.Vector3();
  var _right = new THREE.Vector3();
  var _moveDirection = new THREE.Vector3();
  var _euler = new THREE.Euler();

  var POSTURES = {
    stand: { height: PLAYER_HEIGHT, eye: PLAYER_EYE },
    crouch: { height: CROUCH_HEIGHT, eye: CROUCH_EYE },
    crawl: { height: CRAWL_HEIGHT, eye: CRAWL_EYE }
  };

  class Player {
    constructor(camera) {
      this.camera = camera;
      this.pos = new THREE.Vector3();
      this.vel = new THREE.Vector3();
      this.yaw = Math.PI;
      this.pitch = 0;
      this.onGround = false;
      this.state = 'stand';
      this.crouchOn = false;
      this.crawlOn = false;
      this.eyeHeight = PLAYER_EYE;
      this.dashRemain = 0;
      this.dashDir = new THREE.Vector3(0, 0, -1);
      this.lastCtrlPress = 0;
      this.ctrlTapPending = false;
      this.ctrlPressStart = 0;
      this.stamina = STAMINA_MAX;
      this.exhausted = false;
      this.regenCooldown = 0;
      this.stance = 'walk';
      this.jumpCharge = 0;
      this.jumpBoost = 0;
      this.charging = false;
    }

    height() {
      return POSTURES[this.state].height;
    }

    spawn(x, y, z) {
      this.pos.set(x, y, z);
      this.vel.set(0, 0, 0);
      this.yaw = Math.PI;
      this.pitch = 0;
      this.onGround = false;
      this.state = 'stand';
      this.crouchOn = false;
      this.crawlOn = false;
      this.eyeHeight = PLAYER_EYE;
      this.dashRemain = 0;
      this.lastCtrlPress = 0;
      this.ctrlTapPending = false;
      this.stamina = STAMINA_MAX;
      this.exhausted = false;
      this.regenCooldown = 0;
      this.stance = 'walk';
      this.jumpCharge = 0;
      this.jumpBoost = 0;
      this.charging = false;
    }

    update(dt, input, world) {
      var look = input.takeLook(MOUSE_SENSITIVITY);
      if (!isFinite(this.yaw)) this.yaw = Math.PI;
      if (!isFinite(this.pitch)) this.pitch = 0;
      this.yaw -= look.x;
      if (!isFinite(this.yaw)) this.yaw = 0;
      if (this.yaw > Math.PI || this.yaw < -Math.PI) {
        this.yaw = ((this.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
      }
      this.pitch -= look.y;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));

      this.updatePosture(input, world);

      _euler.set(this.pitch, this.yaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(_euler);
      var targetEye = POSTURES[this.state].eye;
      this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 12);
      this.camera.position.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);

      var sin = Math.sin(this.yaw);
      var cos = Math.cos(this.yaw);
      _fwd.set(-sin, 0, -cos);
      _right.set(cos, 0, -sin);
      _moveDirection.set(0, 0, 0);

      if (input.isDown('KeyW')) _moveDirection.add(_fwd);
      if (input.isDown('KeyS')) _moveDirection.sub(_fwd);
      if (input.isDown('KeyD')) _moveDirection.add(_right);
      if (input.isDown('KeyA')) _moveDirection.sub(_right);

      if (this.dashRemain > 0) this.dashRemain -= dt;

      var speed;
      var moving = _moveDirection.lengthSq() > 0;
      var sprintWanted =
        this.dashRemain <= 0 &&
        this.state === 'stand' &&
        (input.isDown('ShiftLeft') ||
          input.isDown('ShiftRight') ||
          (input.wDouble && input.isDown('KeyW')));
      var running = sprintWanted && !this.exhausted && moving && this.onGround;
      this.updateStamina(dt, running, moving);

      var outStance =
        this.state === 'crouch' ? 'crouch' :
        this.state === 'crawl' ? 'crawl' :
        (sprintWanted ? 'sprint' : 'walk');
      if (outStance !== this.stance) this.stance = outStance;

      if (this.dashRemain > 0) {
        speed = DASH_SPEED;
      } else if (this.state === 'crouch') {
        speed = CROUCH_SPEED;
      } else if (this.state === 'crawl') {
        speed = CRAWL_SPEED;
      } else {
        speed = sprintWanted && !this.exhausted ? SPRINT_SPEED : MOVE_SPEED;
      }

      if (moving) _moveDirection.normalize();
      if (this.dashRemain > 0) _moveDirection.copy(this.dashDir);
      this.vel.x = _moveDirection.x * speed;
      this.vel.z = _moveDirection.z * speed;

      var spaceDown = input.isDown('Space');
      if (spaceDown && this.onGround && !this.exhausted) {
        if (this.state === 'crawl') {
          this.startDash(_moveDirection);
          this.spendStamina(STAMINA_DASH_COST);
          this.charging = false;
        } else if (this.stance === 'sprint' && moving) {
          this.sprintJump();
        } else {
          this.chargeJump(dt);
          this.charging = true;
        }
      } else if (!spaceDown) {
        if (this.jumpCharge > 0) this.launchJump();
        this.jumpCharge = 0;
        this.jumpBoost = 0;
        this.charging = false;
      } else {
        this.charging = false;
      }

      var gravity = GRAVITY;
      this.vel.y = Math.max(this.vel.y - gravity * dt, MAX_FALL_SPEED);

      this.moveAxis('x', dt, world);
      this.moveAxis('z', dt, world);
      this.moveVertical(dt, world);
    }

    updatePosture(input, world) {
      var down =
        input.isDown('ControlLeft') || input.isDown('ControlRight') || input.isDown('KeyC');
      var pressAt = input.modPressAt;
      var releaseAt = input.modReleaseAt;

      if (pressAt !== this.lastCtrlPress) {
        var elapsed = this.lastCtrlPress > 0 ? pressAt - this.lastCtrlPress : -1;
        this.lastCtrlPress = pressAt;
        if (elapsed >= 0 && elapsed < DOUBLE_TAP_MS) {
          this.ctrlTapPending = false;
          this.crawlOn = !this.crawlOn;
          this.crouchOn = false;
        } else {
          this.ctrlTapPending = true;
          this.ctrlPressStart = pressAt;
        }
      }

      if (this.ctrlTapPending && releaseAt > this.lastCtrlPress) {
        this.ctrlTapPending = false;
        var held = releaseAt - this.ctrlPressStart;
        if (held < TAP_TOGGLE_MS) {
          if (this.crawlOn) {
            this.crawlOn = false;
            this.crouchOn = true;
          } else {
            this.crouchOn = !this.crouchOn;
          }
        }
      }

      var wantCrouch = (this.crouchOn || down) && !this.crawlOn;
      var target = this.crawlOn ? 'crawl' : (wantCrouch ? 'crouch' : 'stand');
      if (target !== this.state) this.tryState(target, world);
    }

    tryState(target, world) {
      if (POSTURES[target].height > POSTURES[this.state].height) {
        var prev = this.state;
        this.state = target;
        if (this.overlaps(world)) this.state = prev;
      } else {
        this.state = target;
      }
    }

    updateStamina(dt, running, moving) {
      if (running) {
        this.stamina -= STAMINA_RUN_DRAIN * dt;
        this.regenCooldown = STAMINA_REGEN_DELAY;
        if (this.stamina <= 0) {
          this.stamina = 0;
          this.exhausted = true;
        }
        return;
      }
      if (this.regenCooldown > 0) {
        this.regenCooldown = Math.max(0, this.regenCooldown - dt);
        return;
      }
      var rate = moving ? STAMINA_WALK_REGEN : STAMINA_IDLE_REGEN;
      if (!this.onGround) rate *= STAMINA_AIR_REGEN_SCALE;
      if (this.exhausted && this.stamina < 1) {
        this.stamina += rate * dt;
        if (this.stamina >= 1) {
          this.stamina = 1;
          this.exhausted = false;
        }
      } else if (!this.exhausted) {
        this.stamina = Math.min(STAMINA_MAX, this.stamina + rate * dt);
      }
    }

    spendStamina(cost) {
      if (this.exhausted) return;
      this.stamina -= cost;
      this.regenCooldown = STAMINA_REGEN_DELAY;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
      }
    }

    startDash(dir) {
      this.dashRemain = DASH_TIME;
      if (dir && dir.lengthSq() > 0.001) this.dashDir.copy(dir);
      else this.dashDir.copy(_fwd);
      this.dashDir.normalize();
      this.vel.x = this.dashDir.x * DASH_SPEED;
      this.vel.z = this.dashDir.z * DASH_SPEED;
      this.vel.y = DASH_UP_SPEED;
      this.onGround = false;
    }

    sprintJump() {
      var height = JUMP_SPRINT_HEIGHT + this.jumpBoost * JUMP_BOOST_HEIGHT;
      var mult = STAMINA_SPRINT_JUMP_MULTIPLIER + Math.max(0, this.jumpBoost - 2) * STAMINA_SPRINT_JUMP_RAMP;
      var cost = mult * STAMINA_JUMP_COST_PER_BLOCK * height;
      this.vel.y = Math.sqrt(2 * GRAVITY * height);
      this.onGround = false;
      this.jumpCharge = 0;
      this.charging = false;
      this.spendStamina(cost);
      if (cost > STAMINA_JUMP_COST_BOOST_THRESHOLD) {
        this.regenCooldown = Math.max(this.regenCooldown, STAMINA_REGEN_DELAY * STAMINA_REGEN_DELAY_BOOST);
      }
      this.jumpBoost = this.jumpBoost + 1;
    }

    chargeJump(dt) {
      var maxH = this.state === 'crouch' ? JUMP_HOLD_HEIGHT_CROUCH : JUMP_HOLD_HEIGHT;
      var before = this.jumpCharge;
      this.jumpCharge = Math.min(maxH, this.jumpCharge + JUMP_CHARGE_SPEED * dt);
      var drained = this.jumpCharge - before;
      if (drained <= 0) return;
      this.spendStamina(drained * STAMINA_JUMP_COST_PER_BLOCK);
      if (this.jumpCharge * STAMINA_JUMP_COST_PER_BLOCK > STAMINA_JUMP_COST_BOOST_THRESHOLD) {
        this.regenCooldown = Math.max(this.regenCooldown, STAMINA_REGEN_DELAY * STAMINA_REGEN_DELAY_BOOST);
      }
    }

    launchJump() {
      var maxH = this.state === 'crouch' ? JUMP_HOLD_HEIGHT_CROUCH : JUMP_HOLD_HEIGHT;
      var height = Math.max(JUMP_MIN_HEIGHT, Math.min(this.jumpCharge, maxH));
      this.vel.y = Math.sqrt(2 * GRAVITY * height);
      this.onGround = false;
      this.jumpCharge = 0;
    }

    moveAxis(axis, dt, world) {
      if (this.vel[axis] === 0) return;
      var prev = this.pos[axis];
      var edgeSnap = (this.state === 'crouch' || this.state === 'crawl') && this.onGround && this.dashRemain <= 0;
      this.pos[axis] += this.vel[axis] * dt;
      if (this.overlaps(world)) {
        if (!this.tryStepUp(world)) {
          this.pos[axis] = prev;
          this.vel[axis] = 0;
        }
      } else if (edgeSnap && !this.hasSupport(world)) {
        this.pos[axis] = prev;
        this.vel[axis] = 0;
      }
    }

    tryStepUp(world) {
      if (!this.onGround) return false;
      var fromY = this.pos.y;
      var landing = world.stepLandingY(
        this.pos.x - PLAYER_HALF_WIDTH,
        this.pos.z - PLAYER_HALF_WIDTH,
        this.pos.x + PLAYER_HALF_WIDTH,
        this.pos.z + PLAYER_HALF_WIDTH,
        fromY,
        STEP_HEIGHT
      );
      if (landing === null || landing <= fromY) return false;
      var prevY = this.pos.y;
      this.pos.y = landing;
      var ok = !this.overlaps(world);
      if (!ok) {
        this.pos.y = prevY;
        return false;
      }
      this.vel.y = 0;
      this.onGround = true;
      return true;
    }

    moveVertical(dt, world) {
      var prev = this.pos.y;
      this.pos.y += this.vel.y * dt;
      if (this.overlaps(world)) {
        var falling = this.vel.y < 0;
        this.pos.y = prev;
        this.vel.y = 0;
        this.onGround = falling;
      } else {
        this.onGround = false;
      }
    }

    hasSupport(world) {
      var x0 = Math.floor(this.pos.x - PLAYER_HALF_WIDTH);
      var x1 = Math.floor(this.pos.x + PLAYER_HALF_WIDTH - 0.001);
      var z0 = Math.floor(this.pos.z - PLAYER_HALF_WIDTH);
      var z1 = Math.floor(this.pos.z + PLAYER_HALF_WIDTH - 0.001);
      var gy = Math.floor(this.pos.y) - 1;
      for (var x = x0; x <= x1; x++) {
        for (var z = z0; z <= z1; z++) {
          if (world.isSolid(x, gy, z)) return true;
        }
      }
      if (world.collidesAABB(
        this.pos.x - PLAYER_HALF_WIDTH, this.pos.y - 0.05,
        this.pos.z - PLAYER_HALF_WIDTH,
        this.pos.x + PLAYER_HALF_WIDTH, this.pos.y - 0.001,
        this.pos.z + PLAYER_HALF_WIDTH
      )) return true;
      return false;
    }

    isCrouching() { return this.state === 'crouch' || this.crouchOn; }
    isCrouching() { return this.state === 'crouch' || this.crouchOn; }
    isCrawling() { return this.state === 'crawl' || this.crawlOn; }
    stance() { return this.stance || this.state; }

    stance() { return this.stance || this.state; }
    isCrouching() { return this.state === 'crouch' || this.crouchOn; }
    isCrawling() { return this.state === 'crawl' || this.crawlOn; }
    stance() { return this.stance || this.state; }

    overlaps(world) {
      var res = this._overlapsCore(world);
      try {
        if (res && world && this.pos) {
          var px = Math.floor(this.pos.x);
          var py = Math.floor(this.pos.y + this.height() * 0.5);
          var pz = Math.floor(this.pos.z);
          var id = world.get(px, py, pz);
          if (id) {
            var def = window.AllDogs && window.AllDogs.blocks && window.AllDogs.blocks.BLOCK_DEFS && window.AllDogs.blocks.BLOCK_DEFS[id];
            if (def && def.schema && def.schema.onCollide) {
              try { def.schema.onCollide({ world: world, player: this, x: px, y: py, z: pz, blockId: id }); } catch (e) {}
            }
          }
        }
      } catch (e) {}
      return res;
    }

    _overlapsCore(world) {
      var x0 = Math.floor(this.pos.x - PLAYER_HALF_WIDTH);
      var x1 = Math.floor(this.pos.x + PLAYER_HALF_WIDTH);
      var y0 = Math.floor(this.pos.y);
      var y1 = Math.floor(this.pos.y + this.height() - 0.001);
      var z0 = Math.floor(this.pos.z - PLAYER_HALF_WIDTH);
      var z1 = Math.floor(this.pos.z + PLAYER_HALF_WIDTH);
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          for (var z = z0; z <= z1; z++) {
            if (world.isSolid(x, y, z)) return true;
          }
        }
      }
      if (world.collidesAABB(
        this.pos.x - PLAYER_HALF_WIDTH, this.pos.y,
        this.pos.z - PLAYER_HALF_WIDTH,
        this.pos.x + PLAYER_HALF_WIDTH, this.pos.y + this.height(),
        this.pos.z + PLAYER_HALF_WIDTH
      )) return true;
      return false;
    }
  }

  AllDogs.Player = Player;
})();







