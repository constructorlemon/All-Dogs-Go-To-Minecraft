function OnClick(ctx) {
  if (!ctx || !ctx.game) return;
  try {
    ctx.game.openFurnace(ctx);
  } catch (e) {}
}
function OnCollide(ctx) {}
function OnPlace(ctx) {}
function OnDestroy(ctx) {}
var CraftingRecipe = null;
module.exports = {
  onClick: OnClick,
  onCollide: OnCollide,
  onPlace: OnPlace,
  onDestroy: OnDestroy,
  craftingRecipe: CraftingRecipe
};
