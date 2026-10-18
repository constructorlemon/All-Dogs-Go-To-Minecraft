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
    }

    clear() {
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
      var gen = AllDogs.worldgen.blockAt(x, y, z);
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
        var built = this.buildChunkMeshesAt(Number(parts[0]), Number(parts[1]), chunkSize, group);
        for (var j = 0; j < built.length; j++) meshes.push(built[j]);
      }
      return meshes;
    }

    buildChunk(cx, cz, chunkSize, group) {
      var built = this.buildChunkMeshesAt(cx, cz, chunkSize, group);
      this.chunkMeshes.set(cx + ',' + cz, { cx: cx, cz: cz, meshes: built });
      return built;
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

    updateChunks(px, pz, radius, chunkSize, group, maxPerFrame) {
      var ccx = Math.floor(px / chunkSize);
      var ccz = Math.floor(pz / chunkSize);
      var changed = false;

      var remove = [];
      for (var entry of this.chunkMeshes.values()) {
        if (Math.abs(entry.cx - ccx) > radius || Math.abs(entry.cz - ccz) > radius) {
          remove.push(entry.cx + ',' + entry.cz);
        }
      }
      for (var i = 0; i < remove.length; i++) {
        this.disposeChunk(remove[i]);
        changed = true;
      }

      var candidates = [];
      for (var dx = -radius; dx <= radius; dx++) {
        for (var dz = -radius; dz <= radius; dz++) {
          var cx = ccx + dx;
          var cz = ccz + dz;
          if (this.chunkMeshes.has(cx + ',' + cz)) continue;
          candidates.push([dx * dx + dz * dz, cx, cz]);
        }
      }
      if (candidates.length) {
        candidates.sort(function (a, b) { return a[0] - b[0]; });
        var budget = maxPerFrame || 4;
        var n = Math.min(budget, candidates.length);
        for (var c = 0; c < n; c++) {
          this.buildChunk(candidates[c][1], candidates[c][2], chunkSize, group);
          changed = true;
        }
      }
      return changed;
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
      var H = WORLD_HEIGHT;
      var data = new Int16Array(CHUNK_SIZE * CHUNK_SIZE * H);
      var cx0 = cx * CHUNK_SIZE;
      var cz0 = cz * CHUNK_SIZE;

      for (var lx = 0; lx < CHUNK_SIZE; lx++) {
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
      }

      for (var gx = cx0 - 2; gx < cx0 + CHUNK_SIZE + 2; gx++) {
        for (var gz = cz0 - 2; gz < cz0 + CHUNK_SIZE + 2; gz++) {
          if (AllDogs.worldgen.hasTree(gx, gz)) this.writeTree(data, cx0, cz0, gx, gz);
        }
      }

      if (AllDogs.structures) AllDogs.structures.stamp(this, data, cx, cz);

      var eMap = this.editsByChunk.get(ckey);
      if (eMap) {
        for (var entry of eMap) {
          var parts = entry[0].split(',');
          var elx = Number(parts[0]) - cx0;
          var elz = Number(parts[2]) - cz0;
          if (elx < 0 || elz < 0 || elx >= CHUNK_SIZE || elz >= CHUNK_SIZE) continue;
          data[(elx * CHUNK_SIZE + elz) * H + Number(parts[1])] = entry[1];
        }
      }

      this.chunkData.set(ckey, data);
      return data;
    }

    buildChunkMeshesAt(cx, cz, chunkSize, group) {
      var cx0 = cx * chunkSize;
      var cz0 = cz * chunkSize;

      for (var f = 0; f < FACES.length; f++) {
        FACES[f].uSize = axisSize(FACES[f].uIdx, chunkSize);
        FACES[f].vSize = axisSize(FACES[f].vIdx, chunkSize);
      }

      var keyIds = new Map();
      var idToKey = [];
      function keyId(key) {
        var id = keyIds.get(key);
        if (id === undefined) {
          id = idToKey.length + 1;
          keyIds.set(key, id);
          idToKey.push(key);
        }
        return id;
      }

      var faceGrids = [];
      for (var f2 = 0; f2 < FACES.length; f2++) faceGrids.push(new Map());

      var data = this.ensureChunk(cx, cz);
      for (var lx = 0; lx < chunkSize; lx++) {
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
              if (!isTransparent && !this.isFaceExposed(
                x + face.d[0], y + face.d[1], z + face.d[2]
              )) continue;

          var gridU = face.uIdx === 1 ? y : (face.uIdx === 0 ? x - cx0 : z - cz0);
          var gridV = face.vIdx === 1 ? y : (face.vIdx === 0 ? x - cx0 : z - cz0);
          var plane = face.planeIdx === 0 ? x : face.planeIdx === 1 ? y : z;
          if (face.d[face.planeIdx] > 0) plane += 1;
          if (isTransparent && this.get(
            x + face.d[0], y + face.d[1], z + face.d[2]
          ) !== BLOCK.AIR) {
            if (face.d[face.planeIdx] > 0) plane -= FACE_EPS;
            else plane += FACE_EPS;
          }

          var grids = faceGrids[f3];
          var grid = grids.get(plane);
          if (!grid) {
            grid = makeGrid(face.uSize, face.vSize);
            grids.set(plane, grid);
          }
          grid.data[gridV * grid.u + gridU] = keyId(faceKey(tex, f3, def.axis || 'y', def.yaw));
            }
          }
        }
      }

      var quadsByKey = new Map();
      for (var f4 = 0; f4 < FACES.length; f4++) {
        var fFace = FACES[f4];
        for (var planeEntry of faceGrids[f4]) {
          var grid2 = planeEntry[1];
          var handled = new Uint8Array(grid2.u * grid2.v);
          for (var v = 0; v < grid2.v; v++) {
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
          }
        }
      }

      var meshes = [];
      for (var entry of quadsByKey) {
        var quads2 = entry[1];
        var key = idToKey[entry[0] - 1];
        var positions = [], normals = [], uvs = [], indices = [];
        var verts = 0;

        for (var q of quads2) {
          var qFace = FACES[q.f];
          var uMin = qFace.uIdx === 1 ? q.u0 : (qFace.uIdx === 0 ? cx0 : cz0) + q.u0;
          var vMin = qFace.vIdx === 1 ? q.v0 : (qFace.vIdx === 0 ? cx0 : cz0) + q.v0;
          for (var c = 0; c < 4; c++) {
            var cv = qFace.corners[c];
            var p = [0, 0, 0];
            p[qFace.planeIdx] = q.plane;
            p[qFace.uIdx] = uMin + cv[0] * q.w;
            p[qFace.vIdx] = vMin + cv[1] * q.h;
            positions.push(p[0], p[1], p[2]);
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
        mesh.userData.chunkX = cx;
        mesh.userData.chunkZ = cz;
        group.add(mesh);
        meshes.push(mesh);
      }

      return meshes;
    }
  }

  AllDogs.World = World;
})();