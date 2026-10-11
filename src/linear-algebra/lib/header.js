// The pptx-style section tracker: a row of segments across the top of each slide, grouped into
// Terrain / Control / Optimization / Metrics, with the current slide's segment highlighted.
// A slide joins the tracker with data-sec="terrain|control|optimization|metrics"; data-label sets the
// heading over its group (defaults to the section name).

export const SECTIONS = [
  { key: 'terrain', name: 'Terrain' },
  { key: 'control', name: 'Control' },
  { key: 'optimization', name: 'Optimization' },
  { key: 'metrics', name: 'Metrics' },
];

export function buildHeaders(root) {
  const slides = [...root.querySelectorAll(':scope > section')];
  const tracked = slides.filter((s) => s.dataset.sec);
  for (const slide of tracked) {
    const bar = document.createElement('div');
    bar.className = 'la-tracker';
    const here = tracked.indexOf(slide);
    for (const sec of SECTIONS) {
      const members = tracked.filter((s) => s.dataset.sec === sec.key);
      const group = document.createElement('div');
      group.className = `la-track-group sec-${sec.key}` + (slide.dataset.sec === sec.key ? ' current' : '');
      const label = document.createElement('div');
      label.className = 'la-track-label';
      label.textContent = slide.dataset.sec === sec.key ? (slide.dataset.label || sec.name) : sec.name;
      const segs = document.createElement('div');
      segs.className = 'la-track-segs';
      // Sections with no slides yet still show one empty segment, so the full arc of the talk is visible.
      for (const m of members.length ? members : [null]) {
        const seg = document.createElement('span');
        const i = m ? tracked.indexOf(m) : Infinity;
        seg.className = 'la-seg' + (i < here ? ' done' : i === here ? ' on' : '');
        segs.append(seg);
      }
      group.append(label, segs);
      bar.append(group);
    }
    slide.prepend(bar);
  }
}
