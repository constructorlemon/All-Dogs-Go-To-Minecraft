(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});
  var THREE = window.THREE;

  class BlockRaycaster {
    constructor(camera, maxDistance) {
      this.camera = camera;
      this.maxDistance = maxDistance;
      this.raycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 0, maxDistance);
      this._ndc = new THREE.Vector2(0, 0);
    }

    cast(meshes) {
      if (!meshes.length) return null;
      this.camera.updateMatrixWorld();
      this.raycaster.setFromCamera(this._ndc, this.camera);
      var hits = this.raycaster.intersectObjects(meshes, false);

      for (var i = 0; i < hits.length; i++) {
        var hit = hits[i];
        if (hit.distance > this.maxDistance) break;

        var n = hit.face.normal;
        var p = hit.point;
        var x = Math.floor(p.x - n.x * 0.5);
        var y = Math.floor(p.y - n.y * 0.5);
        var z = Math.floor(p.z - n.z * 0.5);
        return {
          x: x,
          y: y,
          z: z,
          blockId: hit.object.userData.blockId,
          fx: Math.round(n.x),
          fy: Math.round(n.y),
          fz: Math.round(n.z),
          onX: p.x - x,
          onY: p.y - y,
          onZ: p.z - z
        };
      }

      return null;
    }
  }

  AllDogs.BlockRaycaster = BlockRaycaster;
})();