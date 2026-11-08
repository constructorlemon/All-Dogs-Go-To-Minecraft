(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  var BODY_W = 0.6;
  var BODY_H = 1.8;
  var BODY_D = 0.6;

  var _geo = null;
  var _mat = null;

  function bodyGeometry() {
    if (!_geo) _geo = new THREE.BoxGeometry(BODY_W, BODY_H, BODY_D);
    return _geo;
  }

  function bodyMaterial() {
    if (!_mat) _mat = new THREE.MeshLambertMaterial({ color: 0x2f5d2a });
    return _mat;
  }

  // The mesh is centred on its own origin; MobEntity.syncMesh lifts it by half
  // the body height so Entity.pos can stay at the zombie's feet.
  function buildMesh() {
    var mesh = new THREE.Mesh(bodyGeometry(), bodyMaterial());
    mesh.rotation.order = 'YXZ';
    return mesh;
  }

  function target(mob, game) {
    var player = game && game.player;
    if (!player || !player.pos) return null;
    return { x: player.pos.x, y: player.pos.y, z: player.pos.z };
  }

  var schema = {
    name: 'Zombie',
    mob: {
      width: BODY_W,
      height: BODY_H,
      maxHealth: 20,
      speed: 2.1,
      jumpHeight: 1.35,
      pathInterval: 0.55,
      pathHeight: 2,
      pathMaxNodes: 300,
      pathMaxDistance: 20,
      pathMaxDrop: 4,
      pathGoalRadius: 1.4
    },
    buildMesh: buildMesh,
    target: target
  };

  class ZombieEntity extends AllDogs.MobEntity {
    constructor(opts) {
      super('zombie', opts);
      this.itemId = null;
    }
  }

  AllDogs.ZombieEntity = ZombieEntity;
  AllDogs.entities.register('zombie', ZombieEntity);

  // Register immediately as well as through the mod loader so entity creation
  // never depends on the async schema fetch finishing first.
  if (AllDogs.entitySchemas) AllDogs.entitySchemas.register('zombie', schema);

  if (typeof module !== 'undefined' && module.exports) module.exports = schema;
})();
