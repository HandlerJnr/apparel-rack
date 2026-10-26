import { createFittingRoom } from "./fitting-room.js";
import { SIZES, PRODUCTS, GARMENT_META } from "./catalogue.js";
import { initDropMotion } from "./drop-motion.js";

(function () {
  "use strict";
  document.documentElement.classList.add("js");

  /* ================================================================
     Data. One entry per garment, in rail order. Keep ids in step with the
     rail markup, the drop cards and CATALOGUE in src/worker.ts. `stock` is
     per size (0 = sold out); it is in-memory and resets on reload.
     ================================================================ */

  var FREE_DELIVERY = 60;
  var LOW_STOCK = 3;

  function $(id) { return document.getElementById(id); }
  function img(p, view) { return "/img/garments/" + p.id + "-" + view + ".webp"; }
  function gbp(n) { return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: n % 1 ? 2 : 0 }); }
  function gbp2(n) { return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  var body = document.body;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  var small = window.matchMedia("(max-width: 760px)");

  /* ================================================================
     The rail: a small physics simulation.

     Each garment is a cloth strip hanging from its hook, made of NODES
     points joined into a chain (Verlet integration, fixed 240 Hz substeps):
       - gravity pulls it straight; bending constraints keep it from folding
         like a rope, so it swings as one piece of fabric but still bends;
       - the hook slides along the rail on a spring; when a neighbour turns
         round and needs room, the others are pushed along and their hems lag,
         swing and settle;
       - the cursor brushes the cloth it passes, you can grab a garment and
         fling it, and neighbouring hems knock into each other.
     The turn is a separate torsion chain: the hanger turns on a spring and
     each point below follows the one above, so the shoulders come round
     first and the hem follows a moment later, overshoots, and floats back.
     ================================================================ */
  var rail = $("rail");
  var hangs = Array.prototype.slice.call(rail.querySelectorAll(".hang"));
  var N = hangs.length, NODES = 12, HALF_PI = Math.PI / 2, SUB = 1 / 240;
  var K = {
    slide: 78, slideDamp: 14.5,     /* hook along the rail */
    lift: 90, liftDamp: 15,         /* hook toward you when a piece is chosen */
    turn: 230, turnIn: 15, turnOut: 21, /* the hanger turning (damping in / out) */
    twist: 22000, twistRel: 70, twistAbs: 6, /* torsion down the garment */
    air: 1.6,                       /* cloth damping, per second: low = floaty */
    bend: 0.16,                     /* resistance to folding */
    brush: 0.16,                    /* how much a passing cursor pushes */
    breeze: 0.08                    /* idle sway, as a fraction of hang height */
  };
  var geo = { w: 0, h: 0, slot: 0, seg: 0, mx: 0, mt: 0, mb: 0, D: 1500 };
  var active = -1, yawAim = 0, grab = null, clock = 0, breezeOn = !reduced, heroVisible = true;
  var acc = new Float32Array(NODES);

  var G = hangs.map(function (el, i) {
    function arr() { return new Float32Array(NODES); }
    return {
      i: i, el: el, sw: el.querySelector(".swing"), front: el.querySelector(".v-front"), side: el.querySelector(".v-side"),
      m: GARMENT_META[PRODUCTS[i].id],
      px: 0, pvx: 0, py: 0, pvy: 0, pz: 0, pvz: 0, drop: 0,
      th: HALF_PI, thv: 0, tw: arr(), twv: arr(),
      x: arr(), y: arr(), z: arr(), ox: arr(), oy: arr(), oz: arr(),
      tx: 0, w: 0, home: 0, Wf: 0, Ds: 0, flutter: 0, hidden: false, face: 0, fa: 0
    };
  });

  function turnOf(g) { return clamp(1 - g.th / HALF_PI, 0, 1); }

  function measure() {
    geo.w = rail.clientWidth;
    geo.h = hangs[0].offsetHeight;
    geo.slot = geo.w / N;
    geo.seg = geo.h / (NODES - 1);
    geo.mx = Math.round(geo.h * 0.55);
    geo.mt = Math.round(geo.h * 0.14);
    geo.mb = Math.round(geo.h * 0.6);
    G.forEach(function (g, i) {
      g.home = geo.slot * (i + 0.5);
      g.Wf = g.m.front.aspect * geo.h;
      g.Ds = g.m.side.aspect * geo.h;
    });
    if (gl) sizeCanvas();
  }

  /* Each garment wants its resting slot, widened towards its front width as
     it turns. What that adds is taken back from the others in proportion,
     so the total is always exactly the rail. */
  function layout() {
    var cap = small.matches ? geo.w * 0.72 : Infinity;
    var want = [], extra = 0, give = 0;
    G.forEach(function (g) {
      var f = turnOf(g);
      var w = geo.slot + Math.max(0, Math.min(g.Wf * 0.86, cap) - geo.slot) * f;
      want.push(w); extra += w - geo.slot; give += 1 - f;
    });
    var cur = 0;
    G.forEach(function (g, i) {
      var w = want[i] - (give > 0 ? extra * (1 - turnOf(g)) / give : 0);
      g.w = w; g.tx = cur + w / 2; cur += w;
    });
  }

  function hangFrom(g, y0) {
    for (var k = 0; k < NODES; k++) {
      g.x[k] = g.ox[k] = g.px;
      g.y[k] = g.oy[k] = y0 + k * geo.seg;
      g.z[k] = g.oz[k] = g.pz;
    }
  }

  function targetTurn(g) {
    if (g.i === active) return clamp(yawAim, -0.26, 0.26);
    return HALF_PI + (breezeOn ? 0.022 * Math.sin(clock * 0.7 + g.i * 2.1) : 0);
  }
  function targetLift(g) { return g.i === active && !small.matches ? geo.h * 0.06 : 0; }

  /* Jump straight to rest: first paint, resize, reduced motion. */
  function settleAll() {
    G.forEach(function (g) {
      g.th = targetTurn(g); g.thv = 0;
      g.tw.fill(g.th); g.twv.fill(0);
      g.face = g.th < 1.17 ? 1 : 0; g.fa = g.face;
      g.py = 0; g.pvy = 0; g.drop = 0; g.pz = targetLift(g); g.pvz = 0;
    });
    layout();
    G.forEach(function (g) { g.px = g.tx; g.pvx = 0; hangFrom(g, 0); });
  }

  /* Half the garment's width at a node, seen from the front of the rail. */
  function halfWidth(g, k) {
    var t = g.tw[k], body = (g.m.front.bodyR - g.m.front.bodyL) * g.Wf;
    return 0.5 * (Math.abs(Math.cos(t)) * body + Math.abs(Math.sin(t)) * g.Ds * 0.8);
  }

  function step(dt) {
    clock += dt;
    layout();
    var grav = 14 * geo.h, air = 1 - K.air * dt, seg = geo.seg, dt2 = dt * dt;
    for (var gi = 0; gi < N; gi++) {
      var g = G[gi], k;
      /* the hook: along the rail, toward you, and the drop-in on load */
      var ax = K.slide * (g.tx - g.px) - K.slideDamp * g.pvx; g.pvx += ax * dt; g.px += g.pvx * dt;
      var az = K.lift * (targetLift(g) - g.pz) - K.liftDamp * g.pvz; g.pvz += az * dt; g.pz += g.pvz * dt;
      if (g.drop > 0) g.drop -= dt;
      else { var ay = 260 * -g.py - 21 * g.pvy; g.pvy += ay * dt; g.py += g.pvy * dt; }

      /* the hanger turning, and the twist travelling down the cloth */
      var tq = K.turn * (targetTurn(g) - g.th) - (g.i === active ? K.turnIn : K.turnOut) * g.thv;
      g.thv += tq * dt; g.th += g.thv * dt;
      var tw = g.tw, tv = g.twv;
      tw[0] = g.th; tv[0] = g.thv;
      for (k = 1; k < NODES; k++) {
        var last = k === NODES - 1;
        acc[k] = K.twist * ((tw[k - 1] - tw[k]) + (last ? 0 : tw[k + 1] - tw[k]))
               + K.twistRel * ((tv[k - 1] - tv[k]) + (last ? 0 : tv[k + 1] - tv[k]))
               - K.twistAbs * tv[k];
      }
      for (k = 1; k < NODES; k++) { tv[k] += acc[k] * dt; tw[k] += tv[k] * dt; }

      /* Which photo shows. The whole garment swaps at once (rows switching on
         their own leave a seam when the hem lags), at the angle where the
         turned front photo is as narrow as the side one, with a little
         hysteresis so it can't flicker. It's an instant swap: any fade, however
         short, shows the cloth as see-through in some frame. */
      var mean = 0;
      for (k = 1; k < NODES; k++) mean += tw[k];
      mean /= NODES - 1;
      if (!g.face && mean < 1.14) g.face = 1;
      else if (g.face && mean > 1.2) g.face = 0;
      g.fa = g.face;

      /* the cloth: Verlet with gravity, air damping and a little breeze */
      var wind = breezeOn && heroVisible ? K.breeze * geo.h * (Math.sin(clock * 0.83 + gi * 1.7) * 0.6 + Math.sin(clock * 1.91 + gi * 0.6) * 0.4) : 0;
      var vmax = 2400 * dt;
      for (k = 1; k < NODES; k++) {
        var vx = clamp((g.x[k] - g.ox[k]) * air, -vmax, vmax), vy = (g.y[k] - g.oy[k]) * air, vz = clamp((g.z[k] - g.oz[k]) * air, -vmax, vmax);
        g.ox[k] = g.x[k]; g.oy[k] = g.y[k]; g.oz[k] = g.z[k];
        g.x[k] += vx + wind * (k / (NODES - 1)) * dt2;
        g.y[k] += vy + grav * dt2;
        g.z[k] += vz;
      }
      if (hand.on && gi !== active) drag(g, dt);
    }
    if (clock - hand.at > 0.05) hand.vx *= Math.max(0, 1 - 12 * dt);
    for (var it = 0; it < 4; it++) {
      for (gi = 0; gi < N; gi++) {
        g = G[gi];
        g.x[0] = g.ox[0] = g.px; g.y[0] = g.oy[0] = g.py; g.z[0] = g.oz[0] = g.pz;
        for (k = 1; k < NODES; k++) link(g, k - 1, k, seg, 1, k === 1);
        for (k = 2; k < NODES; k++) link(g, k - 2, k, seg * 2, K.bend, k === 2);
      }
      if (grab) pull();
    }
    collide();
  }

  /* Keep two points `rest` apart (only pushes apart for bending links). */
  function link(g, a, b, rest, stiff, pinA) {
    var dx = g.x[b] - g.x[a], dy = g.y[b] - g.y[a], dz = g.z[b] - g.z[a];
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    if (stiff < 1 && d >= rest) return;
    var c = (d - rest) / d * stiff;
    if (pinA) { g.x[b] -= dx * c; g.y[b] -= dy * c; g.z[b] -= dz * c; }
    else {
      c *= 0.5;
      g.x[a] += dx * c; g.y[a] += dy * c; g.z[a] += dz * c;
      g.x[b] -= dx * c; g.y[b] -= dy * c; g.z[b] -= dz * c;
    }
  }

  /* Neighbouring hems can't pass through each other: a flung garment knocks
     the next one, which knocks the next. The limit is measured from where the
     two hooks are right now, so garments sliding along the rail, or resting
     close together, never shove each other apart. */
  function collide() {
    for (var gi = 0; gi < N - 1; gi++) {
      var a = G[gi], b = G[gi + 1], spacing = b.px - a.px;
      for (var k = 3; k < NODES; k++) {
        var minSep = Math.min(spacing * 0.92, 0.75 * (halfWidth(a, k) + halfWidth(b, k)));
        var d = b.x[k] - a.x[k];
        if (d < minSep) { var c = (minSep - d) * 0.15; a.x[k] -= c; b.x[k] += c; }
      }
    }
  }

  /* The cursor moving through the cloth acts like a hand: it drags the fabric
     it's inside toward its own speed, never beyond it. Slow movement parts
     the clothes gently; a quick sweep sends them swinging. */
  var hand = { on: false, x: 0, y: 0, vx: 0, t: 0, at: 0 };
  function drag(g, dt) {
    var f0 = 1 - Math.exp(-9 * dt), target = hand.vx * dt;
    for (var k = 2; k < NODES; k++) {
      var dy = (hand.y - g.y[k]) / (geo.h * 0.17); if (dy * dy > 1) continue;
      var hw = halfWidth(g, k) + 4, dx = (hand.x - g.x[k]) / hw; if (dx * dx > 1) continue;
      var f = f0 * (1 - dy * dy) * (1 - dx * dx * 0.6) * K.brush * 6;
      var v = g.x[k] - g.ox[k];
      g.ox[k] = g.x[k] - (v + (target - v) * f);
      g.oz[k] += Math.abs(target) * 0.12 * f;
    }
  }

  /* Dragging: the grabbed point follows the pointer, within reach of the hook. */
  function pull() {
    var g = grab.g, k = grab.k;
    var dx = grab.x - g.px, dy = grab.y - g.py, reach = k * geo.seg, d = Math.sqrt(dx * dx + dy * dy);
    if (d > reach) { dx *= reach / d; dy *= reach / d; }
    g.x[k] += (g.px + dx - g.x[k]) * 0.35;
    g.y[k] += (g.py + dy - g.y[k]) * 0.35;
  }

  function moveHand(x, y, now) {
    if (reduced) return;
    if (hand.on && now > hand.t) {
      var inst = clamp((x - hand.x) / ((now - hand.t) / 1000), -2600, 2600);
      hand.vx += (inst - hand.vx) * 0.5;
    }
    hand.on = true; hand.x = x; hand.y = y; hand.t = now; hand.at = clock;
    kick();
  }

  function moving() {
    for (var i = 0; i < N; i++) {
      var g = G[i];
      if (Math.abs(g.pvx) > 0.4 || Math.abs(g.pvz) > 0.4 || Math.abs(g.pvy) > 0.4 || g.drop > 0 || Math.abs(g.py) > 0.3) return true;
      if (Math.abs(g.thv) > 0.004 || Math.abs(targetTurn(g) - g.th) > 0.003) return true;
      if (Math.abs(g.tx - g.px) > 0.3) return true;
      for (var k = 1; k < NODES; k++) {
        if (Math.abs(g.twv[k]) > 0.01) return true;
        if (Math.abs(g.x[k] - g.ox[k]) > 0.01 || Math.abs(g.z[k] - g.oz[k]) > 0.01) return true;
      }
    }
    return false;
  }

  var running = false, lastT = 0, accum = 0;
  function frame(now) {
    var dt = clamp((now - lastT) / 1000 || 0.016, 0, 0.05);
    lastT = now; accum += dt;
    var n = 0;
    while (accum >= SUB && n < 14) { step(SUB); accum -= SUB; n++; }
    if (n === 14) accum = 0;
    draw(dt);
    var awake = grab || moving() || (breezeOn && heroVisible);
    if (awake && !document.hidden) requestAnimationFrame(frame);
    else running = false;
  }
  function kick() {
    if (reduced) { settleAll(); draw(0); return; }
    if (!running) { running = true; lastT = performance.now(); requestAnimationFrame(frame); }
  }

  /* ---------------- Geometry shared by the renderer and the tag ---------------- */
  /* Point on the chain at arc length s (Catmull-Rom), with its twist. */
  function ropeAt(g, s, out) {
    var f = clamp(s / geo.seg, 0, NODES - 1.0001), i = Math.floor(f), t = f - i;
    function P(arr, j) {
      if (j < 0) return 2 * arr[0] - arr[1];
      if (j > NODES - 1) return 2 * arr[NODES - 1] - arr[NODES - 2];
      return arr[j];
    }
    function cr(arr) {
      var p0 = P(arr, i - 1), p1 = P(arr, i), p2 = P(arr, i + 1), p3 = P(arr, i + 2), t2 = t * t, t3 = t2 * t;
      return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    }
    out[0] = cr(g.x); out[1] = cr(g.y); out[2] = cr(g.z); out[3] = cr(g.tw);
    return out;
  }
  var _a = [0, 0, 0, 0], _b = [0, 0, 0, 0];
  /* A point on the front photo's plane (u, v in 0..1), in rail space. */
  function frontPoint(g, u, v) {
    ropeAt(g, v * geo.h, _a); ropeAt(g, v * geo.h + 2, _b);
    var tx = _b[0] - _a[0], ty = _b[1] - _a[1] + 1e-4, tz = _b[2] - _a[2], tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    tx /= tl; ty /= tl; tz /= tl;
    var rx = Math.cos(_a[3]), rz = -Math.sin(_a[3]), dot = rx * tx + rz * tz;
    rx -= dot * tx; var ry = -dot * ty; rz -= dot * tz;
    var rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    var lx = (u - g.m.front.hookX) * g.Wf;
    return [_a[0] + rx / rl * lx, _a[1] + ry / rl * lx, _a[2] + rz / rl * lx];
  }
  /* Rail space → rail-relative CSS pixels, with the renderer's perspective. */
  function toScreen(p) {
    var vx = geo.w / 2, vy = 6 + geo.h * 0.42, s = geo.D / (geo.D - p[2]);
    return [vx + (p[0] - vx) * s, vy + (p[1] + 6 - vy) * s];
  }

  /* ---------------- WebGL renderer ---------------- */
  var gl = null, canvas = null, prog = null, U = {}, meshes = {}, glReady = false;

  var VS = "#version 300 es\n" +
    "precision highp float;\n" +
    "in vec2 aUV;\n" +
    "uniform vec4 uNode[12];\n" +
    "uniform float uSeg, uH, uWidth, uHookX, uFlutter, uTime, uWallZ, uFrontA;\n" +
    "uniform int uPlane, uShadow;\n" +
    "uniform vec4 uBody;\n" +
    "uniform vec4 uView;\n" +   /* vanishing point x, y (canvas css), camera distance, depth scale */
    "uniform vec2 uRes, uOrigin;\n" +
    "uniform vec3 uLight;\n" +
    "out vec2 vUV; out float vAlpha; out float vShade;\n" +
    "vec4 nd(int i) { return uNode[clamp(i, 0, 11)]; }\n" +
    "vec4 rope(float s) {\n" +
    "  float f = clamp(s / uSeg, 0.0, 10.999); int i = int(floor(f)); float t = f - float(i);\n" +
    "  vec4 p1 = nd(i), p2 = nd(i + 1);\n" +
    "  vec4 p0 = i == 0 ? 2.0 * p1 - p2 : nd(i - 1);\n" +
    "  vec4 p3 = i >= 10 ? 2.0 * p2 - p1 : nd(i + 2);\n" +
    "  float t2 = t * t, t3 = t2 * t;\n" +
    "  return 0.5 * (2.0 * p1 + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);\n" +
    "}\n" +
    "vec3 surf(vec2 uv, out float tw) {\n" +
    "  float s = uv.y * uH; vec4 c = rope(s); vec4 c2 = rope(s + 2.0);\n" +
    "  vec3 T = normalize(c2.xyz - c.xyz + vec3(0.0, 1e-4, 0.0));\n" +
    "  tw = c.w;\n" +
    "  vec3 r0 = vec3(cos(tw), 0.0, -sin(tw));\n" +
    "  vec3 r = normalize(r0 - dot(r0, T) * T);\n" +
    "  vec3 fw = normalize(cross(r, T));\n" +
    "  float lx = (uv.x - uHookX) * uWidth;\n" +
    "  if (uPlane == 1) return c.xyz + fw * lx;\n" +
    /* the front photo gets a chest: a gentle curve inside the body, flat sleeves,
       and fabric ripples that only appear while the garment is moving */
    "  float bc = 0.5 * (uBody.x + uBody.y), bh = max(0.05, 0.5 * (uBody.y - uBody.x));\n" +
    "  float q = clamp((uv.x - bc) / bh, -1.0, 1.0);\n" +
    "  float prof = smoothstep(uBody.z, uBody.z + 0.14, uv.y) * (1.0 - 0.4 * uv.y);\n" +
    "  float bz = uBody.w * (1.0 - q * q) * prof;\n" +
    "  float fl = uFlutter * sin(uv.x * 21.0 + uv.y * 9.0 - uTime * 6.0) * sin(uv.y * 3.14159) * prof;\n" +
    "  return c.xyz + r * lx + fw * (bz + fl);\n" +
    "}\n" +
    "vec4 project(vec3 p) {\n" +
    "  vec2 sc = p.xy + uOrigin; vec2 d = sc - uView.xy; float w = uView.z - p.z;\n" +
    "  vec2 base = vec2(uView.x * 2.0 / uRes.x - 1.0, 1.0 - uView.y * 2.0 / uRes.y);\n" +
    "  return vec4(base.x * w + d.x * 2.0 * uView.z / uRes.x, base.y * w - d.y * 2.0 * uView.z / uRes.y, -p.z * uView.w * w, w);\n" +
    "}\n" +
    "void main() {\n" +
    "  float tw; vec3 p = surf(aUV, tw);\n" +
    /* which photo is showing is decided per garment on the CPU (see "Which photo shows") */
    "  vAlpha = uFrontA;\n" +   /* the opacity this draw call is given */
    "  vUV = aUV;\n" +
    "  if (uShadow == 1) {\n" +
    "    p = p + uLight * ((uWallZ - p.z) / uLight.z);\n" +
    "    vShade = 1.0; gl_Position = project(p); return;\n" +
    "  }\n" +
    "  float t2; vec3 pu = surf(aUV + vec2(0.01, 0.0), t2); vec3 pv = surf(aUV + vec2(0.0, 0.01), t2);\n" +
    "  vec3 n = normalize(cross(pu - p, pv - p)); if (n.z < 0.0) n = -n;\n" +
    "  vec3 L = normalize(vec3(-0.36, -0.42, 0.83));\n" +
    "  vShade = 0.66 + 0.34 * clamp(dot(n, L) / L.z, 0.0, 1.12);\n" +
    /* the front photo arrives at the side photo's brightness, so the swap doesn't
       flash; it dips a little mid-turn and comes back as it faces the light */
    "  if (uPlane == 0) vShade = mix(vShade, 1.0, smoothstep(0.85, 1.17, tw));\n" +
    "  gl_Position = project(p);\n" +
    "}\n";
  var FS = "#version 300 es\n" +
    "precision mediump float;\n" +
    "precision highp int;\n" +
    "uniform sampler2D uTex; uniform int uShadow; uniform float uShadowA;\n" +
    "in vec2 vUV; in float vAlpha; in float vShade;\n" +
    "out vec4 o;\n" +
    "void main() {\n" +
    "  vec4 c = texture(uTex, vUV);\n" +
    "  if (uShadow == 1) { o = vec4(0.06, 0.07, 0.09, 1.0) * (c.a * vAlpha * uShadowA); return; }\n" +
    "  o = vec4(c.rgb * vShade, c.a) * vAlpha;\n" +
    "}\n";

  function shader(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function grid(cols, rows) {
    var uv = [], idx = [];
    for (var r = 0; r <= rows; r++) for (var c = 0; c <= cols; c++) uv.push(c / cols, r / rows);
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
      var a = r * (cols + 1) + c, b = a + cols + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "aUV"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao: vao, count: idx.length };
  }
  function texture(source) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var an = gl.getExtension("EXT_texture_filter_anisotropic");
    if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    return t;
  }
  /* A soft copy of the silhouette for the shadow on the wall. */
  function blurred(im) {
    var s = 0.25, c = document.createElement("canvas");
    c.width = Math.max(4, Math.round(im.naturalWidth * s)); c.height = Math.max(4, Math.round(im.naturalHeight * s));
    var x = c.getContext("2d"); x.filter = "blur(3px)"; x.drawImage(im, 0, 0, c.width, c.height);
    return c;
  }

  function initGL() {
    try {
      canvas = document.createElement("canvas");
      canvas.className = "rail-gl";
      canvas.setAttribute("aria-hidden", "true");
      gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true });
      if (!gl) { canvas = null; return; }
      prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      ["uNode", "uSeg", "uH", "uWidth", "uHookX", "uFlutter", "uTime", "uWallZ", "uFrontA", "uPlane", "uShadow", "uBody", "uView", "uRes", "uOrigin", "uLight", "uTex", "uShadowA"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
      meshes.front = grid(28, 44);
      meshes.side = grid(8, 44);
    } catch (e) {
      /* No WebGL2 or a shader failed: the photos stay on, driven by the same physics. */
      if (window.console) console.warn("Hangtime rail: drawing without WebGL —", e && e.message);
      gl = null; canvas = null; return;
    }

    var imgs = [];
    G.forEach(function (g) { imgs.push(g.front, g.side); });
    var ready = imgs.map(function (im) {
      if (im.complete && im.naturalWidth) return Promise.resolve();
      return im.decode ? im.decode().catch(function () {}) : new Promise(function (r) { im.onload = im.onerror = r; });
    });
    Promise.all(ready).then(function () {
      if (!gl || imgs.some(function (im) { return !im.naturalWidth; })) return;
      G.forEach(function (g) {
        g.tF = texture(g.front); g.tS = texture(g.side);
        g.bF = texture(blurred(g.front)); g.bS = texture(blurred(g.side));
      });
      rail.appendChild(canvas);
      sizeCanvas();
      glReady = true;
      rail.classList.add("gl");
      kick(); draw(0);
    });
    canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); glReady = false; rail.classList.remove("gl"); });
  }

  function sizeCanvas() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = geo.w + geo.mx * 2, ch = geo.h + geo.mt + geo.mb + 6;
    canvas.style.left = -geo.mx + "px"; canvas.style.top = -geo.mt + "px";
    canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    geo.cw = cw; geo.ch = ch;
  }

  var nodeBuf = new Float32Array(48);
  function drawGarment(g, shadow) {
    for (var k = 0; k < NODES; k++) {
      nodeBuf[k * 4] = g.x[k]; nodeBuf[k * 4 + 1] = g.y[k]; nodeBuf[k * 4 + 2] = g.z[k]; nodeBuf[k * 4 + 3] = g.tw[k];
    }
    gl.uniform4fv(U.uNode, nodeBuf);
    gl.uniform1f(U.uFlutter, reduced ? 0 : g.flutter);
    var mf = g.m.front, ms = g.m.side;
    /* Side photo underneath, fully opaque; the front photo fades in over it.
       Fading both at once would let you see through the cloth mid-swap. */
    if (g.fa < 0.999) { /* the side photo */
      gl.uniform1f(U.uFrontA, shadow ? 1 - g.fa : 1);
      gl.uniform1i(U.uPlane, 1); gl.uniform1f(U.uWidth, g.Ds); gl.uniform1f(U.uHookX, ms.hookX);
      gl.bindTexture(gl.TEXTURE_2D, shadow ? g.bS : g.tS);
      gl.bindVertexArray(meshes.side.vao); gl.drawElements(gl.TRIANGLES, meshes.side.count, gl.UNSIGNED_SHORT, 0);
    }
    if (g.fa > 0.001) { /* the front photo */
      gl.uniform1f(U.uFrontA, g.fa);
      gl.uniform1i(U.uPlane, 0); gl.uniform1f(U.uWidth, g.Wf); gl.uniform1f(U.uHookX, mf.hookX);
      gl.uniform4f(U.uBody, mf.bodyL, mf.bodyR, mf.hanger, geo.h * 0.05);
      gl.bindTexture(gl.TEXTURE_2D, shadow ? g.bF : g.tF);
      gl.bindVertexArray(meshes.front.vao); gl.drawElements(gl.TRIANGLES, meshes.front.count, gl.UNSIGNED_SHORT, 0);
    }
  }

  function renderGL() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(U.uRes, geo.cw, geo.ch);
    gl.uniform2f(U.uOrigin, geo.mx, geo.mt + 6);
    gl.uniform4f(U.uView, geo.mx + geo.w / 2, geo.mt + 6 + geo.h * 0.42, geo.D, 1 / 4000);
    gl.uniform1f(U.uSeg, geo.seg); gl.uniform1f(U.uH, geo.h); gl.uniform1f(U.uTime, clock);
    var L = [0.24, 0.42, -1], ll = Math.sqrt(L[0] * L[0] + L[1] * L[1] + 1);
    gl.uniform3f(U.uLight, L[0] / ll, L[1] / ll, L[2] / ll);
    gl.uniform1f(U.uWallZ, -geo.h * 0.26);
    gl.uniform1f(U.uShadowA, 0.17);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(U.uTex, 0);

    gl.uniform1i(U.uShadow, 1);
    G.forEach(function (g) { if (!g.hidden) drawGarment(g, true); });
    gl.uniform1i(U.uShadow, 0);
    G.slice().sort(function (a, b) { return (a.pz - b.pz) || ((a.i === active) - (b.i === active)); })
      .forEach(function (g) { if (!g.hidden) drawGarment(g, false); });
    gl.bindVertexArray(null);
  }

  /* Without WebGL: the same physics, drawn by moving the two photos. */
  function renderDOM() {
    G.forEach(function (g) {
      var dx = g.x[NODES - 1] - g.px, dy = g.y[NODES - 1] - g.py;
      var ang = -Math.atan2(dx, dy) * 180 / Math.PI;
      var f = turnOf(g), fo = g.fa;
      g.sw.style.transform = "rotate(" + ang.toFixed(2) + "deg) scale(" + (1 + g.pz / geo.D).toFixed(4) + ")";
      g.front.style.opacity = fo;
      g.front.style.transform = "translateX(-50%) rotateY(" + (-80 * (1 - f)).toFixed(2) + "deg)";
      g.side.style.opacity = 1 - fo;
      g.side.style.transform = "translateX(-50%) rotateY(" + (22 * f).toFixed(2) + "deg)";
    });
  }

  function draw(dt) {
    G.forEach(function (g) {
      g.el.style.translate = (g.px - g.home).toFixed(2) + "px " + g.py.toFixed(2) + "px";
      var hv = Math.abs(g.x[NODES - 1] - g.ox[NODES - 1]) / SUB;
      var target = clamp(Math.abs(g.thv) * 0.02 + Math.abs(g.twv[NODES - 1]) * 0.01 + hv * 0.0008, 0, 1) * geo.h * 0.012;
      g.flutter += (target - g.flutter) * 0.12;
    });
    if (glReady) renderGL(); else renderDOM();
    drawTag(dt);
  }

  /* ---------------- The hang tag ---------------- */
  var tagEl = $("tag"), stringEl = $("tag-string");
  var tag = { on: false, owner: -1, phi: 0, w: 0, ax: 0, ay: 0, pax: 0, ppax: 0, L: 40 };
  function fillTag(i) {
    var p = PRODUCTS[i];
    $("tag-name").textContent = p.name;
    $("tag-price").textContent = gbp(p.price);
    $("tag-sizes").innerHTML = SIZES.map(function (s, k) {
      var n = left(p, k);
      return n <= 0 ? "<s>" + s + "</s>" : n <= LOW_STOCK ? "<b>" + s + "</b>" : "<span>" + s + "</span>";
    }).join("");
  }
  function drawTag(dt) {
    var g = active >= 0 ? G[active] : null;
    var show = g && !small.matches && !g.hidden && turnOf(g) > 0.6 && !body.classList.contains("view-open");
    if (!show) {
      if (tag.on) { tag.on = false; tagEl.classList.remove("on"); stringEl.classList.remove("on"); }
      return;
    }
    var a = toScreen(frontPoint(g, g.m.front.tag[0], g.m.front.tag[1]));
    if (!tag.on || tag.owner !== active) {
      if (tag.owner !== active) fillTag(active);
      tag.on = true; tag.owner = active;
      tag.pax = tag.ppax = a[0]; tag.phi = reduced ? 0 : 0.32; tag.w = 0;
      tagEl.classList.add("on"); stringEl.classList.add("on");
    }
    /* a pendulum hanging from the sleeve: it swings when the sleeve moves */
    if (dt > 0 && !reduced) {
      var accX = clamp(((a[0] - tag.pax) - (tag.pax - tag.ppax)) / (dt * dt), -9000, 9000);
      tag.ppax = tag.pax; tag.pax = a[0];
      var al = -(2300 / tag.L) * Math.sin(tag.phi) - 3.4 * tag.w - (accX / tag.L) * Math.cos(tag.phi);
      tag.w += al * dt; tag.phi = clamp(tag.phi + tag.w * dt, -1.2, 1.2);
    }
    var hx = a[0] + tag.L * Math.sin(tag.phi), hy = a[1] + tag.L * Math.cos(tag.phi);
    stringEl.style.transform = "translate(" + a[0].toFixed(1) + "px," + a[1].toFixed(1) + "px) rotate(" + (-tag.phi) + "rad)";
    var sc = clamp(geo.h / 470, 0.7, 1);
    tagEl.style.transform = "translate(" + (hx - 79).toFixed(1) + "px," + (hy - 15).toFixed(1) + "px) rotate(" + (-tag.phi * 0.9) + "rad) scale(" + sc.toFixed(3) + ")";
  }

  /* ---------------- Choosing a garment ---------------- */
  var live = $("rail-live");
  function setActive(i) {
    if (i === active) return;
    active = i;
    if (i >= 0) {
      var p = PRODUCTS[i];
      live.textContent = p.name + ", " + gbp(p.price);
      G[i].pvy -= reduced ? 0 : geo.h * 0.08; /* a small lift as it comes off the rail toward you */
    }
    updateReadout();
    kick();
  }

  function railXY(e) {
    var r = rail.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top - 6];
  }
  /* Which garment is under x, by where each one actually is right now. The
     one facing you is wide, so the pointer stays on it until it clearly leaves. */
  function hitTest(x) {
    if (x < -20 || x > geo.w + 20) return -1;
    var best = -1, dist = Infinity, k;
    for (k = 0; k < N; k++) { var d = Math.abs(x - G[k].px); if (d <= G[k].w / 2 && d < dist) { best = k; dist = d; } }
    if (best >= 0) return best;
    for (k = 0; k < N; k++) { d = Math.abs(x - G[k].px); if (d < dist) { best = k; dist = d; } }
    return best;
  }

  var down = null, suppressClick = false;
  rail.addEventListener("pointermove", function (e) {
    if (body.classList.contains("view-open")) return;
    var p = railXY(e);
    if (!grab) moveHand(p[0], p[1], performance.now()); else hand.on = false;

    if (down && !grab && !reduced && Math.hypot(e.clientX - down.cx, e.clientY - down.cy) > 7 && down.i >= 0) {
      var g = G[down.i], kk = 3, best = Infinity;
      for (var k = 3; k < NODES; k++) { var d = Math.abs(g.y[k] - p[1]); if (d < best) { best = d; kk = k; } }
      grab = { g: g, k: kk, x: p[0], y: p[1] };
      rail.classList.add("grabbing");
      try { rail.setPointerCapture(e.pointerId); } catch (err) {}
    }
    if (grab) { grab.x = p[0]; grab.y = p[1]; kick(); return; }

    if (e.target.closest && e.target.closest(".tag")) return;   /* reading the tag: keep it */
    if (e.pointerType === "mouse" && finePointer.matches && !small.matches) {
      setActive(hitTest(p[0]));
      if (active >= 0) yawAim = clamp((p[0] - G[active].px) / (G[active].w / 2), -1, 1) * 0.22;
      kick();
    }
  });
  rail.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 || e.target.closest(".tag")) return;
    var p = railXY(e);
    down = { cx: e.clientX, cy: e.clientY, i: hitTest(p[0]) };
  });
  function release() {
    down = null;
    if (grab) { grab = null; suppressClick = true; rail.classList.remove("grabbing"); setTimeout(function () { suppressClick = false; }, 0); kick(); }
  }
  rail.addEventListener("pointerup", release);
  rail.addEventListener("pointercancel", release);
  rail.addEventListener("pointerleave", function () {
    hand.on = false; hand.vx = 0;
    if (!grab && !body.classList.contains("view-open") && finePointer.matches) { setActive(-1); yawAim = 0; }
  });
  rail.addEventListener("click", function (e) {
    if (suppressClick) return;
    if (e.target.closest(".tag")) { if (active >= 0) openView(active, garmentRect(active), "rail"); return; }
    var h = e.target.closest(".hang");
    var i = e.detail === 0 && h ? hangs.indexOf(h) : hitTest(railXY(e)[0]);
    if (i < 0) return;
    /* touch: the first tap turns a piece round, the second opens it */
    if (!finePointer.matches && active !== i) { setActive(i); return; }
    openView(i, garmentRect(i), "rail");
  });
  hangs.forEach(function (h, i) {
    h.addEventListener("focus", function () { if (!body.classList.contains("view-open") && !h.matches(":hover")) { yawAim = 0; setActive(i); } });
  });
  rail.addEventListener("focusout", function (e) { if (!rail.contains(e.relatedTarget) && !body.classList.contains("view-open") && !rail.matches(":hover")) setActive(-1); });
  rail.addEventListener("keydown", function (e) {
    var i = hangs.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      hangs[(i + (e.key === "ArrowRight" ? 1 : N - 1)) % N].focus();
    }
  });
  document.addEventListener("pointerdown", function (e) {
    if (!finePointer.matches && active >= 0 && !rail.contains(e.target) && !e.target.closest("#readout") && !body.classList.contains("view-open")) setActive(-1);
  });

  /* Small screens: a readout under the rail stands in for the tag */
  var readoutBtn = $("readout-btn");
  function updateReadout() {
    if (active < 0) {
      $("readout-name").textContent = "The rail";
      $("readout-sub").textContent = "Tap a piece to turn it round";
      readoutBtn.hidden = true;
      return;
    }
    var p = PRODUCTS[active];
    $("readout-name").textContent = p.name;
    $("readout-sub").textContent = gbp(p.price) + " · " + p.kind + " · " + p.colour;
    readoutBtn.hidden = false;
  }
  readoutBtn.addEventListener("click", function () { if (active >= 0) openView(active, garmentRect(active), "rail"); });

  /* Where a garment is on screen, for the fly-in to the piece view. */
  function garmentRect(i) {
    var g = G[i];
    if (!glReady) {
      var r = (turnOf(g) > 0.5 ? g.front : g.side).getBoundingClientRect();
      return r.width ? r : g.el.getBoundingClientRect();
    }
    var rr = rail.getBoundingClientRect(), xs = [], ys = [];
    var f = turnOf(g) > 0.5;
    [0, 1].forEach(function (v) {
      [0, 0.5, 1].forEach(function (u) {
        var p;
        if (f) p = frontPoint(g, u, v);
        else { ropeAt(g, v * geo.h, _a); p = [_a[0] + (u - g.m.side.hookX) * g.Ds, _a[1], _a[2]]; }
        var s = toScreen(p); xs.push(s[0]); ys.push(s[1]);
      });
    });
    var l = Math.min.apply(null, xs), t = Math.min.apply(null, ys);
    return { left: rr.left + l, top: rr.top + t, width: Math.max.apply(null, xs) - l, height: Math.max.apply(null, ys) - t };
  }

  /* Hero visible? Only then does the idle breeze keep the loop running. */
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { heroVisible = es[0].isIntersecting; if (heroVisible) kick(); }).observe(rail);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) kick(); });

  var resizeT = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { measure(); settleAll(); draw(0); kick(); }, 120);
  });
  small.addEventListener("change", function () { setActive(-1); });

  /* ================================================================
     Piece view. Opening flies the photo from wherever it was (the rail or a
     card in the drop) into the stage; closing flies it back.
     ================================================================ */
  var viewImg = $("view-img"), viewStage = $("view-stage");
  var current = 0, origin = "rail", lastFocus = null;
  var EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

  function fillView(i) {
    var p = PRODUCTS[i];
    viewImg.src = img(p, "front"); viewImg.alt = p.name;
    $("view-count").textContent = pad(i + 1) + " / " + pad(N);
    $("view-kind").textContent = "Drop 07 · " + p.kind + " · " + p.colour;
    $("view-name").textContent = p.name;
    $("view-price").textContent = gbp(p.price);
    $("view-meta").textContent = p.meta;
    $("view-fit").textContent = p.fit;
    $("view-fabric").textContent = p.meta + ". Garment-washed once before it ships, so it won't shrink.";
    picked = null;
    renderSizes();
  }

  function cardRect(i) { return document.querySelector('[data-card="' + i + '"] img').getBoundingClientRect(); }
  function fly(fromRect, reverse) {
    if (reduced || !viewImg.animate || !fromRect || !fromRect.width) return null;
    var b = viewImg.getBoundingClientRect();
    if (!b.width) return null;
    var s = fromRect.height / b.height;
    var dx = (fromRect.left + fromRect.width / 2) - (b.left + b.width / 2), dy = fromRect.top - b.top;
    var start = "translate(" + dx + "px," + dy + "px) scale(" + s + ")";
    return viewImg.animate(reverse ? [{ transform: "none" }, { transform: start }] : [{ transform: start }, { transform: "none" }],
      { duration: reverse ? 520 : 700, easing: EASE, fill: "both" });
  }
  function markAway(i) {
    G.forEach(function (g, k) { g.hidden = k === i; g.el.classList.toggle("is-away", k === i); });
    draw(0);
  }

  function openView(i, fromRect, from) {
    if (body.classList.contains("view-open")) return;
    lastFocus = document.activeElement;
    current = i; origin = from || "rail";
    fillView(i);
    if (origin === "rail") { setActive(i); markAway(i); }
    body.classList.add("view-open");
    $("view").setAttribute("aria-hidden", "false");
    var go = function () { var a = fly(fromRect, false); if (a) setTimeout(function () { a.cancel(); }, 720); };
    if (viewImg.complete) go(); else viewImg.onload = function () { viewImg.onload = null; go(); };
    setTimeout(function () { $("view-close").focus({ preventScroll: true }); }, 60);
  }

  function closeView() {
    if (!body.classList.contains("view-open")) return;
    var i = current;
    var to = origin === "rail" ? garmentRect(i) : cardRect(i);
    var a = fly(to, true);
    body.classList.add("view-closing");
    body.classList.remove("view-open");
    $("view").setAttribute("aria-hidden", "true");
    setTimeout(function () {
      body.classList.remove("view-closing");
      if (a) a.cancel();
      markAway(-1);
      if (!finePointer.matches) setActive(-1);
      var back = origin === "rail" ? hangs[i] : document.querySelector('[data-card="' + i + '"]');
      if (back) back.focus({ preventScroll: true });
    }, a ? 520 : 0);
  }

  function viewStep(dir) {
    var next = (current + dir + N) % N;
    var go = function () {
      current = next; fillView(next);
      if (origin === "rail") { setActive(next); markAway(next); }
      if (!reduced && viewImg.animate) viewImg.animate([{ opacity: 0, transform: "translateX(" + (dir * 50) + "px) rotate(" + (dir * 2.5) + "deg)" }, { opacity: 1, transform: "none" }], { duration: 560, easing: EASE });
    };
    if (reduced || !viewImg.animate) return go();
    var out = viewImg.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(" + (dir * -50) + "px) rotate(" + (dir * -2.5) + "deg)" }], { duration: 170, easing: "ease-in", fill: "forwards" });
    setTimeout(function () { go(); out.cancel(); }, 170);
  }
  $("view-prev").addEventListener("click", function () { viewStep(-1); });
  $("view-next").addEventListener("click", function () { viewStep(1); });
  $("view-close").addEventListener("click", closeView);
  viewStage.addEventListener("click", function (e) { if (e.target === viewStage) closeView(); });
  var sx = null, sy = null;
  viewImg.addEventListener("pointerdown", function (e) { sx = e.clientX; sy = e.clientY; });
  viewImg.addEventListener("pointerup", function (e) {
    if (sx === null) return;
    var dx = e.clientX - sx, dy = e.clientY - sy; sx = sy = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) viewStep(dx < 0 ? 1 : -1);
  });

  initDropMotion({ PRODUCTS, reduced, finePointer, clamp, openView });

  /* ================================================================
     Sizes and the bag (in-memory)
     ================================================================ */
  var sizeGrid = $("size-grid"), addBtn = $("add-btn"), picked = null, lines = [];
  function inBag(id, size) {
    for (var k = 0; k < lines.length; k++) if (lines[k].id === id && lines[k].size === size) return lines[k].qty;
    return 0;
  }
  function left(p, s) { return p.stock[s] - inBag(p.id, SIZES[s]); }
  function renderSizes() {
    var p = PRODUCTS[current];
    if (picked !== null && left(p, picked) <= 0) picked = null;
    sizeGrid.innerHTML = SIZES.map(function (s, k) {
      var n = left(p, k), note = n <= 0 ? "Sold out" : n <= LOW_STOCK ? n + " left" : "In stock";
      return '<button class="size" type="button" data-size="' + k + '" aria-pressed="' + (picked === k) + '"' + (n <= 0 ? " disabled" : "") +
        ' aria-label="' + s + ", " + note + '"><span>' + s + '</span><small class="' + (n > 0 && n <= LOW_STOCK ? "low" : "") + '">' + note + "</small></button>";
    }).join("");
    addBtn.disabled = picked === null;
    addBtn.textContent = picked === null ? "Pick a size" : "Add " + SIZES[picked] + " to bag — " + gbp(p.price);
  }
  sizeGrid.addEventListener("click", function (e) {
    var b = e.target.closest(".size");
    if (!b || b.disabled) return;
    picked = Number(b.getAttribute("data-size"));
    renderSizes();
    addBtn.focus({ preventScroll: true });
  });
  addBtn.addEventListener("click", function () {
    if (picked === null) return;
    add(PRODUCTS[current], SIZES[picked]);
    closeView();
    setTimeout(openCart, reduced ? 0 : 480);
  });

  var bagCount = $("bag-count"), bagBtn = $("bag-btn"), elItems = $("cart-items"), checkoutBtn = $("checkout-btn");
  function find(id) { for (var k = 0; k < PRODUCTS.length; k++) if (PRODUCTS[k].id === id) return PRODUCTS[k]; return null; }
  function add(p, size) {
    for (var k = 0; k < lines.length; k++) if (lines[k].id === p.id && lines[k].size === size) { lines[k].qty += 1; render(); return; }
    lines.push({ id: p.id, size: size, qty: 1 });
    render();
  }
  function render() {
    var count = 0, sub = 0;
    lines.forEach(function (l) { count += l.qty; sub += find(l.id).price * l.qty; });
    bagCount.textContent = count;
    bagCount.classList.toggle("on", count > 0);
    bagCount.classList.remove("pop"); void bagCount.offsetWidth; if (count) bagCount.classList.add("pop");
    setTimeout(function () { bagCount.classList.remove("pop"); }, 300);
    bagBtn.setAttribute("aria-label", "Open bag, " + count + " item" + (count === 1 ? "" : "s"));
    $("cart-subtotal").textContent = gbp2(sub);
    checkoutBtn.disabled = count === 0;
    $("cart-progress-bar").style.width = Math.min(sub / FREE_DELIVERY, 1) * 100 + "%";
    $("cart-progress-label").textContent = sub >= FREE_DELIVERY ? "Free UK delivery unlocked" : gbp2(FREE_DELIVERY - sub) + " away from free delivery";
    $("checkout-status").textContent = "";
    if (active >= 0) fillTag(active);
    if (!lines.length) {
      elItems.innerHTML = '<div class="cart-empty"><p>Your bag is empty.</p><button class="btn btn--ghost" type="button" data-close-cart>Back to the rail</button></div>';
      return;
    }
    elItems.innerHTML = lines.map(function (l, k) {
      var p = find(l.id), maxed = l.qty >= p.stock[SIZES.indexOf(l.size)];
      return '<div class="cart-line"><div class="cart-thumb"><img src="' + img(p, "front") + '" alt="" /></div>' +
        "<div><b>" + esc(p.name) + "</b><span>Size " + l.size + " · " + esc(p.colour) + "</span>" +
        '<div class="qty"><button type="button" data-dec="' + k + '" aria-label="One fewer ' + esc(p.name) + '">−</button><em>' + l.qty + "</em>" +
        '<button type="button" data-inc="' + k + '" aria-label="One more ' + esc(p.name) + '"' + (maxed ? " disabled title=\"That's all we have\"" : "") + ">+</button></div></div>" +
        '<div class="cart-right"><b>' + gbp2(p.price * l.qty) + '</b><button class="cart-remove" type="button" data-rm="' + k + '">Remove</button></div></div>';
    }).join("");
  }
  function openCart() { body.classList.add("cart-open"); $("cart-close").focus({ preventScroll: true }); }
  function closeCart() { body.classList.remove("cart-open"); bagBtn.focus({ preventScroll: true }); }
  bagBtn.addEventListener("click", openCart);
  document.addEventListener("click", function (e) { if (e.target.closest("[data-close-cart]")) closeCart(); });
  elItems.addEventListener("click", function (e) {
    var t = e.target.closest("[data-inc],[data-dec],[data-rm]");
    if (!t) return;
    if (t.hasAttribute("data-inc")) { var l = lines[Number(t.getAttribute("data-inc"))]; if (l.qty < find(l.id).stock[SIZES.indexOf(l.size)]) l.qty += 1; }
    else if (t.hasAttribute("data-dec")) lines[Number(t.getAttribute("data-dec"))].qty -= 1;
    else lines[Number(t.getAttribute("data-rm"))].qty = 0;
    lines = lines.filter(function (x) { return x.qty > 0; });
    render();
  });

  // Preview checkout stays in the project; no external sale or payment redirect.
  checkoutBtn.addEventListener("click", function () {
    if (!lines.length) return;
    $("checkout-status").textContent = "Checkout is not enabled during preview. Your selected pieces stay in your bag.";
  });

  /* ================================================================
     The Friday list (demo: validates, sends nothing)
     ================================================================ */
  $("news-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("news-email"), msg = $("news-msg");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) {
      msg.textContent = "Enter an email address, like you@example.com.";
      msg.classList.remove("ok"); input.focus(); return;
    }
    msg.textContent = "You're on the list. See you Thursday night. (Demo: nothing was sent.)";
    msg.classList.add("ok"); e.target.reset();
  });

  /* ================================================================
     Page chrome: header state, keyboard, entrance motion
     ================================================================ */
  var topBar = $("top-bar");
  function onScroll() { topBar.classList.toggle("scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  document.addEventListener("keydown", function (e) {
    if ($("fitting-room").open) return;
    if (e.key === "Escape") {
      if (body.classList.contains("cart-open")) closeCart();
      else closeView();
      return;
    }
    if (!body.classList.contains("view-open") || body.classList.contains("cart-open")) return;
    if (e.key === "ArrowRight") viewStep(1);
    else if (e.key === "ArrowLeft") viewStep(-1);
  });

  var appears = Array.prototype.slice.call(document.querySelectorAll(".appear"));
  appears.forEach(function (el) { el.addEventListener("animationend", function (ev) { if (ev.target === el) el.classList.add("is-in"); }, { once: true }); });
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    appears.forEach(function (el) { if (!(el.getAnimations ? el.getAnimations().length : 1)) el.classList.add("is-in"); });
  }); });
  setTimeout(function () { appears.forEach(function (el) { el.classList.add("is-in"); }); }, 2500);

  var reveals = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    reveals.forEach(function (el) { io.observe(el); });
    setTimeout(function () { reveals.forEach(function (el) { el.classList.add("is-in"); }); }, 4000);
  } else reveals.forEach(function (el) { el.classList.add("is-in"); });

  createFittingRoom({ getCurrent: function () { return current; }, onSelect: function (i) {
    current = i; fillView(i); if (origin === "rail") { setActive(i); markAway(i); }
  } });

  /* ---------------- Start ---------------- */
  measure();
  settleAll();
  if (!reduced) {
    /* the garments drop onto the rail one after another */
    G.forEach(function (g, i) { g.py = -geo.h * 0.2; g.drop = 0.12 + i * 0.07; hangFrom(g, g.py); g.ox[NODES - 1] += (i % 2 ? 1 : -1) * 1.2; });
  }
  updateReadout();
  draw(0);
  initGL();
  kick();
})();
