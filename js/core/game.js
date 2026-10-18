(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;


  var C = AllDogs.constants;
  var WORLD_HEIGHT = C.WORLD_HEIGHT;
  var REACH = C.REACH;
  var PLAYER_HALF_WIDTH = C.PLAYER_HALF_WIDTH;
  var DROP_PICKUP_RADIUS = 1.2;
  var SMELT_TIME = 10;
  var SMELT_RECIPES = { dirt: { id: 'clay', qty: 1 } };


  var blocks = AllDogs.blocks;
  var BLOCK = blocks.BLOCK;
  var BLOCK_DEFS = blocks.BLOCK_DEFS;
  var ITEMS = blocks.ITEMS;
  var orderEntries = blocks.orderEntries;


  var craftingApi = AllDogs.crafting;


  class Game {
    constructor(container) {
      this.container = container;
      this.inventoryOpen = false;
this.started = false;
      this.creative = false;
      this.selectedItem = null;
      this.hotbarSlot = 0;
      this.craftInputs = [null, null, null];
      this.furnaces = {};
      this.openFurnaceKey = null;
      this.target = null;
      this.targetEntity = null;
      this.worldMeshes = [];
      this.structureEntities = {};
      this.target = null;
      this.chunkSize = C.CHUNK_SIZE;


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
        self.hud.flash('Selected ' + ITEMS[id].name);
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
      this.renderDistance = (AllDogs.constants.RENDER_DISTANCE != null)
        ? AllDogs.constants.RENDER_DISTANCE : 5;
      this.chunksPerFrame = 2;
      this.player.spawn(zone.spawn.x, zone.spawn.y, zone.spawn.z);
      this.world.updateChunks(
        this.player.pos.x, this.player.pos.z,
        this.renderDistance, this.chunkSize, this.worldGroup, 9
      );
      this.worldMeshes = this.world.collectMeshes();
      this.syncStructureChunks();
      this.spawnZoneEntities(zone);
      this.hud.setZone(this.zones.name());


      this.bindEvents();
      this.hud.showOverlay('Click to start');
    }


    bindEvents() {
      var canvas = this.renderer.domElement;
      var self = this;
      this.input.listen();


      canvas.addEventListener('mousedown', function (e) {
        if (!self.input.locked || self.inventoryOpen || self.signEditor.active) return;
        if (e.button === 0) self.tryBreak();
        else if (e.button === 2) self.tryPlace();
      });


      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      document.addEventListener('contextmenu', function (e) { e.preventDefault(); });


      this.input.onLockChange = function () {
        if (self.input.locked) {
          self.started = true;
          self.menuDebug.hide();
          self.hud.hideOverlay();
        } else if (!self.inventoryOpen && !self.signEditor.active) {
          self.hud.showOverlay(self.started ? 'Click to resume' : 'Click to start');
        }
      };


      document.getElementById('overlay').addEventListener('click', function () {
        if (self.menuDebug.visible) return;
        self.enterFullscreen();
        self.input.requestLock();
      });


      document.getElementById('overlay-creative').addEventListener('click', function () {
        if (self.menuDebug.visible) return;
        self.enterCreative();
        self.enterFullscreen();
        self.input.requestLock();
      });


      document.getElementById('overlay-instructions').addEventListener('click', function (e) {
        if (self.menuDebug.visible) return;
        e.stopPropagation();
        window.location.href = 'controls.html';
      });


      window.addEventListener('beforeunload', function (e) {
        if (!self.input.locked || self.inventoryOpen) return;
        e.preventDefault();
        e.returnValue = '';
      });
    }


    enterFullscreen() {
      var el = document.documentElement;
      var fn =
        el.requestFullscreen ||
        el.webkitRequestFullscreen ||
        el.mozRequestFullScreen ||
        el.msRequestFullscreen;
      if (fn) {
        var p = fn.call(el);
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    }


    isFullscreen() {
      return !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement
      );
    }


    exitFullscreen() {
      var fn =
        document.exitFullscreen ||
        document.webkitExitFullscreen ||
        document.mozCancelFullScreen;
      if (fn) fn.call(document);
    }


    enterCreative() {
      this.creative = true;
      this.inventory.setCreative();
      this.hud.flash('Creative mode: all blocks granted');
      this.refreshUI();
    }


    resize() {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }


    panelOpts() {
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
    }


    openFurnace(ctx) {
      if (!ctx) return;
      this.signEditor.close();
      var key = ctx.x + ',' + ctx.y + ',' + ctx.z;
      if (!this.furnaces[key]) {
        this.furnaces[key] = { x: ctx.x, y: ctx.y, z: ctx.z, slots: [null, null], out: null, progress: 0 };
      }
      this.openFurnaceKey = key;
      this.inventoryOpen = true;
      this.hotbar.el.classList.add('inv-open');
      this.panel.open(this.inventory, this.panelOpts());
      this.input.releaseLock();
      this.hud.flash('Furnace');
    }


    furnaceContainer() {
      if (this.openFurnaceKey && this.furnaces[this.openFurnaceKey]) {
        return this.furnaces[this.openFurnaceKey].slots;
      }
      return null;
    }


    updateFurnaces(dt) {
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
      if (any && this.inventoryOpen && this.openFurnaceKey && !this.panel.el.hidden) {
        this.panel.render(this.inventory, this.panelOpts());
      }
    }


    takeFurnaceOutput(invIdx, count) {
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
    }


    moveInvToContainer(invIdx, container, idx, count) {
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
    }


    moveContainerToInv(container, idx, invIdx, count) {
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
    }


    moveContainerToContainer(container, fromIdx, toIdx, count) {
      if (!container) return false;
      var from = container[fromIdx];
      if (!from) return false;
      if (fromIdx === toIdx) return false;
      var n = count === undefined ? from.qty : Math.min(count, from.qty);
      if (n <= 0) return false;
      var dst = container[toIdx];
      if (dst && dst.id !== from.id) return false;
      if (dst) dst.qty += n;
      else container[toIdx] = { id: from.id, qty: n };
      from.qty -= n;
      if (from.qty <= 0) container[fromIdx] = null;
      return true;
    }


    refreshUI() {
      var list = this.inventory.entries();
      if (this.selectedItem && this.inventory.count(this.selectedItem) < 1) this.selectedItem = null;
      if (!this.selectedItem) {
        var hs = this.inventory.get(this.hotbarSlot);
        if (hs) this.selectedItem = hs.id;
        else if (list.length) this.selectedItem = list[0][0];
      }
      var barSlots = [];
      for (var i = 0; i < 9; i++) barSlots.push(this.inventory.get(i));
      this.hotbar.render(barSlots, this.selectedItem);
      if (this.inventoryOpen) {
        this.panel.render(this.inventory, this.panelOpts());
      }
    }


    selectedSlot() {
      if (this.creative) {
        return this.selectedItem ? [this.selectedItem, 999] : null;
      }
      var idx = this.inventory.indexOf(this.selectedItem);
      if (idx < 0) return null;
      var s = this.inventory.get(idx);
      return [s.id, s.qty];
    }


    spawnZoneEntities(zone) {
      var configs = zone.entities();
      for (var i = 0; i < configs.length; i++) {
        var e = this.entityManager.create(configs[i].type, configs[i]);
        if (e) {
          this.entityManager.add(e);
          if (e.solidBlock) this.world.addCollider(e);
        }
      }
    }


    openSignEditor(entity) {
      if (this.inventoryOpen || this.signEditor.active) return;
      this.highlight.visible = false;
      this.signEditor.open(entity);
      this.input.releaseLock();
    }


    closeSignEditor() {
      this.signEditor.close();
      if (!this.inventoryOpen) this.input.requestLock();
    }


    handleKeys() {
      if (this.signEditor.active) {
        this.input.resetLook();
        return;
      }
      if (this.input.consumePressed('F3')) {
        if (this.started) this.debug.toggle();
        else this.menuDebug.toggle();
        return;
      }
      if (this.input.consumePressed('KeyE')) {
        this.toggleInventory();
        return;
      }
      if (this.input.consumePressed('KeyQ')) {
        this.dropSelected();
        return;
      }


      var wheel = this.input.takeWheel();
      if (wheel !== 0) this.cycleSlot(wheel);


      for (var i = 1; i <= 9; i++) {
        if (this.input.consumePressed('Digit' + i)) this.selectSlot(i - 1);
      }
    }


    toggleInventory() {
      if (this.inventoryOpen) {
        this.panel.close();
        this.inventoryOpen = false;
        this.hotbar.el.classList.remove('inv-open');
        this.hud.setHint(this.hud.baseHint);
        if (!this.input.locked) this.input.requestLock();
      } else {
        if (!this.input.locked) return;
        this.inventoryOpen = true;
        this.hotbar.el.classList.add('inv-open');
        this.panel.open(this.inventory, this.panelOpts());
        this.input.releaseLock();
      }
    }


    cycleSlot(dir) {
      if (this.creative) {
        var list = orderEntries(this.inventory.entries());
        if (list.length === 0) return;
        var cur = this.selectedItem;
        var idx = list.findIndex(function (pair) { return pair[0] === cur; });
        if (idx < 0) idx = 0;
        var next = (idx + dir + list.length) % list.length;
        this.selectedItem = list[next][0];
        this.refreshUI();
        return;
      }
      this.hotbarSlot = (this.hotbarSlot + dir + 9) % 9;
      var s = this.inventory.get(this.hotbarSlot);
      this.selectedItem = s ? s.id : null;
      this.refreshUI();
    }


    selectSlot(idx) {
      if (this.creative) {
        var list = orderEntries(this.inventory.entries());
        if (list[idx]) this.selectedItem = list[idx][0];
        this.refreshUI();
        return;
      }
      if (idx < 0 || idx >= 9) return;
      this.hotbarSlot = idx;
      var s = this.inventory.get(idx);
      this.selectedItem = s ? s.id : null;
      this.refreshUI();
    }


    dropSelected() {
      var slot = this.selectedSlot();
      if (!slot) return;
      var itemId = slot[0];
      var x = this.player.pos.x - Math.sin(this.player.yaw) * 1.2;
      var z = this.player.pos.z - Math.cos(this.player.yaw) * 1.2;
      if (!this.drops.drop(itemId, 1, x, z, this.world, this.clock.getElapsedTime(), Math.floor(this.player.pos.y))) {
        this.hud.flash('Cannot drop there.');
        return;
      }
      this.inventory.remove(itemId, 1);
      this.refreshUI();
      this.hud.flash('-1 ' + ITEMS[itemId].name);
    }


    collectDrops() {
      var self = this;
      var picked = this.drops.pickupNear(
        this.player.pos.x, this.player.pos.y, this.player.pos.z,
        DROP_PICKUP_RADIUS, this.clock.getElapsedTime(),
        function (id) { return self.inventory.canHold(id); }
      );
      if (!picked.length) return;
      var msg = [];
      for (var i = 0; i < picked.length; i++) {
        this.inventory.add(picked[i].itemId, picked[i].qty);
        msg.push('+' + picked[i].qty + ' ' + ITEMS[picked[i].itemId].name);
      }
      this.refreshUI();
      this.hud.flash(msg.join(' '));
    }


    updateTarget() {
      var hit = this.raycaster.cast(this.worldMeshes);
      this.target = hit;
      this.targetEntity = null;
      if (this.input.locked && !this.inventoryOpen && !this.signEditor.active) {
        var rayHit = this.entityManager.raycast(this.camera, REACH);
        if (rayHit) this.targetEntity = rayHit.entity;
      }


      if (this.targetEntity) {
        var b = this.targetEntity.bounds;
        this.highlight.visible = true;
        this.highlight.position.set(
          (b.min.x + b.max.x) / 2,
          (b.min.y + b.max.y) / 2,
          (b.min.z + b.max.z) / 2
        );
        this.highlight.scale.set(
          b.max.x - b.min.x,
          b.max.y - b.min.y,
          b.max.z - b.min.z
        );
      } else if (hit) {
        this.highlight.visible = true;
        this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
        this.highlight.scale.set(1, 1, 1);
      } else {
        this.highlight.visible = false;
      }
    }


    tryBreak() {
      if (this.targetEntity) {
        var ent = this.targetEntity;
        var itemId = ent.itemId || null;
        if (ent.solidBlock) this.world.removeCollider(ent);
        this.entityManager.remove(ent);
        this.targetEntity = null;
        if (itemId && !this.creative) {
          if (this.inventory.add(itemId, 1)) {
            this.hud.flash('+1 ' + ITEMS[itemId].name);
          } else {
            this.hud.flash('Inventory full!');
          }
          this.refreshUI();
        } else {
          this.hud.flash('Broke the ' + ent.type);
        }
        return;
      }
      var t = this.target;
      if (!t) return;
      var def = BLOCK_DEFS[t.blockId];
      if (def && def.schema && def.schema.onClick && (this.player.isCrouching() || this.player.isCrawling())) {
        try { def.schema.onClick({ game: this, world: this.world, player: this.player, x: t.x, y: t.y, z: t.z, blockId: t.blockId }); } catch (err) {}
        return;
      }
      if (!def || !def.breakable) {
        this.hud.flash('This block cannot be removed.');
        return;
      }
      if (def.needsTool && !this.creative && this.inventory.count(def.needsTool) < 1) {
        this.hud.flash('You need a pickaxe to mine Stone. Craft it from planks and sticks!');
        return;
      }
      if (def.schema && def.schema.onDestroy) {
        try { def.schema.onDestroy({ game: this, world: this.world, player: this.player, x: t.x, y: t.y, z: t.z, blockId: t.blockId }); } catch (err) {}
      }
      this.world.set(t.x, t.y, t.z, BLOCK.AIR);
      var drop = def.drop;
      if (drop && !this.creative) {
        if (this.inventory.add(drop, 1)) {
          this.hud.flash('+1 ' + ITEMS[drop].name);
        } else {
          this.drops.drop(drop, 1, t.x + 0.5, t.z + 0.5, this.world, this.clock.getElapsedTime(), t.y + 1);
          this.hud.flash('Inventory full! Drop stayed behind.');
        }
      }
      this.rebuildChunksFor(t.x, t.y, t.z);
      this.refreshUI();
    }


    tryPlace() {
      if (this.targetEntity) {
        this.targetEntity.interact(this);
        return;
      }
      var t = this.target;
      if (t) {
        var pdef = BLOCK_DEFS[t.blockId];
        if (pdef && pdef.schema && pdef.schema.onClick) {
          try { pdef.schema.onClick({ game: this, world: this.world, player: this.player, x: t.x, y: t.y, z: t.z, blockId: t.blockId }); } catch (err) {}
          return;
        }
      }
      var slot = this.selectedSlot();
      if (!t || !slot) return;


      var itemId = slot[0];
      var baseId = ITEMS[itemId].place;
      if (baseId === undefined || baseId === null) return;


      if (typeof baseId === 'string') {
        this.tryPlaceEntity(itemId, baseId, t);
        return;
      }


      var faceAxis = t.fx !== 0 ? 'x' : t.fy !== 0 ? 'y' : 'z';
      var baseDef = BLOCK_DEFS[baseId];
      var blockId;
      if (baseDef && baseDef.axisOnly) {
        blockId = AllDogs.blocks.yawVariantId(baseId, AllDogs.blocks.yawFromFacing(
          this.player.pos.x - (t.x + 0.5),
          this.player.pos.z - (t.z + 0.5)
        ));
      } else {
        blockId = AllDogs.blocks.variantId(baseId, AllDogs.blocks.axisFromHit(t.onX, t.onY, t.onZ, faceAxis));
      }


      var px = t.x + t.fx;
      var py = t.y + t.fy;
      var pz = t.z + t.fz;


      if (py < 0 || py >= WORLD_HEIGHT) {
        this.hud.flash('Cannot place there.');
        return;
      }
      if (this.world.isSolid(px, py, pz) || this.world.solidAABBTopAt(px, py, pz) !== null) {
        this.hud.flash('Cannot place there.');
        return;
      }
      if (this.cellTouchesPlayer(px, py, pz)) {
        this.hud.flash('Cannot place inside yourself.');
        return;
      }


      if (!this.creative) this.inventory.remove(itemId, 1);
      this.world.set(px, py, pz, blockId);
      var placedDef = BLOCK_DEFS[blockId];
      if (placedDef && placedDef.schema && placedDef.schema.onPlace) {
        try { placedDef.schema.onPlace({ game: this, world: this.world, player: this.player, x: px, y: py, z: pz, blockId: blockId }); } catch (err) {}
      }
      this.rebuildChunksFor(px, py, pz);
      this.refreshUI();
    }


    cellTouchesPlayer(cx, cy, cz) {
      var minX = Math.floor(this.player.pos.x - PLAYER_HALF_WIDTH);
      var maxX = Math.floor(this.player.pos.x + PLAYER_HALF_WIDTH);
      var minY = Math.floor(this.player.pos.y);
      var maxY = Math.floor(this.player.pos.y + this.player.height() - 0.001);
      var minZ = Math.floor(this.player.pos.z - PLAYER_HALF_WIDTH);
      var maxZ = Math.floor(this.player.pos.z + PLAYER_HALF_WIDTH);
      return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY && cz >= minZ && cz <= maxZ;
    }


    tryPlaceEntity(itemId, type, t) {
      var px = t.x + t.fx;
      var py = t.y + t.fy;
      var pz = t.z + t.fz;


      if (py < 0 || py >= WORLD_HEIGHT) {
        this.hud.flash('Cannot place there.');
        return;
      }
      if (this.world.isSolid(px, py, pz)) {
        this.hud.flash('Cannot place there.');
        return;
      }


      var e = this.entityManager.create(type, {
        pos: { x: px + 0.5, y: py, z: pz + 0.5 },
        yaw: Math.atan2(
          this.player.pos.x - (px + 0.5),
          this.player.pos.z - (pz + 0.5)
        )
      });
      if (!e) return;
      if (this.entityOverlapsPlayer(e)) {
        this.hud.flash('Cannot place inside yourself.');
        return;
      }
      var eb = e.bounds;
      if (this.world.collidesAABB(eb.min.x, eb.min.y, eb.min.z, eb.max.x, eb.max.y, eb.max.z)) {
        this.hud.flash('Cannot place there.');
        return;
      }
      if (!this.creative) this.inventory.remove(itemId, 1);
      this.entityManager.add(e);
      if (e.solidBlock) this.world.addCollider(e);
      this.refreshUI();
      this.hud.flash('Placed ' + ITEMS[itemId].name);
    }


    entityOverlapsPlayer(entity) {
      var b = entity.bounds;
      var minX = this.player.pos.x - PLAYER_HALF_WIDTH;
      var maxX = this.player.pos.x + PLAYER_HALF_WIDTH;
      var minY = this.player.pos.y;
      var maxY = this.player.pos.y + this.player.height();
      var minZ = this.player.pos.z - PLAYER_HALF_WIDTH;
      var maxZ = this.player.pos.z + PLAYER_HALF_WIDTH;
      return (
        b.min.x < maxX && b.max.x > minX &&
        b.min.y < maxY && b.max.y > minY &&
        b.min.z < maxZ && b.max.z > minZ
      );
    }


    rebuildChunk(cx, cz) {
      this.world.rebuildChunk(cx, cz, this.chunkSize, this.worldGroup);
      this.worldMeshes = this.world.collectMeshes();
    }

    updateChunks() {
      var changed = this.world.updateChunks(
        this.player.pos.x,
        this.player.pos.z,
        this.renderDistance, this.chunkSize, this.worldGroup,
        this.chunksPerFrame
      );
      if (changed) {
        this.worldMeshes = this.world.collectMeshes();
        this.syncStructureChunks();
      }
    }

    syncStructureChunks() {
      if (!AllDogs.structures) return;
      var tracked = this.structureEntities;
      var live = this.world.chunkMeshes;
      for (var key of live.keys()) {
        if (tracked[key] !== undefined) continue;
        var parts = key.split(',');
        var cx = Number(parts[0]);
        var cz = Number(parts[1]);
        var made = AllDogs.structures.entitiesFor(cx, cz);
        var ids = [];
        for (var i = 0; i < made.length; i++) {
          var e = this.entityManager.create(made[i].type, made[i]);
          if (!e) continue;
          this.entityManager.add(e);
          if (e.solidBlock) this.world.addCollider(e);
          ids.push(e);
        }
        tracked[key] = ids;
      }
      for (var tkey in tracked) {
        if (live.has(tkey)) continue;
        var old = tracked[tkey];
        for (var j = 0; j < old.length; j++) {
          if (old[j].solidBlock) this.world.removeCollider(old[j]);
          this.entityManager.remove(old[j]);
        }
        delete tracked[tkey];
      }
    }


    rebuildChunksFor(x, y, z) {
      var cx = Math.floor(x / this.chunkSize);
      var cz = Math.floor(z / this.chunkSize);
      var px = cx * this.chunkSize;
      var pz = cz * this.chunkSize;
      var list = [[cx, cz]];
      if (x === px) list.push([cx - 1, cz]);
      else if (x === px + this.chunkSize - 1) list.push([cx + 1, cz]);
      if (z === pz) list.push([cx, cz - 1]);
      else if (z === pz + this.chunkSize - 1) list.push([cx, cz + 1]);
      for (var i = 0; i < list.length; i++) this.rebuildChunk(list[i][0], list[i][1]);
    }


    handleItemMove(fromIdx, fromZone, toIdx, toZone, count) {
      if (fromZone === 'out') {
        if (toZone === 'inv') return this.takeCraftOutput();
        return false;
      }
      if (fromZone === 'furnout') {
        var took = toZone === 'inv' ? this.takeFurnaceOutput(toIdx, count) : false;
        if (took) this.refreshUI();
        return took;
      }
      var furn = this.furnaceContainer();
      var ok = false;
      if (fromZone === 'inv' && toZone === 'inv') {
        ok = this.inventory.move(fromIdx, toIdx, count);
      } else if (fromZone === 'inv' && toZone === 'in') {
        ok = this.placeIntoCraft(toIdx, fromIdx, count);
      } else if (fromZone === 'in' && toZone === 'inv') {
        ok = this.returnCraft(fromIdx, toIdx, count);
      } else if (fromZone === 'in' && toZone === 'in') {
        ok = this.moveCraft(fromIdx, toIdx, count);
      } else if (fromZone === 'inv' && toZone === 'furn') {
        ok = this.moveInvToContainer(fromIdx, furn, toIdx, count);
      } else if (fromZone === 'furn' && toZone === 'inv') {
        ok = this.moveContainerToInv(furn, fromIdx, toIdx, count);
      } else if (fromZone === 'furn' && toZone === 'furn') {
        ok = this.moveContainerToContainer(furn, fromIdx, toIdx, count);
      }
      if (ok) this.refreshUI();
      return ok;
    }


    placeIntoCraft(craftIdx, invIdx, count) {
      var src = this.inventory.get(invIdx);
      if (!src) return false;
      var dest = this.craftInputs[craftIdx];
      var n = count === undefined ? src.qty : Math.min(count, src.qty);
      if (dest) {
        if (dest.id !== src.id) return false;
        var merge = this.inventory.take(invIdx, n);
        if (!merge) return false;
        dest.qty += merge.qty;
        return true;
      }
      var taken = this.inventory.take(invIdx, n);
      if (!taken) return false;
      this.craftInputs[craftIdx] = taken;
      return true;
    }


    returnCraft(craftIdx, invIdx, count) {
      var c = this.craftInputs[craftIdx];
      if (!c) return false;
      var dest = this.inventory.get(invIdx);
      if (dest && dest.id !== c.id) return false;
      var n = count === undefined ? c.qty : Math.min(count, c.qty);
      if (dest) {
        dest.qty += n;
      } else {
        this.inventory.set(invIdx, { id: c.id, qty: n });
      }
      c.qty -= n;
      if (c.qty <= 0) this.craftInputs[craftIdx] = null;
      return true;
    }


    moveCraft(fromIdx, toIdx, count) {
      var a = this.craftInputs[fromIdx];
      if (!a) return false;
      if (fromIdx === toIdx) return false;
      var b = this.craftInputs[toIdx];
      var n = count === undefined ? a.qty : Math.min(count, a.qty);
      if (n <= 0) return false;
      if (b && b.id !== a.id) {
        if (n < a.qty) return false;
        this.craftInputs[fromIdx] = b;
        this.craftInputs[toIdx] = a;
        return true;
      }
      if (b) {
        b.qty += n;
      } else {
        this.craftInputs[toIdx] = { id: a.id, qty: n };
      }
      a.qty -= n;
      if (a.qty <= 0) this.craftInputs[fromIdx] = null;
      return true;
    }


    distributeStack(sourceIdx, sourceZone, targets, mode) {
      var src = sourceZone === 'in' ? this.craftInputs[sourceIdx] : this.inventory.get(sourceIdx);
      if (!src || !targets || targets.length === 0) return false;
      var n = src.qty;
      var K = targets.length;
      var one = mode === 'one';
      var base = one ? 0 : Math.floor(n / K);
      var rem = one ? 0 : n - base * K;
      var placed = 0;
      for (var i = 0; i < K && placed < n; i++) {
        var idx = targets[i];
        if (idx < 0 || idx >= this.inventory.capacity) continue;
        var share = one ? 1 : (base + (i < rem ? 1 : 0));
        if (share <= 0) continue;
        var dest = this.inventory.get(idx);
        if (dest && dest.id !== src.id) continue;
        if (dest) dest.qty += share;
        else this.inventory.set(idx, { id: src.id, qty: share });
        placed += share;
      }
      if (placed > 0) {
        if (sourceZone === 'in') {
          if (placed >= src.qty) this.craftInputs[sourceIdx] = null;
          else src.qty -= placed;
        } else {
          if (placed >= src.qty) this.inventory.set(sourceIdx, null);
          else src.qty -= placed;
        }
      }
      return placed > 0;
    }


    takeCraftOutput() {
      var res = craftingApi.resolve(this.craftInputs);
      if (!res) {
        this.hud.flash('No matching recipe.');
        return false;
      }
      if (!this.inventory.canHold(res.output[0])) {
        this.hud.flash('Inventory full!');
        return false;
      }
      craftingApi.consume(this.craftInputs, res.recipe);
      this.inventory.add(res.output[0], res.output[1]);
      this.hud.flash('Crafted ' + res.output[1] + 'x ' + ITEMS[res.output[0]].name);
      this.refreshUI();
      return true;
    }


    loop() {
      var self = this;
      requestAnimationFrame(function () { self.loop(); });
      var dt = Math.min(this.clock.getDelta(), 0.05);


      this.zones.update(dt);
      this.handleKeys();
      this.updateFurnaces(dt);
      this.updateChunks();
      this.drops.update(dt, this.clock.getElapsedTime());
      this.debug.update(this, dt);


      if (this.input.locked && !this.inventoryOpen) {
        this.player.update(dt, this.input, this.world);
        this.entityManager.update(dt, this);
        this.updateTarget();
        this.collectDrops();
      }


      this.staminaBar.update(this.player);


      this.renderer.render(this.scene, this.camera);
    }


    start() {
      this.clock = new THREE.Clock();
      this.hud.setBaseHint('');
      this.refreshUI();
      this.loop();
    }
  }


  AllDogs.Game = Game;
})();