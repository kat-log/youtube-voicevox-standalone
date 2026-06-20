/**
 * ポップアップの設定セクションの折りたたみ・並び替えを管理する。
 *
 * - 見出し付き6セクション（`#reorderable-sections` 配下）が対象。
 * - 折りたたみ状態・並び順を chrome.storage.sync に永続化する。
 * - 「操作」セクションはラッパー外＝先頭固定で対象外。
 */

/** 折りたたみ状態の保存キー: section ID → 折りたたみ中か */
const COLLAPSED_KEY = 'popupSectionCollapsed';
/** 並び順の保存キー: section ID の配列 */
const ORDER_KEY = 'popupSectionOrder';

/** HTML 記述順のデフォルト並び順 */
const DEFAULT_ORDER = [
  'initial-settings',
  'speaker-settings',
  'basic-settings',
  'fun-settings',
  'filter-settings',
  'general-settings',
] as const;

let dragStartId: string | null = null;

function getContainer(): HTMLElement | null {
  return document.getElementById('reorderable-sections');
}

function getSections(): HTMLElement[] {
  const container = getContainer();
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>('.section[data-section-id]')
  );
}

/** 保存済みの並び順を DOM に適用する。未知IDは無視、欠落IDはデフォルト順で末尾補完。 */
function applyOrder(savedOrder: string[] | undefined): void {
  const container = getContainer();
  if (!container) return;

  const sections = getSections();
  const byId = new Map(sections.map((el) => [el.dataset.sectionId!, el]));

  const order = (savedOrder ?? []).filter((id) => byId.has(id));
  for (const id of DEFAULT_ORDER) {
    if (!order.includes(id) && byId.has(id)) order.push(id);
  }

  for (const id of order) {
    const el = byId.get(id);
    if (el) container.appendChild(el);
  }
}

/** 保存済みの折りたたみ状態を DOM に適用する。 */
function applyCollapsed(collapsed: Record<string, boolean> | undefined): void {
  for (const section of getSections()) {
    const id = section.dataset.sectionId!;
    const isCollapsed = collapsed?.[id] === true;
    section.classList.toggle('collapsed', isCollapsed);
    const header = section.querySelector<HTMLElement>('.section-header');
    header?.setAttribute('aria-expanded', String(!isCollapsed));
  }
}

/** storage を読み込み、並び順＋折りたたみ状態を再適用する（イベント再登録なし）。 */
export function applySectionLayout(): void {
  chrome.storage.sync.get([COLLAPSED_KEY, ORDER_KEY], (data) => {
    applyOrder(data[ORDER_KEY] as string[] | undefined);
    applyCollapsed(data[COLLAPSED_KEY] as Record<string, boolean> | undefined);
  });
}

/** 現在の DOM 上の並び順を storage に保存する。 */
function persistOrder(): void {
  const order = getSections().map((el) => el.dataset.sectionId!);
  chrome.storage.sync.set({ [ORDER_KEY]: order });
}

/** 指定セクションの折りたたみ状態を storage に保存する。 */
function persistCollapsed(id: string, isCollapsed: boolean): void {
  chrome.storage.sync.get([COLLAPSED_KEY], (data) => {
    const current = (data[COLLAPSED_KEY] as Record<string, boolean> | undefined) ?? {};
    current[id] = isCollapsed;
    chrome.storage.sync.set({ [COLLAPSED_KEY]: current });
  });
}

/** 開閉トグル＋永続化。 */
function toggleSection(section: HTMLElement): void {
  const id = section.dataset.sectionId!;
  const isCollapsed = section.classList.toggle('collapsed');
  const header = section.querySelector<HTMLElement>('.section-header');
  header?.setAttribute('aria-expanded', String(!isCollapsed));
  persistCollapsed(id, isCollapsed);
}

/** drop 時に並び順を入れ替え、DOM 反映＋永続化する。 */
function reorder(fromId: string, toId: string): void {
  const container = getContainer();
  if (!container || fromId === toId) return;
  const fromEl = container.querySelector<HTMLElement>(`[data-section-id="${fromId}"]`);
  const toEl = container.querySelector<HTMLElement>(`[data-section-id="${toId}"]`);
  if (!fromEl || !toEl) return;

  const sections = getSections();
  const fromIdx = sections.indexOf(fromEl);
  const toIdx = sections.indexOf(toEl);
  // ドラッグ先より前から来た場合は後ろへ、後ろから来た場合は前へ挿入する。
  if (fromIdx < toIdx) {
    toEl.after(fromEl);
  } else {
    toEl.before(fromEl);
  }
  persistOrder();
}

function registerEvents(): void {
  for (const section of getSections()) {
    const header = section.querySelector<HTMLElement>('.section-header');
    if (!header) continue;

    // 見出し行クリックで開閉（ドラッグハンドルは除外）。
    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.drag-handle')) return;
      toggleSection(section);
    });
    // キーボード（Enter/Space）でも開閉可能に。
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSection(section);
      }
    });

    // ドラッグ&ドロップによる並び替え。
    // ドラッグはハンドルからのみ開始する（セクション内のテキスト選択を妨げないため）。
    const id = section.dataset.sectionId!;
    const handle = header.querySelector<HTMLElement>('.drag-handle');
    handle?.addEventListener('mousedown', () => section.setAttribute('draggable', 'true'));
    handle?.addEventListener('mouseup', () => section.removeAttribute('draggable'));

    section.addEventListener('dragstart', (e) => {
      dragStartId = id;
      section.classList.add('dragging');
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', id);
    });
    section.addEventListener('dragend', () => {
      dragStartId = null;
      section.classList.remove('dragging');
      section.removeAttribute('draggable');
      getContainer()
        ?.querySelectorAll('.drag-over')
        .forEach((el) => el.classList.remove('drag-over'));
    });
    section.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      getContainer()
        ?.querySelectorAll('.drag-over')
        .forEach((el) => el.classList.remove('drag-over'));
      if (dragStartId !== id) section.classList.add('drag-over');
    });
    section.addEventListener('dragleave', () => {
      section.classList.remove('drag-over');
    });
    section.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragStartId || dragStartId === id) return;
      reorder(dragStartId, id);
    });
  }
}

/** ポップアップ初期化時に呼ぶ。状態適用＋イベント登録を行う。 */
export function initSectionLayout(): void {
  if (!getContainer()) return;
  registerEvents();
  applySectionLayout();
}
