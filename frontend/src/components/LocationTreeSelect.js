import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildLocationPath } from '../utils/locationTree';

function TreePickerNode({ node, selectedId, onSelect, level = 0 }) {
  const [expanded, setExpanded] = useState(level < 2);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = String(selectedId) === String(node.id);

  return (
    <div>
      <div
        role="option"
        aria-selected={isSelected}
        className={`location-tree-option ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: 10 + level * 18 }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <span
            className="tree-toggle"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className="tree-toggle-spacer" />
        )}
        <span className="location-tree-option-name">{node.name}</span>
        {node.location_type_name && (
          <span className="location-tree-option-type">{node.location_type_name}</span>
        )}
      </div>
      {expanded && hasChildren && node.children.map((child) => (
        <TreePickerNode
          key={child.id}
          node={child}
          selectedId={selectedId}
          onSelect={onSelect}
          level={level + 1}
        />
      ))}
    </div>
  );
}

/**
 * Tree dropdown for picking a location (parent or leaf). Shows full path after selection.
 */
export default function LocationTreeSelect({
  tree = [],
  locations = [],
  value,
  onChange,
  placeholder = '— Select location —',
  disabled = false,
  required = false,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const pathLabel = useMemo(
    () => buildLocationPath(locations, value),
    [locations, value],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (node) => {
    onChange(String(node.id));
    setOpen(false);
  };

  return (
    <div className={`location-tree-select ${disabled ? 'disabled' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="location-tree-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="location-tree-select-trigger-text">
          {value && pathLabel ? (
            <span className="location-tree-select-path">{pathLabel}</span>
          ) : (
            <span className="location-tree-select-placeholder">{placeholder}</span>
          )}
        </span>
        <span className="location-tree-select-chevron" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>

      {value && pathLabel && (
        <div className="location-tree-select-summary" aria-live="polite">
          <span className="location-tree-select-summary-label">Selected:</span>{' '}
          {pathLabel}
        </div>
      )}

      {open && (
        <div className="location-tree-select-panel" role="listbox">
          {!tree.length ? (
            <p className="location-tree-select-empty">No locations available</p>
          ) : (
            tree.map((node) => (
              <TreePickerNode
                key={node.id}
                node={node}
                selectedId={value}
                onSelect={pick}
              />
            ))
          )}
        </div>
      )}

      {required && !value && (
        <span className="location-tree-select-hint">Choose a location from the tree (site, building, room, etc.)</span>
      )}
    </div>
  );
}
