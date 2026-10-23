(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var HOUSE_NAMES = [
    'Casa', 'Willow', 'Maple', 'Birch', 'Cedar', 'Hearth', 'Nook', 'Den',
    'Lodge', 'Cabin', 'Croft', 'Hollow', 'Bramble', 'Fern', 'Amber', 'Ivory',
    'Hazel', 'Juniper', 'Rowan', 'Alder', 'Brooke', 'Clover', 'Thistle', 'Wren'
  ];

  var LEGEND = {
    '.': 'AIR',
    'F': 'PLANKS',
    'W': 'PLANKS',
    'U': 'Furnace',
    'G': 'GLASS',
    'X': 'PLANKS'
  };

  var SMALL = {
    size: 5,
    layers: [
      [
        'FFFFF',
        'FFFFF',
        'FFFFF',
        'FFFFF',
        'FFFFF'
      ],
      [
        'WW.WW',
        'W.U.W',
        'W...W',
        'W...W',
        'WWWWW'
      ],
      [
        'WW.WW',
        'W...W',
        'W...W',
        'W...W',
        'WWWWW'
      ],
      [
        'FFFFF',
        'FFFFF',
        'FFFFF',
        'FFFFF',
        'FFFFF'
      ]
    ],
    furniture: [
      { type: 'chest', lx: 1, lz: 3, y: 1, face: 1 },
      { type: 'sign', lx: 2, lz: -1, y: 1, face: 0 }
    ]
  };

  var LARGE = {
    size: 7,
    layers: [
      [
        'FFFFFFF',
        'FFFFFFF',
        'FFFFFFF',
        'FFFFFFF',
        'FFFFFFF',
        'FFFFFFF',
        'FFFFFFF'
      ],
      [
        'WWW.WWW',
        'W.....W',
        'W..U..W',
        'W.....W',
        'W.....W',
        'W.....W',
        'WWWWWWW'
      ],
      [
        'WWW.WWW',
        'W.....W',
        'W.....W',
        'W.....W',
        'W.....W',
        'W.....W',
        'WWWWWWW'
      ],
      [
        'FFFFFFF',
        'FFFFFFF',
        'FFFFFFF',
        'FFFFFFF',
        'FFFFFFF',
        'FFFFFFF',
        'FFFFFFF'
      ]
    ],
    furniture: [
      { type: 'chest', lx: 1, lz: 5, y: 1, face: 1 },
      { type: 'chest', lx: 5, lz: 5, y: 1, face: 3 },
      { type: 'sign', lx: 3, lz: -1, y: 1, face: 0 }
    ]
  };

  var SMALL_WINDOWS = {
    size: 5,
    layers: [
      [
        'FFFFF',
        'FFFFF',
        'FFFFF',
        'FFFFF',
        'FFFFF'
      ],
      [
        'WW.WW',
        'W...W',
        'W.U.W',
        'W...W',
        'WWWWW'
      ],
      [
        'WW.WW',
        'W.G.W',
        'W...W',
        'W.G.W',
        'WWWWW'
      ],
      [
        'FFFFF',
        'FFFFF',
        'FFFFF',
        'FFFFF',
        'FFFFF'
      ]
    ],
    furniture: [
      { type: 'chest', lx: 1, lz: 3, y: 1, face: 1 },
      { type: 'sign', lx: 2, lz: -1, y: 1, face: 0 }
    ]
  };

  var LARGE_EXT = {
    size: 9,
    layers: [
      [
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF'
      ],
      [
        'WWWW.WWWW',
        'W.......W',
        'WU......W',
        'W.......W',
        'W..WWWW.W',
        'W..W....W',
        'W..W....W',
        'W..WWWWWW',
        'WWWWWWWWW'
      ],
      [
        'WWWW.WWWW',
        'W.......W',
        'W.......W',
        'W.......W',
        'W..WWWW.W',
        'W..W....W',
        'W..W....W',
        'W..WWWWWW',
        'WWWWWWWWW'
      ],
      [
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF',
        'FFFFFFFFF'
      ]
    ],
    furniture: [
      { type: 'chest', lx: 1, lz: 5, y: 1, face: 1 },
      { type: 'chest', lx: 5, lz: 7, y: 1, face: 2 },
      { type: 'sign', lx: 3, lz: -1, y: 1, face: 0 }
    ]
  };

  function houseName(p) {
    var n = HOUSE_NAMES[Math.floor(AllDogs.worldgen.hash2(p.x * 31 + 7, p.z * 17 + 13) * HOUSE_NAMES.length)];
    return n || HOUSE_NAMES[0];
  }

  function entityList(p) {
    var out = [];
    var list = p.variant.furniture || [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var r = AllDogs.structures.rotate(it.lx, it.lz, p.size, p.turns);
      var yaw = (p.turns + (it.face || 0)) * (-Math.PI / 2);
      var desc = {
        type: it.type,
        pos: { x: p.x + r.x + 0.5, y: p.base + it.y, z: p.z + r.z + 0.5 },
        yaw: yaw
      };
      if (it.type === 'sign') desc.text = [houseName(p)];
      out.push(desc);
    }
    return out;
  }

  AllDogs.structures.register('house', {
    flatness: 1,
    spawn: {
      spacing: 26,
      attempts: 6,
      density: 0.7,
      regionScale: 0.02,
      regionOctaves: 3,
      regionThreshold: 0.52,
      safeRadius: 22
    },
    variants: [
      { size: SMALL.size, layers: SMALL.layers, legend: LEGEND, furniture: SMALL.furniture },
      { size: LARGE.size, layers: LARGE.layers, legend: LEGEND, furniture: LARGE.furniture },
      { size: SMALL_WINDOWS.size, layers: SMALL_WINDOWS.layers, legend: LEGEND, furniture: SMALL_WINDOWS.furniture },
      { size: LARGE_EXT.size, layers: LARGE_EXT.layers, legend: LEGEND, furniture: LARGE_EXT.furniture }
    ],
    entities: entityList
  });
})();
