(function () {
  'use strict';

  var doc = document;

  doc.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  var menuBtn = doc.querySelector('.menu-btn');
  var mobileNav = doc.getElementById('mobile-nav');
  if (menuBtn && mobileNav) {
    menuBtn.addEventListener('click', function () {
      var willOpen = !mobileNav.hasAttribute('data-open');
      if (willOpen) {
        mobileNav.setAttribute('data-open', '');
      } else {
        mobileNav.removeAttribute('data-open');
      }
      menuBtn.setAttribute('aria-expanded', String(willOpen));
    });
  }

  var desktop = window.matchMedia('(min-width: 901px)');
  doc.querySelectorAll('details.sidebar-nav').forEach(function (det) {
    var sync = function () {
      det.open = desktop.matches;
    };
    sync();
    if (typeof desktop.addEventListener === 'function') {
      desktop.addEventListener('change', sync);
    }
  });

  doc.querySelectorAll('[data-stagger]').forEach(function (group) {
    Array.prototype.forEach.call(group.children, function (child, i) {
      child.style.setProperty('--rd', i * 55 + 'ms');
    });
  });

  var revealItems = Array.prototype.slice.call(doc.querySelectorAll('.reveal-item'));
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches || !('IntersectionObserver' in window)) {
    revealItems.forEach(function (el) {
      el.classList.add('in');
    });
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -6% 0px' }
    );
    revealItems.forEach(function (el) {
      io.observe(el);
    });
  }

  doc.querySelectorAll('.bars[data-bars]').forEach(function (box) {
    var count = parseInt(box.getAttribute('data-bars'), 10) || 48;
    var lit = (box.getAttribute('data-lit') || '')
      .split(',')
      .map(function (n) {
        return parseInt(n, 10);
      })
      .filter(function (n) {
        return !isNaN(n);
      });
    var frag = doc.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      var bar = doc.createElement('span');
      bar.className = 'bar' + (lit.indexOf(i) !== -1 ? ' lit' : '');
      bar.style.setProperty('--h', Math.round(14 + Math.random() * 86) + '%');
      if (!reduced.matches) {
        bar.style.setProperty('--dur', (1.1 + Math.random() * 1.3).toFixed(2) + 's');
        bar.style.setProperty('--del', (-Math.random() * 2).toFixed(2) + 's');
      }
      frag.appendChild(bar);
    }
    box.appendChild(frag);
    if (!reduced.matches) {
      box.classList.add('anim');
    }
  });

  doc.querySelectorAll('[data-copy-source]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var holder = doc.getElementById(btn.getAttribute('data-copy-source'));
      var codeEl = holder && holder.querySelector('code');
      if (!codeEl || !navigator.clipboard) return;
      navigator.clipboard
        .writeText(codeEl.innerText.replace(/^\$\s/gm, '').replace(/\s*#.*$/gm, ''))
        .then(function () {
          btn.classList.add('done');
          window.setTimeout(function () {
            btn.classList.remove('done');
          }, 1600);
        })
        .catch(function () {});
    });
  });
})();
