(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var container = document.getElementById('game');

  function boot() {
    var game = new AllDogs.Game(container);
    game.start();

    window.addEventListener('resize', function () {
      game.resize();
    });

    window.game = game;
  }

  var loader = AllDogs.modLoader;
  if (loader && loader.ready) loader.ready.then(boot, boot);
  else boot();
})();