/* Shared behaviour for souravbaid.com. Every block no-ops on pages without its elements. */
/* Smooth scroll */
document.querySelectorAll('a[href^="#"]').forEach(function(a) {
  a.addEventListener('click', function(e) {
    var href = this.getAttribute('href');
    if (href === '#') return;
    var target = document.querySelector(href);
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});


/* Nav shadow on scroll */
var navEl = document.getElementById('main-nav');
if (navEl) window.addEventListener('scroll', function() {
  navEl.style.boxShadow = window.scrollY > 10 ? '0 2px 16px rgba(0,0,0,.07)' : '';
}, { passive: true });

/* Scroll reveal */
if (window.IntersectionObserver) {
  var revealObs = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) { e.target.classList.add('visible'); revealObs.unobserve(e.target); }
    });
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(function(el) { revealObs.observe(el); });
} else {
  document.querySelectorAll('.reveal').forEach(function(el) { el.classList.add('visible'); });
}

/* Counter animation for privacy stats */
function animCount(el, target, suffix, duration) {
  var startTime = null;
  function step(ts) {
    if (!startTime) startTime = ts;
    var p = Math.min((ts - startTime) / duration, 1);
    el.textContent = Math.round(p * target) + suffix;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
if (window.IntersectionObserver) {
  var prvObs = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) {
        e.target.querySelectorAll('.prv-n').forEach(function(el) {
          var target = parseInt(el.getAttribute('data-count'), 10);
          var suffix = el.getAttribute('data-suffix');
          animCount(el, target, suffix, target === 0 ? 600 : 1000);
        });
        prvObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.3 });
  var ps = document.getElementById('prv-stats');
  if (ps) prvObs.observe(ps);
}

// Scroll-pinned walkthrough: scroll position drives the step, so the user
// controls the pace. Sticky does the pinning, so native scrolling is untouched.
(function(){
  var wraps = document.querySelectorAll('.pin-wrap');
  if (!wraps.length) return;
  var all = [];

  [].forEach.call(wraps, function(wrap){
    var steps   = wrap.querySelectorAll('.pin-step');
    var screens = wrap.querySelectorAll('.pscr');
    var n = steps.length;
    // Screens either follow the steps one to one, or say which steps they show (data-s="2 3"),
    // which is how Together's two phones each keep a screen up across several steps.
    var tagged = wrap.querySelector('.pscr[data-s]') != null;
    if (!n || (!tagged && screens.length !== n)) return;
    function shows(sc, k, i) {
      return tagged ? (sc.getAttribute('data-s') || '').split(' ').indexOf(String(i)) !== -1 : k === i;
    }
    var cur = -1;

    all.push(function(){
      var r = wrap.getBoundingClientRect();
      // Skip sections nowhere near the viewport.
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      var travel = r.height - window.innerHeight;
      var i;
      // travel <= 0 means the stage is not pinning (reduced motion unpins it),
      // in which case the steps stack and the phone just holds the first screen.
      if (travel <= 0) {
        i = 0;
      } else {
        var p = -r.top / travel;
        p = p < 0 ? 0 : (p > 1 ? 1 : p);
        i = Math.min(Math.floor(p * n), n - 1);
      }
      if (i === cur) return;
      cur = i;
      // The step on the wrap too, so animations inside the phones can key off it.
      wrap.setAttribute('data-s', String(i));
      for (var k = 0; k < n; k++) steps[k].classList.toggle('on', k === i);
      for (var j = 0; j < screens.length; j++) screens[j].classList.toggle('on', shows(screens[j], j, i));
    });
  });

  // One rect read and at most one class swap per section per event, so this runs
  // inline. A requestAnimationFrame guard would deadlock permanently if a frame
  // never arrives -- the pending flag stays set and every later scroll is dropped.
  function update() { for (var i = 0; i < all.length; i++) all[i](); }
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
}());


// Hamburger menu
(function(){
  var btn = document.getElementById('ham-btn');
  var menu = document.getElementById('mob-menu');
  if (!btn || !menu) return;
  function close() {
    menu.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    var opening = !menu.classList.contains('open');
    opening ? menu.classList.add('open') : close();
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  });
  menu.querySelectorAll('.mob-link').forEach(function(link) {
    link.addEventListener('click', close);
  });
  document.addEventListener('click', function(e) {
    if (!menu.contains(e.target) && !btn.contains(e.target)) close();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') close();
  });
}());

// "What Arth does" showcase (home): one area open at a time, the phone shows its screen.
// Auto-advances while on screen (unless the visitor prefers reduced motion). Clicking or tapping
// an area shows it and pauses there; scrolling the page plays it again. A mouse resting over it
// doesn't pause anything.
(function(){
  var sec = document.querySelector('.show');
  if (!sec) return;
  var items = sec.querySelectorAll('.show-it');
  var screens = sec.querySelectorAll('#show-phone .pscr');
  var n = items.length;
  if (!n || screens.length !== n) return;
  var MS = 3000, cur = 0;

  function go(i, animate) {
    cur = i;
    for (var k = 0; k < n; k++) {
      var on = k === i;
      items[k].classList.toggle('on', on);
      items[k].querySelector('.show-t').setAttribute('aria-expanded', on ? 'true' : 'false');
      screens[k].classList.toggle('on', on);
    }
    if (animate) {
      var it = items[i];
      it.classList.remove('show-li-in'); void it.offsetWidth; it.classList.add('show-li-in');
    }
  }

  var auto = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var inView = false, held = false, heldAtY = 0, timer = null, remaining = MS, startedAt = 0;
  sec.style.setProperty('--show-ms', MS + 'ms');
  if (auto) sec.classList.add('auto', 'paused');

  function running() { return auto && inView && !held; }
  function sync() {
    clearTimeout(timer);
    if (!running()) {
      if (startedAt) { remaining = Math.max(0, remaining - (Date.now() - startedAt)); startedAt = 0; }
      sec.classList.add('paused');
      return;
    }
    sec.classList.remove('paused');
    startedAt = Date.now();
    timer = setTimeout(function () {
      startedAt = 0; remaining = MS;
      go((cur + 1) % n, true);
      sync();
    }, remaining);
  }
  [].forEach.call(items, function (it, i) {
    it.querySelector('.show-t').addEventListener('click', function () {
      // Hold on the area picked; a fresh 3 s once scrolling resumes it.
      held = true; heldAtY = window.scrollY; remaining = MS; startedAt = 0;
      if (i !== cur) go(i, true);
      sync();
    });
  });

  // On screen? A position check on scroll (IntersectionObserver never reports in some embedded
  // views). Scrolling a little after a click also plays it again.
  var g = sec.querySelector('.show-g');
  function check() {
    var r = g.getBoundingClientRect();
    var h = window.innerHeight || document.documentElement.clientHeight;
    var v = r.top < h * 0.7 && r.bottom > h * 0.3;
    var resume = held && Math.abs(window.scrollY - heldAtY) > 40;
    if (resume) {
      held = false;
      remaining = MS; startedAt = 0;
      var bar = items[cur].querySelector('.show-bar i'); // this area's bar starts again from empty
      if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
    }
    if (v !== inView || resume) { inView = v; sync(); }
  }
  window.addEventListener('scroll', check, { passive: true });
  window.addEventListener('resize', check, { passive: true });
  check();
}());

// Stories (home): a phone and its steps, one step at a time. Each phone shows the screens whose
// data-s lists the current step. Plays on its own while on screen, 3 s a step. Tapping a step
// shows it and holds there a while, then carries on.
// Visitors who prefer reduced motion get the steps to tap, but nothing moves by itself.
[].forEach.call(document.querySelectorAll('.story'), function (story) {
  var steps = story.querySelectorAll('.tog-step');
  var screens = story.querySelectorAll('.pscr[data-s]');
  var bar = story.querySelector('.tog-prog i');
  var n = steps.length, cur = 0, timer = null, inView = false, heldUntil = 0;
  if (!n) return;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var HOLD = 12000, STEP_MS = 3000;

  function readMs() {
    return STEP_MS;
  }
  function go(i) {
    cur = i;
    story.setAttribute('data-s', String(i));
    for (var k = 0; k < n; k++) steps[k].classList.toggle('on', k === i);
    [].forEach.call(screens, function (sc) {
      sc.classList.toggle('on', sc.getAttribute('data-s').split(' ').indexOf(String(i)) !== -1);
    });
  }
  function restartBar(ms) {
    if (!bar) return;
    story.style.setProperty('--tog-ms', ms + 'ms');
    bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
  }
  function schedule() {
    clearTimeout(timer);
    timer = null;
    var run = !reduced && inView && !document.hidden;
    story.classList.toggle('auto', !reduced);
    story.classList.toggle('paused', !run);
    if (!run) return;
    var wait = Math.max(readMs(cur), heldUntil - Date.now());
    restartBar(wait);
    timer = setTimeout(function () { go((cur + 1) % n); schedule(); }, wait);
  }
  function setInView(v) {
    // Also restarts a story that should be playing but isn't (the page was hidden and the
    // browser never said it came back).
    if (v === inView && !(v && !timer)) return;
    inView = v;
    schedule();
  }

  [].forEach.call(steps, function (b, i) {
    b.addEventListener('click', function () { heldUntil = Date.now() + HOLD; go(i); schedule(); });
  });
  document.addEventListener('visibilitychange', schedule);
  go(0);

  // On screen? A plain position check on scroll: IntersectionObserver never reports in some
  // embedded views, and one rect read per scroll is cheap.
  function check() {
    var r = story.getBoundingClientRect();
    var h = window.innerHeight || document.documentElement.clientHeight;
    setInView(r.top < h * 0.75 && r.bottom > h * 0.25);
  }
  window.addEventListener('scroll', check, { passive: true });
  window.addEventListener('resize', check, { passive: true });
  check();
});

// FAQ: a link to /faq#some-question opens that answer and scrolls to it.
(function () {
  function openFromHash() {
    var id = decodeURIComponent((location.hash || '').slice(1));
    var d = id && document.getElementById(id);
    if (!d || d.tagName !== 'DETAILS') return;
    d.open = true;
    d.scrollIntoView({ block: 'start' });
  }
  openFromHash();
  window.addEventListener('hashchange', openFromHash);
}());

/* Direct download: point the button at the newest release's APK (each release names its own,
   e.g. Arth-4.20.0.apk). Without JavaScript, or if GitHub can't be reached, the link opens the
   latest release page instead. */
(function () {
  var links = document.querySelectorAll('[data-latest-apk]');
  if (!links.length || !window.fetch) return;
  fetch('https://api.github.com/repos/kaiser7292/arth/releases/latest')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (rel) {
      var apk = rel && (rel.assets || []).filter(function (a) { return /\.apk$/i.test(a.name); })[0];
      if (!apk) return;
      links.forEach(function (l) {
        l.href = apk.browser_download_url;
        l.setAttribute('download', apk.name);
        l.setAttribute('aria-label', 'Download ' + apk.name);
      });
    })
    .catch(function () {});
}());
