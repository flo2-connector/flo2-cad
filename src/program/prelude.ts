// The program's side of the confinement: the JavaScript that runs INSIDE the program's
// own context (a fresh V8 realm with only the language's built-ins, and no require,
// import, process, file system, network or timers), before the program, and gives it
// the library's functions as globals.
//
// It holds ONE capability, `bridge(name, jsonText) -> jsonText`, captured in a closure
// the program cannot reach. Everything it sends is JSON text, and everything it gets back
// is JSON text it parses itself, so every object the program ever touches was made in its
// own realm: no object, function or error from the engine's realm crosses, and none of
// their constructors with them (the classic way out of a vm context). A failure in the
// engine comes back as text and is thrown here as the program's own Error, so the line
// that failed is in its stack. What the program gets for a solid, a stone or a 2D
// profile is a frozen object of its own realm that names a handle; the geometry and every
// checker declaration stay in the engine's table (library.ts).
//
// None of this is the security boundary on its own, and none of it needs to be trusted:
// the program can rewrite anything here (it shares the realm). It gains nothing by it,
// because the engine side takes only names and JSON, checks every argument, and keeps
// the declarations itself. See src/program/run.ts for the boundary as a whole.

export const PRELUDE_FILENAME = 'flo2-cad-library.js';
export const PROGRAM_FILENAME = 'program.js';

/** Evaluated in the program's context; its value is a function taking the bridge and returning the runner. */
export const PRELUDE = String.raw`(function (bridge) {
  'use strict';
  const G = globalThis;
  const stringify = JSON.stringify, parse = JSON.parse;
  const freeze = Object.freeze, keys = Object.keys, define = Object.defineProperty, isArray = Array.isArray;
  const apply = Reflect.apply, ErrorCtor = Error, StringCtor = String;
  const handles = new WeakMap();
  const wmGet = WeakMap.prototype.get, wmSet = WeakMap.prototype.set;
  const handleOf = (o) => apply(wmGet, handles, [o]);
  const logs = [];

  function encode(v, depth) {
    if (depth > 64) throw new ErrorCtor('an argument is nested more than 64 deep');
    if (v === null || v === undefined) return null;
    const t = typeof v;
    if (t === 'number' || t === 'string' || t === 'boolean') return v;
    if (t === 'object') {
      const h = handleOf(v);
      if (h) return h.t === 'solid' ? { $solid: h.id } : h.t === 'stone' ? { $stone: h.id } : { $profile: h.id };
      if (isArray(v)) {
        const out = [];
        for (let i = 0; i < v.length; i++) out.push(encode(v[i], depth + 1));
        return out;
      }
      const out = {};
      for (const k of keys(v)) if (v[k] !== undefined) define(out, k, { value: encode(v[k], depth + 1), enumerable: true });
      return out;
    }
    throw new ErrorCtor('an argument is a ' + t + '; a call takes numbers, text, lists, objects of settings, and what the library made');
  }

  function make(C, t, id, dims) {
    const o = new C();
    apply(wmSet, handles, [o, freeze({ t, id })]);
    if (dims !== undefined) define(o, 'dims', { value: deepFreeze(dims), enumerable: true });
    return freeze(o);
  }
  function deepFreeze(v) {
    if (v && typeof v === 'object') {
      for (const k of keys(v)) deepFreeze(v[k]);
      freeze(v);
    }
    return v;
  }
  function decode(v) {
    if (v && typeof v === 'object' && !isArray(v)) {
      if (typeof v.$solid === 'number') return make(Solid, 'solid', v.$solid, v.dims);
      if (typeof v.$stone === 'number') return make(Stone, 'stone', v.$stone, v.dims);
      if (typeof v.$profile === 'number') return make(Profile, 'profile', v.$profile);
    }
    return v;
  }

  function call(name, args) {
    while (args.length && args[args.length - 1] === undefined) args.length--;
    const text = stringify(encode(args, 0));
    let out;
    try {
      out = bridge(name, text);
    } catch {
      throw new ErrorCtor(name + ': the engine could not finish this call (the program may have called too deeply)');
    }
    if (typeof out !== 'string') throw new ErrorCtor(name + ': the engine gave no answer');
    const r = parse(out);
    if (r.error !== undefined) throw new ErrorCtor(StringCtor(r.error));
    return decode(r.ok);
  }

  class Solid {
    translate(...a) { return call('translate', [this, ...a]); }
    rotate(...a) { return call('rotate', [this, ...a]); }
    mirror(plane) { return call('mirror', [this, plane]); }
    scale(f) { return call('scale', [this, f]); }
    add(...o) { return call('union', [this, ...o]); }
    subtract(...o) { return call('difference', [this, ...o]); }
    intersect(...o) { return call('intersection', [this, ...o]); }
    named(name) { return call('named', [this, name]); }
    bounds() { return call('bounds', [this]); }
    volume() { return call('volume', [this]); }
    slice(z) { return call('slice', [this, z]); }
    project() { return call('project', [this]); }
    trim(normal, offset) { return call('trim', [this, normal, offset]); }
  }
  class Profile {
    offset(d, o) { return call('p_offset', [this, d, o]); }
    add(q) { return call('p_add', [this, q]); }
    subtract(q) { return call('p_subtract', [this, q]); }
    intersect(q) { return call('p_intersect', [this, q]); }
    translate(...a) { return call('p_translate', [this, ...a]); }
    rotate(deg) { return call('p_rotate', [this, deg]); }
    scale(f) { return call('p_scale', [this, f]); }
    mirror(n) { return call('p_mirror', [this, n]); }
    hull() { return call('p_hull', [this]); }
    bounds() { return call('p_bounds', [this]); }
    area() { return call('p_area', [this]); }
  }
  class Stone {}
  for (const C of [Solid, Profile, Stone]) { freeze(C.prototype); freeze(C); }

  const api = {
    sphere: (r) => call('sphere', [r]),
    cylinder: (r, h, o) => call('cylinder', [r, h, o]),
    box: (...a) => call('box', a),
    torus: (R, r) => call('torus', [R, r]),
    sweep: (r, path, o) => call('sweep', [r, path, o]),
    extrude: (p, h, o) => call('extrude', [p, h, o]),
    revolve: (p, o) => call('revolve', [p, o]),
    hull: (...s) => call('hull', s),
    hullPoints: (pts) => call('hullPoints', [pts]),
    union: (...s) => call('union', s),
    difference: (...s) => call('difference', s),
    intersection: (...s) => call('intersection', s),
    smoothUnion: (r, ...s) => call('smoothUnion', [r, ...s]),
    op: (node) => call('op', [node]),
    segments: (r) => call('segments', [r]),
    circle: (r) => call('circle', [r]),
    rect: (x, y, o) => call('rect', [x, y, o]),
    polygon: (pts) => call('polygon', [pts]),
    ringShank: (o) => call('ringShank', [o]),
    roundStone: (o) => call('roundStone', [o]),
    emeraldStone: (o) => call('emeraldStone', [o]),
    cabochon: (o) => call('cabochon', [o]),
    stone: (s, o) => call('stone', [s, o]),
    prongHead: (o) => call('prongHead', [o]),
    bezel: (o) => call('bezel', [o]),
    thicken: (o) => call('thicken', [o]),
    translate: (s, ...a) => call('translate', [s, ...a]),
    rotate: (s, ...a) => call('rotate', [s, ...a]),
    mirror: (s, p) => call('mirror', [s, p]),
    scale: (s, f) => call('scale', [s, f]),
  };
  const say = (...a) => {
    if (logs.length < 50) logs.push(a.map((x) => { try { return typeof x === 'string' ? x : stringify(x); } catch { return '?'; } }).join(' ').slice(0, 300));
  };
  api.console = freeze({ log: say, info: say, warn: say, error: say });
  for (const k of keys(api)) define(G, k, { value: freeze(api[k]), writable: false, enumerable: false, configurable: false });
  delete G.WebAssembly;
  // The same piece every time: a check runs the program twice (the casting file and its finer
  // reference), so Math.random is a fixed-seed generator (mulberry32), not the system's.
  let seed = 0x5eed1e55;
  define(Math, 'random', { value: function random() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }, writable: true, configurable: true });

  function describe(e) {
    let message = 'the program threw something that is not an error';
    let line = null;
    try { message = e instanceof ErrorCtor ? StringCtor(e.message) : StringCtor(e); } catch {}
    try {
      const m = /program\.js:(\d+)/.exec(e instanceof ErrorCtor ? StringCtor(e.stack) : '');
      if (m) line = +m[1];
    } catch {}
    return { message: message.slice(0, 1000), line };
  }
  function kindOf(v) {
    if (v === undefined) return 'nothing (is "return" missing?)';
    if (v === null) return 'null';
    return typeof v === 'object' ? (handleOf(v) ? 'a ' + handleOf(v).t : 'an object') : 'a ' + typeof v;
  }

  return function run(program) {
    let v;
    try {
      v = program();
    } catch (e) {
      return stringify({ error: describe(e), logs });
    }
    try {
      if (v !== null && typeof v === 'object' && typeof v.then === 'function') {
        return stringify({ error: { message: 'the program returned a promise; a program builds the piece and returns it at once (no await, no timers).', line: null }, logs });
      }
    } catch (e) {
      return stringify({ error: describe(e), logs });
    }
    const h = v !== null && typeof v === 'object' ? handleOf(v) : undefined;
    if (!h || h.t !== 'solid') return stringify({ error: { message: 'the program must end by returning the piece, one solid, for example "return union(band, head);". It returned ' + kindOf(v) + '.', line: null }, logs });
    return stringify({ ok: h.id, logs });
  };
})`;
