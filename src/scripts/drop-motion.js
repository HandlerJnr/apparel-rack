export function initDropMotion({ PRODUCTS, reduced, finePointer, clamp, openView }) {
  /* The Drop: spring motion anchored at the hanger, with a delayed cloth hem.
     Vertical touch gestures remain native scrolling; only horizontal drags capture. */
  Array.prototype.forEach.call(document.querySelectorAll("[data-card]"), function (card) {
    var i = Number(card.getAttribute("data-card")), art = card.querySelector(".card-art"), im = art.querySelector("img");
    var c = null, ctx = null, frame = 0, last = 0, angle = 0, velocity = 0, bend = 0, bendV = 0;
    var target = 0, hover = false, press = null, holdTimer = 0, suppressUntil = 0, w = 0, h = 0;
    im.draggable = false;
    function setup() {
      if (reduced || !im.naturalWidth) return false;
      if (!c) {
        c = document.createElement("canvas"); ctx = c.getContext("2d");
        if (!ctx) { c = null; return false; }
        c.className = "drop-cloth"; c.setAttribute("aria-hidden", "true"); art.appendChild(c);
        art.classList.add("cloth-ready");
      }
      var r = art.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      var cw = Math.round(w * dpr), ch = Math.round(h * dpr);
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return w > 0 && h > 0;
    }
    function paint(time) {
      ctx.clearRect(0, 0, w, h);
      var ih = h * .9, iw = ih * im.naturalWidth / im.naturalHeight;
      var top = h * .064, pivotY = top + ih * .025;
      ctx.save(); ctx.translate(w * .5, pivotY); ctx.rotate(angle * Math.PI / 180);
      // Cloth strips are driven by a damped bend; the hanger stays still.
      var slices = 32;
      for (var n = 0; n < slices; n++) {
        var t = n / slices, next = (n + 1) / slices;
        var cloth = Math.max(0, (t - .13) / .87), lag = cloth * cloth;
        var offset = bend * w * .014 * lag * Math.cos(cloth * 2.1 - time * .0018);
        var twist = 1 - Math.min(.1, Math.abs(bend) * .003 * lag);
        var sy = t * im.naturalHeight, sh = Math.min(im.naturalHeight - sy, (next - t) * im.naturalHeight + 1.5);
        var dh = ih * sh / im.naturalHeight;
        ctx.drawImage(im, 0, sy, im.naturalWidth, sh, -iw * twist * .5 + offset, top - pivotY + t * ih, iw * twist, dh);
      }
      ctx.restore();
    }
    function tick(time) {
      var dt = Math.min((time - (last || time)) / 1000, .032); last = time;
      // Substeps keep spring behaviour consistent on both 60 Hz and 120 Hz screens.
      var steps = Math.max(1, Math.ceil(dt / .008)), step = dt / steps;
      for (var n = 0; n < steps; n++) {
        velocity += ((target - angle) * 100 - velocity * 6.8) * step;
        angle += velocity * step;
        bendV += ((angle * .52 - bend) * 68 - bendV * 5.4) * step;
        bend += bendV * step;
      }
      paint(time);
      if (Math.abs(angle - target) + Math.abs(velocity) + Math.abs(bend) + Math.abs(bendV) > .035 || press || hover) frame = requestAnimationFrame(tick);
      else { frame = 0; last = 0; angle = velocity = bend = bendV = 0; paint(time); }
    }
    function wake(impulse) {
      if (!setup()) return;
      velocity = clamp(velocity + (impulse || 0), -160, 160);
      if (!frame) { last = 0; frame = requestAnimationFrame(tick); }
    }
    function release() {
      clearTimeout(holdTimer); holdTimer = 0;
      if (!press) return;
      if (press.dragged || press.held) suppressUntil = performance.now() + 650;
      var releasedId = press.id; press = null;
      if (art.hasPointerCapture && art.hasPointerCapture(releasedId)) art.releasePointerCapture(releasedId);
      target = 0; art.classList.remove("cloth-grabbed"); wake(0);
    }
    card.addEventListener("click", function (e) {
      // Keyboard activation bypasses touch-drag click suppression.
      if (e.detail !== 0 && performance.now() < suppressUntil) { e.preventDefault(); return; }
      openView(i, im.getBoundingClientRect(), "card");
    });
    if (reduced) return;
    if (im.complete) { if (setup()) paint(0); }
    else im.addEventListener("load", function () { if (setup()) paint(0); }, { once: true });
    art.addEventListener("pointerenter", function (e) {
      if (e.pointerType !== "mouse") return;
      hover = true; wake((i % 2 ? -1 : 1) * 48);
    });
    art.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || !setup()) return;
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, dragged: false, held: false, touch: e.pointerType !== "mouse" };
      wake(25);
      if (press.touch) holdTimer = setTimeout(function () {
        if (!press || press.dragged) return;
        press.held = true; art.classList.add("cloth-grabbed"); wake(85);
      }, 220);
    });
    art.addEventListener("pointermove", function (e) {
      var r = art.getBoundingClientRect(), u = clamp((e.clientX - r.left) / r.width - .5, -.5, .5);
      if (press && press.id === e.pointerId) {
        var dx = e.clientX - press.x, dy = e.clientY - press.y;
        if (press.touch && !press.dragged && Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx)) { release(); return; }
        if (!press.dragged && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
          press.dragged = true; clearTimeout(holdTimer); art.setPointerCapture(e.pointerId); art.classList.add("cloth-grabbed");
        }
        if (press.dragged) {
          if (e.cancelable) e.preventDefault();
          target = clamp(dx / r.width * 28, -16, 16);
          wake(clamp((e.clientX - press.lastX) * 1.8, -22, 22));
        }
        press.lastX = e.clientX;
      } else if (e.pointerType === "mouse") { target = u * 9; wake(0); }
    });
    art.addEventListener("pointerup", release);
    art.addEventListener("pointercancel", release);
    art.addEventListener("lostpointercapture", release);
    art.addEventListener("pointerleave", function () { hover = false; if (!press) { target = 0; wake(0); } });
    art.addEventListener("contextmenu", function (e) { if (press && press.touch) e.preventDefault(); });
    card.addEventListener("focus", function () { wake(35); });
    card.addEventListener("blur", function () { hover = false; target = 0; wake(0); });
    if (window.ResizeObserver) new ResizeObserver(function () { if (setup()) paint(performance.now()); }).observe(art);
    // A brief, once-only wave makes the touch interaction discoverable on phones.
    if (window.IntersectionObserver) {
      var peek = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { if (entry.isIntersecting && !finePointer.matches) { wake((i % 2 ? -1 : 1) * 28); peek.disconnect(); } });
      }, { threshold: .6 }); peek.observe(art);
    }
  });

}
