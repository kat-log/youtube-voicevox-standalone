import '../styles/styles.scss';
import type { CommentLifecycle, TimelineStatus } from '@/background/lifecycle-tracker';

// スケール: 10px = 1秒 (0.01 px/ms)
const SCALE = 0.01;
// 固定列（話者・コメント）の既定幅。CSS の --speaker-width / --label-width と一致させる
const DEFAULT_SPEAKER_WIDTH = 120;
const DEFAULT_LABEL_WIDTH = 240;
// 固定列の幅の許容範囲（px）
const SPEAKER_WIDTH_RANGE = { min: 60, max: 400 };
const LABEL_WIDTH_RANGE = { min: 80, max: 800 };
// 列幅の保存キー
const SPEAKER_WIDTH_KEY = 'timelineSpeakerWidth';
const LABEL_WIDTH_KEY = 'timelineLabelWidth';
// 目盛り間隔: 5秒
const RULER_INTERVAL_MS = 5000;
// 目盛りの横幅（px）= 5s * 10px/s = 50px
const RULER_INTERVAL_PX = RULER_INTERVAL_MS * SCALE;
// タイムラインに保持するコメント行の上限
const MAX_TIMELINE_ROWS = 500;

let originTime: number = Date.now();
const lifecycles = new Map<string, CommentLifecycle>();
let rafId: number | null = null;
/**
 * 最新への自動追従（横=右端 / 縦=最下部）。
 * 過去行のクリックより追従が優先されると行に飛べないため、クリック時に解除する。
 * ユーザーが自分で端付近まで戻したら再開する
 */
let followLatestX = true;
let followLatestY = true;
/** 端付近とみなす距離（px）。追従の再開判定に使う */
const FOLLOW_THRESHOLD_PX = 40;
let speakerWidth = DEFAULT_SPEAKER_WIDTH;
let labelWidth = DEFAULT_LABEL_WIDTH;
/** 固定列を除いたガント本体の必要幅（px）。originTime を 0 とする座標系 */
let maxContentPx = 0;

/** 固定列（話者＋コメント）の合計幅。ガント本体はこの分だけ右にずれる */
function getFixedColsWidth(): number {
  return speakerWidth + labelWidth;
}

/** JS 側の幅を CSS 変数に書き戻す。セグメントは .row-track 越しに自動追従する */
function applyColumnWidths(): void {
  document.body.style.setProperty('--speaker-width', `${speakerWidth}px`);
  document.body.style.setProperty('--label-width', `${labelWidth}px`);
  applyGanttWidth();
  updateRuler();
}

function clamp(value: number, range: { min: number; max: number }): number {
  return Math.max(range.min, Math.min(range.max, value));
}

/** 保存値を列幅として正規化する。未設定・不正値は既定値に戻す（設定リセット時など） */
function normalizeWidth(
  value: unknown,
  range: { min: number; max: number },
  fallback: number
): number {
  return typeof value === 'number' ? clamp(value, range) : fallback;
}

/** ガント本体の横幅を #gantt-inner に反映する（固定列の幅は CSS 変数に委ねる） */
function applyGanttWidth(): void {
  const ganttInner = document.getElementById('gantt-inner');
  if (!ganttInner) return;
  ganttInner.style.minWidth =
    `calc(var(--speaker-width) + var(--label-width) + ${maxContentPx}px)`;
}

// ===== ルーラーとガントのスクロール同期 =====
{
  const ganttScrollEl = document.getElementById('gantt-scroll');
  const rulerAxisScroll = document.getElementById('ruler-axis-scroll');
  if (ganttScrollEl && rulerAxisScroll) {
    ganttScrollEl.addEventListener('scroll', () => {
      rulerAxisScroll.scrollLeft = ganttScrollEl.scrollLeft;
    });
  }
}

// ===== 自動追従状態の更新 =====
// 端付近まで戻した軸だけ追従を再開する。追従中の自動スクロールもここを通るが、
// その場合は端にいるため true のまま維持される。
// 変化した軸だけを見るのは、クリックによる横スクロールで縦の追従解除が
// 巻き戻らないようにするため
{
  const scroll = document.getElementById('gantt-scroll');
  if (scroll) {
    let lastLeft = scroll.scrollLeft;
    let lastTop = scroll.scrollTop;
    scroll.addEventListener('scroll', () => {
      if (scroll.scrollLeft !== lastLeft) {
        lastLeft = scroll.scrollLeft;
        followLatestX =
          scroll.scrollWidth - scroll.scrollLeft - scroll.clientWidth < FOLLOW_THRESHOLD_PX;
      }
      if (scroll.scrollTop !== lastTop) {
        lastTop = scroll.scrollTop;
        followLatestY =
          scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < FOLLOW_THRESHOLD_PX;
      }
    });
  }
}

// ===== ダークモード =====
function applyDarkMode(value: unknown): void {
  const isDark =
    value !== undefined ? Boolean(value) : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.body.classList.toggle('dark-mode', isDark);
}

chrome.storage.sync.get(['darkMode'], (data) => applyDarkMode(data.darkMode));

// ===== 保存済みの列幅を復元 =====
chrome.storage.sync.get([SPEAKER_WIDTH_KEY, LABEL_WIDTH_KEY], (data) => {
  speakerWidth = normalizeWidth(data[SPEAKER_WIDTH_KEY], SPEAKER_WIDTH_RANGE, DEFAULT_SPEAKER_WIDTH);
  labelWidth = normalizeWidth(data[LABEL_WIDTH_KEY], LABEL_WIDTH_RANGE, DEFAULT_LABEL_WIDTH);
  applyColumnWidths();
});

// ===== 設定変更への追従 =====
// 設定のインポートやリセットは storage を直接書き換えるため、
// このページを開いたままだとリロードするまで反映されなかった。
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;

  if ('darkMode' in changes) applyDarkMode(changes['darkMode'].newValue);

  // キーの削除（リセット）と未変更を区別するため newValue ではなく `in` で判定する
  if (SPEAKER_WIDTH_KEY in changes || LABEL_WIDTH_KEY in changes) {
    if (SPEAKER_WIDTH_KEY in changes) {
      speakerWidth = normalizeWidth(
        changes[SPEAKER_WIDTH_KEY].newValue,
        SPEAKER_WIDTH_RANGE,
        DEFAULT_SPEAKER_WIDTH
      );
    }
    if (LABEL_WIDTH_KEY in changes) {
      labelWidth = normalizeWidth(
        changes[LABEL_WIDTH_KEY].newValue,
        LABEL_WIDTH_RANGE,
        DEFAULT_LABEL_WIDTH
      );
    }
    applyColumnWidths();
  }
});

// ===== 列幅のドラッグ変更 =====
setupColumnResizer('resizer-speaker', SPEAKER_WIDTH_RANGE, () => speakerWidth, (w) => {
  speakerWidth = w;
});
setupColumnResizer('resizer-label', LABEL_WIDTH_RANGE, () => labelWidth, (w) => {
  labelWidth = w;
});

function setupColumnResizer(
  resizerId: string,
  range: { min: number; max: number },
  getWidth: () => number,
  setWidth: (width: number) => void
): void {
  const resizer = document.getElementById(resizerId);
  if (!resizer) return;

  resizer.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = getWidth();
    resizer.classList.add('dragging');
    document.body.classList.add('resizing');

    const onMove = (moveEvent: MouseEvent): void => {
      setWidth(clamp(startWidth + moveEvent.clientX - startX, range));
      applyColumnWidths();
    };

    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      resizer.classList.remove('dragging');
      document.body.classList.remove('resizing');
      chrome.storage.sync.set({
        [SPEAKER_WIDTH_KEY]: speakerWidth,
        [LABEL_WIDTH_KEY]: labelWidth,
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ===== 初期状態取得 =====
chrome.runtime.sendMessage({ action: 'getTimelineState' }, (response: {
  lifecycles: CommentLifecycle[];
  status: TimelineStatus;
} | undefined) => {
  if (!response) return;
  if (response.lifecycles.length > 0) {
    const minFetch = Math.min(...response.lifecycles.map((lc) => lc.fetchTime));
    originTime = minFetch;
  }
  for (const lc of response.lifecycles) {
    lifecycles.set(lc.id, lc);
    addOrUpdateRow(lc);
  }
  updateCounters(response.status);
  updateRuler();
  startRafLoop();
});

// ===== リアルタイムメッセージ =====
chrome.runtime.onMessage.addListener((request: {
  action: string;
  lifecycle?: CommentLifecycle;
  status?: TimelineStatus;
}) => {
  if (request.action === 'timelineUpdate' && request.lifecycle) {
    const lc = request.lifecycle;
    // originTime を最初のコメント基準に調整
    if (lc.fetchTime < originTime) {
      originTime = lc.fetchTime;
      updateRuler();
      reRenderAllRows();
    }
    lifecycles.set(lc.id, lc);
    addOrUpdateRow(lc);
  } else if (request.action === 'timelineStatusUpdate' && request.status) {
    updateCounters(request.status);
  }
});

// ===== カウンター更新 =====
function updateCounters(status: TimelineStatus): void {
  setCounter('cnt-synth-wait', status.pendingSynth);
  setCounter('cnt-synth-active', status.activeSynth);
  setCounter('cnt-play-wait', status.pendingPlay);
  setCounter('cnt-play-active', status.activePlaying);
}

function setCounter(id: string, value: number): void {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

// ===== 目盛りヘッダー =====
function updateRuler(): void {
  const ruler = document.getElementById('ruler');
  if (!ruler) return;
  ruler.innerHTML = '';

  const ganttScroll = document.getElementById('gantt-scroll');
  const fixed = getFixedColsWidth();

  const visibleAxisWidth = Math.max(
    (ganttScroll ? ganttScroll.clientWidth : window.innerWidth) - fixed,
    0
  );
  const elapsedWidth = (Date.now() - originTime) * SCALE + 100;
  const axisWidth = Math.max(visibleAxisWidth, maxContentPx, elapsedWidth);

  ruler.style.width = `${axisWidth}px`;

  const tickCount = Math.ceil(axisWidth / RULER_INTERVAL_PX) + 1;
  for (let i = 0; i < tickCount; i++) {
    const leftPx = i * RULER_INTERVAL_PX;
    const tick = document.createElement('div');
    tick.className = 'ruler-tick';
    tick.style.left = `${leftPx}px`;
    tick.innerHTML = `<div class="ruler-tick-line"></div><div class="ruler-tick-label">${i * 5}s</div>`;
    ruler.appendChild(tick);
  }
}

// ===== 古い行の削除 =====
function pruneOldestRows(): void {
  const ganttInner = document.getElementById('gantt-inner');
  while (lifecycles.size > MAX_TIMELINE_ROWS) {
    const oldestId = lifecycles.keys().next().value;
    if (!oldestId) break;
    lifecycles.delete(oldestId);
    if (ganttInner) {
      const row = ganttInner.querySelector<HTMLElement>(
        `[data-id="${CSS.escape(oldestId)}"]`
      );
      row?.remove();
    }
  }
}

// ===== 行の追加・更新 =====
function addOrUpdateRow(lc: CommentLifecycle): void {
  const ganttInner = document.getElementById('gantt-inner');
  if (!ganttInner) return;

  const emptyMsg = document.getElementById('empty-msg');
  if (emptyMsg) emptyMsg.remove();

  let row = ganttInner.querySelector<HTMLElement>(`[data-id="${CSS.escape(lc.id)}"]`);
  if (!row) {
    row = createRow(lc);
    ganttInner.append(row);
    pruneOldestRows();

    // 新規コメントが追加されたとき、縦の追従が有効なら最下部へ
    const scroll = document.getElementById('gantt-scroll');
    if (scroll && followLatestY) {
      scroll.scrollTop = scroll.scrollHeight;
    }
  }

  // 話者は音声合成の開始時に確定するため、行の生成後に届く。毎回反映する
  const speakerCell = row.querySelector<HTMLElement>('.row-speaker');
  if (speakerCell) {
    speakerCell.textContent = lc.speaker ?? '';
    speakerCell.title = lc.speaker ?? '';
  }

  renderSegments(row, lc, Date.now());
}

function createRow(lc: CommentLifecycle): HTMLElement {
  const row = document.createElement('div');
  row.className = 'timeline-row';
  row.dataset.id = lc.id;

  const speaker = document.createElement('div');
  speaker.className = 'row-speaker';
  row.appendChild(speaker);

  const label = document.createElement('div');
  label.className = 'row-label';
  label.textContent = lc.text;
  label.title = lc.text;
  row.appendChild(label);

  const track = document.createElement('div');
  track.className = 'row-track';
  row.appendChild(track);

  // 行のどこにカーソルがあってもツールチップを出す。
  // lifecycle は更新のたびに別オブジェクトに差し替わるので、
  // 生成時の lc を捕捉せずイベント発生時に引き直すこと
  row.addEventListener('mousemove', (e) => {
    const current = lifecycles.get(row.dataset.id ?? '');
    if (current) showTooltip(e, current);
  });
  row.addEventListener('mouseleave', hideTooltip);
  row.addEventListener('click', () => centerRow(row));

  return row;
}

// ===== クリックした行のバーを画面中央へ =====
function centerRow(row: HTMLElement): void {
  const lc = lifecycles.get(row.dataset.id ?? '');
  const scroll = document.getElementById('gantt-scroll');
  if (!lc || !scroll) return;

  document.querySelector('.timeline-row.selected')?.classList.remove('selected');
  row.classList.add('selected');

  // 追従が有効なままだと毎フレーム右端へ引き戻され、クリックが効かない。
  // クリックを優先し、ユーザーが端まで戻したときに追従を再開する
  followLatestX = false;
  followLatestY = false;

  // 未完了の行はバーが現在時刻まで伸びている（renderSegments と同じ終端の求め方）
  const lastTime = lc.playEndTime ?? lc.stoppedTime ?? lc.droppedTime ?? Date.now();
  const startPx = (lc.fetchTime - originTime) * SCALE;
  const endPx = (lastTime - originTime) * SCALE;

  // 固定列は左端に貼り付いてスクロール領域を覆うため、それを除いた可視幅の
  // 中央にバーの中点が来るよう scrollLeft を決める
  // （バーのコンテンツ座標 = 固定列幅 + startPx なので、固定列幅は打ち消し合う）
  const visibleWidth = Math.max(scroll.clientWidth - getFixedColsWidth(), 1);
  const target = (startPx + endPx) / 2 - visibleWidth / 2;
  const maxScroll = Math.max(scroll.scrollWidth - scroll.clientWidth, 0);

  scroll.scrollTo({ left: Math.max(0, Math.min(target, maxScroll)), behavior: 'smooth' });
}

// ===== セグメント描画 =====
function renderSegments(row: HTMLElement, lc: CommentLifecycle, now: number): void {
  const track = row.querySelector<HTMLElement>('.row-track');
  if (!track) return;
  // 既存セグメントを削除
  track.textContent = '';

  const stages: Array<{ cls: string; start: number; end: number | null }> = [];

  // 音声生成待ち: fetchTime → synthStartTime（足切り or 停止で止める）
  if (lc.fetchTime) {
    stages.push({
      cls: 'synth-wait',
      start: lc.fetchTime,
      end: lc.synthStartTime ?? lc.droppedTime ?? lc.stoppedTime ?? null,
    });
  }

  // 音声生成中: synthStartTime → synthEndTime（停止で止める）
  if (lc.synthStartTime) {
    stages.push({
      cls: 'synth-active',
      start: lc.synthStartTime,
      end: lc.synthEndTime ?? lc.stoppedTime ?? null,
    });
  }

  // 読み上げ待ち: synthEndTime → playStartTime（停止で止める）
  if (lc.synthEndTime) {
    stages.push({
      cls: 'play-wait',
      start: lc.synthEndTime,
      end: lc.playStartTime ?? lc.stoppedTime ?? null,
    });
  }

  // 読み上げ中: playStartTime → playEndTime（停止で止める）
  if (lc.playStartTime) {
    stages.push({
      cls: 'play-active',
      start: lc.playStartTime,
      end: lc.playEndTime ?? lc.stoppedTime ?? null,
    });
  }

  for (const stage of stages) {
    const startPx = (stage.start - originTime) * SCALE;
    const endMs = stage.end ?? now;
    const widthPx = Math.max(2, (endMs - stage.start) * SCALE);

    const seg = document.createElement('div');
    seg.className = `segment ${stage.cls}`;
    seg.style.left = `${startPx}px`;
    seg.style.width = `${widthPx}px`;

    track.appendChild(seg);
  }

  // ガント本体の必要幅を更新（横スクロール用）
  if (stages.length > 0) {
    const endPx = ((stages[stages.length - 1].end ?? now) - originTime) * SCALE + 20;
    if (endPx > maxContentPx) {
      maxContentPx = endPx;
      applyGanttWidth();
    }
  }
}

function reRenderAllRows(): void {
  const now = Date.now();
  for (const [, lc] of lifecycles) {
    const ganttInner = document.getElementById('gantt-inner');
    const row = ganttInner?.querySelector<HTMLElement>(`[data-id="${CSS.escape(lc.id)}"]`);
    if (row) renderSegments(row, lc, now);
  }
}

// ===== RAF ループ（進行中バーのリアルタイム伸長） =====
function startRafLoop(): void {
  if (rafId !== null) return;
  function loop() {
    const now = Date.now();
    for (const [, lc] of lifecycles) {
      // 完了済み・足切り済み・停止済みは再描画不要
      if (lc.playEndTime) continue;
      if (lc.droppedTime && !lc.synthStartTime) continue;
      if (lc.stoppedTime) continue;
      const ganttInner = document.getElementById('gantt-inner');
      const row = ganttInner?.querySelector<HTMLElement>(`[data-id="${CSS.escape(lc.id)}"]`);
      if (row) renderSegments(row, lc, now);
    }
    updateRuler();

    // 横スクロール自動追従：追従が有効なら現在時刻に追従
    const scroll = document.getElementById('gantt-scroll');
    if (scroll && followLatestX) {
      scroll.scrollLeft = scroll.scrollWidth - scroll.clientWidth;
    }

    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
}

// ===== ツールチップ =====
const tooltip = document.getElementById('tooltip')!;

function showTooltip(e: MouseEvent, lc: CommentLifecycle): void {
  const now = Date.now();
  const lines: string[] = [`💬 ${lc.text}`];
  if (lc.speaker) lines.push(`🎤 ${lc.speaker}`);

  const synthWait = lc.synthStartTime
    ? lc.synthStartTime - lc.fetchTime
    : (lc.droppedTime ?? lc.stoppedTime ?? now) - lc.fetchTime;
  lines.push(`音声生成待ち: ${synthWait}ms`);
  if (lc.droppedTime && !lc.synthStartTime) {
    lines.push(`⚠️ 足切り済み（キュー上限により破棄）`);
  }

  if (lc.synthStartTime) {
    const synthActive = lc.synthEndTime
      ? lc.synthEndTime - lc.synthStartTime
      : (lc.stoppedTime ?? now) - lc.synthStartTime;
    lines.push(`音声生成中: ${synthActive}ms`);
  }

  if (lc.synthEndTime) {
    const playWait = lc.playStartTime
      ? lc.playStartTime - lc.synthEndTime
      : (lc.stoppedTime ?? now) - lc.synthEndTime;
    lines.push(`読み上げ待ち: ${playWait}ms`);
  }

  if (lc.playStartTime) {
    const playActive = lc.playEndTime
      ? lc.playEndTime - lc.playStartTime
      : (lc.stoppedTime ?? now) - lc.playStartTime;
    lines.push(`読み上げ中: ${playActive}ms`);
  }

  if (lc.stoppedTime) {
    lines.push(`⏹ 停止により中断`);
  }

  tooltip.textContent = '';
  for (const line of lines) {
    if (tooltip.childNodes.length > 0) tooltip.appendChild(document.createElement('br'));
    tooltip.appendChild(document.createTextNode(line));
  }
  tooltip.style.display = 'block';
  positionTooltip(e);
}

function positionTooltip(e: MouseEvent): void {
  const margin = 12;
  let x = e.clientX + margin;
  let y = e.clientY + margin;
  const rect = tooltip.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - margin;
  if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - margin;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

document.addEventListener('mousemove', (e) => {
  if (tooltip.style.display === 'block') positionTooltip(e);
});

function hideTooltip(): void {
  tooltip.style.display = 'none';
}

// ===== クリアボタン =====
document.getElementById('clear-btn')?.addEventListener('click', () => {
  lifecycles.clear();
  const ganttInner = document.getElementById('gantt-inner');
  if (ganttInner) {
    ganttInner.innerHTML = '<div class="empty-msg" id="empty-msg">読み上げを開始するとコメントが表示されます</div>';
    ganttInner.style.minWidth = '';
  }
  maxContentPx = 0;
  originTime = Date.now();
  followLatestX = true;
  followLatestY = true;
  updateRuler();
});
