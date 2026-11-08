/* The hand, animated the way dao5 animates its frog.

   The art itself is a fixed block of text (assets/hand.txt, inlined into the
   page). This script splits it into one <span> per character, then:
     - makes a few percent of the characters "passive cyclers" that step
       through a small pool of glyphs and faint tints on a slow clock;
     - keeps a fading trail of pointer positions and tints every character
       within reach of a trail point, tracking the pointer across the whole
       page rather than only while it is over the art.
   Character positions are cached once per layout, and the DOM is only
   written when a character or its colour actually changes. */

(() => {
  const container = document.getElementById("hand-container");
  if (!container) return;

  // ---------- Tunables ----------
  const charPool = ["a", "d", "o", "0", "1", "2", "3", "4", "5"];
  const PASSIVE_RATE = 0.05;          // share of characters that cycle on their own
  const proximityRange = 50;          // px radius of the pointer trail
  const maxTrailLength = 80;          // points kept
  const TRAIL_ADD_EVERY_N_FRAMES = 3;
  const TRAIL_FADE_FRAMES = 40;

  // Monochrome, with one cold accent. No pure black: the type is already
  // black, so a black trail point would be a dead spot in the trail. The pale
  // end nearly erases a character, which reads as the drawing recoiling.
  const trailColors = ["#1b5fd1", "#2b2b2b", "#5a5a5a", "#8c8c8c", "#b9b9b9", "#d6d6d6"];
  const passiveColors = [
    "#1e1e1e",
    "rgba(27, 95, 209, 0.22)",
    "rgba(0, 0, 0, 0.35)",
    "rgba(120, 120, 120, 0.4)",
  ];

  // ---------- Helpers ----------
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // ---------- Build DOM ----------
  // The static text is already in the container so the art renders without
  // JavaScript; take it, then rebuild it as spans.
  const asciiText = container.textContent.replace(/^\n+|\n+$/g, "");
  container.textContent = "";
  const lines = asciiText.split("\n");

  const chars = [];
  const charElements = [];
  const frag = document.createDocumentFragment();

  for (const line of lines) {
    for (const ch of line) {
      const isPassiveCycler = ch !== " " && Math.random() < PASSIVE_RATE;
      chars.push({
        originalChar: ch,
        isPassiveCycler,
        passiveAnimFrame: Math.random() * charPool.length,
        passiveCharSequence: isPassiveCycler ? shuffle(charPool).slice(0, 8) : null,
      });
      const span = document.createElement("span");
      span.className = "char";
      span.textContent = ch;
      frag.appendChild(span);
      charElements.push(span);
    }
    frag.appendChild(document.createElement("br"));
  }
  container.appendChild(frag);

  // ---------- Cache positions ----------
  const elementCache = [];
  let recacheRaf = null;

  function recachePositions() {
    elementCache.length = 0;
    const box = container.getBoundingClientRect();
    for (let i = 0; i < charElements.length; i++) {
      const r = charElements[i].getBoundingClientRect();
      elementCache.push({
        x: r.left - box.left + container.scrollLeft,
        y: r.top - box.top + container.scrollTop,
        element: charElements[i],
        charObj: chars[i],
        index: i,
      });
    }
  }
  function scheduleRecache() {
    if (recacheRaf) cancelAnimationFrame(recacheRaf);
    recacheRaf = requestAnimationFrame(recachePositions);
  }
  window.addEventListener("resize", scheduleRecache, { passive: true });
  window.addEventListener("orientationchange", scheduleRecache, { passive: true });
  if (window.visualViewport) {
    visualViewport.addEventListener("resize", scheduleRecache, { passive: true });
    visualViewport.addEventListener("scroll", scheduleRecache, { passive: true });
  }
  function centreScroll() {
    const slack = container.scrollWidth - container.clientWidth;
    if (slack > 0) container.scrollLeft = slack / 2;
  }
  requestAnimationFrame(() => {
    centreScroll();
    recachePositions();
    requestAnimationFrame(() => { centreScroll(); recachePositions(); });
  });

  // ---------- Pointer / touch trail ----------
  let isActive = false;
  let frameCounter = 0;
  const cursorTrail = [];

  function pushTrailPoint(x, y) {
    cursorTrail.push({
      x, y, frame: frameCounter,
      color: trailColors[(Math.random() * trailColors.length) | 0],
    });
    if (cursorTrail.length > maxTrailLength) cursorTrail.shift();
  }
  function setPointerFromClient(clientX, clientY) {
    const box = container.getBoundingClientRect();
    isActive = true;
    if (frameCounter % TRAIL_ADD_EVERY_N_FRAMES === 0) {
      pushTrailPoint(clientX - box.left + container.scrollLeft,
                     clientY - box.top + container.scrollTop);
    }
  }
  // Bound to the window, not to the art. The trail is kept in coordinates
  // relative to the container, so a pointer anywhere on the page is placed
  // correctly against the characters: approach the drawing from any direction
  // and the nearest characters light before the cursor reaches them.
  const onPointer = (e) => setPointerFromClient(e.clientX, e.clientY);
  const onTouch = (e) => {
    const t = e.touches && e.touches[0];
    if (t) setPointerFromClient(t.clientX, t.clientY);
  };
  window.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener("pointerdown", onPointer, { passive: true });
  window.addEventListener("touchmove", onTouch, { passive: true });
  window.addEventListener("touchstart", onTouch, { passive: true });
  window.addEventListener("touchend", () => { isActive = false; }, { passive: true });
  document.addEventListener("pointerleave", () => { isActive = false; }, { passive: true });
  window.addEventListener("blur", () => { isActive = false; }, { passive: true });

  // ---------- Render loop ----------
  const last = charElements.map(() => ({ c: null, col: null }));
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");

  function trailIntensity(px, py, x, y) {
    const d = Math.hypot(px - x, py - y);
    return d >= proximityRange ? 0 : 1 - d / proximityRange;
  }

  function updateFrame() {
    // The clock always advances, so the passive cyclers keep shimmering whether
    // or not anyone is pointing at the drawing. requestAnimationFrame is
    // already suspended by the browser on a hidden tab, so an unwatched page
    // still costs nothing.
    frameCounter++;
    for (let i = cursorTrail.length - 1; i >= 0; i--) {
      if (frameCounter - cursorTrail[i].frame > TRAIL_FADE_FRAMES) cursorTrail.splice(i, 1);
    }

    for (let i = 0; i < elementCache.length; i++) {
      const { x, y, element, charObj, index } = elementCache[i];
      let color = "#000000";
      let charToDisplay = charObj.originalChar;
      let maxIntensity = 0;
      let chosenColor = null;

      for (let t = 0; t < cursorTrail.length; t++) {
        const p = cursorTrail[t];
        const base = trailIntensity(p.x, p.y, x, y);
        if (!base) continue;
        const intensity = base * clamp01(1 - (frameCounter - p.frame) / TRAIL_FADE_FRAMES);
        if (intensity > maxIntensity) { maxIntensity = intensity; chosenColor = p.color; }
      }

      if (maxIntensity > 0.1 && chosenColor) {
        color = chosenColor;
      } else if (charObj.isPassiveCycler && !still.matches) {
        const step = frameCounter / 20 + charObj.passiveAnimFrame;
        charToDisplay = charObj.passiveCharSequence[(step | 0) % charObj.passiveCharSequence.length];
        color = passiveColors[(step | 0) % passiveColors.length];
      }

      const li = last[index];
      if (li.c !== charToDisplay) { element.textContent = charToDisplay; li.c = charToDisplay; }
      if (li.col !== color) { element.style.color = color; li.col = color; }
    }
    requestAnimationFrame(updateFrame);
  }
  updateFrame();

  // ---------- Typewriter line ----------
  const tw = document.querySelector(".typewriter-text");
  if (tw && !still.matches) {
    const full = tw.textContent.trim();
    tw.textContent = "";
    tw.style.visibility = "visible";
    let i = 0;
    const tick = () => {
      tw.textContent = full.slice(0, ++i);
      if (i < full.length) setTimeout(tick, 18 + Math.random() * 30);
    };
    setTimeout(tick, 400);
  } else if (tw) {
    tw.style.visibility = "visible";
  }
})();
