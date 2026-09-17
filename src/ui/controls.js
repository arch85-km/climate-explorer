/**
 * Toolbar control factories.
 *
 * Each returns { node, set(value) } so the toolbar can rebuild cheaply and still
 * push state changes back into controls the user is not currently touching.
 *
 * @version 1.0.0 — 2026-09-17
 */
import { el, icon } from './dom.js';

let uid = 0;
const nextId = (prefix) => `cx-${prefix}-${(uid += 1)}`;

/** A labelled group of controls. */
function group(label, ...children) {
  return el('div.group', {}, el('div.group-label', { text: label }), el('div.group-body', {}, ...children));
}

/** A native select, which is the right control on a phone as well as a desktop. */
function select(options, value, onChange, opts = {}) {
  const id = nextId('sel');
  const node = el('select.select', { id, 'aria-label': opts.ariaLabel || opts.label || 'option' });
  const render = (v) => {
    node.replaceChildren();
    for (const o of options) {
      if (o.group) {
        const g = el('optgroup', { label: o.group });
        for (const child of o.options) {
          g.appendChild(el('option', { value: child.value, selected: child.value === v }, child.label));
        }
        node.appendChild(g);
      } else {
        node.appendChild(el('option', { value: o.value, selected: o.value === v }, o.label));
      }
    }
  };
  render(value);
  node.addEventListener('change', () => onChange(node.value));
  const wrap = opts.label
    ? el('label.field', {}, el('span.field-label', { text: opts.label }), node)
    : node;
  return { node: wrap, input: node, set: (v) => { node.value = v; }, setOptions: (o, v) => { options = o; render(v); } };
}

/** A range input with a live value readout. */
function slider(opts) {
  const out = el('span.slider-value', { text: opts.format ? opts.format(opts.value) : String(opts.value) });
  const input = el('input.slider', {
    type: 'range',
    min: String(opts.min),
    max: String(opts.max),
    step: String(opts.step || 1),
    value: String(opts.value),
    'aria-label': opts.label,
  });
  const emit = (commit) => {
    const v = Number(input.value);
    out.textContent = opts.format ? opts.format(v) : String(v);
    opts.onInput?.(v, commit);
  };
  input.addEventListener('input', () => emit(false));
  input.addEventListener('change', () => emit(true));
  const node = el('label.field', {},
    el('span.field-label', {}, opts.label, out),
    input);
  return {
    node,
    input,
    set(v) {
      input.value = String(v);
      out.textContent = opts.format ? opts.format(v) : String(v);
    },
  };
}

/** A segmented control — the right shape for 2 to 5 mutually exclusive options. */
function segmented(options, value, onChange, opts = {}) {
  const buttons = new Map();
  const node = el('div.segmented', { role: 'radiogroup', 'aria-label': opts.label || '' });
  for (const o of options) {
    const b = el('button.seg', {
      type: 'button',
      role: 'radio',
      'aria-checked': o.value === value ? 'true' : 'false',
      title: o.title || o.label,
      onclick: () => onChange(o.value),
    }, o.icon ? icon(o.icon, 15) : null, o.label ? el('span', { text: o.label }) : null);
    if (o.value === value) b.classList.add('is-active');
    buttons.set(o.value, b);
    node.appendChild(b);
  }
  const wrap = opts.label && opts.showLabel !== false
    ? el('label.field', {}, el('span.field-label', { text: opts.label }), node)
    : node;
  return {
    node: wrap,
    set(v) {
      for (const [key, b] of buttons) {
        const on = key === v;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    },
  };
}

/** A checkbox styled as a switch. */
function toggle(label, value, onChange, opts = {}) {
  const input = el('input', { type: 'checkbox', checked: value, 'aria-label': label });
  input.addEventListener('change', () => onChange(input.checked));
  const node = el('label.toggle', { title: opts.title || '' },
    input, el('span.toggle-track', {}, el('span.toggle-thumb')), el('span.toggle-label', { text: label }));
  return { node, input, set: (v) => { input.checked = !!v; } };
}

/** A plain button, optionally icon-only. */
function button(label, onClick, opts = {}) {
  const node = el('button.btn', {
    type: 'button',
    title: opts.title || label,
    'aria-label': opts.ariaLabel || label,
    onclick: onClick,
  }, opts.icon ? icon(opts.icon, opts.iconSize || 15) : null,
  opts.iconOnly ? null : el('span', { text: label }));
  if (opts.variant) node.classList.add(`cx-btn-${opts.variant}`);
  if (opts.iconOnly) node.classList.add('cx-btn-icon');
  return {
    node,
    setLabel(text) { const s = node.querySelector('span'); if (s) s.textContent = text; },
    setActive(on) { node.classList.toggle('is-active', !!on); },
    setDisabled(on) { node.disabled = !!on; },
  };
}

/**
 * A month/day picker built from two selects — more reliable inside a WordPress
 * page than <input type="date">, whose native picker some themes restyle badly.
 */
function dayPicker(label, value, onChange, daysInMonth) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthSel = el('select.select.select-compact', { 'aria-label': `${label} month` });
  MONTHS.forEach((m, i) => monthSel.appendChild(el('option', { value: String(i + 1) }, m)));
  const daySel = el('select.select.select-compact', { 'aria-label': `${label} day` });

  function fillDays(month, day) {
    daySel.replaceChildren();
    const n = daysInMonth(month);
    for (let d = 1; d <= n; d += 1) daySel.appendChild(el('option', { value: String(d) }, String(d)));
    daySel.value = String(Math.min(day, n));
  }

  monthSel.value = String(value.month);
  fillDays(value.month, value.day);

  const emit = () => {
    const month = Number(monthSel.value);
    fillDays(month, Number(daySel.value));
    onChange({ month, day: Number(daySel.value) });
  };
  monthSel.addEventListener('change', emit);
  daySel.addEventListener('change', emit);

  return {
    node: el('label.field', {},
      el('span.field-label', { text: label }),
      el('div.daypicker', {}, daySel, monthSel)),
    set(v) {
      monthSel.value = String(v.month);
      fillDays(v.month, v.day);
    },
  };
}

export { group, select, slider, segmented, toggle, button, dayPicker, nextId };
