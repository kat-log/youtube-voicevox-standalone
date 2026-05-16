import '../styles/styles.scss';
import type { CommentLifecycle, TimelineStatus } from '@/background/lifecycle-tracker';

// スケール: 10px = 1秒 (0.01 px/ms)
const SCALE = 0.01;
// ラベル列の幅（CSSと一致させる）
const LABEL_WIDTH = 160;
// 目盛り間隔: 5秒
const RULER_INTERVAL_MS = 5000;
// 目盛りの横幅（px）= 5s * 10px/s = 50px
const RULER_INTERVAL_PX = RULER_INTERVAL_MS * SCALE;

let originTime: number = Date.now();
const lifecycles = new Map<string, CommentLifecycle>();
let rafId: number | null = null;

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

// ===== ダークモード =====
chrome.storage.sync.get(['darkMode'], (data) => {
  const isDark: boolean =
    data.darkMode !== undefined
      ? data.darkMode
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (isDark) document.body.classList.add('dark-mode');
});

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
  const ganttInner = document.getElementById('gantt-inner');

  const visibleAxisWidth = ganttScroll ? ganttScroll.clientWidth : window.innerWidth - LABEL_WIDTH;
  const contentAxisWidth = ganttInner
    ? Math.max(parseInt(ganttInner.style.minWidth || '0', 10) - LABEL_WIDTH, 0)
    : 0;
  const axisWidth = Math.max(visibleAxisWidth, contentAxisWidth, getGanttWidth() - LABEL_WIDTH);

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

function getGanttWidth(): number {
  const now = Date.now();
  return LABEL_WIDTH + (now - originTime) * SCALE + 100;
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

    // 新規コメントが追加されたとき、スクロールが最下部付近なら追従
    const scroll = document.getElementById('gantt-scroll');
    if (scroll) {
      const distFromBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
      if (distFromBottom < 40) {
        scroll.scrollTop = scroll.scrollHeight;
      }
    }
  }
  renderSegments(row, lc, Date.now());
}

function createRow(lc: CommentLifecycle): HTMLElement {
  const row = document.createElement('div');
  row.className = 'timeline-row';
  row.dataset.id = lc.id;

  const label = document.createElement('div');
  label.className = 'row-label';
  const displayText = lc.text.length > 20 ? lc.text.slice(0, 20) + '…' : lc.text;
  label.textContent = displayText;
  label.title = lc.text;
  row.appendChild(label);

  return row;
}

// ===== セグメント描画 =====
function renderSegments(row: HTMLElement, lc: CommentLifecycle, now: number): void {
  // 既存セグメントを削除
  row.querySelectorAll('.segment').forEach((s) => s.remove());

  const stages: Array<{ cls: string; start: number; end: number | null }> = [];

  // 音声生成待ち: fetchTime → synthStartTime
  if (lc.fetchTime) {
    stages.push({
      cls: 'synth-wait',
      start: lc.fetchTime,
      end: lc.synthStartTime ?? null,
    });
  }

  // 音声生成中: synthStartTime → synthEndTime
  if (lc.synthStartTime) {
    stages.push({
      cls: 'synth-active',
      start: lc.synthStartTime,
      end: lc.synthEndTime ?? null,
    });
  }

  // 読み上げ待ち: synthEndTime → playStartTime
  if (lc.synthEndTime) {
    stages.push({
      cls: 'play-wait',
      start: lc.synthEndTime,
      end: lc.playStartTime ?? null,
    });
  }

  // 読み上げ中: playStartTime → playEndTime
  if (lc.playStartTime) {
    stages.push({
      cls: 'play-active',
      start: lc.playStartTime,
      end: lc.playEndTime ?? null,
    });
  }

  for (const stage of stages) {
    const startPx = LABEL_WIDTH + (stage.start - originTime) * SCALE;
    const endMs = stage.end ?? now;
    const widthPx = Math.max(2, (endMs - stage.start) * SCALE);

    const seg = document.createElement('div');
    seg.className = `segment ${stage.cls}`;
    seg.style.left = `${startPx}px`;
    seg.style.width = `${widthPx}px`;

    seg.addEventListener('mousemove', (e) => showTooltip(e, lc));
    seg.addEventListener('mouseleave', hideTooltip);

    row.appendChild(seg);
  }

  // 行の最小幅を更新（横スクロール用）
  const ganttInner = document.getElementById('gantt-inner');
  if (ganttInner) {
    const currentWidth = stages.length > 0
      ? LABEL_WIDTH + ((stages[stages.length - 1].end ?? now) - originTime) * SCALE + 20
      : LABEL_WIDTH + 20;
    const existingWidth = parseInt(ganttInner.style.minWidth || '0', 10);
    if (currentWidth > existingWidth) {
      ganttInner.style.minWidth = `${currentWidth}px`;
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
      // 完了していないものだけ更新
      if (lc.playEndTime) continue;
      const ganttInner = document.getElementById('gantt-inner');
      const row = ganttInner?.querySelector<HTMLElement>(`[data-id="${CSS.escape(lc.id)}"]`);
      if (row) renderSegments(row, lc, now);
    }
    updateRuler();
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
}

// ===== ツールチップ =====
const tooltip = document.getElementById('tooltip')!;

function showTooltip(e: MouseEvent, lc: CommentLifecycle): void {
  const now = Date.now();
  const lines: string[] = [`💬 ${lc.text.slice(0, 30)}`];

  const synthWait = lc.synthStartTime
    ? lc.synthStartTime - lc.fetchTime
    : now - lc.fetchTime;
  lines.push(`音声生成待ち: ${synthWait}ms`);

  if (lc.synthStartTime) {
    const synthActive = lc.synthEndTime
      ? lc.synthEndTime - lc.synthStartTime
      : now - lc.synthStartTime;
    lines.push(`音声生成中: ${synthActive}ms`);
  }

  if (lc.synthEndTime) {
    const playWait = lc.playStartTime
      ? lc.playStartTime - lc.synthEndTime
      : now - lc.synthEndTime;
    lines.push(`読み上げ待ち: ${playWait}ms`);
  }

  if (lc.playStartTime) {
    const playActive = lc.playEndTime
      ? lc.playEndTime - lc.playStartTime
      : now - lc.playStartTime;
    lines.push(`読み上げ中: ${playActive}ms`);
  }

  tooltip.innerHTML = lines.join('<br>');
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
  originTime = Date.now();
  updateRuler();
});
