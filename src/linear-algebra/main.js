// Entry point for the linear-algebra deck (linear-algebra/index.html). Shares the river deck's
// look (src/styles/deck.css) but has its own slides, styles and widget registry.
import Reveal from 'reveal.js';
import 'reveal.js/reveal.css';
import 'reveal.js/theme/white.css';
import 'katex/dist/katex.min.css';
import renderMathInElement from 'katex/contrib/auto-render';
import '../styles/deck.css';
import './styles/deck.css';
import { WIDGETS } from './widgets/index.js';
import { buildHeaders } from './lib/header.js';

buildHeaders(document.querySelector('.slides'));

const deck = new Reveal({
  width: 1280,
  height: 720,
  margin: 0.03,
  center: false,
  hash: true,
  slideNumber: 'c/t',
  transition: 'fade',
  transitionSpeed: 'fast',
  controls: true,
  progress: true,
  mouseWheel: false,
});

// ---- math ----
const mathOptions = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '\\(', right: '\\)', display: false },
  ],
  throwOnError: false,
};

// ---- widgets: created lazily for the current and next slide, running only while visible ----
const hosts = [...document.querySelectorAll('[data-widget]')].map((el) => ({ el, name: el.dataset.widget, instance: null, loading: false }));

async function ensure(host) {
  if (host.instance || host.loading) return;
  host.loading = true;
  try {
    const mod = await WIDGETS[host.name]();
    host.instance = mod.create(host.el, { deck });
    host.syncActive?.();
  } catch (e) {
    console.error(`widget "${host.name}" failed`, e);
    host.el.textContent = `Widget "${host.name}" failed to load: ${e.message}`;
  } finally {
    host.loading = false;
  }
}

function sync() {
  const slides = deck.getSlides();
  const current = deck.getCurrentSlide();
  const idx = slides.indexOf(current);
  const near = new Set([current, slides[idx + 1]].filter(Boolean));
  for (const host of hosts) {
    const here = current.contains(host.el);
    const soon = [...near].some((s) => s.contains(host.el));
    if (soon) ensure(host);
    host.syncActive = () => host.instance?.setActive(here && !deck.isOverview());
    host.syncActive();
  }
}

deck.on('ready', () => { renderMathInElement(document.querySelector('.slides'), mathOptions); sync(); });
deck.on('slidechanged', sync);
deck.on('overviewshown', sync);
deck.on('overviewhidden', sync);
deck.initialize();
