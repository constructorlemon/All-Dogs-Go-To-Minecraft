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
      window.location.replace('worlds.html');
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
    var cacheKey = structures ? structures.cacheKey + ':' + seed : null;

    if (!structures) { done(); return; }

    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); }
    catch (err) { cached = null; }

    if (cached && structures.importCache(cached, seed)) {
      if (screen) screen.hidden = true;
      done();
      return;
    }

    if (screen) {
      screen.hidden = false;
      fill.style.width = '0%';
      text.textContent = 'Preparing world...';
    }

    var state = { i: 0 };
    function step() {
      var finished = structures.precomputeAround(structures.cacheRadius, 8, state);
      var pct = Math.round((state.i / state.total) * 100);
      if (fill) fill.style.width = pct + '%';
      if (text) text.textContent = 'Preparing world... ' + pct + '%';
      if (!finished) { requestAnimationFrame(step); return; }
      try { localStorage.setItem(cacheKey, JSON.stringify(structures.exportCache(seed))); }
      catch (err) { }
      if (screen) screen.hidden = true;
      done();
    }
    requestAnimationFrame(step);
  }

  var loader = AllDogs.modLoader;
  if (loader && loader.ready) loader.ready.then(boot, boot);
  else boot();
})();
