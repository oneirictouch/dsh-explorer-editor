/**
 * Sidebar view-tab strip for the dsh-explorer-editor plugin: [工作区] [文件].
 *
 * Rendered in two places, always as the same component:
 *  - inside the workspace browser's section header row (via the
 *    `sidebar.workspaces.tabs` slot, replacing the "工作区" section label);
 *  - at the top of the file-manager panel wrapper while the file manager is
 *    open (direct component usage, so both sites share one look).
 *
 * Clicking a tab swaps the `sidebar.workspaces` cell content: "工作区"
 * disposes the plugin's shadow entry (the workspace browser resurfaces);
 * "文件" mounts it (the file-manager panel takes over the cell). The selected
 * tab lives in sidebarTabsStore.ts so both render sites stay in sync.
 *
 * Deliberately NOT role="tab": the center-column editor activation helper
 * (activateEditorView in index.tsx) finds its view tabs by scanning
 * [role="tab"], so giving the sidebar strip that role would make file clicks
 * hit the wrong element. These are toggle buttons (aria-pressed) instead.
 */
import type { JSX } from 'react';
import { useSidebarTab } from './sidebarTabsStore.ts';
import { cx } from './cx.ts';
import type { Translator } from './i18n.ts';

export interface SidebarTabsProps {
  /** Wide (expanded) sidebar: icon + label; collapsed rail: icon only. */
  wide?: boolean;
  /** Expand the collapsed sidebar (used when a tab is picked from the rail). */
  expandSidebar?: () => void;
  /** Switch to the file-manager tab. */
  onSelectFile: () => void;
  /** Switch back to the workspace-browser tab. */
  onSelectWorkspace: () => void;
  /** Bound translator (auto-provided by the slot when registered with locale). */
  t: Translator;
}

export function SidebarTabs({ wide, expandSidebar, onSelectFile, onSelectWorkspace, t }: SidebarTabsProps): JSX.Element {
  const tab = useSidebarTab();
  const workspaceLabel = t('workspace.tab');
  const fileLabel = t('view.label');
  return (
    <div className="dshf-tabs" role="group" aria-label={t('tabs.aria')}>
      <button
        type="button"
        className={cx('dshf-tab', tab === 'workspace' && 'dshf-tab-active')}
        aria-pressed={tab === 'workspace'}
        title={wide ? undefined : workspaceLabel}
        onClick={onSelectWorkspace}
      >
        <FolderCloseIcon size={wide ? 14 : 16} />
        {wide ? <span className="dshf-tab-label">{workspaceLabel}</span> : null}
      </button>
      <button
        type="button"
        className={cx('dshf-tab', tab === 'files' && 'dshf-tab-active')}
        aria-pressed={tab === 'files'}
        title={wide ? undefined : fileLabel}
        onClick={() => {
          onSelectFile();
          if (!wide) expandSidebar?.();
        }}
      >
        <FolderOpenIcon size={wide ? 14 : 16} />
        {wide ? <span className="dshf-tab-label">{fileLabel}</span> : null}
      </button>
    </div>
  );
}

/**
 * 文件（打开）图标 folder_open_16 outline，内联自
 * @deepseek-ai/dsh-client-ui-primitives 的 IconFolderOpenOutline16，
 * 避免给插件新增运行时依赖；fill=currentColor 随主题/激活态变色。
 */
export function FolderOpenIcon(props: { size?: number }): JSX.Element {
  const size = props.size ?? 16;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: 'block' }}>
      <path
        d="M5.19629 1.57104C5.81144 1.5711 6.38623 1.8786 6.72754 2.39038L7.19922 3.09839C7.28454 3.22635 7.42824 3.30344 7.58203 3.30347H12.1699C13.5039 3.30348 14.5859 4.38548 14.5859 5.71948V6.62671C15.2694 7.02689 15.6605 7.85012 15.4385 8.68726L14.3848 12.658C14.1037 13.7164 13.1449 14.4527 12.0498 14.4529H2.91699C1.51651 14.4529 0.451662 13.2814 0.501954 11.9519V3.98706C0.501954 2.65305 1.58396 1.57104 2.91797 1.57104H5.19629ZM3.7793 7.75562C3.30994 7.75562 2.89883 8.07153 2.77832 8.52515L1.91602 11.7722C1.74167 12.4291 2.23734 13.073 2.91699 13.073H12.0498C12.5191 13.0728 12.9304 12.757 13.0508 12.3035L14.1045 8.33374C14.1819 8.04202 13.9619 7.756 13.6602 7.75562H3.7793ZM2.91797 2.9519C2.34625 2.9519 1.88281 3.41534 1.88281 3.98706V7.2937C2.33068 6.7269 3.02249 6.37476 3.7793 6.37476H13.2051V5.71948C13.2051 5.14777 12.7416 4.68434 12.1699 4.68433H7.58203C6.96675 4.6843 6.39209 4.37595 6.05078 3.86401L5.5791 3.15601C5.49379 3.02821 5.34995 2.95196 5.19629 2.9519H2.91797Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** 工作区（关闭）图标 folder_close_16，内联自 IconFolderClose16。 */
function FolderCloseIcon(props: { size?: number }): JSX.Element {
  const size = props.size ?? 16;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: 'block' }}>
      <path
        transform="translate(1.5 2.429)"
        d="M5.05582 0.518756L4.50669 0.86654L5.05582 0.518756ZM13 9.4837L13.65 9.4837L13.65 3.53962L13 3.53962L12.35 3.53962L12.35 9.4837L13 9.4837ZM11.3264 1.86603L11.3264 1.21603L6.52313 1.21603L6.52313 1.86603L6.52313 2.51603L11.3264 2.51603L11.3264 1.86603ZM5.58054 1.34727L6.12968 0.999489L5.60495 0.170972L5.05582 0.518756L4.50669 0.86654L5.03141 1.69506L5.58054 1.34727ZM4.11323 1.23058e-13L4.11323 -0.65L1.67359 -0.65L1.67359 5.00699e-14L1.67359 0.65L4.11323 0.65L4.11323 1.23058e-13ZM0 1.67359L-0.65 1.67359L-0.65 9.4837L0 9.4837L0.65 9.4837L0.65 1.67359L0 1.67359ZM11.3264 11.1573L11.3264 10.5073L1.67359 10.5073L1.67359 11.1573L1.67359 11.8073L11.3264 11.8073L11.3264 11.1573ZM0 9.4837L-0.65 9.4837C-0.65 10.767 0.390308 11.8073 1.67359 11.8073L1.67359 11.1573L1.67359 10.5073C1.10828 10.5073 0.65 10.049 0.65 9.4837L0 9.4837ZM1.67359 5.00699e-14L1.67359 -0.65C0.390307 -0.65 -0.65 0.390309 -0.65 1.67359L0 1.67359L0.65 1.67359C0.65 1.10828 1.10828 0.65 1.67359 0.65L1.67359 5.00699e-14ZM5.05582 0.518756L5.60495 0.170972C5.28121 -0.340193 4.71829 -0.65 4.11323 -0.65L4.11323 1.23058e-13L4.11323 0.65C4.27282 0.65 4.4213 0.731715 4.50669 0.86654L5.05582 0.518756ZM6.52313 1.86603L6.52313 1.21603C6.36354 1.21603 6.21507 1.13431 6.12968 0.999489L5.58054 1.34727L5.03141 1.69506C5.35515 2.20622 5.91808 2.51603 6.52313 2.51603L6.52313 1.86603ZM13 3.53962L13.65 3.53962C13.65 2.25634 12.6097 1.21603 11.3264 1.21603L11.3264 1.86603L11.3264 2.51603C11.8917 2.51603 12.35 2.97431 12.35 3.53962L13 3.53962ZM13 9.4837L12.35 9.4837C12.35 10.049 11.8917 10.5073 11.3264 10.5073L11.3264 11.1573L11.3264 11.8073C12.6097 11.8073 13.65 10.767 13.65 9.4837L13 9.4837Z"
        fill="currentColor"
      />
    </svg>
  );
}
