(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var cache = {};
  var urlCache = {};

  function canvas16() {
    var c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    return [c, c.getContext('2d')];
  }

  function fill(x, color) {
    x.fillStyle = color;
    x.fillRect(0, 0, 16, 16);
  }

  function speck(x, rgb, base, n) {
    for (var i = 0; i < n; i++) {
      var v = Math.floor(Math.random() * base);
      x.fillStyle = 'rgb(' + (rgb[0] + v) + ',' + (rgb[1] + v) + ',' + (rgb[2] + v) + ')';
      x.fillRect(Math.floor(Math.random() * 16), Math.floor(Math.random() * 16), 1, 1);
    }
  }

  function drawDirt(x) {
    fill(x, '#6f4e2e');
    speck(x, [-10, -10, -10], 22, 22);
  }

  function drawGrass(x) {
    drawDirt(x);
    x.fillStyle = '#5c9144';
    x.fillRect(0, 0, 16, 5);
    for (var i = 0; i < 8; i++) {
      x.fillRect(Math.random() * 15, 4, 1, 2);
    }
  }

  function drawStone(x) {
    fill(x, '#8a8a88');
    speck(x, [-16, -16, -16], 34, 18);
  }

  function drawLog(x) {
    fill(x, '#6a4a28');
    for (var vx = 0; vx < 16; vx++) {
      x.fillStyle = vx % 4 === 0 ? '#573c1f' : '#7c5c34';
      x.fillRect(vx, 0, 1, 16);
    }
    x.fillStyle = '#8a6a3f';
    x.fillRect(0, 13, 16, 3);
  }

  function drawPlanks(x) {
    fill(x, '#b08a4a');
    x.strokeStyle = '#6f5426';
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(0, 4);
    x.lineTo(16, 4);
    x.moveTo(0, 8);
    x.lineTo(16, 8);
    x.moveTo(0, 12);
    x.lineTo(16, 12);
    x.stroke();
    speck(x, [-12, -12, -12], 24, 12);
  }

  function drawLeaves(x) {
    fill(x, '#3e7a28');
    speck(x, [6, 12, 4], 26, 26);
    x.clearRect(3, 3, 2, 2);
    x.clearRect(11, 5, 2, 2);
    x.clearRect(6, 11, 2, 2);
  }

  function drawSand(x) {
    fill(x, '#dcc679');
    speck(x, [-8, -8, -8], 18, 16);
  }

  function drawStick(x) {
    x.clearRect(0, 0, 16, 16);
    x.fillStyle = '#a5793f';
    x.fillRect(6, 1, 3, 14);
    x.fillStyle = '#c99b5e';
    x.fillRect(6, 1, 1, 14);
    x.fillStyle = '#6f4e2e';
    x.fillRect(8, 7, 1, 8);
  }

  function drawPickaxe(x) {
    x.clearRect(0, 0, 16, 16);
    x.fillStyle = '#9aa0a8';
    x.fillRect(2, 1, 12, 3);
    x.fillRect(3, 4, 4, 2);
    x.fillStyle = '#6f4e2e';
    x.fillRect(5, 8, 4, 7);
    x.fillStyle = '#8a6540';
    x.fillRect(5, 11, 4, 1);
  }

  function drawClay(x) {
    fill(x, '#9aa4b0');
    speck(x, [-14, -10, -6], 26, 22);
  }

  function drawSign(x) {
    x.clearRect(0, 0, 16, 16);
    x.fillStyle = '#5d3a17';
    x.fillRect(2, 2, 12, 7);
    x.fillStyle = '#8a5a2b';
    x.fillRect(3, 3, 10, 5);
    x.fillStyle = '#6f5129';
    x.fillRect(3, 7, 10, 1);
    x.fillStyle = '#6f4e2e';
    x.fillRect(7, 8, 3, 8);
  }

  function drawChest(x) {
    x.clearRect(0, 0, 16, 16);
    x.fillStyle = '#5d3a17';
    x.fillRect(1, 3, 14, 12);
    x.fillStyle = '#b08a50';
    x.fillRect(2, 4, 12, 10);
    x.strokeStyle = '#8a6236';
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(2, 7);
    x.lineTo(14, 7);
    x.moveTo(2, 10);
    x.lineTo(14, 10);
    x.moveTo(8, 5);
    x.lineTo(8, 6);
    x.stroke();
    x.fillStyle = '#c7a069';
    x.fillRect(2, 1, 12, 3);
    x.fillStyle = '#5d3a17';
    x.fillRect(2, 4, 12, 1);
    x.fillStyle = '#7a5730';
    x.fillRect(7, 4, 2, 2);
  }

  var DRAWERS = {
    dirt: drawDirt,
    grass: drawGrass,
    stone: drawStone,
    log: drawLog,
    planks: drawPlanks,
    leaves: drawLeaves,
    sand: drawSand,
    clay: drawClay,
    sign: drawSign,
    chest: drawChest,
    stick: drawStick,
    pickaxe: drawPickaxe
  };

  function iconCanvas(itemId) {
    if (!cache[itemId]) {
      var c = canvas16();
      var draw = DRAWERS[itemId];
      if (draw) draw(c[1]);
      cache[itemId] = c[0];
    }
    return cache[itemId];
  }

  function iconDataUrl(itemId) {
    if (!urlCache[itemId]) urlCache[itemId] = iconCanvas(itemId).toDataURL();
    return urlCache[itemId];
  }

  function registerIconCanvas(itemId, canvas) {
    cache[itemId] = canvas;
    delete urlCache[itemId];
  }

  AllDogs.iconCanvas = iconCanvas;
  AllDogs.iconDataUrl = iconDataUrl;
  AllDogs.registerIconCanvas = registerIconCanvas;
})();