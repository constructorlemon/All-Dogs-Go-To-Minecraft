(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var container = document.getElementById('game');
  var configKey = 'adsgtm.world';

  function readConfig() {
    try { return JSON.parse(sessionStorage.getItem(configKey) || 'null'); }
    catch (err) { return null; }
  }

  function boot() {
    var config = window.ADSGTM_AUTOSTART
      ? { mode: 'new', seed: AllDogs.constants.SEED, creative: false }
      : readConfig();

    if (!config) {
      window.location.replace('index.html');
      return;
    }

    var parsed = null;
    var seed;
    if (config.mode === 'load') {
      parsed = AllDogs.worldSave.parse(config.text || '');
      seed = parsed.seed;
      if (seed === null || seed === undefined || isNaN(seed)) seed = AllDogs.constants.SEED;
    } else {
      seed = config.seed !== undefined && config.seed !== null
        ? config.seed : AllDogs.constants.SEED;
    }

    if (AllDogs.worldgen && AllDogs.worldgen.setSeed) AllDogs.worldgen.setSeed(seed);
    if (AllDogs.structures && AllDogs.structures.resetCache) AllDogs.structures.resetCache();

    preloadStructures(seed, function () {
      var game = new AllDogs.Game(container);

      if (parsed && AllDogs.worldSave) {
        AllDogs.worldSave.apply(game, parsed);
      } else if (config.creative) {
        game.enterCreative();
      }

      game.start();

      window.addEventListener('resize', function () {
        game.resize();
      });

      window.game = game;
    });
  }

  function preloadStructures(seed, done) {
    var structures = AllDogs.structures;
    var screen = document.getElementById('loading-screen');
    var fill = document.getElementById('loading-bar-fill');
    var text = document.getElementById('loading-text');
    var gridEl = document.getElementById('loading-chunk-grid');
    var cacheKey = structures ? structures.cacheKey + ':' + seed : null;

    var radius = (structures && structures.cacheRadius) ? structures.cacheRadius : 8;
    var side = radius * 2 + 1;
    var tiles = [];
    if (gridEl) {
      gridEl.innerHTML = '';
      gridEl.style.gridTemplateColumns = 'repeat(' + side + ', 10px)';
      for (var gi = 0; gi < side * side; gi++) {
        var tile = document.createElement('div');
        tile.className = 'loading-chunk-tile loading-chunk-tile-wait';
        gridEl.appendChild(tile);
        tiles.push(tile);
      }
    }

    if (!structures) { if (screen) screen.hidden = true; done(); return; }

    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); }
    catch (err) { cached = null; }

    if (cached && structures.importCache(cached, seed)) {
      if (gridEl) {
        for (var ci = 0; ci < tiles.length; ci++) {
          tiles[ci].className = 'loading-chunk-tile loading-chunk-tile-green';
        }
      }
      if (fill) fill.style.width = '100%';
      if (text) text.textContent = 'Loading world... 100%';
      setTimeout(function () { if (screen) screen.hidden = true; done(); }, 120);
      return;
    }

    if (screen) {
      screen.hidden = false;
      if (fill) fill.style.width = '0%';
      if (text) text.textContent = 'Preparing world...';
    }

    var state = { i: 0 };
    function step() {
      var finished = structures.precomputeAround(radius, 8, state);
      var count = state.i || 0;
      var total = state.total || (side * side);
      var pct = Math.round((count / total) * 100);
      if (fill) fill.style.width = pct + '%';
      if (text) text.textContent = 'Preparing world... ' + pct + '%';
      for (var ti = 0; ti < count && ti < tiles.length; ti++) {
        if (tiles[ti].className !== 'loading-chunk-tile loading-chunk-tile-green') {
          tiles[ti].className = 'loading-chunk-tile loading-chunk-tile-blue';
        }
      }
      if (count < tiles.length && tiles[count]) {
        tiles[count].className = 'loading-chunk-tile loading-chunk-tile-active';
      }
      if (!finished) { requestAnimationFrame(step); return; }
      for (var gi2 = 0; gi2 < tiles.length; gi2++) {
        tiles[gi2].className = 'loading-chunk-tile loading-chunk-tile-green';
      }
      try { localStorage.setItem(cacheKey, JSON.stringify(structures.exportCache(seed))); }
      catch (err) { }
      if (fill) fill.style.width = '100%';
      if (text) text.textContent = 'Preparing world... 100%';
      setTimeout(function () { if (screen) screen.hidden = true; done(); }, 150);
    }
    requestAnimationFrame(step);
  }

  var loader = AllDogs.modLoader;
  if (loader && loader.ready) loader.ready.then(boot, boot);
  else boot();
})();
