(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  function totals(inputs) {
    var present = {};
    for (var i = 0; i < inputs.length; i++) {
      var s = inputs[i];
      if (s) present[s.id] = (present[s.id] || 0) + s.qty;
    }
    return present;
  }

  function match(inputs) {
    var present = totals(inputs);
    for (var i = 0; i < AllDogs.recipes.length; i++) {
      var r = AllDogs.recipes[i];
      var need = {};
      for (var j = 0; j < r.inputs.length; j++) need[r.inputs[j][0]] = r.inputs[j][1];
      var ok = true;
      for (var id in present) {
        if (!need[id]) { ok = false; break; }
      }
      if (!ok) continue;
      for (var id in need) {
        if ((present[id] || 0) < need[id]) { ok = false; break; }
      }
      if (!ok) continue;
      return r;
    }
    return null;
  }

  function resolve(inputs) {
    var r = match(inputs);
    if (!r) return null;
    return { recipe: r, output: r.outputs[0] };
  }

  function consume(inputs, recipe) {
    recipe.inputs.forEach(function (req) {
      var id = req[0];
      var qty = req[1];
      for (var i = 0; i < inputs.length && qty > 0; i++) {
        var s = inputs[i];
        if (s && s.id === id) {
          var take = Math.min(s.qty, qty);
          s.qty -= take;
          qty -= take;
          if (s.qty <= 0) inputs[i] = null;
        }
      }
    });
  }

  AllDogs.crafting = {
    match: match,
    resolve: resolve,
    consume: consume
  };
})();