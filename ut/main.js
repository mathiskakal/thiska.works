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
    'figure[data-img-id],' +
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
// STUBS — Pass 2+
// ============================================================

/*
function initMapSequence() {
  // Sticky crossfade map with timeline bar.
  // Needs Scrollama for scroll-progress tracking (not just enter/exit).
  // Components: img-05 (1789) → img-06 (1821) → img-08 (1861)
  // See COMPONENTS.md #4
}

function initDataViz() {
  // D3 / Chart.js rendering for [data-component="data-viz"] figures.
  // Lazy-load D3 only when a data-viz enters the viewport.
  // See COMPONENTS.md #9
}

function initSwitcher() {
  // Tab-based crop comparison: img-11 (North) vs img-12 (South).
  // See COMPONENTS.md #7
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

  // Central observer registrations (order doesn't matter)
  initScrollReveal();
  initSections();

  // Independent lightweight observers
  initProgressiveReveal();
  initScrollDive();

  // Non-observer interactions
  initHeroParallax();
  initFootnotes();
});
