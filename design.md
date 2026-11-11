# All Dogs Go To Minecraft — System Design

This document describes the systems implemented in the current codebase. It is an implementation-oriented overview rather than a future roadmap.

## 1. Architecture and runtime lifecycle

- The game is a static browser application. There is no bundler or server-side game runtime; pages load scripts in dependency order and share the `window.AllDogs` namespace.
- Rendering and 3D math use the checked-in `lib/three.min.js` library.
- `index.html` is the world selector. It creates a new-world or load-world configuration in `sessionStorage` under `adsgtm.world`, then navigates to `game.html`.
- `game.html` owns the game canvas, loading screen, HUD, hotbar, inventory, and sign editor. `js/main.js` waits for the mod loader, selects the seed, preloads structure placement data, constructs `AllDogs.Game`, applies a save/creative mode, and starts the loop.
- `testing/__smoke.html` is a standalone autostart harness. It loads the same systems and exposes `window.game` for browser smoke checks.
- The player camera is positioned at the spawn point as soon as the game is constructed. The world remains paused for player movement until the first canvas click, which enters fullscreen where supported and requests pointer lock. The HUD shows `Click to start` until the first interaction, then clears the prompt.

### Main loop

`Game.loop()` runs from `requestAnimationFrame` and caps the simulation delta at 50 ms. Each frame it:

1. Updates the active zone hook and consumes edge-triggered input.
2. Advances all furnace timers.
3. Streams/rebuilds nearby chunks within a time and chunk-count budget.
4. Updates and expires item drops.
5. Updates the debug HUD when visible.
6. While pointer locked and the inventory is closed, updates the player, runs the global pathfinding and GOAP planning schedulers, updates entities, resolves player/mob rigid-body overlap, target raycasts, and drop pickup.
7. Updates the health and stamina HUDs and renders the Three.js scene.

## 2. World model and terrain generation

### Coordinate and storage model

- The effective world is infinite on X/Z and 64 blocks high (`WORLD_HEIGHT`). `CHUNK_SIZE` is 16, so each chunk contains `16 × 16 × 64` cells.
- Y below zero behaves as bedrock; Y at or above the world height behaves as air.
- `World` separates generated terrain from player edits:
  - `overrides` stores only cells whose value differs from deterministic generation.
  - `editsByChunk` indexes those overrides for chunk rebuilds and save files.
  - `chunkData` stores loaded chunk cell arrays.
  - `chunkMeshes` stores the rendered meshes currently in the streaming radius.
- `World.set()` compares a new value to `generatedAt()`. Returning a cell to its generated value removes the override, keeping saves compact.

### Seeded terrain

`js/world/worldgen.js` uses an integer seed and deterministic integer hashing:

- `hash2()` produces repeatable values for X/Z coordinates.
- Smooth bilinear noise and four-octave fBm produce terrain height.
- Surface height is approximately `4 ± 6`, clamped to `1..WORLD_HEIGHT - 8`.
- The bottom layer is bedrock; the surface is grass or a very rare sand patch; the next two layers are dirt; deeper terrain is stone.
- Trees are sparse hash-selected columns on ground at least four blocks high. Trunks are 4–6 blocks tall and are surrounded by deterministic leaf clusters.
- `blockAt()` is pure for a given seed and coordinate, allowing any distance to be generated on demand.

### Chunk streaming and meshing

`World.updateChunks()` keeps chunks in a square render radius around the player (`RENDER_DISTANCE` is 5), with one extra chunk retained for transition/culling stability. Missing chunks are selected nearest-first and removed chunks are disposed.

Chunk construction is incremental and has four phases:

1. **Data:** fill terrain columns, stamp cross-chunk trees, stamp registered structures, and apply saved edits.
2. **Face extraction:** find exposed faces, including special handling for transparent/alpha-tested textures and neighboring chunks.
3. **Greedy meshing:** merge adjacent coplanar cells sharing a texture/face key into larger quads.
4. **Assembly:** create Three.js buffer geometry with positions, normals, UVs, indices, and a cached material.

The game budgets chunk work per frame (`chunksPerFrame` and `chunkBuildBudgetMs`) to avoid long stalls while moving. Breaking or placing a block rebuilds its chunk and neighboring chunks when the edit is on a chunk boundary.

## 3. Blocks, items, textures, and placement

### Block and item registry

`js/world/blocks.js` defines the base block IDs and item definitions:

- Blocks: air, grass, dirt, stone, log, planks, leaves, sand, and unbreakable bedrock.
- Log X/Z variants preserve orientation when logs are placed against different faces.
- Items include the placeable blocks plus clay, sticks, a sign, a chest, and a wooden pickaxe.
- Each block definition specifies its display texture, breakability, drop, and optional tool requirement. Stone requires a pickaxe unless the player is creative.
- Items can place either a numeric block ID or a registered entity type such as `sign` or `chest`.
- Direction helpers select log axis variants, yaw variants, or face-based variants from the raycast hit location.

### Texture system

`js/world/textures.js` creates procedural 16×16 canvas textures for built-in materials. Textures use nearest filtering and cached Lambert materials. Grass and logs select different face textures for tops/sides; leaves use alpha testing and do not fully occlude neighboring faces. A magenta fallback texture makes missing texture registrations visible.

Mod textures are stored as six 16×16 faces and can be opaque or alpha-tested. The world renderer uses texture keys as mesh/material keys and repeats their UVs over greedy quads.

### Block interaction

The center-screen `BlockRaycaster` intersects rendered chunk meshes up to `REACH` (6 blocks) and returns the hit cell, face normal, and hit position. `Game.updateTarget()` also raycasts registered entities and gives an entity priority over a block.

- Left click attacks a targeted living mob. Melee deals `PLAYER_ATTACK_DAMAGE` (5), applies a knockback of `PLAYER_ATTACK_KNOCKBACK` (2.5) plus `PLAYER_ATTACK_SPEED_SCALE` (0.6) per unit of player speed, briefly flashes the mob red, and only removes it when a hit reduces its health to zero. Non-mob entities and blocks are still removed or broken directly by a left click.
- Right click interacts with an entity or block schema, otherwise places the selected item.
- Placement checks world bounds, solid cells, entity-top colliders, and overlap with the player.
- Block orientation is derived from the hit face and, for yaw-only blocks, from the player’s facing direction.
- Breaking invokes schema hooks, removes the cell, rebuilds affected chunks, and puts the configured drop in the inventory or on the ground if the inventory has no room.
- Bedrock cannot be broken. Crouching/crawling allows a schema `onClick` action to intercept a left click before normal breaking.

## 4. Player, input, movement, and collision

### Input and camera

`Input` tracks held keys, one-shot key presses, mouse-look deltas, and wheel direction. It handles pointer lock changes, ignores keyboard shortcuts while typing in editable controls, clamps unusually large mouse deltas, and clears held keys on window blur/page hide.

`Player` is a first-person camera controller with yaw/pitch limits and a configurable eye height. Movement is relative to the camera’s yaw and is resolved independently on X, Z, and Y.

### Movement modes

- Walking uses `MOVE_SPEED` (5); sprinting uses `SPRINT_SPEED` (8).
- Horizontal motion has momentum. The player accelerates toward the requested walk/sprint velocity with `PLAYER_ACCEL` (24), `PLAYER_SPRINT_ACCEL` (30), or `PLAYER_AIR_ACCEL` (10), and coasts to rest with `PLAYER_GROUND_FRICTION` (20) or `PLAYER_AIR_FRICTION` (0.8) instead of snapping to the target speed each frame. Dashing overrides velocity directly for its short burst.
- Shift or a W double-tap requests sprinting while standing.
- Ctrl/C hold or C hold crouches. A short tap toggles crouch; a double tap toggles crawl.
- Crouch and crawl use lower collision heights and slower speeds. Expanding to a taller posture is rejected if the player would overlap terrain.
- Walking uses an immediate fixed-height jump when Space is pressed. Crouching retains a charge jump: hold Space to build height and release to leap.
- Sprinting jumps immediately. Holding Space after landing chains sprint jumps and increases the jump boost.
- Crawling plus Space performs a short directional dash with an upward impulse.

### Collision, stamina, and health

- Gravity, terminal fall speed, solid voxel cells, and entity AABBs are applied in the player movement step.
- The player can step up by `STEP_HEIGHT` (0.5). Crouching/crawling use edge support checks so the player does not casually walk off a ledge.
- Mod block `onCollide` hooks can run when an overlap is detected.
- Stamina ranges from 0 to 1. Sprinting drains it; walking and idling regenerate it, with slower regeneration in air and a delay after exertion. Normal jumps, crouch charge jumps, sprint jumps, and dashes also spend stamina. Sprint jumps repeated within six update frames of the previous jump receive a stamina-cost grace period to prevent rapid ceiling-bounce jumps from draining the bar.
- Exhaustion prevents sprint/jump actions until stamina fully recovers. `StaminaBar` displays fill, color thresholds, charging state, and exhaustion state.
- Health ranges from 0 to `PLAYER_MAX_HEALTH` (100). `Player.damage(amount, source)` subtracts health and clamps it at zero, but the player is intentionally not removed or respawned yet. Zombie attacks also call `Player.applyKnockback()`, which pushes the player away and divides the requested speed by weight. `HealthBar` sits above the stamina bar, aligned to its left half, and draws 10% tick markers like the stamina bar.

## 5. Inventory, hotbar, crafting, and smelting

### Inventory and selection

- The normal inventory has 36 slots. The first nine are the hotbar; the inventory panel renders the remaining slots while the hotbar stays visible.
- Stacks have no configured maximum. Adding merges with the first matching item or uses the first empty slot.
- Number keys and mouse wheel select hotbar items; Q drops one selected item in front of the player.
- Creative mode uses the same inventory, hotbar, crafting, and furnace UI as survival. Entering creative fills the real inventory slots with every item at quantity 999, expanding capacity if a mod adds more items than the normal 36 slots. Creative world placement/removal does not consume or grant inventory items, and furnace outputs can still be collected normally.
- `InventoryPanel` supports full-stack moves, partial moves, stack merging, complete-stack swaps, and drag distribution. Shift distributes a stack evenly over the selected inventory or open-GUI squares; Ctrl puts one item in each selected square.
- Shift-click or Ctrl-click quick-moves a whole stack. Shift prefers open crafting/furnace/chest slots: hotbar and main-inventory stacks go to the first accepting GUI slot, falling back to the inventory when none accepts them. Ctrl prefers the inventory: hotbar stacks go to the main inventory and main-inventory stacks go to the hotbar, falling back to the GUI only when the inventory has no room. GUI items always return to the first empty inventory slot. Clicking an empty inventory or hotbar slot while a GUI item exists pulls that GUI stack into the clicked slot.

### Crafting

The crafting panel has three input slots and one output. Recipe matching totals item IDs across the input slots, so arrangement does not matter. Current recipes are:

| Recipe | Inputs | Output |
| --- | --- | --- |
| Planks | 1 log | 4 planks |
| Sticks | 2 planks | 4 sticks |
| Wooden pickaxe | 3 planks + 2 sticks | 1 pickaxe |

Taking the output consumes one recipe’s required quantities and adds the result to the inventory if it can hold that item.

### Furnace

The current furnace is a block schema, not an entity. The checked-in `Furnace.js` schema opens `Game.openFurnace()` on interaction. Furnace state is keyed by block coordinate and contains two input-side slots, an output stack, and progress.

- The only active smelting recipe is 1 dirt → 1 clay over 10 seconds.
- The second visible furnace slot is reserved but is not currently used as fuel.
- Smelting continues for tracked furnace states while the game loop runs, including when the furnace UI is closed.
- The furnace UI stacks its two input slots on the left, shows an arrow in the middle, and places the output slot on the right. A gold fill sweeps across the arrow to track the current `furnaceProgress` value.
- Furnace contents and progress are not included in world saves.

## 6. Entities and item drops

### Entity framework

`Entity` is the base type with position, velocity, bounds, a collision `weight` (default 1), mesh synchronization, update/interact hooks, and removal state. `AllDogs.entities` is a type registry; `EntityManager` owns active entities, attaches their meshes, updates them, and performs center-ray AABB selection. `AllDogs.entitySchemas` is a parallel registry for entity behavior modules loaded from `mods/schema/`.

### Mobs and pathfinding

`MobEntity` (`js/entity/mob.js`) is the moving-creature base class. It stores health, speed, gravity, jump height, stop distance, and a feet-based position, with a bounds getter that spans the full body. Movement uses per-axis AABB collision against solid voxels and entity colliders, gravity with a terminal fall speed, automatic jumping when horizontally blocked or when the next path node is higher, and mesh synchronization offset to the body center. Path following string-pulls the route: it looks a few nodes ahead and steers at the furthest one reachable by a straight walkable line, so mobs cross the cell grid smoothly instead of stair-stepping and zig-zagging. Line-of-sight sampling is throttled and cached per mob to keep a large horde cheap; a visible target within short range is chased directly, and the stop distance prevents the final approach from jittering back and forth. Schema hooks (`mob`, `buildMesh`, `target`, `tick`, `goap`, `onHurt`, `onDeath`, `onInteract`, `onSpawn`, `onRemoved`) let a schema drive appearance, targeting, and behavior while sharing all physical logic. `damage()` applies damage and removes the mob at zero health; the manager then detaches its mesh.

Behavior code can drive a mob through the navigation API: `moveTo(x, y, z, { radius })` records a destination, `stopMoving()` clears it, and `nav.arrived`/`nav.distance` report progress. Schemas without a `goap` definition keep using `target`/`tick` exactly as before; schemas with one use a `GoapBrain` instead.

Mobs also carry a collision `weight` (default 1). Their steering eases toward the desired velocity using acceleration and friction (`accel`/`friction`, default 14 and 18), so collision impulses and knockback carry visibly instead of being overwritten on the next frame. `applyKnockback()` shoves a mob away with a weight-scaled speed and briefly suppresses steering; `receiveImpact()` does the same from hard collisions. Knockback duration scales with the requested speed between 0.18 s and 0.55 s. `hit(amount, source, { knockback })` combines damage and knockback for player melee. A hurt mob sets `hurtTime`, tints its per-instance cloned material red through `updateHurtFlash()`, and restores the original emissive colour when the flash expires. Mobs still die at zero health.

`AllDogs.pathfinder` (`js/entity/pathfinder.js`) provides bounded A* over the voxel grid. Searches are capped by node count (default 300), horizontal radius (20 blocks), drop height (4 blocks), and a goal radius; a binary heap, numeric node keys, and 8-direction movement with corner checks keep them small. If the budget is exhausted before the goal, the best frontier node becomes a partial path. A global scheduler runs searches with a roughly 3 ms per-frame budget and at most 16 searches per frame, keeps at most one queued request per mob, staggers repath intervals by distance, and rejects new requests once 256 are pending so 1000 mobs cannot grow the queue without bound. Mobs fall back to direct pursuit while their path is queued or when the queue is saturated.

`AllDogs.mobCollision` (`js/entity/mobCollision.js`) adds rigid-body separation between the player and every living mob. Both use feet-based bounds and a collision `weight`; inverse weight decides how much positional correction each body takes, so the player (weight 1) moves the lighter zombie (weight 0.8) more than itself. A uniform XZ spatial hash collects nearby pairs, then up to three Gauss-Seidel passes resolve each pair along the horizontal axis with the smallest overlap. Closing velocity produces an impulse shared by inverse weight, with a restitution of 0.12 once the closing speed passes 1.2 m/s; slow or motionless overlap only gets positional correction. Impacts above 1.5 m/s also briefly suppress mob steering (capped at 0.45 s) so the transferred momentum is visible. A per-frame resolution budget rotates through pairs when a dense horde produces too many contacts, so collision work cannot stall a frame. Positional correction uses a small slop to prevent jitter. Every correction is tested against solid voxels and static entity colliders first, with axis-only fallbacks so bodies slide along walls instead of being pushed through them. Moved mob meshes and the player camera are re-synchronized after resolution.

### GOAP AI

`AllDogs.goap` (`js/entity/goap.js`) is an opt-in goal-oriented action planner shared by every mob. A schema supplies a `goap` definition with facts, goals, and actions. Facts are boolean observations about the mob and world; goals have a desired fact set and a priority; actions have boolean `pre` conditions, `effects`, an optional cost, and lifecycle hooks (`canStart`, `start`, `update`, `stop`, or an instant `run`). The planner performs a bounded forward search over action effects (`maxNodes` 64, `maxDepth` 6) and the global scheduler plans at most 16 brains per frame within a roughly 1.5 ms budget, rejecting new requests once 256 are pending. Each brain has one plan request in flight, re-checks the next action against live facts before starting it, and fails back to a paused state when a plan is impossible.

Idling is built into the brain. When no goal applies, a plan fails, or a plan completes, the brain sleeps for a configurable number of frames (`idleTicks`, `noPlanPauseTicks`, `goalPauseTicks`) plus a deterministic per-mob jitter. During that pause `update()` only decrements the counter and returns before collecting facts or scanning goals, so thousands of inactive mobs cost almost nothing. `pauseTicks` on an action and the `idleAction()` helper provide the same behavior inside a plan. `schema.goap` takes precedence over the legacy `target`/`tick` hooks; `GoapBrain.stop()` is called on death and removal.

### Built-in entities

- **Sign:** a wooden board and post with a canvas-rendered message. Text is limited to four lines and can be edited through the sign editor. The saved position uses the ground coordinate rather than the board’s visual center.
- **Chest:** a solid collider with a hinged animated lid. Interaction opens a 27-slot container UI instead of only toggling the lid. Each chest owns a separate inventory keyed by its rounded entity position, so generated and player-placed chests both keep individual contents. Breaking a chest drops every stored stack on the ground. Chest behavior is implemented by the built-in entity schema `mods/schema/Chest.js`.
- **Zombie:** a 2-block-tall dark green rectangular prism with weight 0.8, driven by GOAP. Its `hunt` goal picks the player when present; an acquire action stores the target and a chase action navigates with the shared A* pathfinder, switching to a direct line when the player is visible. Once in melee range, an `attack` goal runs an instant attack action that deals 6 damage and a knockback shove to the player on a 900 ms cooldown (`performance.now()` based so it does not consume the game clock). It jumps automatically when blocked or when the next node is higher, stops at melee distance, sleeps on the brain's idle path when it has nothing to do, has 20 health, and is implemented by the built-in entity schema `mods/schema/Zombie.js`. Left-clicking a zombie deals 5 damage plus a speed-scaled knockback, briefly flashes it red, and only removes it at zero health; repeated hits therefore defeat it instead of one click destroying it.
- **Generated furniture:** structures create signs and chests as generated entities. They are loaded/unloaded with their origin chunk.

Generated entities are marked separately from player-placed entities. Removing one records a stable type/position key so it stays removed after chunk reloads. Generated sign edits use the same key; player-placed entity records are written directly to saves.

### Drops

`Drops` represents dropped items as small textured cubes. Drops:

- settle on the highest solid voxel or entity collider below their cell;
- merge with nearby drops of the same item;
- bob and spin visually;
- cannot be picked up for three seconds;
- expire after five minutes;
- are collected within a 1.2-block radius only if the inventory can hold the item.

## 7. Zones and structures

### Zones

`Zone` defines the extension hooks for spawn, generation, entities, enter/update/leave behavior, and exit permissions. `ZoneManager` registers zones and, on entry, clears the world, calls zone generation, and activates the zone.

Only `TestingZone` is currently registered. It uses seeded terrain for a spawn point and places a welcome sign, a chest, and three test zombies near the spawn. The framework is ready for additional zones, but there is no zone transition UI or portal system yet.

### Deterministic structures

`js/world/structures/structure.js` provides a data-driven structure registry:

- Definitions contain ASCII layer maps, legends, variants, placement rules, and optional entity factories.
- Placement is deterministic from the world seed. Candidate regions are filtered by a noise threshold, density, safe radius, flatness, sand, and nearby generated trees.
- Variants are rotated in 90-degree increments. Directional block IDs are rotated with the structure.
- Structures are stamped into chunk data before edits are applied, and their furniture entities are requested by chunk.

The checked-in house definition uses 26-block placement spacing, four 5/7/9-block variants, plank construction, the mod Furnace block, and chest/sign furniture. House signs receive deterministic names from a fixed list.

Structure placements are precomputed around the starting area in a loading screen (radius 8 = 17×17 placement-cache cells) and cached in `localStorage` under `adsgtm.placements:<seed>`. The cache includes a version and definition signature, so changed structure definitions invalidate it. Placements outside the precomputed area are calculated lazily as chunks are requested.

## 8. Persistence and world loading

World saves are downloaded as plain text files named `adsgtm-world-<seed>.txt`. Version 1 records:

- seed and creative-mode flag;
- player position, yaw, and pitch;
- non-generated block overrides;
- player-placed entities and their yaw/text;
- removed generated entity keys;
- edited generated sign text;
- non-empty chest inventories keyed by chest position.

Chest records use `chest=<x>,<y>,<z>,<encoded slot array>`, where the slot array uses the same URI-encoded JSON approach as sign text. Chest inventories are also tracked for generated chests that are currently outside the loaded chunk range.

The parser ignores blank/comment lines and unknown keys. Loading reconstructs the deterministic world from the saved seed, applies block edits, removes generated entities, applies sign edits, recreates placed entities, restores chest contents, rebuilds already-loaded affected chunks, restores player orientation/position, and enters creative mode when recorded.

The save system intentionally does **not** currently serialize normal inventory, selected item, dropped items, furnace state, zone ID, or the structure placement cache. The cache is a separate derived local-storage optimization rather than part of a world save. There is no automatic save; the pause menu’s **Save World** action triggers the browser download.

## 9. User interface and game states

- **World selector:** new seed/random seed, creative checkbox, save-file picker, validation messages, controls link, and F3 mod-tools menu.
- **Loading screen:** structure precomputation progress bar and a tile grid showing waiting, active, processed, and complete cache cells.
- **Start state:** the player is rendered at the spawn point immediately, while movement remains paused behind the `Click to start` HUD prompt until the first canvas interaction.
- **HUD:** crosshair, zone label, transient action messages, hotbar, player health bar, and stamina bar.
- **Inventory:** modal overlay with crafting, furnace, or chest container view, item icons, selection, drag/drop, and stack distribution. The chest view puts the 27-slot chest grid above the player inventory.
- **Sign editor:** four-line textarea with Save, Enter-to-save, Escape-to-cancel, and outside-click cancellation.
- **Pause menu:** M toggles resume, save, instructions, and main-menu actions. Releasing pointer lock prevents the world from responding while the menu is open.
- **Debug HUD:** F3 shows FPS, position, block/cell, player state, chunk, facing, world dimensions, mesh/render counts, drops, entities, and inventory totals.

## 10. Modding pipeline

### Texture editor

`mod_textures.html` and `js/mod/textureEditor.js` provide a browser editor for a six-face, 3×2 atlas. It supports brush, grain/texture, eraser, flood fill, color pick, circle, square, filled/outline shapes, blend modes, undo/redo, import, and PNG export. The 3D cube preview can be manually rotated or auto-rotated.

Filename suffixes define block orientation:

- `name.png`: no generated orientation variants;
- `name_rot.png`: any-direction block with X/Y/Z variants;
- `name_rotY.png`: yaw-only block with four upright rotations.

The editor tells the user to put the PNG in `mods/texture` and run `node tools/scanmods.js`.

### Manifest and runtime registration

`tools/scanmods.js` scans PNG files, decodes supported 8-bit PNG color types, slices the six atlas faces, and writes `js/mods/manifest.js`. It also lists JSON files in `mods/mobs`, although the current browser loader does not instantiate mob definitions.

`js/mods/modLoader.js` processes the manifest sequentially before game boot. It loads embedded face data or image paths, registers dynamic block IDs/items/textures/icons, and optionally loads `mods/schema/<name>.js`. A schema is exposed through a temporary `module.exports` bridge. A block schema can provide:

- `onClick` for block interaction;
- `onCollide` for player collision effects;
- `onPlace` and `onDestroy` hooks;
- `craftingRecipe` as an extension field (not currently consumed by the built-in crafting resolver).

The loader also registers built-in entity schemas. `Chest.js` is loaded for the `chest` entity type and owns its 27-slot inventories, interaction, quick-move handling, destroy/drop behavior, and save/load helpers. Entity schemas use hooks such as `onSpawn`, `onInteract`, and `onDestroy`. `AllDogs.entitySchemas` is the entity-schema registry, mirroring the block schema registry.

The current checked-in examples include furnace, transparent, and rotated test textures. `mod_meshes.html` is currently only a placeholder page.

## 11. Testing and diagnostics

`testing/__smoke.html` is the primary executable verification surface. It checks boot/render setup, player health damage/clamping and health-bar fill, inventory, mod schema registration, furnace opening and smelting, chest containers and save round trips, block interaction, seeded world generation, chunk streaming budgets, greedy mesh rebuilds, structures and orientation, generated furniture, save/parse/apply round trips, zombie schema registration, test-zombie spawning, A* path production, mob movement and navigation, player/mob rigid-body separation with weight-scaled collision impulses, player movement momentum, GOAP plan production, the zombie attack plan/damage/cooldown/knockback, player melee damage/knockback/hurt flash, and the 1000-brain idle fast path. Results are written to a `#smoke-result` element using `data-smoke` and `data-errors` attributes.

The in-game F3 overlay is useful for runtime performance and streaming diagnostics. There is no package-managed unit-test suite or build step; the application is run as static files with the browser smoke page and the Node manifest scanner as the main tooling.

## 12. Source map

| Area | Main files |
| --- | --- |
| Boot and game orchestration | `index.html`, `game.html`, `js/main.js`, `js/core/game.js` |
| Constants and targeting | `js/core/constants.js`, `js/core/raycast.js` |
| Input and player | `js/movement/input.js`, `js/movement/player.js` |
| Blocks, terrain, rendering | `js/world/blocks.js`, `worldgen.js`, `world.js`, `textures.js` |
| Structures and zones | `js/world/structures/*`, `js/zones/*` |
| Items and crafting | `js/crafting/*`, `js/world/drops.js` |
| Entities | `js/entity/*` |
| Mobs and pathfinding | `js/entity/mob.js`, `js/entity/mobCollision.js`, `js/entity/pathfinder.js`, `js/entity/goap.js`, `mods/schema/Zombie.js` |
| Saves | `js/world/worldSave.js` |
| HUD and menus | `js/ui/*`, `css/style.css`, `controls.html` |
| Mods | `mod_textures.html`, `mod_meshes.html`, `js/mod/*`, `js/mods/*`, `tools/scanmods.js`, `mods/*` |
| Browser verification | `testing/__smoke.html` |
