// Tiny DOM helpers for widget control panels.

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(c));
  return node;
}

/** Segmented single-choice button group. Returns { el, set(value) }. */
export function segmented(options, value, onChange) {
  const root = h('div', { class: 'seg' });
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', 'data-value': o.value, title: o.title ?? '' }, o.label);
    b.addEventListener('click', () => { set(o.value); onChange?.(o.value); });
    root.append(b);
    return b;
  });
  function set(v) { buttons.forEach((b) => b.classList.toggle('on', b.dataset.value === String(v))); }
  set(value);
  return { el: root, set };
}

export function select(options, value, onChange) {
  const s = h('select', {}, options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  s.addEventListener('change', () => onChange?.(s.value));
  return s;
}
