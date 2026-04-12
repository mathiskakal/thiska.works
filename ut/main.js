/* ============================================================
   main.js — Interactive essay engine
   thiska.works/ut — Climate Caused the US Civil War

   Architecture: two purpose-built IntersectionObservers backed
   by one shared state Map.

   continuousObserver (multi-threshold) — sections only. Keeps
   intersectionState current so mood tracking always reads the
   full viewport picture, not just the observer's delta.

   revealObserver (single 0.15 threshold) — one-shot reveals for
   figures, blockquotes, chapter-breaks. Fires at a visually
   pleasing 15% intersection; unobserves immediately after.
   ============================================================ */

'use strict';

// ============================================================
// 1. REDUCED MOTION
// ============================================================

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
window.REDUCED_MOTION = REDUCED_MOTION;

// ============================================================
// 2. CENTRAL SCROLL STATE
//    intersectionState tracks every observed element's current
//    ratio. Updated on every IntersectionObserver callback.
//    Callers read from this map — never from the entries delta.
// ============================================================

const intersectionState = new Map(); // element → intersectionRatio

// continuousObserver — sections only. Multi-threshold for accurate
// ratio tracking. Feeds intersectionState so updateMood() always
// reads the full viewport picture, never just the delta.
const continuousObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      intersectionState.set(entry.target, entry.intersectionRatio);
    });
    updateMood();
  },
  { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
);

// revealObserver — one-shot elements (figures, blockquotes, breaks).
// Single threshold at 0.15 so reveals fire when ~15% of the element
// is visible — not at the first pixel. Elements unobserve after reveal.
const revealObserver = new IntersectionObserver(
  (entries, self) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in-view');
      self.unobserve(entry.target);
    });
  },
  { threshold: 0.15, rootMargin: '0px 0px -5% 0px' }
);

// ============================================================
// 4. MOOD TRACKING
//    Reads the full intersectionState map to find which section
//    occupies the most viewport. Updates body[data-active-mood].
//    CSS visual transitions are purely declarative (section's
//    own data-mood drives background color via custom properties).
// ============================================================

function updateMood() {
  let dominant = null;
  let maxRatio = -1;

  intersectionState.forEach((ratio, el) => {
    if (el.tagName !== 'SECTION') return;
    if (ratio > maxRatio) {
      maxRatio = ratio;
      dominant = el;
    }
  });

  if (dominant) {
    const mood = dominant.dataset.mood || 'neutral';
    if (document.body.dataset.activeMood !== mood) {
      document.body.dataset.activeMood = mood;
    }
  }
}

// ============================================================
// 5. REGISTER SCROLL-REVEAL ELEMENTS
//    Chapter breaks, figures, blockquotes — fade in on enter.
// ============================================================

function initScrollReveal() {
  const targets = document.querySelectorAll(
    '[data-component="chapter-break"],' +
    '[data-component="sub-break"],' +
    // Exclude map-sequence figures — their visibility is controlled
    // by .is-active inside the sticky stage, not by scroll-reveal.
    'figure[data-img-id]:not([data-component="map-sequence"]),' +
    'blockquote[data-component="rich-quote"]'
  );

  targets.forEach((el) => revealObserver.observe(el));
}

// ============================================================
// 6. REGISTER SECTIONS (for mood tracking)
// ============================================================

function initSections() {
  document.querySelectorAll('section').forEach((s) => {
    continuousObserver.observe(s);
  });
}

// ============================================================
// 7. PROGRESSIVE REVEAL
//    List items in [data-component="progressive-reveal"] appear
//    one at a time, staggered. Uses its own lightweight observer
//    (different threshold; container observed only once, then
//    items are staggered via setTimeout — no per-item observer
//    needed, no layout thrash).
// ============================================================

function initProgressiveReveal() {
  if (REDUCED_MOTION) return;

  const containers = document.querySelectorAll(
    '[data-component="progressive-reveal"]'
  );
  if (!containers.length) return;

  const containerObserver = new IntersectionObserver(
    (entries, self) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const items = entry.target.querySelectorAll('li');
        items.forEach((item, i) => {
          setTimeout(() => item.classList.add('in-view'), i * 130);
        });

        self.unobserve(entry.target); // one-shot
      });
    },
    { threshold: 0.15 }
  );

  containers.forEach((c) => containerObserver.observe(c));
}

// ============================================================
// 8. HERO PARALLAX
//    Desktop only. Translate hero image at 35% scroll rate.
//    Pauses once header has scrolled out of view (no wasted
//    rAF calls for the rest of the page).
// ============================================================

function initHeroParallax() {
  if (REDUCED_MOTION) return;
  if (window.innerWidth < 768) return;

  const header = document.querySelector(
    'header[data-component="image-motion"][data-motion-type="parallax"]'
  );
  if (!header) return;

  const img = header.querySelector('img');
  if (!img) return;

  img.style.willChange = 'transform';

  let ticking = false;
  let active = true; // becomes false once header is fully scrolled past

  // Stop driving parallax once header is off-screen
  const headerSentinel = new IntersectionObserver(
    ([entry]) => { active = entry.isIntersecting; },
    { threshold: 0 }
  );
  headerSentinel.observe(header);

  window.addEventListener(
    'scroll',
    () => {
      if (!active || ticking) return;
      requestAnimationFrame(() => {
        img.style.transform = `translateY(${window.scrollY * 0.35}px)`;
        ticking = false;
      });
      ticking = true;
    },
    { passive: true }
  );
}

// ============================================================
// 9. SCROLL-DIVE PARAGRAPH
//    #scroll-dive fades as it exits the top of the viewport,
//    giving a "diving into the article" feel.
// ============================================================

function initScrollDive() {
  if (REDUCED_MOTION) return;

  const el = document.getElementById('scroll-dive');
  if (!el) return;

  el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';

  const obs = new IntersectionObserver(
    ([entry]) => {
      const exitingTop = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      el.style.opacity = exitingTop ? '0' : '';
      el.style.transform = exitingTop ? 'translateY(16px)' : '';
    },
    { threshold: 0, rootMargin: '0px 0px -75% 0px' }
  );

  obs.observe(el);
}

// ============================================================
// 10. FOOTNOTE CLICK — smooth scroll + highlight
//     Highlight removal uses setTimeout keyed to computed
//     animation duration, not animationend — safe under
//     prefers-reduced-motion where animation: none fires no event.
// ============================================================

function initFootnotes() {
  const refs = document.querySelectorAll('sup[id^="fnref-"] a');
  if (!refs.length) return;

  refs.forEach((ref) => {
    ref.addEventListener('click', (e) => {
      e.preventDefault();

      const targetId = ref.getAttribute('href').slice(1);
      const target = document.getElementById(targetId);
      if (!target) return;

      target.scrollIntoView({
        behavior: REDUCED_MOTION ? 'auto' : 'smooth',
        block: 'center',
      });

      target.classList.add('fn--highlight');

      // Read actual computed animation duration — safe under animation:none
      const computedDuration =
        parseFloat(getComputedStyle(target).animationDuration) * 1000;
      const clearAfter = Number.isFinite(computedDuration) && computedDuration > 0
        ? computedDuration + 100   // slight buffer after animation ends
        : 1300;                    // fallback when animation is disabled

      setTimeout(() => target.classList.remove('fn--highlight'), clearAfter);
    });
  });
}

// ============================================================
// SWITCHER COMPONENT
//    [data-component="switcher"] — crop comparison (img-11 / img-12)
//
//    JS adds tab bar and labels to the DOM, then adds .switcher-ready
//    to the container. CSS handles the rest:
//    - Mobile: tabs are visible, inactive figure has aria-hidden="true"
//              (CSS display:none)
//    - Desktop ≥640px: tabs hidden, grid layout shows both figures
//
//    Screen-size agnostic: no matchMedia in JS — CSS owns the layout.
// ============================================================

function initSwitcher() {
  const switchers = document.querySelectorAll('[data-component="switcher"]');
  if (!switchers.length) return;

  switchers.forEach((container) => {
    const figures = Array.from(
      container.querySelectorAll('figure[data-switcher-label]')
    );
    if (figures.length < 2) return;

    // --- Build tab bar ---
    const tabBar = document.createElement('div');
    tabBar.className = 'switcher-tabs';
    tabBar.setAttribute('role', 'tablist');
    tabBar.setAttribute('aria-label', 'Select crop region');

    const tabs = figures.map((fig, i) => {
      const tab = document.createElement('button');
      tab.className = 'switcher-tab';
      tab.textContent = fig.dataset.switcherLabel;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('type', 'button');
      tab.setAttribute('aria-selected', i === 0 ? 'true' : 'false');

      // Start: second figure hidden on mobile
      if (i !== 0) fig.setAttribute('aria-hidden', 'true');

      tab.addEventListener('click', () => {
        // Deactivate all
        tabs.forEach((t, j) => {
          t.setAttribute('aria-selected', 'false');
          figures[j].setAttribute('aria-hidden', 'true');
        });
        // Activate clicked
        tab.setAttribute('aria-selected', 'true');
        fig.removeAttribute('aria-hidden');
      });

      tabBar.appendChild(tab);
      return tab;
    });

    // --- Inject labels above each figure (visible on desktop) ---
    figures.forEach((fig) => {
      const label = document.createElement('div');
      label.className = 'switcher-label';
      label.setAttribute('aria-hidden', 'true'); // decorative on desktop; tabs cover mobile
      label.textContent = fig.dataset.switcherLabel;
      fig.prepend(label);
    });

    // Tab bar goes before the figures
    container.prepend(tabBar);

    // Signal CSS the DOM is ready
    container.classList.add('switcher-ready');
  });
}

// ============================================================
// MAP SEQUENCE COMPONENT
//    Sticky crossfade map panel with a clickable year timeline.
//    Works with IntersectionObserver — no Scrollama needed since
//    we only need enter/exit, not continuous scroll progress.
//
//    DOM restructuring:
//    1. Collects [data-component="map-sequence"] figures from section
//    2. Builds .map-stage (sticky) and moves figures into it
//    3. Inserts stage before the first [data-map-trigger] paragraph
//    4. Watches trigger paragraphs to crossfade maps on scroll
//
//    Graceful degradation: without JS, all three maps render
//    inline as regular images between the prose.
// ============================================================

function buildTimeline(figures, onActivate) {
  const nav = document.createElement('nav');
  nav.className = 'map-timeline';
  nav.setAttribute('aria-label', 'Navigate maps by year');

  const track = document.createElement('div');
  track.className = 'map-timeline-track';

  figures.forEach((fig, i) => {
    if (i > 0) {
      const connector = document.createElement('div');
      connector.className = 'map-timeline-connector';
      connector.setAttribute('aria-hidden', 'true');
      track.appendChild(connector);
    }

    const btn = document.createElement('button');
    btn.className = 'map-timeline-btn';
    btn.textContent = fig.dataset.year;
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    btn.addEventListener('click', () => onActivate(i));
    track.appendChild(btn);
  });

  nav.appendChild(track);
  return nav;
}

function initMapSequence() {
  const mapFigures = Array.from(
    document.querySelectorAll('[data-component="map-sequence"]')
  );
  if (mapFigures.length < 2) return;

  const section = mapFigures[0].closest('section');
  if (!section) return;

  let activeIndex = 0;

  // --- Activate a step: crossfade map + update timeline ---
  function activateStep(index) {
    if (index === activeIndex && index !== 0) return;
    activeIndex = index;

    mapFigures.forEach((fig, i) =>
      fig.classList.toggle('is-active', i === index)
    );

    stage.querySelectorAll('.map-timeline-btn').forEach((btn, i) =>
      btn.setAttribute('aria-pressed', i === index ? 'true' : 'false')
    );
  }

  // --- Build sticky stage ---
  const stage = document.createElement('div');
  stage.className = 'map-stage';
  stage.setAttribute('role', 'img');
  stage.setAttribute(
    'aria-label',
    'Interactive map: free vs slave states 1789–1861'
  );

  mapFigures.forEach((fig, i) => {
    fig.classList.add('map-frame');
    if (i === 0) fig.classList.add('is-active');
    // Moving the DOM node also removes it from its original position
    stage.appendChild(fig);
  });

  const timeline = buildTimeline(mapFigures, activateStep);
  stage.appendChild(timeline);

  // --- Insert stage before the first trigger paragraph ---
  const firstTrigger = section.querySelector('[data-map-trigger]');
  if (firstTrigger) {
    section.insertBefore(stage, firstTrigger);
  } else {
    const h2 = section.querySelector('h2');
    (h2 ? h2 : section.firstElementChild).after(stage);
  }

  // --- Watch trigger paragraphs ---
  // rootMargin '-55% 0px -10% 0px' fires when the paragraph's top
  // edge enters the band between 55vh and 90vh from viewport top —
  // i.e., just below the sticky stage, in the prose reading area.
  const triggers = section.querySelectorAll('[data-map-trigger]');
  if (!triggers.length) return;

  const stepObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const step = parseInt(entry.target.dataset.mapTrigger, 10);
        if (!Number.isNaN(step)) activateStep(step);
      });
    },
    { rootMargin: '-55% 0px -10% 0px', threshold: 0 }
  );

  triggers.forEach((t) => stepObserver.observe(t));
}

// ============================================================
// STUBS — Pass 2+
// ============================================================

/*
function initDataViz() {
  // D3 / Chart.js rendering for [data-component="data-viz"] figures.
  // Lazy-load D3 only when a data-viz enters the viewport.
  // See COMPONENTS.md #9
}

function initCausalChain() {
  // img-28 — nodes illuminate as their linked sections are read.
  // Reads body.dataset.activeMood / section read-state to drive reveals.
  // See COMPONENTS.md #12
}
*/

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('js-active');
  if (REDUCED_MOTION) document.body.classList.add('reduced-motion');

  // DOM restructuring must happen before observers are attached
  initMapSequence();
  initSwitcher();

  // Central observer registrations
  initScrollReveal();
  initSections();

  // Independent lightweight observers
  initProgressiveReveal();
  initScrollDive();

  // Non-observer interactions
  initHeroParallax();
  initFootnotes();
});
