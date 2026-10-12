import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Replaces the browser's native popup for long <select> elements with a compact,
 * searchable list (fixed height, same width as the field). Mount once at the app root.
 *
 * The <select> stays the source of truth: picking an item sets its value and fires a
 * bubbling "change" event, so existing React onChange handlers work unchanged.
 * Opt out per element with data-native-select.
 */
const MIN_OPTIONS = 9;
const LIST_MAX_HEIGHT = 280;
const SEARCH_HEIGHT = 44;
const GAP = 4;

const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;

function shouldEnhance(el) {
  return (
    el instanceof HTMLSelectElement &&
    !el.multiple &&
    !el.disabled &&
    el.size <= 1 &&
    !el.hasAttribute('data-native-select') &&
    el.options.length >= MIN_OPTIONS
  );
}

function readOptions(select) {
  return Array.from(select.options)
    .filter((o) => !o.hidden)
    .map((o) => ({ value: o.value, label: o.text, disabled: o.disabled }));
}

function computePosition(select) {
  const r = select.getBoundingClientRect();
  const width = Math.max(r.width, 220);
  const left = Math.min(r.left, window.innerWidth - width - 8);
  const popupHeight = LIST_MAX_HEIGHT + SEARCH_HEIGHT;
  const spaceBelow = window.innerHeight - r.bottom;
  const openUp = spaceBelow < popupHeight + GAP && r.top > spaceBelow;
  const maxHeight = Math.max(160, Math.min(popupHeight, (openUp ? r.top : spaceBelow) - GAP - 8));
  return openUp
    ? { left: Math.max(8, left), width, bottom: window.innerHeight - r.top + GAP, maxHeight }
    : { left: Math.max(8, left), width, top: r.bottom + GAP, maxHeight };
}

function SelectPopup({ select, onClose }) {
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState(() => computePosition(select));
  const options = useMemo(() => readOptions(select), [select]);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === select.value)));
  const popupRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const choose = useCallback((opt) => {
    if (!opt || opt.disabled) return;
    if (select.value !== opt.value) {
      nativeValueSetter.call(select, opt.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    onClose(true);
  }, [select, onClose]);

  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    setActive(query ? 0 : Math.max(0, filtered.findIndex((o) => o.value === select.value)));
  }, [query, filtered, select]);

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    const reposition = () => {
      if (!document.body.contains(select)) return onClose(false);
      setPos(computePosition(select));
    };
    const outside = (e) => {
      // Clicks on enhanced selects (this one or another) are handled by SelectEnhancer.
      if (popupRef.current?.contains(e.target) || shouldEnhance(e.target)) return;
      onClose(false);
    };
    const onScroll = (e) => {
      if (popupRef.current?.contains(e.target)) return;
      reposition();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousedown', outside, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousedown', outside, true);
    };
  }, [select, onClose]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(filtered[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose(true);
    } else if (e.key === 'Tab') {
      onClose(true);
    }
  };

  return createPortal(
    <div
      ref={popupRef}
      className="select-enhancer-popup"
      style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
      onKeyDown={onKeyDown}
    >
      <input
        ref={searchRef}
        className="select-enhancer-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search…"
        aria-label="Search options"
      />
      <ul ref={listRef} className="select-enhancer-list" role="listbox">
        {filtered.length === 0 && <li className="select-enhancer-empty">No matches</li>}
        {filtered.map((o, i) => (
          <li
            key={`${o.value}-${i}`}
            data-idx={i}
            role="option"
            aria-selected={o.value === select.value}
            aria-disabled={o.disabled || undefined}
            className={[
              'select-enhancer-option',
              i === active ? 'is-active' : '',
              o.value === select.value ? 'is-selected' : '',
              o.disabled ? 'is-disabled' : '',
            ].join(' ')}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(o)}
            title={o.label}
          >
            {o.label}
          </li>
        ))}
      </ul>
    </div>,
    document.body
  );
}

export default function SelectEnhancer() {
  const [open, setOpen] = useState(null);
  const seq = useRef(0);

  const close = useCallback((refocus) => {
    setOpen((current) => {
      if (refocus && current && document.body.contains(current.el)) current.el.focus();
      return null;
    });
  }, []);

  useEffect(() => {
    const openFor = (el) => {
      seq.current += 1;
      return { el, id: seq.current };
    };
    const onMouseDown = (e) => {
      if (e.button !== 0 || !shouldEnhance(e.target)) return;
      e.preventDefault();
      const target = e.target;
      setOpen((current) => (current?.el === target ? null : openFor(target)));
      target.focus();
    };
    const onKeyDown = (e) => {
      if (!shouldEnhance(e.target)) return;
      const opens = e.key === ' ' || e.key === 'Enter' || e.key === 'F4' ||
        (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'));
      if (!opens) return;
      e.preventDefault();
      const target = e.target;
      setOpen(openFor(target));
    };
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  return open ? <SelectPopup key={open.id} select={open.el} onClose={close} /> : null;
}
