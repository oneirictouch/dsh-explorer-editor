/**
 * VS Code-style floating context menu for the file tree.
 *
 * Fixed-position at the cursor, keyboard navigable (↑/↓, Enter, Esc), closes
 * on outside click / Escape, and flips to stay inside the viewport.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Translator } from './i18n.ts';

export interface TreeMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  onSelect: () => void;
}

interface TreeContextMenuProps {
  x: number;
  y: number;
  items: TreeMenuItem[];
  t: Translator;
  onClose: () => void;
}

export function TreeContextMenu({ x, y, items, t, onClose }: TreeContextMenuProps): JSX.Element {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  // Visible = items without separators; keyboard nav walks this list.
  const visible = useMemo(() => items.filter((item) => !item.separator), [items]);

  // Measure and flip so the menu stays inside the viewport.
  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 4);
    const top = Math.min(y, window.innerHeight - rect.height - 4);
    setPosition({ left: Math.max(4, left), top: Math.max(4, top) });
  }, [x, y]);

  // Focus the first enabled item on open.
  useEffect(() => {
    const first = visible.findIndex((item) => !item.disabled);
    setActive(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        let idx = active;
        for (let step = 0; step < visible.length; step++) {
          idx = (idx + delta + visible.length) % visible.length;
          if (!visible[idx].disabled) break;
        }
        setActive(idx);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const item = visible[active];
        if (item !== undefined && !item.disabled) {
          item.onSelect();
          onClose();
        }
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onContextMenuElsewhere = (e: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('contextmenu', onContextMenuElsewhere, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('contextmenu', onContextMenuElsewhere, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, active, onClose]);

  return (
    <div
      ref={rootRef}
      className="dshf-context-menu"
      role="menu"
      aria-label={t('contextMenu.label')}
      style={position === null ? { visibility: 'hidden', left: x, top: y } : { left: position.left, top: position.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return <div key={item.id} role="separator" className="dshf-menu-sep" />;
        }
        const visibleIndex = visible.indexOf(item);
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`dshf-menu-item${visibleIndex === active ? ' dshf-menu-item-active' : ''}${item.disabled ? ' dshf-menu-item-disabled' : ''}`}
            disabled={item.disabled}
            onMouseEnter={() => setActive(visibleIndex)}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
          >
            <span className="dshf-menu-label">{item.label}</span>
            {item.shortcut !== undefined && <span className="dshf-menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
