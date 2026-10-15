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
    if (!n || screens.length !== n) return;
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
      for (var k = 0; k < n; k++) {
        steps[k].classList.toggle('on', k === i);
        screens[k].classList.toggle('on', k === i);
      }
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
