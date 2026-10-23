(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  var blocks = AllDogs.blocks;
  var BLOCK = blocks.BLOCK;
  var BLOCK_DEFS = blocks.BLOCK_DEFS;
  var CHUNK_SIZE = AllDogs.constants.CHUNK_SIZE;
  var WORLD_HEIGHT = AllDogs.constants.WORLD_HEIGHT;

  var FACES = [
    { d: [1, 0, 0], planeIdx: 0, uIdx: 2, vIdx: 1, corners: [[0, 0], [0, 1], [1, 1], [1, 0]] },
    { d: [-1, 0, 0], planeIdx: 0, uIdx: 2, vIdx: 1, corners: [[1, 0], [1, 1], [0, 1], [0, 0]] },
    { d: [0, 1, 0], planeIdx: 1, uIdx: 0, vIdx: 2, corners: [[0, 1], [1, 1], [1, 0], [0, 0]] },
    { d: [0, -1, 0], planeIdx: 1, uIdx: 0, vIdx: 2, corners: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { d: [0, 0, 1], planeIdx: 2, uIdx: 0, vIdx: 1, corners: [[1, 0], [1, 1], [0, 1], [0, 0]] },
    { d: [0, 0, -1], planeIdx: 2, uIdx: 0, vIdx: 1, corners: [[0, 0], [0, 1], [1, 1], [1, 0]] }
  ];

  var FACE_EPS = 0.001;

  function capFace(axis, dir) {
    if (axis === 'x') return dir[0] !== 0;
    if (axis === 'z') return dir[2] !== 0;
    return dir[1] !== 0;
  }

  var AXIS_FACE_CELLS = {
    x: [2, 3, 1, 0, 4, 5],
    y: [0, 1, 2, 3, 4, 5],
    z: [0, 1, 5, 4, 2, 3]
  };

  var FRONT_CELL = 5;

  function rotateY(d, turns) {
    var x = d[0], z = d[2];
    for (var i = 0; i < ((turns % 4) + 4) % 4; i++) {
      var nx = z;
      z = -x;
      x = nx;
    }
    return [x, d[1], z];
  }

  function sameDir(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  var YAW_FACE_CELLS = [];
  for (var yq = 0; yq < 4; yq++) {
    var yremap = [];
    for (var yf = 0; yf < 6; yf++) {
      var want = rotateY(FACES[yf].d, 4 - yq);
      for (var yc = 0; yc < 6; yc++) {
        if (sameDir(FACES[yc].d, want)) { yremap[yf] = yc; break; }
      }
    }
    YAW_FACE_CELLS.push(yremap);
  }

  function faceKey(tex, f, axis, yaw) {
    if (tex === 'grass') return f === 2 ? 'grass_top' : 'grass_side';
    if (tex === 'log') return capFace(axis || 'y', FACES[f].d) ? 'log_top' : 'log_side';
    if (blocks.isModTextureKey(tex)) {
      var cell = f;
      if (yaw != null && YAW_FACE_CELLS[yaw]) {
        cell = YAW_FACE_CELLS[yaw][f];
      } else if (blocks.isDirectionalKey(tex)) {
        var remap = AXIS_FACE_CELLS[axis];
        if (remap) cell = remap[f];
      }
      return tex + '#' + cell;
    }
    return tex;
  }

  function axisSize(axis, chunkSize) {
    return axis === 1 ? WORLD_HEIGHT : chunkSize;
  }

  function makeGrid(u, v) {
    return { u: u, v: v, data: new Int32Array(u * v) };
  }

  class World {
    constructor() {
      this.overrides = new Map();
      this.editsByChunk = new Map();
      this.chunkData = new Map();
      this.chunkMeshes = new Map();
      this.colliders = [];
      this.activeJob = null;
    }

    clear() {
      this.activeJob = null;
      var keys = Array.from(this.chunkMeshes.keys());
      for (var i = 0; i < keys.length; i++) this.disposeChunk(keys[i]);
      this.chunkMeshes.clear();
      this.chunkData.clear();
      this.overrides.clear();
      this.editsByChunk.clear();
      this.colliders.length = 0;
    }

    addCollider(entity) {
      this.colliders.push(entity);
    }

    removeCollider(entity) {
      var i = this.colliders.indexOf(entity);
      if (i >= 0) this.colliders.splice(i, 1);
    }

    collidesAABB(minX, minY, minZ, maxX, maxY, maxZ) {
      for (var i = 0; i < this.colliders.length; i++) {
        var b = this.colliders[i].bounds;
        if (
          minX < b.max.x && maxX > b.min.x &&
          minY < b.max.y && maxY > b.min.y &&
          minZ < b.max.z && maxZ > b.min.z
        ) {
          return true;
        }
      }
      return false;
    }

    solidAABBTopAt(cx, cy, cz) {
      var x = cx + 0.5;
      var y = cy + 0.5;
      var z = cz + 0.5;
      for (var i = 0; i < this.colliders.length; i++) {
        var b = this.colliders[i].bounds;
        if (
          x >= b.min.x && x <= b.max.x &&
          y >= b.min.y && y <= b.max.y &&
          z >= b.min.z && z <= b.max.z
        ) {
          return b.max.y;
        }
      }
      return null;
    }

    stepLandingY(minX, minZ, maxX, maxZ, fromY, stepHeight) {
      var maxY = fromY + stepHeight;
      var landing = null;
      for (var i = 0; i < this.colliders.length; i++) {
        var b = this.colliders[i].bounds;
        if (
          b.max.x > minX && b.min.x < maxX &&
          b.max.z > minZ && b.min.z < maxZ
        ) {
          var top = b.max.y;
          if (top > fromY && top <= maxY) {
            if (landing === null || top > landing) landing = top;
          }
        }
      }
      var x0 = Math.floor(minX);
      var x1 = Math.floor(maxX);
      var z0 = Math.floor(minZ);
      var z1 = Math.floor(maxZ);
      var y0 = Math.max(0, Math.floor(fromY));
      var y1 = Math.min(WORLD_HEIGHT - 1, Math.floor(maxY));
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          for (var z = z0; z <= z1; z++) {
            if (this.isSolid(x, y, z)) {
              var top = y + 1;
              if (top > fromY && top <= maxY) {
                if (landing === null || top > landing) landing = top;
              }
            }
          }
        }
      }
      return landing;
    }

    set(x, y, z, id) {
      if (y < 0 || y >= WORLD_HEIGHT) return;
      var gen = this.generatedAt(x, y, z);
      var cx = Math.floor(x / CHUNK_SIZE);
      var cz = Math.floor(z / CHUNK_SIZE);
      var ckey = cx + ',' + cz;
      var gkey = x + ',' + y + ',' + z;
      var eMap = this.editsByChunk.get(ckey);
      if (id === gen) {
        this.overrides.delete(gkey);
        if (eMap) eMap.delete(gkey);
      } else {
        this.overrides.set(gkey, id);
        if (!eMap) { eMap = new Map(); this.editsByChunk.set(ckey, eMap); }
        eMap.set(gkey, id);
      }
      var data = this.chunkData.get(ckey);
      if (data) {
        var lx = x - cx * CHUNK_SIZE;
        var lz = z - cz * CHUNK_SIZE;
        data[(lx * CHUNK_SIZE + lz) * WORLD_HEIGHT + y] = id;
      }
    }

    generatedAt(x, y, z) {
      if (AllDogs.structures) {
        var s = AllDogs.structures.blockAt(x, y, z);
        if (s !== null && s !== undefined) return s;
      }
      return AllDogs.worldgen.blockAt(x, y, z);
    }

    get(x, y, z) {
      if (y < 0) return BLOCK.BEDROCK;
      if (y >= WORLD_HEIGHT) return BLOCK.AIR;
      var cx = Math.floor(x / CHUNK_SIZE);
      var cz = Math.floor(z / CHUNK_SIZE);
      var data = this.chunkData.get(cx + ',' + cz);
      if (data) {
        var lx = x - cx * CHUNK_SIZE;
        var lz = z - cz * CHUNK_SIZE;
        return data[(lx * CHUNK_SIZE + lz) * WORLD_HEIGHT + y];
      }
      var ov = this.overrides.get(x + ',' + y + ',' + z);
      if (ov !== undefined) return ov;
      return AllDogs.worldgen.blockAt(x, y, z);
    }

    isSolid(x, y, z) {
      return this.get(x, y, z) !== BLOCK.AIR;
    }

    isFaceExposed(x, y, z) {
      if (y < 0 || y >= WORLD_HEIGHT) return true;
      var id = this.get(x, y, z);
      if (id === BLOCK.AIR) return true;
      var def = BLOCK_DEFS[id];
      if (!def) return true;
      return !AllDogs.textures.occludesTexture(def.texture);
    }

    buildChunkMeshes(chunkSize, group) {
      var meshes = [];
      for (var ckey of this.chunkData.keys()) {
        var parts = ckey.split(',');
        var built = this.buildChunk(Number(parts[0]), Number(parts[1]), chunkSize, group);
        for (var j = 0; j < built.length; j++) meshes.push(built[j]);
      }
      return meshes;
    }

    buildChunk(cx, cz, chunkSize, group) {
      var job = this.beginChunk(cx, cz, chunkSize, group);
      var guard = 0;
      while (job.phase !== 'done' && guard < 1000000) { this.stepChunk(job, Infinity); guard++; }
      this.chunkMeshes.set(cx + ',' + cz, { cx: cx, cz: cz, meshes: job.meshes });
      return job.meshes;
    }

    beginChunk(cx, cz, chunkSize, group) {
      return {
        cx: cx,
        cz: cz,
        chunkSize: chunkSize,
        group: group,
        cx0: cx * chunkSize,
        cz0: cz * chunkSize,
        phase: 'data',
        meshes: [],
        data: null,
        col: 0,
        treeI: 0,
        faceGrids: null,
        keyIds: null,
        idToKey: null,
        flat: null,
        greedyF: 0,
        greedyPlaneList: null,
        greedyPi: 0,
        greedyGrid: null,
        greedyV: 0,
        greedyHandled: null,
        quadsByKey: null,
        assembleKeys: null,
        assembleI: 0,
        quads2: null
      };
    }

    disposeChunk(ckey) {
      var entry = this.chunkMeshes.get(ckey);
      if (!entry) return;
      for (var i = 0; i < entry.meshes.length; i++) {
        var mesh = entry.meshes[i];
        if (mesh.parent) mesh.parent.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
      }
      this.chunkMeshes.delete(ckey);
      if (!this.editsByChunk.has(ckey)) this.chunkData.delete(ckey);
    }

    collectMeshes() {
      var out = [];
      for (var entry of this.chunkMeshes.values()) {
        for (var i = 0; i < entry.meshes.length; i++) out.push(entry.meshes[i]);
      }
      return out;
    }

    rebuildChunk(cx, cz, chunkSize, group) {
      this.disposeChunk(cx + ',' + cz);
      this.buildChunk(cx, cz, chunkSize, group);
    }

    updateChunks(px, pz, radius, chunkSize, group, maxPerFrame, budgetMs) {
      var ccx = Math.floor(px / chunkSize);
      var ccz = Math.floor(pz / chunkSize);
      var changed = false;
      var now = function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
      var start = now();
      var budget = budgetMs || 6;

      var keep = radius + 1;
      var remove = [];
      for (var entry of this.chunkMeshes.values()) {
        var adx = Math.abs(entry.cx - ccx);
        var adz = Math.abs(entry.cz - ccz);
        if (adx > keep || adz > keep) remove.push(entry.cx + ',' + entry.cz);
      }
      for (var i = 0; i < remove.length; i++) {
        this.disposeChunk(remove[i]);
        changed = true;
        if (now() - start > budget) break;
      }

      if (this.activeJob && (Math.abs(this.activeJob.cx - ccx) > keep || Math.abs(this.activeJob.cz - ccz) > keep)) {
        this.activeJob = null;
      }

      if (!this.activeJob) {
        var candidates = [];
        for (var dx = -radius; dx <= radius; dx++) {
          for (var dz = -radius; dz <= radius; dz++) {
            var cx = ccx + dx;
            var cz = ccz + dz;
            if (this.chunkMeshes.has(cx + ',' + cz)) continue;
            candidates.push([dx * dx + dz * dz, cx, cz]);
          }
        }
        if (!candidates.length) return changed;
        candidates.sort(function (a, b) { return a[0] - b[0]; });
        this.activeJob = this.beginChunk(candidates[0][1], candidates[0][2], chunkSize, group);
      }

      var budgetCount = maxPerFrame || 4;
      var built = 0;
      while (this.activeJob) {
        this.stepChunk(this.activeJob, start + budget);
        if (this.activeJob.phase === 'done') {
          var job = this.activeJob;
          this.chunkMeshes.set(job.cx + ',' + job.cz, { cx: job.cx, cz: job.cz, meshes: job.meshes });
          this.activeJob = null;
          changed = true;
          built++;
          if (built >= budgetCount || now() - start > budget) break;
          this.activeJob = this.nextCandidate(ccx, ccz, radius, chunkSize, group);
          if (!this.activeJob) break;
        } else if (now() - start > budget) {
          break;
        }
      }
      return changed;
    }

    nextCandidate(ccx, ccz, radius, chunkSize, group) {
      var best = null;
      var bestD = Infinity;
      for (var dx = -radius; dx <= radius; dx++) {
        for (var dz = -radius; dz <= radius; dz++) {
          var cx = ccx + dx;
          var cz = ccz + dz;
          if (this.chunkMeshes.has(cx + ',' + cz)) continue;
          var d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = [cx, cz]; }
        }
      }
      if (!best) return null;
      return this.beginChunk(best[0], best[1], chunkSize, group);
    }

    putLocal(data, cx0, cz0, x, y, z, id) {
      if (y < 0 || y >= WORLD_HEIGHT) return;
      var lx = x - cx0;
      var lz = z - cz0;
      if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE) return;
      var idx = (lx * CHUNK_SIZE + lz) * WORLD_HEIGHT + y;
      if (id === BLOCK.LEAVES && data[idx] === BLOCK.LOG) return;
      data[idx] = id;
    }

    writeTree(data, cx0, cz0, tx, tz) {
      var ground = AllDogs.worldgen.heightAt(tx, tz);
      var trunk = AllDogs.worldgen.trunkHeight(tx, tz);
      var top = ground + trunk;
      for (var y = ground + 1; y <= top; y++) {
        this.putLocal(data, cx0, cz0, tx, y, tz, BLOCK.LOG);
      }
      for (var dy = -1; dy <= 2; dy++) {
        var rad = dy <= 0 ? 2 : dy === 1 ? 1 : 0;
        for (var dx = -rad; dx <= rad; dx++) {
          for (var dz = -rad; dz <= rad; dz++) {
            if (dx === 0 && dz === 0) continue;
            this.putLocal(data, cx0, cz0, tx + dx, top + dy, tz + dz, BLOCK.LEAVES);
          }
        }
      }
    }

    ensureChunk(cx, cz) {
      var ckey = cx + ',' + cz;
      var cached = this.chunkData.get(ckey);
      if (cached) return cached;
      var job = this.beginChunk(cx, cz, CHUNK_SIZE, null);
      var guard = 0;
      while (job.phase !== 'done' && guard < 1000000) { this.stepChunk(job, Infinity); guard++; }
      return this.chunkData.get(ckey);
    }

    stepChunk(job, deadline) {
      var now = function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
      while (job.phase !== 'done') {
        this.stepChunkPhase(job, deadline);
        if (now() > deadline) return;
      }
    }

    stepChunkPhase(job, deadline) {
      if (job.phase === 'data') return this.stepDataPhase(job, deadline);
      if (job.phase === 'mesh') return this.stepMeshPhase(job, deadline);
      if (job.phase === 'greedy') return this.stepGreedyPhase(job, deadline);
      if (job.phase === 'assemble') return this.stepAssemblePhase(job, deadline);
      job.phase = 'done';
    }

    stepDataPhase(job, deadline) {
      var cx = job.cx;
      var cz = job.cz;
      var cx0 = job.cx0 = cx * CHUNK_SIZE;
      var cz0 = job.cz0 = cz * CHUNK_SIZE;
      var H = WORLD_HEIGHT;
      if (!job.data) {
        job.data = new Int16Array(CHUNK_SIZE * CHUNK_SIZE * H);
        job.col = 0;
        job.sub = 'terrain';
        job.treeGx = cx0 - 2;
        job.treeGz = cz0 - 2;
        job.treeEndX = cx0 + CHUNK_SIZE + 2;
        job.treeEndZ = cz0 + CHUNK_SIZE + 2;
      }
      var data = job.data;

      if (job.sub === 'terrain') {
        var batch = 0;
        var nowT = function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
        while (job.col < CHUNK_SIZE) {
          var lx = job.col;
          var x = cx0 + lx;
          for (var lz = 0; lz < CHUNK_SIZE; lz++) {
            var z = cz0 + lz;
            var h = AllDogs.worldgen.heightAt(x, z);
            var sand = AllDogs.worldgen.isSandPatch(x, z);
            var col = (lx * CHUNK_SIZE + lz) * H;
            for (var y = 0; y <= h; y++) {
              var b = BLOCK.STONE;
              if (y === 0) b = BLOCK.BEDROCK;
              else if (y === h) b = sand ? BLOCK.SAND : BLOCK.GRASS;
              else if (y > h - 3) b = BLOCK.DIRT;
              data[col + y] = b;
            }
          }
          job.col++;
          if (++batch >= 2 && nowT() > deadline) return;
          if (batch >= 16) return;
        }
        job.sub = 'trees';
        job.gx = job.treeGx;
        job.gz = job.treeGz;
      }

      if (job.sub === 'trees') {
        var tbatch = 0;
        var nowTr = function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
        while (job.gx < job.treeEndX) {
          if (AllDogs.worldgen.hasTree(job.gx, job.gz)) this.writeTree(data, cx0, cz0, job.gx, job.gz);
          job.gz++;
          if (job.gz >= job.treeEndZ) { job.gz = job.treeGz; job.gx++; }
          if (nowTr() > deadline) return;
          if (++tbatch >= 400) return;
        }
        job.sub = 'stamp';
      }

      if (job.sub === 'stamp') {
        if (AllDogs.structures) AllDogs.structures.stamp(this, data, cx, cz);
        job.sub = 'edits';
      }

      if (job.sub === 'edits') {
        var eMap = this.editsByChunk.get(cx + ',' + cz);
        if (eMap) {
          for (var entry of eMap) {
            var parts = entry[0].split(',');
            var elx = Number(parts[0]) - cx0;
            var elz = Number(parts[2]) - cz0;
            if (elx < 0 || elz < 0 || elx >= CHUNK_SIZE || elz >= CHUNK_SIZE) continue;
            data[(elx * CHUNK_SIZE + elz) * H + Number(parts[1])] = entry[1];
          }
        }
        this.chunkData.set(cx + ',' + cz, data);
        job.phase = 'mesh';
        job.faceGrids = [];
        for (var f2 = 0; f2 < FACES.length; f2++) job.faceGrids.push(new Map());
        job.keyIds = new Map();
        job.idToKey = [];
        for (var f3 = 0; f3 < FACES.length; f3++) {
          FACES[f3].uSize = axisSize(FACES[f3].uIdx, job.chunkSize);
          FACES[f3].vSize = axisSize(FACES[f3].vIdx, job.chunkSize);
        }
        job.lx = 0;
      }
    }

    stepMeshPhase(job, deadline) {
      var chunkSize = job.chunkSize;
      var cx0 = job.cx0;
      var cz0 = job.cz0;
      var data = job.data;
      var faceGrids = job.faceGrids;
      var self = this;
      var batch = 0;
      var nowM = function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
      while (job.lx < chunkSize) {
        var lx = job.lx;
        var x = cx0 + lx;
        for (var lz = 0; lz < chunkSize; lz++) {
          var z = cz0 + lz;
          var col = (lx * chunkSize + lz) * WORLD_HEIGHT;
          for (var y = 0; y < WORLD_HEIGHT; y++) {
            var id = data[col + y];
            if (id === BLOCK.AIR) continue;
            var def = BLOCK_DEFS[id];
            if (!def) continue;
            var tex = def.texture;
            var isTransparent = !AllDogs.textures.occludesTexture(tex);

            for (var f3 = 0; f3 < FACES.length; f3++) {
              var face = FACES[f3];
              var nx = x + face.d[0];
              var ny = y + face.d[1];
              var nz = z + face.d[2];
              if (!isTransparent) {
                if (ny >= 0 && ny < WORLD_HEIGHT) {
                  var nflx = nx - cx0;
                  var nflz = nz - cz0;
                  var nid;
                  if (nflx >= 0 && nflz >= 0 && nflx < chunkSize && nflz < chunkSize) {
                    nid = data[(nflx * chunkSize + nflz) * WORLD_HEIGHT + ny];
                  } else {
                    nid = self.get(nx, ny, nz);
                  }
                  if (nid !== BLOCK.AIR) {
                    var ndef = BLOCK_DEFS[nid];
                    if (ndef && AllDogs.textures.occludesTexture(ndef.texture)) continue;
                  }
                }
              }

              var gridU = face.uIdx === 1 ? y : (face.uIdx === 0 ? x - cx0 : z - cz0);
              var gridV = face.vIdx === 1 ? y : (face.vIdx === 0 ? x - cx0 : z - cz0);
              var plane = face.planeIdx === 0 ? x : face.planeIdx === 1 ? y : z;
              if (face.d[face.planeIdx] > 0) plane += 1;
              if (isTransparent) {
                var tnid;
                if (ny < 0 || ny >= WORLD_HEIGHT) tnid = BLOCK.BEDROCK;
                else {
                  var tflx = nx - cx0;
                  var tflz = nz - cz0;
                  if (tflx >= 0 && tflz >= 0 && tflx < chunkSize && tflz < chunkSize) {
                    tnid = data[(tflx * chunkSize + tflz) * WORLD_HEIGHT + ny];
                  } else {
                    tnid = self.get(nx, ny, nz);
                  }
                }
                if (tnid !== BLOCK.AIR) {
                  if (face.d[face.planeIdx] > 0) plane -= FACE_EPS;
                  else plane += FACE_EPS;
                }
              }

              var grids = faceGrids[f3];
              var grid = grids.get(plane);
              if (!grid) {
                grid = makeGrid(face.uSize, face.vSize);
                grids.set(plane, grid);
              }
              grid.data[gridV * grid.u + gridU] = this.keyId(job, faceKey(tex, f3, def.axis || 'y', def.yaw));
            }
          }
        }
        job.lx++;
        if (++batch >= 2 && nowM() > deadline) return;
        if (batch >= 4) return;
      }
      job.phase = 'greedy';
      job.greedyF = 0;
      job.quadsByKey = new Map();
      job.flat = [];
      for (var f4 = 0; f4 < FACES.length; f4++) {
        for (var pe of faceGrids[f4]) job.flat.push([f4, pe]);
      }
      job.greedyPi = 0;
      job.greedyGrid = null;
      job.greedyHandled = null;
      job.greedyV = 0;
    }

    keyId(job, key) {
      var id = job.keyIds.get(key);
      if (id === undefined) {
        id = job.idToKey.length + 1;
        job.keyIds.set(key, id);
        job.idToKey.push(key);
      }
      return id;
    }

    stepGreedyPhase(job, deadline) {
      if (job.greedyPi >= job.flat.length) { job.phase = 'assemble'; job.assembleI = 0; job.assembleKeys = []; for (var k of job.quadsByKey.keys()) job.assembleKeys.push(k); return; }
      var nowG = function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
      var planesThisCall = 0;
      while (job.greedyPi < job.flat.length) {
        var entry = job.flat[job.greedyPi];
        var f4 = entry[0];
        var planeEntry = entry[1];
        var grid2 = planeEntry[1];
        if (job.greedyGrid !== grid2) {
          job.greedyGrid = grid2;
          job.greedyHandled = new Uint8Array(grid2.u * grid2.v);
          job.greedyV = 0;
        }
        var handled = job.greedyHandled;
        var quadsByKey = job.quadsByKey;
        var batch = 0;
        while (job.greedyV < grid2.v) {
          var v = job.greedyV;
          for (var u = 0; u < grid2.u; u++) {
            var idx = v * grid2.u + u;
            var key = grid2.data[idx];
            if (key === 0 || handled[idx]) continue;

            var w = 1;
            while (u + w < grid2.u && grid2.data[v * grid2.u + u + w] === key && !handled[v * grid2.u + u + w]) w++;

            var h = 1;
            var rowDone = false;
            while (!rowDone && v + h < grid2.v) {
              for (var kx = u; kx < u + w; kx++) {
                if (grid2.data[(v + h) * grid2.u + kx] !== key || handled[(v + h) * grid2.u + kx]) {
                  rowDone = true;
                  break;
                }
              }
              if (!rowDone) h++;
            }

            for (var yy = v; yy < v + h; yy++) {
              for (var xx = u; xx < u + w; xx++) handled[yy * grid2.u + xx] = 1;
            }

            var quads = quadsByKey.get(key);
            if (!quads) { quads = []; quadsByKey.set(key, quads); }
            quads.push({ f: f4, u0: u, v0: v, w: w, h: h, plane: planeEntry[0] });
            u += w - 1;
          }
          job.greedyV++;
          if (++batch >= 2 && nowG() > deadline) return;
          if (batch >= 4) return;
        }
        job.greedyPi++;
        job.greedyGrid = null;
        planesThisCall++;
        if (planesThisCall >= 2 && nowG() > deadline) return;
      }
      job.phase = 'assemble';
      job.assembleI = 0;
      job.assembleKeys = [];
      for (var k2 of job.quadsByKey.keys()) job.assembleKeys.push(k2);
    }

    stepAssemblePhase(job, deadline) {
      var cx0 = job.cx0;
      var nowA = function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
      var cz0 = job.cz0;
      var group = job.group;
      var batch = 0;
      while (job.assembleI < job.assembleKeys.length) {
        var keyId = job.assembleKeys[job.assembleI];
        var key = job.idToKey[keyId - 1];
        var quads2 = job.quadsByKey.get(keyId);
        var positions = [], normals = [], uvs = [], indices = [];
        var verts = 0;

        for (var qi = 0; qi < quads2.length; qi++) {
          var q = quads2[qi];
          var qFace = FACES[q.f];
          var uMin = qFace.uIdx === 1 ? q.u0 : (qFace.uIdx === 0 ? cx0 : cz0) + q.u0;
          var vMin = qFace.vIdx === 1 ? q.v0 : (qFace.vIdx === 0 ? cx0 : cz0) + q.v0;
          for (var c = 0; c < 4; c++) {
            var cv = qFace.corners[c];
            var px = 0, py = 0, pz = 0;
            if (qFace.planeIdx === 0) px = q.plane;
            else if (qFace.planeIdx === 1) py = q.plane;
            else pz = q.plane;
            if (qFace.uIdx === 0) px = uMin + cv[0] * q.w;
            else if (qFace.uIdx === 1) py = uMin + cv[0] * q.w;
            else pz = uMin + cv[0] * q.w;
            if (qFace.vIdx === 0) px = vMin + cv[1] * q.h;
            else if (qFace.vIdx === 1) py = vMin + cv[1] * q.h;
            else pz = vMin + cv[1] * q.h;
            positions.push(px, py, pz);
            normals.push(qFace.d[0], qFace.d[1], qFace.d[2]);
            uvs.push(cv[0] * q.w, cv[1] * q.h);
          }
          indices.push(verts, verts + 1, verts + 2, verts, verts + 2, verts + 3);
          verts += 4;
        }

        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
        geo.computeBoundingSphere();

        var mesh = new THREE.Mesh(geo, AllDogs.textures.getMaterial(key));
        mesh.userData.blockId = blocks.keyToId(key);
        mesh.userData.chunkX = job.cx;
        mesh.userData.chunkZ = job.cz;
        if (group) group.add(mesh);
        job.meshes.push(mesh);

        job.assembleI++;
        if (nowA() > deadline) return;
        if (++batch >= 4) return;
      }
      job.phase = 'done';
    }
  }

  AllDogs.World = World;
})();