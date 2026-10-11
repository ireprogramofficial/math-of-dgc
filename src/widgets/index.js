// Registry: data-widget="<name>" on an element mounts the widget exported by that module.
export const WIDGETS = {
  hero: () => import('./hero.js'),
  gallery: () => import('./gallery.js'),
  control: () => import('./control.js'),
  loops: () => import('./loops.js'),
  schedule: () => import('./schedule.js'),
  optimize: () => import('./optimize.js'),
};
