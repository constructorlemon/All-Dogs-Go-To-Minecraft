(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  AllDogs.recipes = [
    {
      id: 'planks',
      name: 'Planks',
      inputs: [['log', 1]],
      outputs: [['planks', 4]]
    },
    {
      id: 'sticks',
      name: 'Sticks',
      inputs: [['planks', 2]],
      outputs: [['stick', 4]]
    },
    {
      id: 'pickaxe',
      name: 'Wooden Pickaxe',
      inputs: [['planks', 3], ['stick', 2]],
      outputs: [['pickaxe', 1]]
    }
  ];
})();