/**
 * Minimal DOM helpers.
 *
 * There is deliberately no raw-HTML escape hatch: text out of an EPW file
 * (city names, header comments) reaches the UI, and all of it goes through
 * textContent so a crafted file cannot inject markup.
 *
 * Everything the app creates lives under one root element and carries an
 * `epwviz-` class prefix, so a WordPress theme's stylesheet cannot reach in and
 * a plugin's script cannot collide with anything here.
 *
 * @version 1.0.0 — 2026-09-15
 */

const NS = 'epwviz';

/** el('div.foo#bar', { attrs }, ...children) */
function el(spec, props, ...children) {
  const [tagPart, ...rest] = String(spec).split(/(?=[.#])/);
  const node = document.createElement(tagPart || 'div');
  for (const token of rest) {
    if (token.startsWith('.')) node.classList.add(`${NS}-${token.slice(1)}`);
    else if (token.startsWith('#')) node.id = token.slice(1);
  }
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'class') node.className = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(4)) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child))
      : child);
  }
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** An inline SVG icon from a path, sized to the current font. */
function icon(path, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

const ICONS = {
  upload: 'M12 16V4m0 0L7 9m5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  play: 'M7 4v16l13-8z',
  pause: 'M8 4v16M16 4v16',
  sun: 'M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m10-10 1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  printer: 'M6 9V3h12v6M6 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1M6 14h12v7H6z',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  collapse: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  download: 'M12 4v12m0 0-5-5m5 5 5-5M4 18v2h16v-2',
  columns: 'M4 4h7v16H4zM13 4h7v16h-7z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  reset: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  info: 'M12 16v-5m0-3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
};

export { el, clear, icon, ICONS, NS };
