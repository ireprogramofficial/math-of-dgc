// Slide: open-loop trajectory optimization, solved live in the browser.
import { createBoatWidget } from './boatWidget.js';

export function create(el) {
  return createBoatWidget(el, {
    scenario: 'meander',
    presets: [],
    solve: true,
    draggableTarget: true,
  });
}
