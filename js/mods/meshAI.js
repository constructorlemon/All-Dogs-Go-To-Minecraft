(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  // Shared list of GOAP behaviours that mesh exports can inherit. The game
  // loader also uses the AI id (for example "zombie") to copy the matching
  // built-in schema onto the generated mob at runtime.
  var list = [];

  function register(id, name, note) {
    if (!id) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].name = name || list[i].name;
        list[i].note = note || list[i].note;
        return list[i];
      }
    }
    var entry = { id: String(id), name: name || String(id), note: note || '' };
    list.push(entry);
    return entry;
  }

  register('zombie', 'Zombie (GOAP hunter)', 'Targets the player, chases, then attacks in melee range.');

  AllDogs.meshAI = {
    register: register,
    list: function () {
      return list.map(function (entry) {
        return { id: entry.id, name: entry.name, note: entry.note };
      });
    }
  };
})();
