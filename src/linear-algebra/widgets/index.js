// Registry for the linear-algebra deck: data-widget="<name>" on an element mounts the widget exported by that module.
// A widget module exports create(el, { deck }) returning { setActive(on), destroy() }.
// River-deck widgets in src/widgets/ can be registered here too, e.g. hero: () => import('../../widgets/hero.js').
export const WIDGETS = {
  diffeq: () => import('./diffeq.js'),
  variables: () => import('./variables.js'),
  datamap: () => import('./datamap.js'),
  pipeline: () => import('./pipeline.js'),
  akmap: () => import('./akmap.js'),
  cone: () => import('./cone.js'),
};
