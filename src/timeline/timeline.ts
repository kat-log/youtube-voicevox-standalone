import '../styles/styles.scss';
import type { CommentLifecycle, TimelineStatus } from '@/background/lifecycle-tracker';
import {
  CENTER_ANIM_MS,
  easeOutCubic,
  isOwnScrollPosition,
  shouldResumeFollow,
  type ScrollMode,
} from './follow-state';
import {
  DEFAULT_TIME_UNIT,
  formatDuration,
  formatRulerLabel,
  normalizeTimeUnit,
  type TimeUnit,
} from './format';
import {
  DEFAULT_SCALE,
  anchorMsAt,
  chooseTickIntervalMs,
  fitScale,
  normalizeScale,
  scrollLeftForAnchor,
  zoomPercent,
  zoomScale,
} from './scale';

// 固定列（話者・コメント）の既定幅。CSS の --speaker-width / --label-width と一致させる
const DEFAULT_SPEAKER_WIDTH = 120;
const DEFAULT_LABEL_WIDTH = 240;
// 固定列の幅の許容範囲（px）
const SPEAKER_WIDTH_RANGE = { min: 60, max: 400 };
const LABEL_WIDTH_RANGE = { min: 80, max: 800 };
// 列幅の保存キー
const SPEAKER_WIDTH_KEY = 'timelineSpeakerWidth';
const LABEL_WIDTH_KEY = 'timelineLabelWidth';
// ガント本体の右端に足す余白（px）
const GANTT_PAD_PX = 20;
// 目盛りを描く範囲を可視域から広げる余白（px）。スクロール直後の欠けを防ぐ
const RULER_OVERSCAN_PX = 200;
// 横軸スケールの保存キー
const SCALE_KEY = 'timelineScale';
// 所要時間の表示単位の保存キー
const TIME_UNIT_KEY = 'timelineTimeUnit';
// スケール・単位の保存を間引く間隔（ms）。ホイールズームで storage.sync の書き込み上限に当たらないようにする
const SETTING_SAVE_DEBOUNCE_MS = 500;
// タイムラインに保持するコメント行の上限
const MAX_TIMELINE_ROWS = 500;

/** 横軸のスケール（px/ms）。ズームで可変 */
let scale = DEFAULT_SCALE;
/** 所要時間の表示単位（ツールチップ） */
let timeUnit: TimeUnit = DEFAULT_TIME_UNIT;
let originTime: number = Date.now();
const lifecycles = new Map<string, CommentLifecycle>();
let rafId: number | null = null;
/**
 * 最新への自動追従（横=右端 / 縦=最下部）。
 * 位置から推測せず「モード」として持つ。行クリックやユーザーのスクロール操作でのみ
 * 切り替わり、自分が出した自動スクロールでは変化しない
 */
let followLatestX = true;
let followLatestY = true;
/**
 * 横スクロール位置の書き手はこのモードだけ。
 * ネイティブの smooth スクロールと RAF 追従が同時に書き込むと必ず追従が勝ってしまうため、
 * 中央寄せのアニメーションも RAF ループ内で自前に行う
 */
let scrollMode: ScrollMode = 'follow';
/** 'animate' 中の補間パラメータ */
let animStartLeft = 0;
let animTargetLeft = 0;
let animStartAt = 0;
/**
 * 自分が最後に書き込んだスクロール位置（丸め後の実値）。
 * scroll イベントが自分の書き込み由来かユーザー操作かを見分けるために使う。
 * null は「直近の書き込みは無効」を意味する
 */
let lastWrittenLeft: number | null = null;
let lastWrittenTop: number | null = null;
let speakerWidth = DEFAULT_SPEAKER_WIDTH;
let labelWidth = DEFAULT_LABEL_WIDTH;
/**
 * 固定列を除いたガント本体が必要とする時間の長さ（ms, originTime 起点）。
 * px ではなく ms で持つことで、ズームしても幅を計算し直すだけで済む
 */
let maxContentMs = 0;
/** 直前に描いた目盛りの内容の識別子。同じなら描き直さない（RAF から毎フレーム呼ばれる） */
let lastRulerKey = '';
/** スケール・表示単位の保存を間引くタイマー */
let saveTimer: number | null = null;

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
  const contentPx = maxContentMs * scale + GANTT_PAD_PX;
  ganttInner.style.minWidth =
    `calc(var(--speaker-width) + var(--label-width) + ${contentPx}px)`;
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

// ===== スクロール位置の書き込み =====
// 自分の書き込みには「どのフレームで書いたか」の印を付ける。scroll イベントは
// レンダリング更新時（RAF コールバックより前）に遅れて届くため、位置の一致だけでなく
// 直近フレームであることも条件にして、自分の自動スクロールをユーザー操作と誤認しない
const WRITE_TAG_MAX_FRAME_LAG = 1;
let frameCounter = 0;
let writtenLeftFrame = -Infinity;
let writtenTopFrame = -Infinity;

function writeScrollLeft(scroll: HTMLElement, left: number): void {
  scroll.scrollLeft = left;
  // 丸め後の実値を保持する（端数・ズームで要求値とずれるため）
  lastWrittenLeft = scroll.scrollLeft;
  writtenLeftFrame = frameCounter;
}

function writeScrollTop(scroll: HTMLElement, top: number): void {
  scroll.scrollTop = top;
  lastWrittenTop = scroll.scrollTop;
  writtenTopFrame = frameCounter;
}

/** この scroll イベントが自分の書き込み由来か（＝ユーザー操作ではないか） */
function isOwnScroll(current: number, written: number | null, writtenFrame: number): boolean {
  if (frameCounter - writtenFrame > WRITE_TAG_MAX_FRAME_LAG) return false;
  return isOwnScrollPosition(current, written);
}

// ===== 中央寄せアニメーション =====
// ネイティブの scrollTo({ behavior: 'smooth' }) は RAF の追従書き込みに中断されるうえ、
// 動き出しが遅く「右端付近」の判定に引っかかって追従を復活させてしまうため使わない
function startScrollAnimation(scroll: HTMLElement, targetLeft: number): void {
  animStartLeft = scroll.scrollLeft;
  animTargetLeft = targetLeft;
  animStartAt = performance.now();
  scrollMode = 'animate';
}

function cancelScrollAnimation(): void {
  if (scrollMode === 'animate') scrollMode = 'idle';
}

// ===== 追従状態の切り替え =====
function setFollow(x: boolean, y: boolean): void {
  followLatestX = x;
  followLatestY = y;
  if (x) scrollMode = 'follow';
  else if (scrollMode === 'follow') scrollMode = 'idle';
  syncFollowButton();
}

const followBtn = document.getElementById('follow-btn');

/**
 * 追従の ON/OFF をボタンに反映する。状態変更は必ず setFollow を通すこと。
 * 表示は横（＝最新時刻への追従）を基準にする。ユーザーの操作で縦だけ最下部に
 * 戻ることがあり、それを「追従中」と見せると実際の見た目と食い違うため
 */
function syncFollowButton(): void {
  if (!followBtn) return;
  followBtn.classList.toggle('off', !followLatestX);
  followBtn.setAttribute('aria-pressed', String(followLatestX));
  followBtn.textContent = followLatestX ? '⏩ 最新に追従中' : '⏸ 追従オフ';
  followBtn.title = followLatestX
    ? 'クリックで追従を止める（過去のコメント行をクリックしても止まります）'
    : 'クリックで最新への追従を再開する';
}

followBtn?.addEventListener('click', () => setFollow(!followLatestX, !followLatestX));
syncFollowButton();

// ===== ユーザー操作による追従の解除・再開 =====
// 端付近まで自分で戻した軸だけ追従を再開する。判定するのは
// 「実際に動いた」かつ「自分の書き込みではない」軸だけ。
// - 自分の書き込みを除くことで、自動スクロールが自分で追従を復活させない
// - 動いた軸だけを見ることで、中央寄せの横スクロールが縦の追従解除を巻き戻さない
{
  const scroll = document.getElementById('gantt-scroll');
  if (scroll) {
    let lastSeenLeft = scroll.scrollLeft;
    let lastSeenTop = scroll.scrollTop;
    scroll.addEventListener('scroll', () => {
      const left = scroll.scrollLeft;
      const top = scroll.scrollTop;
      const movedX = left !== lastSeenLeft;
      const movedY = top !== lastSeenTop;
      lastSeenLeft = left;
      lastSeenTop = top;

      const userMovedX = movedX && !isOwnScroll(left, lastWrittenLeft, writtenLeftFrame);
      const userMovedY = movedY && !isOwnScroll(top, lastWrittenTop, writtenTopFrame);
      if (!userMovedX && !userMovedY) return;

      // ユーザーが触った時点でアニメーションより操作を優先する
      if (userMovedX) cancelScrollAnimation();

      const nextX = userMovedX
        ? shouldResumeFollow(scroll.scrollWidth - left - scroll.clientWidth)
        : followLatestX;
      const nextY = userMovedY
        ? shouldResumeFollow(scroll.scrollHeight - top - scroll.clientHeight)
        : followLatestY;
      if (nextX !== followLatestX || nextY !== followLatestY) setFollow(nextX, nextY);
    });

    // scroll イベントを待たずに、触られた時点でアニメーションを止める
    for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const) {
      scroll.addEventListener(type, cancelScrollAnimation, { passive: true });
    }
  }
}

// ===== ダークモード =====
function applyDarkMode(value: unknown): void {
  const isDark =
    value !== undefined ? Boolean(value) : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.body.classList.toggle('dark-mode', isDark);
}

chrome.storage.sync.get(['darkMode'], (data) => applyDarkMode(data.darkMode));

// ===== 保存済みの列幅・スケール・表示単位を復元 =====
chrome.storage.sync.get([SPEAKER_WIDTH_KEY, LABEL_WIDTH_KEY, SCALE_KEY, TIME_UNIT_KEY], (data) => {
  speakerWidth = normalizeWidth(data[SPEAKER_WIDTH_KEY], SPEAKER_WIDTH_RANGE, DEFAULT_SPEAKER_WIDTH);
  labelWidth = normalizeWidth(data[LABEL_WIDTH_KEY], LABEL_WIDTH_RANGE, DEFAULT_LABEL_WIDTH);
  scale = normalizeScale(data[SCALE_KEY]);
  timeUnit = normalizeTimeUnit(data[TIME_UNIT_KEY]);
  syncZoomLabel();
  syncUnitButton();
  applyColumnWidths();
  reRenderAllRows();
});

// ===== 設定変更への追従 =====
// 設定のインポートやリセットは storage を直接書き換えるため、
// このページを開いたままだとリロードするまで反映されなかった。
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;

  if ('darkMode' in changes) applyDarkMode(changes['darkMode'].newValue);

  // 自分の保存もここに返ってくるため、値が変わったときだけ描画し直す
  if (SCALE_KEY in changes) {
    const next = normalizeScale(changes[SCALE_KEY].newValue);
    if (next !== scale) applyScale(next, null);
  }

  if (TIME_UNIT_KEY in changes) {
    const next = normalizeTimeUnit(changes[TIME_UNIT_KEY].newValue);
    if (next !== timeUnit) {
      timeUnit = next;
      syncUnitButton();
    }
  }

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

// ===== 設定の保存（間引き） =====
// ホイールズームは短時間に何度も発火する。storage.sync には書き込み回数の上限が
// あるため、最後の値だけを少し遅らせて書く
function saveViewSettings(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    chrome.storage.sync.set({ [SCALE_KEY]: scale, [TIME_UNIT_KEY]: timeUnit });
  }, SETTING_SAVE_DEBOUNCE_MS);
}

// ===== 横軸のズーム =====
// 表示の同期関数は storage の復元コールバックからも呼ばれる。宣言順に縛られないよう、
// 要素はモジュール変数に持たず呼び出しのたびに引く（呼ばれるのは操作時だけ）
function syncZoomLabel(): void {
  const zoomLabel = document.getElementById('zoom-level');
  if (!zoomLabel) return;
  zoomLabel.textContent = `${zoomPercent(scale)}%`;
  zoomLabel.title = `1秒あたり ${Math.round(scale * 1000 * 10) / 10}px（クリックで既定に戻す）`;
}

/** 可視の軸領域（固定列を除いたガントの表示幅） */
function getVisibleAxisWidth(scroll: HTMLElement): number {
  return Math.max(scroll.clientWidth - getFixedColsWidth(), 1);
}

/**
 * スケールを変更する。
 * anchorOffsetPx は「可視の軸領域の左端からの距離」で、その位置の時刻が動かないように
 * スクロール位置を取り直す。null なら可視領域の中央を支点にする。
 * 追従中は右端に貼り付いたままにしたいので、スクロール位置には触らない
 */
function applyScale(next: number, anchorOffsetPx: number | null): void {
  const scroll = document.getElementById('gantt-scroll');
  if (scroll && !followLatestX) {
    // 中央寄せアニメーションが残っていると、次のフレームで旧スケールの目標位置に
    // 引き戻されてしまう
    cancelScrollAnimation();
    const offset = anchorOffsetPx ?? getVisibleAxisWidth(scroll) / 2;
    const anchorMs = anchorMsAt(scroll.scrollLeft, offset, scale);
    scale = next;
    applyGanttWidth();
    // 幅を反映したあとでないと scrollLeft が頭打ちになる
    const maxScroll = Math.max(scroll.scrollWidth - scroll.clientWidth, 0);
    const target = scrollLeftForAnchor(anchorMs, offset, scale);
    writeScrollLeft(scroll, Math.max(0, Math.min(target, maxScroll)));
  } else {
    scale = next;
    applyGanttWidth();
  }

  syncZoomLabel();
  updateRuler();
  reRenderAllRows();
}

function zoomBy(steps: number, anchorOffsetPx: number | null = null): void {
  const next = zoomScale(scale, steps);
  if (next === scale) return;
  applyScale(next, anchorOffsetPx);
  saveViewSettings();
}

document.getElementById('zoom-in')?.addEventListener('click', () => zoomBy(1));
document.getElementById('zoom-out')?.addEventListener('click', () => zoomBy(-1));
document.getElementById('zoom-level')?.addEventListener('click', () => {
  if (scale === DEFAULT_SCALE) return;
  applyScale(DEFAULT_SCALE, null);
  saveViewSettings();
});

// 記録済みの全区間が画面に収まるスケールにする（長い放送の俯瞰用）
document.getElementById('zoom-fit')?.addEventListener('click', () => {
  const scroll = document.getElementById('gantt-scroll');
  if (!scroll || maxContentMs <= 0) return;
  // 右端の余白の分だけ狭い幅に収める（余白を足しても可視幅を越えない）
  const next = fitScale(maxContentMs, getVisibleAxisWidth(scroll) - GANTT_PAD_PX);
  applyScale(next, null);
  saveViewSettings();
  // 全体を見るのだから左端（＝最初のコメント）から見せる
  setFollow(false, followLatestY);
  writeScrollLeft(scroll, 0);
});

// Ctrl / ⌘ + ホイールでカーソル位置を支点にズーム（ブラウザのページ拡大は抑止する）
{
  const scroll = document.getElementById('gantt-scroll');
  scroll?.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = scroll.getBoundingClientRect();
      const offset = Math.max(0, e.clientX - rect.left - getFixedColsWidth());
      zoomBy(e.deltaY < 0 ? 1 : -1, offset);
    },
    { passive: false }
  );
}

// キーボードショートカット（+ / - / 0）。入力欄が無いページなので常時受ける
document.addEventListener('keydown', (e: KeyboardEvent) => {
  // 修飾キー付きはブラウザのページ拡大など別の操作なので触らない
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '+' || e.key === '=') zoomBy(1);
  else if (e.key === '-') zoomBy(-1);
  else if (e.key === '0') {
    if (scale === DEFAULT_SCALE) return;
    applyScale(DEFAULT_SCALE, null);
    saveViewSettings();
  }
});

// ===== 所要時間の表示単位 =====
function syncUnitButton(): void {
  const unitBtn = document.getElementById('unit-btn');
  if (!unitBtn) return;
  unitBtn.textContent = timeUnit === 'sec' ? '⏱ 秒' : '⏱ ms';
  unitBtn.setAttribute('aria-pressed', String(timeUnit === 'ms'));
  unitBtn.title =
    timeUnit === 'sec'
      ? 'ツールチップの所要時間を秒で表示中（クリックでミリ秒に切り替え）'
      : 'ツールチップの所要時間をミリ秒で表示中（クリックで秒に切り替え）';
}

document.getElementById('unit-btn')?.addEventListener('click', () => {
  timeUnit = timeUnit === 'sec' ? 'ms' : 'sec';
  syncUnitButton();
  saveViewSettings();
});

syncZoomLabel();
syncUnitButton();

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

  const ganttScroll = document.getElementById('gantt-scroll');
  const fixed = getFixedColsWidth();

  const visibleAxisWidth = Math.max(
    (ganttScroll ? ganttScroll.clientWidth : window.innerWidth) - fixed,
    0
  );
  const elapsedWidth = (Date.now() - originTime) * scale + 100;
  const axisWidth = Math.max(visibleAxisWidth, maxContentMs * scale + GANTT_PAD_PX, elapsedWidth);

  // 目盛り間隔はスケールから決める。拡大すれば細かく、縮小すれば粗くなり、
  // ラベルが重ならない最小の「きりの良い」間隔が選ばれる
  const intervalMs = chooseTickIntervalMs(scale);
  const intervalPx = intervalMs * scale;

  // 拡大すると軸全体では目盛りが数万本になり得るので、可視範囲（＋余白）だけ描く。
  // ルーラーは軸座標（0 = originTime）で、ガントと同じ scrollLeft でスクロールする
  const scrollLeft = ganttScroll ? ganttScroll.scrollLeft : 0;
  const firstIndex = Math.max(0, Math.floor((scrollLeft - RULER_OVERSCAN_PX) / intervalPx));
  const lastIndex = Math.min(
    Math.ceil(axisWidth / intervalPx),
    Math.ceil((scrollLeft + visibleAxisWidth + RULER_OVERSCAN_PX) / intervalPx)
  );

  const key = `${originTime}:${intervalMs}:${Math.round(axisWidth)}:${firstIndex}:${lastIndex}`;
  if (key === lastRulerKey) return;
  lastRulerKey = key;

  ruler.style.width = `${axisWidth}px`;
  ruler.textContent = '';

  const fragment = document.createDocumentFragment();
  for (let i = firstIndex; i <= lastIndex; i++) {
    const tick = document.createElement('div');
    tick.className = 'ruler-tick';
    tick.style.left = `${i * intervalPx}px`;

    const line = document.createElement('div');
    line.className = 'ruler-tick-line';
    tick.appendChild(line);

    const label = document.createElement('div');
    label.className = 'ruler-tick-label';
    label.textContent = formatRulerLabel(i * intervalMs, intervalMs);
    tick.appendChild(label);

    fragment.appendChild(tick);
  }
  ruler.appendChild(fragment);
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
      writeScrollTop(scroll, scroll.scrollHeight);
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
  // 縦も止める（新着で最下部へ飛ぶと選択行が視界から外れるため）。
  // 再開はトグルボタン、またはユーザー自身が端まで戻したとき
  setFollow(false, false);

  // 未完了の行はバーが現在時刻まで伸びている（renderSegments と同じ終端の求め方）
  const lastTime = lc.playEndTime ?? lc.stoppedTime ?? lc.droppedTime ?? Date.now();
  const startPx = (lc.fetchTime - originTime) * scale;
  const endPx = (lastTime - originTime) * scale;

  // 固定列は左端に貼り付いてスクロール領域を覆うため、それを除いた可視幅の
  // 中央にバーの中点が来るよう scrollLeft を決める
  // （バーのコンテンツ座標 = 固定列幅 + startPx なので、固定列幅は打ち消し合う）
  const visibleWidth = Math.max(scroll.clientWidth - getFixedColsWidth(), 1);
  const target = (startPx + endPx) / 2 - visibleWidth / 2;
  const maxScroll = Math.max(scroll.scrollWidth - scroll.clientWidth, 0);

  startScrollAnimation(scroll, Math.max(0, Math.min(target, maxScroll)));
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
    const startPx = (stage.start - originTime) * scale;
    const endMs = stage.end ?? now;
    const widthPx = Math.max(2, (endMs - stage.start) * scale);

    const seg = document.createElement('div');
    seg.className = `segment ${stage.cls}`;
    seg.style.left = `${startPx}px`;
    seg.style.width = `${widthPx}px`;

    track.appendChild(seg);
  }

  // ガント本体の必要幅を更新（横スクロール用）。幅は px ではなく ms で覚えておき、
  // 実際の px はスケールを掛けて求める
  if (stages.length > 0) {
    const endMs = (stages[stages.length - 1].end ?? now) - originTime;
    if (endMs > maxContentMs) {
      maxContentMs = endMs;
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
    frameCounter++;
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

    // 横スクロール位置の書き手はここだけ。追従と中央寄せアニメーションが
    // 同じフレームで競合しないよう、モードで排他にする
    const scroll = document.getElementById('gantt-scroll');
    if (scroll) {
      if (scrollMode === 'follow') {
        writeScrollLeft(scroll, scroll.scrollWidth - scroll.clientWidth);
      } else if (scrollMode === 'animate') {
        const progress = (performance.now() - animStartAt) / CENTER_ANIM_MS;
        const eased = easeOutCubic(progress);
        writeScrollLeft(scroll, animStartLeft + (animTargetLeft - animStartLeft) * eased);
        if (progress >= 1) scrollMode = 'idle';
      }
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
  lines.push(`音声生成待ち: ${formatDuration(synthWait, timeUnit)}`);
  if (lc.droppedTime && !lc.synthStartTime) {
    lines.push(`⚠️ 足切り済み（キュー上限により破棄）`);
  }

  if (lc.synthStartTime) {
    const synthActive = lc.synthEndTime
      ? lc.synthEndTime - lc.synthStartTime
      : (lc.stoppedTime ?? now) - lc.synthStartTime;
    lines.push(`音声生成中: ${formatDuration(synthActive, timeUnit)}`);
  }

  if (lc.synthEndTime) {
    const playWait = lc.playStartTime
      ? lc.playStartTime - lc.synthEndTime
      : (lc.stoppedTime ?? now) - lc.synthEndTime;
    lines.push(`読み上げ待ち: ${formatDuration(playWait, timeUnit)}`);
  }

  if (lc.playStartTime) {
    const playActive = lc.playEndTime
      ? lc.playEndTime - lc.playStartTime
      : (lc.stoppedTime ?? now) - lc.playStartTime;
    lines.push(`読み上げ中: ${formatDuration(playActive, timeUnit)}`);
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
  maxContentMs = 0;
  originTime = Date.now();
  lastWrittenLeft = null;
  lastWrittenTop = null;
  setFollow(true, true);
  updateRuler();
});
