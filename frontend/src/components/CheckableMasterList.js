import React, { useEffect, useRef } from 'react';

/**
 * Master list (tag types, vendors, …) with row checkboxes, select-all, and a bulk-delete bar.
 * Clicking a row name opens its details; the checkbox only toggles selection.
 */
export default function CheckableMasterList({
  title,
  items,
  selectedId,
  onSelect,
  checkedIds,
  onCheckedChange,
  onBulkDelete,
  emptyLabel,
}) {
  const allChecked = items.length > 0 && items.every((i) => checkedIds.has(i.id));
  const someChecked = !allChecked && items.some((i) => checkedIds.has(i.id));
  const selectAllRef = useRef(null);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someChecked;
  }, [someChecked]);

  const toggleAll = () => {
    onCheckedChange(allChecked ? new Set() : new Set(items.map((i) => i.id)));
  };

  const toggleOne = (id) => {
    const next = new Set(checkedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onCheckedChange(next);
  };

  return (
    <div className="master-list">
      <div className="master-list-header">
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allChecked}
          onChange={toggleAll}
          disabled={!items.length}
          aria-label={`Select all ${title}`}
        />
        <span>{title}</span>
      </div>

      {checkedIds.size > 0 && (
        <div className="master-list-bulk" role="status">
          <span>{checkedIds.size} selected</span>
          <button type="button" className="btn btn-danger btn-sm" onClick={onBulkDelete}>
            Delete selected
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCheckedChange(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="master-list-body">
        {items.map((item) => {
          const isSelected = selectedId === item.id;
          const isChecked = checkedIds.has(item.id);
          return (
            <div
              key={item.id}
              className={`master-list-row${isSelected ? ' is-selected' : ''}${isChecked ? ' is-checked' : ''}`}
              onClick={() => onSelect(item)}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleOne(item.id)}
                aria-label={`Select ${item.name}`}
              />
              <span className="master-list-name" title={item.name}>{item.name}</span>
            </div>
          );
        })}
        {items.length === 0 && <div className="master-list-empty">{emptyLabel}</div>}
      </div>
    </div>
  );
}
