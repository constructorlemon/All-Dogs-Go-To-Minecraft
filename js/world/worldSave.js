(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var VERSION = 1;

  function round(v) {
    return Math.round(v * 1000) / 1000;
  }

  function encodeLines(lines) {
    return encodeURIComponent(JSON.stringify(Array.isArray(lines) ? lines : []));
  }

  function decodeLines(text) {
    try {
      var value = JSON.parse(decodeURIComponent(text));
      return Array.isArray(value) ? value : [];
    } catch (err) {
      return [];
    }
  }

  function entityPos(entity) {
    var p = (entity && typeof entity.savePos === 'function') ? entity.savePos() : entity.pos;
    return { x: round(p.x), y: round(p.y), z: round(p.z) };
  }

  function entityKey(type, x, y, z) {
    return type + '@' + round(x) + ',' + round(y) + ',' + round(z);
  }

  function serialize(game) {
    var lines = [];
    lines.push('version=' + VERSION);
    var seed = AllDogs.worldgen && AllDogs.worldgen.getSeed
      ? AllDogs.worldgen.getSeed()
      : (AllDogs.constants.SEED || 0);
    lines.push('seed=' + seed);
    lines.push('creative=' + (game.creative ? 1 : 0));

    var p = game.player;
    lines.push('player=' + [
      round(p.pos.x), round(p.pos.y), round(p.pos.z),
      round(p.yaw || 0), round(p.pitch || 0)
    ].join(','));

    for (var pair of game.world.overrides) {
      var parts = pair[0].split(',');
      lines.push('block=' + parts[0] + ',' + parts[1] + ',' + parts[2] + ',' + pair[1]);
    }

    var entities = game.entityManager.entities;
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (e.generated) continue;
      var ep = entityPos(e);
      var extra = e.type === 'sign' ? encodeLines(e.text) : '';
      lines.push('placed=' + e.type + ',' + ep.x + ',' + ep.y + ',' + ep.z + ',' +
        round(e.yaw || 0) + ',' + extra);
    }

    var removed = game.entityRemovals || {};
    for (var rk in removed) {
      var r = removed[rk];
      lines.push('removed=' + r.type + ',' + r.x + ',' + r.y + ',' + r.z);
    }

    var edits = game.signTextEdits || {};
    for (var sk in edits) {
      var s = edits[sk];
      lines.push('signtext=' + s.x + ',' + s.y + ',' + s.z + ',' + encodeLines(s.text));
    }

    return lines.join('\n') + '\n';
  }

  function parse(text) {
    var data = {
      version: 0,
      seed: null,
      creative: false,
      player: null,
      blocks: [],
      placed: [],
      removed: {},
      signText: {}
    };
    var lines = String(text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#') continue;
      var eq = line.indexOf('=');
      if (eq < 0) continue;
      var key = line.slice(0, eq);
      var val = line.slice(eq + 1);

      if (key === 'version') {
        data.version = Number(val) || 0;
      } else if (key === 'seed') {
        data.seed = Number(val);
      } else if (key === 'creative') {
        data.creative = val === '1' || val === 'true';
      } else if (key === 'player') {
        var pp = val.split(',').map(Number);
        data.player = {
          x: pp[0] || 0, y: pp[1] || 0, z: pp[2] || 0,
          yaw: pp[3] || 0, pitch: pp[4] || 0
        };
      } else if (key === 'block') {
        var b = val.split(',').map(Number);
        if (b.length >= 4) data.blocks.push([b[0], b[1], b[2], b[3]]);
      } else if (key === 'placed') {
        var c = val.split(',');
        if (c.length >= 5) {
          var rec = {
            type: c[0],
            x: Number(c[1]),
            y: Number(c[2]),
            z: Number(c[3]),
            yaw: Number(c[4]) || 0,
            text: c[5] ? decodeLines(c.slice(5).join(',')) : null
          };
          data.placed.push(rec);
        }
      } else if (key === 'removed') {
        var rr = val.split(',');
        if (rr.length >= 4) {
          var rpos = { type: rr[0], x: Number(rr[1]), y: Number(rr[2]), z: Number(rr[3]) };
          data.removed[entityKey(rpos.type, rpos.x, rpos.y, rpos.z)] = rpos;
        }
      } else if (key === 'signtext') {
        var ss = val.split(',');
        if (ss.length >= 4) {
          var spos = {
            x: Number(ss[0]), y: Number(ss[1]), z: Number(ss[2]),
            text: decodeLines(ss.slice(3).join(','))
          };
          data.signText[entityKey('sign', spos.x, spos.y, spos.z)] = spos;
        }
      }
    }
    return data;
  }

  function apply(game, data) {
    if (!data) return false;
    var world = game.world;
    var affected = {};

    for (var i = 0; i < data.blocks.length; i++) {
      var b = data.blocks[i];
      world.set(b[0], b[1], b[2], b[3]);
      affected[Math.floor(b[0] / game.chunkSize) + ',' + Math.floor(b[2] / game.chunkSize)] = true;
    }

    game.entityRemovals = data.removed || {};
    var entities = game.entityManager.entities;
    for (var rk in game.entityRemovals) {
      var r = game.entityRemovals[rk];
      for (var j = entities.length - 1; j >= 0; j--) {
        var ent = entities[j];
        if (!ent.generated) continue;
        var ep = entityPos(ent);
        if (entityKey(ent.type, ep.x, ep.y, ep.z) !== rk) continue;
        if (ent.solidBlock) world.removeCollider(ent);
        game.entityManager.remove(ent);
      }
    }

    game.signTextEdits = data.signText || {};
    for (var sk in game.signTextEdits) {
      var s = game.signTextEdits[sk];
      var want = entityKey('sign', s.x, s.y, s.z);
      for (var m = 0; m < entities.length; m++) {
        var sign = entities[m];
        if (sign.type !== 'sign') continue;
        var sp = entityPos(sign);
        if (entityKey('sign', sp.x, sp.y, sp.z) === want) sign.setText(s.text);
      }
    }

    for (var q = 0; q < data.placed.length; q++) {
      var pr = data.placed[q];
      var opts = { pos: { x: pr.x, y: pr.y, z: pr.z }, yaw: pr.yaw };
      if (pr.text) opts.text = pr.text;
      var ne = game.entityManager.create(pr.type, opts);
      if (!ne) continue;
      game.entityManager.add(ne);
      if (ne.solidBlock) world.addCollider(ne);
    }

    for (var ck in affected) {
      if (!world.chunkMeshes.has(ck)) continue;
      var cp = ck.split(',');
      game.rebuildChunk(Number(cp[0]), Number(cp[1]));
    }

    if (data.player) {
      var player = game.player;
      player.pos.set(data.player.x, data.player.y, data.player.z);
      player.yaw = data.player.yaw;
      player.pitch = data.player.pitch;
    }

    if (data.creative && !game.creative) game.enterCreative();

    return true;
  }

  AllDogs.worldSave = {
    VERSION: VERSION,
    serialize: serialize,
    parse: parse,
    apply: apply,
    entityKey: entityKey,
    entityPos: entityPos
  };
})();
