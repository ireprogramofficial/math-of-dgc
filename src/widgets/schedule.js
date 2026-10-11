// Slide: the components of an open-loop control-affine system, played out on a boat.
import { createBoatWidget } from './boatWidget.js';

export function create(el) {
  return createBoatWidget(el, {
    scenarios: ['straight', 'meander', 'lake'],
    scenario: 'straight',
    presets: ['drift', 'east', 'northEast'],
    solve: false,
    draggableTarget: false,
  });
}
