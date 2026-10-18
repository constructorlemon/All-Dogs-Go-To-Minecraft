(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  var C = AllDogs.constants;
  var REACH = C.REACH;
  var HOTBAR_SIZE = C.HOTBAR_SIZE;
  var PLAYER_HALF_WIDTH = C.PLAYER_HALF_WIDTH;
  var DROP_PICKUP_RADIUS = 1.3;
  var SMELT_TIME = 10;

  var blocks = AllDogs.blocks;
  var BLOCK = blocks.BLOCK;
  var BLOCK_DEFS = blocks.BLOCK_DEFS;
  var ITEMS = blocks.ITEMS;
  var craftingApi = AllDogs.crafting;

  var SMELT_RECIPES = { dirt: { id: 'clay', qty: 1 } };

  function Game(container) {
    this.container = container;
    this.started = false;
    this.creative = false;
    this.chunkSize = C.CHUNK_SIZE;
    this.selectedItem = null;
    this.craftInputs = [null, null, null];
    this.furnaces = {};
    this.openFurnaceKey = null;
    this.worldMeshes = [];
    this.time = 0;
    this.last = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fc7ff);
    this.scene.fog = new THREE.Fog(0x8fc7ff, 60, 150);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 250);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    var hemi = new THREE.HemisphereLight(0xffffff, 0x8a7f6a, 0.9);
    var sun = new THREE.DirectionalLight(0xfff2dc, 1.1);
    sun.position.set(60, 130, 40);
    this.scene.add(hemi, sun);

    this.world = new AllDogs.World();
    this.inventory = new AllDogs.Inventory();
    this.input = new AllDogs.Input(this.renderer.domElement);
    this.input.listen();
    this.player = new AllDogs.Player(this.camera);
    this.raycaster = new AllDogs.BlockRaycaster(this.camera, REACH);

    this.hud = new AllDogs.Hud();
    this.hotbar = new AllDogs.Hotbar();
    this.staminaBar = new AllDogs.StaminaBar();
    this.panel = new AllDogs.InventoryPanel();
    this.signEditor = new AllDogs.SignEditor();
    this.debug = new AllDogs.DebugHud();
    this.menuDebug = new AllDogs.MainDebug();

    var self = this;
    this.signEditor.onClose = function () { self.closeSignEditor(); };
    this.panel.onMove = function (fromIdx, fromZone, toIdx, toZone, count) {
      self.handleItemMove(fromIdx, fromZone, toIdx, toZone, count);
    };
    this.panel.onCraftOutput = function () { self.takeCraftOutput(); };
    this.panel.onDistribute = function (sourceIdx, sourceZone, targets, mode) {
      var ok = self.distributeStack(sourceIdx, sourceZone, targets, mode);
      if (ok) self.refreshUI();
    };
    this.hotbar.onSelectIndex = function (idx) { self.selectSlot(idx); };
    this.panel.onSelect = function (id) {
      if (!self.creative && self.inventory.count(id) < 1) return;
      self.selectedItem = id;
      self.hud.flash('Selected ' + (ITEMS[id] ? ITEMS[id].name : id));
      self.refreshUI();
    };

    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);

    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x111111 })
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.drops = new AllDogs.Drops();
    this.scene.add(this.drops.group);
    this.entityManager = new AllDogs.EntityManager(this.scene);

    this.zones = new AllDogs.ZoneManager(this.world);
    this.zones.register(new AllDogs.TestingZone());
    var zone = this.zones.enter('testing');
    this.worldMeshes = this.world.buildChunkMeshes(C.CHUNK_SIZE, this.worldGroup);
    this.player.spawn(zone.spawn.x, zone.spawn.y, zone.spawn.z);
    this.spawnZoneEntities(zone);
    this.hud.setZone(this.zones.name());

    var starter = { dirt: 64, stone: 64, log: 32, planks: 32, sand: 32, sign: 8, chest: 4 };
    for (var id in starter) {
      if (ITEMS[id] && this.inventory.canHold(id)) this.inventory.add(id, starter[id]);
    }
    this.selectSlot(0);

    this.bindEvents();
    this.hud.showOverlay('Click to start');
  }

  Game.prototype.start = function () {
    this.started = true;
    this.last = performance.now();
    this.hud.setBaseHint('WASD move  ·  Space jump  ·  Click break  ·  Right-click place  ·  E inventory');
    this.refreshUI();
    this.animate();
  };

  Game.prototype.animate = function () {
    var self = this;
    requestAnimationFrame(function () { self.animate(); });
    var now = performance.now();
    var dt = (now - this.last) / 1000;
    this.last = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  Game.prototype.update = function (dt) {
    if (!this.isUiOpen()) {
      this.player.update(dt, this.input, this.world);
      this.pickupDrops();
    }
    this.handleWheel();
    this.updateFurnaces(dt);
    this.entityManager.update(dt, this);
    this.drops.update(dt, this.time);
    this.updateHighlight();
    this.staminaBar.update(this.player);
    this.debug.update(this, dt);
  };

  Game.prototype.resize = function () {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  Game.prototype.isUiOpen = function () {
    return this.signEditor.active || !this.panel.el.hidden;
  };

  Game.prototype.bindEvents = function () {
    var self = this;
    window.addEventListener('keydown', function (e) { self.handleKey(e); });

    this.renderer.domElement.addEventListener('mousedown', function (e) {
      if (self.signEditor.active) return;
      if (!self.panel.el.hidden) { self.closeInventory(); return; }
      if (e.button === 0) self.tryLeftClick();
      else if (e.button === 2) self.tryRightClick();
    });

    this.renderer.domElement.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    if (this.panel.el) {
      this.panel.el.addEventListener('mousedown', function (e) {
        if (e.target === self.panel.el) self.closeInventory();
      });
    }

    var overlay = document.getElementById('overlay');
    var creativeBtn = document.getElementById('overlay-creative');
    var instrBtn = document.getElementById('overlay-instructions');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === creativeBtn || e.target === instrBtn) return;
        self.input.requestLock();
      });
    }
    if (creativeBtn) {
      creativeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        self.toggleCreative();
        self.input.requestLock();
      });
    }
    if (instrBtn) {
      instrBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        self.hud.flash('WASD move · Space jump · Shift sprint · Ctrl crouch · E inventory · F5 debug');
      });
    }

    if (this.input && typeof this.input.onLockChange !== 'undefined') {
      this.input.onLockChange = function (locked) {
        if (locked) self.hud.hideOverlay();
        else if (!self.isUiOpen()) self.hud.showOverlay('Click to start');
      };
    }
  };

  Game.prototype.handleKey = function (e) {
    if (this.signEditor.active) return;
    var digit = e.code ? e.code.match(/^Digit([1-9])$/) : null;
    if (digit) { this.selectSlot(parseInt(digit[1], 10) - 1); return; }
    if (e.code === 'KeyE') {
      if (!this.panel.el.hidden) this.closeInventory();
      else this.openInventory();
    } else if (e.code === 'Escape') {
      if (!this.panel.el.hidden) this.closeInventory();
    } else if (e.code === 'F3') {
      e.preventDefault();
      this.debug.toggle();
    } else if (e.code === 'F5') {
      e.preventDefault();
      this.menuDebug.toggle();
    }
  };

  Game.prototype.handleWheel = function () {
    var d = this.input.takeWheel();
    if (!d) return;
    var slots = this.hotbarSlotCount();
    if (slots < 1) return;
    var idx = ((this.selectedIndex() + (d > 0 ? 1 : -1)) % slots + slots) % slots;
    this.selectSlot(idx);
  };

  Game.prototype.hotbarSlotCount = function () {
    var c = this.inventory.capacity;
    if (!(c > 0) || !isFinite(c)) c = 36;
    return Math.min(HOTBAR_SIZE, c);
  };

  Game.prototype.selectedIndex = function () {
    for (var i = 0; i < this.hotbarSlotCount(); i++) {
      var slot = this.inventory.get(i);
      if (slot && slot.id === this.selectedItem) return i;
    }
    return 0;
  };

  Game.prototype.selectSlot = function (idx) {
    var slot = this.inventory.get(idx);
    this.selectedItem = slot ? slot.id : null;
    if (this.selectedItem && ITEMS[this.selectedItem]) {
      this.hud.flash(ITEMS[this.selectedItem].name);
    }
    this.refreshUI();
  };

  Game.prototype.toggleCreative = function () {
    this.creative = !this.creative;
    if (this.creative) this.inventory.setCreative();
    else this.inventory.creative = false;
    this.hud.flash(this.creative ? 'Creative mode' : 'Survival mode');
    this.refreshUI();
  };

  Game.prototype.openInventory = function () {
    this.signEditor.close();
    this.openFurnaceKey = null;
    this.panel.open(this.inventory, this.panelOpts());
    this.input.releaseLock();
  };

  Game.prototype.closeInventory = function () {
    if (!this.panel.el.hidden) this.panel.close();
    this.openFurnaceKey = null;
    if (this.input && !this.input.locked) this.hud.showOverlay('Click to start');
  };

  Game.prototype.openFurnace = function (ctx) {
    this.signEditor.close();
    var key = ctx.x + ',' + ctx.y + ',' + ctx.z;
    if (!this.furnaces[key]) {
      this.furnaces[key] = { x: ctx.x, y: ctx.y, z: ctx.z, slots: [null, null], out: null, progress: 0 };
    }
    this.openFurnaceKey = key;
    this.panel.open(this.inventory, this.panelOpts());
    this.input.releaseLock();
    this.hud.flash('Furnace');
  };

  Game.prototype.panelOpts = function () {
    var opts = {
      creative: this.creative,
      selectedId: this.selectedItem,
      craftInputs: this.craftInputs
    };
    if (this.openFurnaceKey && this.furnaces[this.openFurnaceKey]) {
      var f = this.furnaces[this.openFurnaceKey];
      opts.mode = 'furnace';
      opts.furnaceSlots = f.slots;
      opts.furnaceOut = f.out ? [f.out.id, f.out.qty] : null;
      opts.furnaceProgress = f.progress;
    }
    return opts;
  };

  Game.prototype.updateFurnaces = function (dt) {
    var any = false;
    for (var key in this.furnaces) {
      var f = this.furnaces[key];
      var input = f.slots[0];
      var recipe = input ? SMELT_RECIPES[input.id] : null;
      if (!recipe) { f.progress = 0; continue; }
      if (f.out && f.out.id !== recipe.id) continue;
      f.progress += dt / SMELT_TIME;
      if (f.progress >= 1) {
        f.progress = 0;
        if (f.out) f.out.qty += recipe.qty;
        else f.out = { id: recipe.id, qty: recipe.qty };
        input.qty -= 1;
        if (input.qty <= 0) f.slots[0] = null;
      }
      any = true;
    }
    if (any && this.openFurnaceKey && !this.panel.el.hidden) {
      this.panel.render(this.inventory, this.panelOpts());
    }
  };

  Game.prototype.refreshUI = function () {
    var slots = [];
    var n = this.hotbarSlotCount();
    for (var i = 0; i < HOTBAR_SIZE; i++) {
      slots.push(i < n ? this.inventory.get(i) : null);
    }
    this.hotbar.render(slots, this.selectedItem);
    if (!this.panel.el.hidden) this.panel.render(this.inventory, this.panelOpts());
  };

  Game.prototype.containerFor = function (zone) {
    if (zone === 'in') return this.craftInputs;
    if (zone === 'furn' && this.openFurnaceKey && this.furnaces[this.openFurnaceKey]) {
      return this.furnaces[this.openFurnaceKey].slots;
    }
    return null;
  };

  Game.prototype.handleItemMove = function (fromIdx, fromZone, toIdx, toZone, count) {
    var moved = false;
    if (fromZone === 'out') { this.takeCraftOutput(); return true; }
    if (fromZone === 'furnout') { moved = this.takeFurnaceOutput(toIdx, count); }
    else if (fromZone === 'inv' && toZone === 'inv') moved = this.inventory.move(fromIdx, toIdx, count);
    else if (fromZone === 'inv') moved = this.moveInvToContainer(fromIdx, this.containerFor(toZone), toIdx, count);
    else if (toZone === 'inv') moved = this.moveContainerToInv(this.containerFor(fromZone), fromIdx, toIdx, count);
    else moved = this.moveContainerToContainer(this.containerFor(fromZone), fromIdx, this.containerFor(toZone), toIdx, count);
    if (moved) this.refreshUI();
    return moved;
  };

  Game.prototype.takeFurnaceOutput = function (invIdx, count) {
    if (!this.openFurnaceKey) return false;
    var f = this.furnaces[this.openFurnaceKey];
    if (!f || !f.out) return false;
    if (this.creative) { f.out = null; return true; }
    var dst = this.inventory.get(invIdx);
    var n = count === undefined ? f.out.qty : Math.min(count, f.out.qty);
    if (dst && dst.id !== f.out.id) return false;
    if (dst) dst.qty += n;
    else this.inventory.set(invIdx, { id: f.out.id, qty: n });
    f.out.qty -= n;
    if (f.out.qty <= 0) f.out = null;
    return true;
  };

  Game.prototype.moveInvToContainer = function (invIdx, container, idx, count) {
    if (!container) return false;
    var src = this.inventory.get(invIdx);
    if (!src) return false;
    var n = count === undefined ? src.qty : Math.min(count, src.qty);
    if (n <= 0) return false;
    var dst = container[idx];
    if (dst && dst.id !== src.id) return false;
    if (dst) dst.qty += n;
    else container[idx] = { id: src.id, qty: n };
    src.qty -= n;
    if (src.qty <= 0) this.inventory.set(invIdx, null);
    return true;
  };

  Game.prototype.moveContainerToInv = function (container, idx, invIdx, count) {
    if (!container) return false;
    var src = container[idx];
    if (!src) return false;
    var n = count === undefined ? src.qty : Math.min(count, src.qty);
    if (n <= 0) return false;
    var dst = this.inventory.get(invIdx);
    if (dst && dst.id !== src.id) return false;
    if (dst) dst.qty += n;
    else this.inventory.set(invIdx, { id: src.id, qty: n });
    src.qty -= n;
    if (src.qty <= 0) container[idx] = null;
    return true;
  };

  Game.prototype.moveContainerToContainer = function (fromC, fromIdx, toC, toIdx, count) {
    if (!fromC || !toC) return false;
    var src = fromC[fromIdx];
    if (!src) return false;
    var n = count === undefined ? src.qty : Math.min(count, src.qty);
    if (n <= 0) return false;
    var dst = toC[toIdx];
    if (dst && dst.id !== src.id) return false;
    if (dst) dst.qty += n;
    else toC[toIdx] = { id: src.id, qty: n };
    src.qty -= n;
    if (src.qty <= 0) fromC[fromIdx] = null;
    return true;
  };

  Game.prototype.distributeStack = function (sourceIdx, sourceZone, targets, mode) {
    if (sourceZone !== 'inv' || !targets || !targets.length) return false;
    var src = this.inventory.get(sourceIdx);
    if (!src) return false;
    var remaining = src.qty;
    var viable = [];
    for (var i = 0; i < targets.length; i++) {
      if (this.inventory.get(targets[i]) === null) viable.push(targets[i]);
    }
    if (!viable.length) return false;
    var each = mode === 'one' ? 1 : Math.floor(remaining / viable.length);
    if (each <= 0) return false;
    var moved = false;
    for (var j = 0; j < viable.length && remaining > 0; j++) {
      var amount = mode === 'one' ? 1 : each;
      this.inventory.set(viable[j], { id: src.id, qty: amount });
      remaining -= amount;
      moved = true;
    }
    if (moved) {
      if (remaining > 0) src.qty = remaining;
      else this.inventory.set(sourceIdx, null);
    }
    return moved;
  };

  Game.prototype.takeCraftOutput = function () {
    var res = craftingApi.resolve(this.craftInputs);
    if (!res) return;
    var out = res.output;
    if (!this.creative) {
      if (!this.inventory.canHold(out[0])) { this.hud.flash('Inventory full'); return; }
      craftingApi.consume(this.craftInputs, res.recipe);
      this.inventory.add(out[0], out[1]);
    }
    this.hud.flash('Crafted ' + (ITEMS[out[0]] ? ITEMS[out[0]].name : out[0]));
    this.refreshUI();
  };

  Game.prototype.pickupDrops = function () {
    var self = this;
    var gained = this.drops.pickupNear(
      this.player.pos.x, this.player.pos.y, this.player.pos.z,
      DROP_PICKUP_RADIUS, this.time,
      function (id) { return self.inventory.canHold(id); }
    );
    if (!gained || !gained.length) return;
    for (var i = 0; i < gained.length; i++) {
      this.inventory.add(gained[i].itemId, gained[i].qty);
    }
    this.refreshUI();
  };

  Game.prototype.tryLeftClick = function () {
    var ehit = this.entityManager.raycast(this.camera, REACH);
    var hit = this.raycaster.cast(this.worldMeshes);
    var blockDist = hit ? this.distanceToBlock(hit) : Infinity;
    if (ehit && ehit.distance < blockDist) {
      if (ehit.entity.interact) ehit.entity.interact(this);
      return;
    }
    if (!hit) return;
    var id = this.world.get(hit.x, hit.y, hit.z);
    var def = BLOCK_DEFS[id];
    if (!def) return;
    var ctx = { game: this, world: this.world, player: this.player, x: hit.x, y: hit.y, z: hit.z, blockId: id };
    if (def.schema && def.schema.onClick && (this.player.isCrouching() || this.player.isCrawling())) {
      try { def.schema.onClick(ctx); } catch (err) {}
      return;
    }
    this.breakBlock(hit.x, hit.y, hit.z, def, ctx);
  };

  Game.prototype.tryRightClick = function () {
    var ehit = this.entityManager.raycast(this.camera, REACH);
    var hit = this.raycaster.cast(this.worldMeshes);
    var blockDist = hit ? this.distanceToBlock(hit) : Infinity;
    if (ehit && ehit.distance < blockDist) {
      if (ehit.entity.interact) ehit.entity.interact(this);
      return;
    }
    if (!hit) return;
    var id = this.world.get(hit.x, hit.y, hit.z);
    var def = BLOCK_DEFS[id];
    if (def && def.schema && def.schema.onClick) {
      var ctx = { game: this, world: this.world, player: this.player, x: hit.x, y: hit.y, z: hit.z, blockId: id };
      try { def.schema.onClick(ctx); } catch (err) {}
      return;
    }
    this.placeBlock(hit);
  };

  Game.prototype.distanceToBlock = function (hit) {
    var dx = hit.x + 0.5 - this.player.pos.x;
    var dy = hit.y + 0.5 - (this.player.pos.y + this.player.eyeHeight);
    var dz = hit.z + 0.5 - this.player.pos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  Game.prototype.breakBlock = function (x, y, z, def, ctx) {
    if (!def.breakable) return;
    if (def.schema && def.schema.onDestroy) { try { def.schema.onDestroy(ctx); } catch (err) {} }
    this.world.set(x, y, z, BLOCK.AIR);
    if (!this.creative && def.drop != null) {
      this.drops.drop(def.drop, 1, x + 0.5, z + 0.5, this.world, this.time, y + 1);
    }
    this.rebuildWorldMeshes();
  };

  Game.prototype.placeBlock = function (hit) {
    if (!this.selectedItem) return;
    var item = ITEMS[this.selectedItem];
    if (!item || item.place == null) return;
    var x = hit.x + hit.fx;
    var y = hit.y + hit.fy;
    var z = hit.z + hit.fz;
    if (this.world.get(x, y, z) !== BLOCK.AIR) return;
    if (this.intersectsPlayer(x, y, z)) return;
    if (typeof item.place === 'string') {
      if (!this.placeEntity(item.place, x, y, z)) return;
    } else {
      var id = this.resolvePlacementId(item.place, hit);
      this.world.set(x, y, z, id);
      this.rebuildWorldMeshes();
    }
    this.consumeSelected();
  };

  Game.prototype.resolvePlacementId = function (baseId, hit) {
    var def = BLOCK_DEFS[baseId];
    if (!def || !def.directional) return baseId;
    if (def.axisOnly) {
      var fwdX = -Math.sin(this.player.yaw);
      var fwdZ = -Math.cos(this.player.yaw);
      return blocks.yawVariantId(baseId, blocks.yawFromFacing(fwdX, fwdZ));
    }
    var faceAxis = Math.abs(hit.fx) > 0.5 ? 'x' : (Math.abs(hit.fy) > 0.5 ? 'y' : 'z');
    return blocks.variantId(baseId, blocks.axisFromHit(hit.onX, hit.onY, hit.onZ, faceAxis, false));
  };

  Game.prototype.placeEntity = function (type, x, y, z) {
    var ent = this.entityManager.create(type, {
      pos: { x: x + 0.5, y: y, z: z + 0.5 },
      yaw: this.player.yaw
    });
    if (!ent) return false;
    this.entityManager.add(ent);
    if (ent.solidBlock && this.world.addCollider) this.world.addCollider(ent);
    return true;
  };

  Game.prototype.consumeSelected = function () {
    if (this.creative || !this.selectedItem) return;
    this.inventory.remove(this.selectedItem, 1);
    if (this.inventory.count(this.selectedItem) < 1) this.selectedItem = null;
    this.refreshUI();
  };

  Game.prototype.intersectsPlayer = function (x, y, z) {
    var p = this.player;
    var minX = p.pos.x - PLAYER_HALF_WIDTH;
    var maxX = p.pos.x + PLAYER_HALF_WIDTH;
    var minZ = p.pos.z - PLAYER_HALF_WIDTH;
    var maxZ = p.pos.z + PLAYER_HALF_WIDTH;
    var minY = p.pos.y;
    var maxY = p.pos.y + p.height();
    return minX < x + 1 && maxX > x && minY < y + 1 && maxY > y && minZ < z + 1 && maxZ > z;
  };

  Game.prototype.rebuildWorldMeshes = function () {
    for (var i = 0; i < this.worldMeshes.length; i++) {
      var m = this.worldMeshes[i];
      this.worldGroup.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    this.worldMeshes = this.world.buildChunkMeshes(C.CHUNK_SIZE, this.worldGroup);
  };

  Game.prototype.updateHighlight = function () {
    var hit = this.raycaster.cast(this.worldMeshes);
    if (!hit) { this.highlight.visible = false; return; }
    this.highlight.visible = true;
    this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  };

  Game.prototype.spawnZoneEntities = function (zone) {
    var list = zone && zone.entities ? zone.entities() : [];
    this.entityManager.clear();
    for (var i = 0; i < list.length; i++) {
      var desc = list[i];
      var ent = this.entityManager.create(desc.type, desc);
      if (!ent) continue;
      if (desc.yaw !== undefined) ent.yaw = desc.yaw;
      this.entityManager.add(ent);
      if (ent.solidBlock && this.world.addCollider) this.world.addCollider(ent);
    }
  };

  Game.prototype.openSignEditor = function (entity) {
    if (!this.panel.el.hidden) this.closeInventory();
    this.input.releaseLock();
    this.signEditor.open(entity);
  };

  Game.prototype.closeSignEditor = function () {
    this.signEditor.close();
    if (!this.input.locked) this.hud.showOverlay('Click to start');
  };

  AllDogs.Game = Game;
})();
