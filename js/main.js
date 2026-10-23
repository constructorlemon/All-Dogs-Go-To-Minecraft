(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var container = document.getElementById('game');

  function boot() {
    preloadStructures(function () {
      var game = new AllDogs.Game(container);
      game.start();

      window.addEventListener('resize', function () {
        game.resize();
      });

      window.game = game;
    });
  }

  function preloadStructures(done) {
    var structures = AllDogs.structures;
    var screen = document.getElementById('loading-screen');
    var fill = document.getElementById('loading-bar-fill');
    var text = document.getElementById('loading-text');
    var seed = AllDogs.constants.SEED;

    if (!structures) { done(); return; }

    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(structures.cacheKey) || 'null'); }
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
      try { localStorage.setItem(structures.cacheKey, JSON.stringify(structures.exportCache(seed))); }
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
