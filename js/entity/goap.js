(function () {
  'use strict';
  var AllDogs = (window.AllDogs = window.AllDogs || {});

  var DEFAULT_IDLE_TICKS = 30;
  var DEFAULT_IDLE_JITTER = 20;
  var DEFAULT_GOAL_PAUSE_TICKS = 5;
  var MAX_NODES = 64;
  var MAX_DEPTH = 6;
  var MAX_PLANS_PER_FRAME = 16;
  var PLAN_BUDGET_MS = 1.5;
  var MAX_PENDING = 256;

  var definitions = {};
  var compiledCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var queue = [];
  var stats = {
    planned: 0,
    failed: 0,
    queued: 0,
    rejected: 0,
    processed: 0,
    lastMs: 0
  };

  function nowMs() {
    return typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  }

  function numberOr(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function copyState(state) {
    var out = {};
    for (var key in state) {
      if (Object.prototype.hasOwnProperty.call(state, key)) out[key] = state[key];
    }
    return out;
  }

  function stateSignature(state) {
    var keys = Object.keys(state).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      parts.push(keys[i] + '=' + String(state[keys[i]]));
    }
    return parts.join(';');
  }

  function satisfies(desired, state) {
    if (!desired) return true;
    for (var key in desired) {
      if (!Object.prototype.hasOwnProperty.call(desired, key)) continue;
      if (state[key] !== desired[key]) return false;
    }
    return true;
  }

  function unsatisfiedCount(desired, state) {
    var count = 0;
    for (var key in desired) {
      if (!Object.prototype.hasOwnProperty.call(desired, key)) continue;
      if (state[key] !== desired[key]) count++;
    }
    return count;
  }

  function applyEffects(state, effects) {
    var changed = false;
    if (!effects) return changed;
    for (var key in effects) {
      if (!Object.prototype.hasOwnProperty.call(effects, key)) continue;
      if (state[key] !== effects[key]) {
        state[key] = effects[key];
        changed = true;
      }
    }
    return changed;
  }

  function actionCost(action, mob, state, game) {
    var cost = typeof action.cost === 'function'
      ? action.cost(mob, state, game)
      : action.cost;
    cost = Number(cost);
    return isFinite(cost) && cost >= 0 ? cost : 1;
  }

  function compileAction(action) {
    if (!action || !action.name) return null;
    return {
      name: action.name,
      cost: action.cost == null ? 1 : action.cost,
      pre: action.pre || {},
      effects: action.effects || {},
      instant: !!action.instant,
      timeout: Math.max(0, numberOr(action.timeout, 0)),
      pauseTicks: Math.max(0, numberOr(action.pauseTicks, 0)),
      canStart: typeof action.canStart === 'function' ? action.canStart : null,
      start: typeof action.start === 'function' ? action.start : null,
      update: typeof action.update === 'function' ? action.update : null,
      stop: typeof action.stop === 'function' ? action.stop : null,
      run: typeof action.run === 'function' ? action.run : null
    };
  }

  function compileGoal(goal) {
    if (!goal) return null;
    return {
      name: goal.name || '',
      priority: goal.priority == null ? 0 : goal.priority,
      desired: goal.desired || {}
    };
  }

  function compile(name, def) {
    var actions = [];
    var actionMap = {};
    var source = def.actions || [];
    for (var i = 0; i < source.length; i++) {
      var compiled = compileAction(source[i]);
      if (!compiled) continue;
      if (actionMap[compiled.name]) {
        if (window.console && console.warn) {
          console.warn('GOAP: duplicate action "' + compiled.name + '" in "' + name + '"');
        }
      }
      actions.push(compiled);
      actionMap[compiled.name] = compiled;
    }

    var goals = [];
    var goalSource = def.goals || [];
    for (var g = 0; g < goalSource.length; g++) {
      var compiledGoal = compileGoal(goalSource[g]);
      if (compiledGoal) goals.push(compiledGoal);
    }

    return {
      name: name,
      _compiled: true,
      facts: typeof def.facts === 'function' ? def.facts : function () { return {}; },
      goals: goals,
      actions: actions,
      actionMap: actionMap,
      idleTicks: Math.max(1, numberOr(def.idleTicks, DEFAULT_IDLE_TICKS)),
      idleJitter: Math.max(0, numberOr(def.idleJitter, DEFAULT_IDLE_JITTER)),
      noPlanPauseTicks: Math.max(1, numberOr(def.noPlanPauseTicks, DEFAULT_IDLE_TICKS)),
      goalPauseTicks: Math.max(0, numberOr(def.goalPauseTicks, DEFAULT_GOAL_PAUSE_TICKS))
    };
  }

  function define(name, def) {
    if (!name || !def) return null;
    var compiled = compile(name, def);
    definitions[name] = compiled;
    return compiled;
  }

  function get(name) {
    return definitions[name] || null;
  }

  function resolveDefinition(defOrName) {
    if (!defOrName) return null;
    if (typeof defOrName === 'string') return definitions[defOrName] || null;
    if (defOrName._compiled) return defOrName;
    if (compiledCache && compiledCache.has(defOrName)) return compiledCache.get(defOrName);
    var compiled = compile(defOrName.name || 'inline', defOrName);
    if (compiledCache) compiledCache.set(defOrName, compiled);
    return compiled;
  }

  // Bounded forward search over the boolean fact space. This is deliberately
  // small: mob plans are typically two or three actions, and the scheduler
  // limits how many plans may run per frame.
  function plan(defOrName, facts, mob, game, options) {
    var def = resolveDefinition(defOrName);
    options = options || {};
    if (!def) return null;
    var goal = options.goal || null;
    if (!goal) return null;

    facts = facts || {};
    if (satisfies(goal.desired, facts)) return [];

    var maxNodes = Math.max(1, numberOr(options.maxNodes, MAX_NODES));
    var maxDepth = Math.max(1, numberOr(options.maxDepth, MAX_DEPTH));
    var maxMs = Math.max(0, numberOr(options.maxMs, 0));
    var started = nowMs();

    var open = [{
      state: copyState(facts),
      actions: [],
      g: 0,
      depth: 0,
      f: unsatisfiedCount(goal.desired, facts)
    }];
    var bestG = {};
    bestG[stateSignature(facts)] = 0;
    var expanded = 0;

    while (open.length && expanded < maxNodes) {
      if (maxMs > 0 && (expanded & 7) === 0 && nowMs() - started > maxMs) break;

      var bestIndex = 0;
      for (var o = 1; o < open.length; o++) {
        if (open[o].f < open[bestIndex].f) bestIndex = o;
      }
      var node = open.splice(bestIndex, 1)[0];
      expanded++;

      if (satisfies(goal.desired, node.state)) return node.actions;
      if (node.depth >= maxDepth) continue;

      for (var a = 0; a < def.actions.length; a++) {
        var action = def.actions[a];
        if (!satisfies(action.pre, node.state)) continue;

        var next = copyState(node.state);
        if (!applyEffects(next, action.effects)) continue;

        var nextActions = node.actions.concat([action]);
        if (satisfies(goal.desired, next)) return nextActions;

        var signature = stateSignature(next);
        var g = node.g + actionCost(action, mob, node.state, game);
        var seen = bestG[signature];
        if (seen !== undefined && seen <= g) continue;
        bestG[signature] = g;

        open.push({
          state: next,
          actions: nextActions,
          g: g,
          depth: node.depth + 1,
          f: g + unsatisfiedCount(goal.desired, next)
        });
      }
    }
    return null;
  }

  function request(brain, goal, facts) {
    if (!brain || !goal || brain.stopped) return false;
    if (brain.queued) return false;
    if (queue.length >= MAX_PENDING) {
      stats.rejected++;
      return false;
    }
    brain.queued = true;
    queue.push({ brain: brain, goal: goal, facts: facts || {} });
    stats.queued++;
    return true;
  }

  function update(dt, game) {
    if (!queue.length) {
      stats.lastMs = 0;
      return;
    }
    var started = nowMs();
    var processed = 0;
    while (queue.length && processed < MAX_PLANS_PER_FRAME) {
      if (processed > 0 && nowMs() - started >= PLAN_BUDGET_MS) break;
      var req = queue.shift();
      var brain = req.brain;
      brain.queued = false;
      if (brain.stopped || brain.goal !== req.goal) continue;
      if (brain.mob && brain.mob.alive === false) continue;

      var result = plan(brain.def, req.facts, brain.mob, game, { goal: req.goal });
      processed++;
      if (result) {
        stats.planned++;
      } else {
        stats.failed++;
      }
      brain.receivePlan(result, game);
    }
    stats.processed += processed;
    stats.lastMs = nowMs() - started;
  }

  class GoapBrain {
    constructor(mob, def) {
      this.mob = mob;
      this.def = def;
      this.blackboard = {};
      this.facts = null;
      this.goal = null;
      this.plan = null;
      this.planIndex = 0;
      this.action = null;
      this.actionElapsed = 0;
      this.ctx = null;
      this.pauseTicks = 0;
      this.queued = false;
      this.stopped = false;
    }

    stop() {
      this.stopped = true;
      this.plan = null;
      this.goal = null;
      this.action = null;
      this.ctx = null;
      this.queued = false;
      this.pauseTicks = 0;
      if (this.mob && this.mob.stopMoving) this.mob.stopMoving();
    }

    wake() {
      if (!this.stopped) this.pauseTicks = 0;
    }

    isIdle() {
      return this.pauseTicks > 0;
    }

    update(dt, game) {
      if (this.stopped || (this.mob && this.mob.alive === false)) return;

      // Idle fast path: no facts, no goal scan, no planner work. This is the
      // main CPU saving for large populations of currently inactive mobs.
      if (this.pauseTicks > 0) {
        this.pauseTicks--;
        return;
      }
      if (this.queued) return;
      if (this.plan) {
        this.updateAction(dt, game);
        return;
      }
      this.chooseGoal(game);
    }

    chooseGoal(game) {
      var facts = {};
      try { facts = this.def.facts(this.mob, game) || {}; } catch (err) { facts = {}; }
      this.facts = facts;

      var best = null;
      var bestPriority = -Infinity;
      for (var i = 0; i < this.def.goals.length; i++) {
        var goal = this.def.goals[i];
        if (satisfies(goal.desired, facts)) continue;
        var priority = typeof goal.priority === 'function'
          ? goal.priority(this.mob, game, facts)
          : goal.priority;
        priority = Number(priority);
        if (isNaN(priority)) priority = 0;
        if (priority > bestPriority) {
          bestPriority = priority;
          best = goal;
        }
      }

      if (!best) {
        this.enterIdle(this.def.idleTicks, this.def.idleJitter);
        return;
      }

      if (this.mob && this.mob.stopMoving) this.mob.stopMoving();
      this.goal = best;
      if (!request(this, best, facts)) {
        this.goal = null;
        this.enterIdle(this.def.noPlanPauseTicks, this.def.idleJitter);
      }
    }

    receivePlan(result, game) {
      if (this.stopped || !this.goal) return;
      if (!result || !result.length) {
        this.goal = null;
        this.enterIdle(this.def.noPlanPauseTicks, this.def.idleJitter);
        return;
      }
      this.plan = result;
      this.planIndex = 0;
      this.startAction(game);
    }

    startAction(game) {
      var action = this.plan && this.plan[this.planIndex];
      if (!action) {
        this.completePlan(game);
        return;
      }

      this.action = action;
      this.actionElapsed = 0;
      this.ctx = {};

      if (action.canStart) {
        var canStart = false;
        try { canStart = action.canStart(this.mob, game, this.ctx); } catch (err) { canStart = false; }
        if (canStart === false) {
          this.failAction(game);
          return;
        }
      }

      if (action.start) {
        var started = true;
        try { started = action.start(this.mob, game, this.ctx); } catch (err) { started = false; }
        if (started === false || started === 'failed') {
          this.failAction(game);
          return;
        }
      }
    }

    updateAction(dt, game) {
      var action = this.action;
      if (!action) return;

      if (action.instant) {
        var ok = true;
        if (action.run) {
          try { ok = action.run(this.mob, game, this.ctx); } catch (err) { ok = false; }
        }
        if (ok === false || ok === 'failed') this.failAction(game);
        else this.finishAction(game);
        return;
      }

      this.actionElapsed += dt;
      if (action.timeout > 0 && this.actionElapsed > action.timeout) {
        this.failAction(game);
        return;
      }

      var result = 'running';
      if (action.update) {
        try { result = action.update(this.mob, dt, game, this.ctx); } catch (err) { result = 'failed'; }
      } else {
        result = 'done';
      }

      if (result === 'failed' || result === false) {
        this.failAction(game);
      } else if (result === 'done' || result === true) {
        this.finishAction(game);
      }
    }

    finishAction(game) {
      var action = this.action;
      if (action && action.stop) {
        try { action.stop(this.mob, game, this.ctx); } catch (err) {}
      }
      this.action = null;
      this.ctx = null;

      // An idle-style action can pause the brain before any further work.
      if (action && action.pauseTicks > 0) {
        this.plan = null;
        this.goal = null;
        this.enterIdle(action.pauseTicks, 0);
        return;
      }

      this.planIndex++;
      if (!this.plan || this.planIndex >= this.plan.length) {
        this.completePlan(game);
        return;
      }

      // The plan was built from a snapshot. Re-check the next action against
      // live facts so a moving target or changed world safely forces a replan.
      var facts = {};
      try { facts = this.def.facts(this.mob, game) || {}; } catch (err) { facts = {}; }
      this.facts = facts;
      var next = this.plan[this.planIndex];
      if (!satisfies(next.pre, facts)) {
        this.failPlan(game);
        return;
      }
      this.startAction(game);
    }

    completePlan(game) {
      this.plan = null;
      this.goal = null;
      this.enterIdle(this.def.goalPauseTicks, 0);
    }

    failAction(game) {
      var action = this.action;
      if (action && action.stop) {
        try { action.stop(this.mob, game, this.ctx); } catch (err) {}
      }
      this.action = null;
      this.ctx = null;
      this.failPlan(game);
    }

    failPlan(game) {
      this.plan = null;
      this.goal = null;
      this.enterIdle(this.def.noPlanPauseTicks, this.def.idleJitter);
    }

    enterIdle(ticks, jitter) {
      ticks = Math.max(1, numberOr(ticks, DEFAULT_IDLE_TICKS));
      jitter = Math.max(0, numberOr(jitter, 0));
      var offset = jitter > 0 ? (this.mob && this.mob.id ? this.mob.id : 0) % (jitter + 1) : 0;
      this.pauseTicks = ticks + offset;
      this.facts = null;
      this.plan = null;
      this.goal = null;
      if (this.mob && this.mob.stopMoving) this.mob.stopMoving();
    }
  }

  function createBrain(mob, defOrName) {
    var def = resolveDefinition(defOrName);
    if (!def) return null;
    return new GoapBrain(mob, def);
  }

  // Convenience action for schemas that want an explicit idle step in a plan.
  // The brain also has a built-in idle fallback when there is no plan or goal.
  function idleAction(opts) {
    opts = opts || {};
    return {
      name: opts.name || 'idle',
      cost: opts.cost == null ? 10 : opts.cost,
      pre: opts.pre || {},
      effects: opts.effects || {},
      instant: true,
      pauseTicks: Math.max(1, numberOr(opts.ticks, DEFAULT_IDLE_TICKS)),
      run: typeof opts.run === 'function' ? opts.run : function () { return true; }
    };
  }

  AllDogs.goap = {
    define: define,
    get: get,
    plan: plan,
    request: request,
    update: update,
    createBrain: createBrain,
    idleAction: idleAction,
    GoapBrain: GoapBrain,
    stats: stats,
    settings: {
      defaultIdleTicks: DEFAULT_IDLE_TICKS,
      defaultIdleJitter: DEFAULT_IDLE_JITTER,
      maxNodes: MAX_NODES,
      maxDepth: MAX_DEPTH,
      maxPlansPerFrame: MAX_PLANS_PER_FRAME,
      planBudgetMs: PLAN_BUDGET_MS,
      maxPending: MAX_PENDING
    }
  };
})();
