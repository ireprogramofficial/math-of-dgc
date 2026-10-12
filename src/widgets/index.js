// Registry: data-widget="<name>" on an element mounts the widget exported by that module.
export const WIDGETS = {
  hero: () => import('./hero.js'),
  gallery: () => import('./gallery.js'),
  control: () => import('./control.js'),
  loops: () => import('./loops.js'),
  unknown: () => import('./unknownDrift.js'),
  optimal: () => import('./optimalControl.js'),
  optimize: () => import('./optimize.js'),
};
