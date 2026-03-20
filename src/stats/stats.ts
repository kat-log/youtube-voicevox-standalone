import '../styles/styles.scss';
import { RANKS, getCurrentRank, getNextRank, getProgressToNextRank } from './ranks';

// ダークモード設定を反映
chrome.storage.sync.get(['darkMode'], (data) => {
  let isDark: boolean;
  if (data.darkMode !== undefined) {
    isDark = data.darkMode;
  } else {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  if (isDark) {
    document.body.classList.add('dark-mode');
  }
});

// 累計データを読み込んで表示
chrome.storage.local.get({ stats: { totalCount: 0, lastActiveDate: '' } }, (data) => {
  renderStats(data.stats.totalCount);
});

// リアルタイム更新を受信
chrome.runtime.onMessage.addListener((request: { action: string; totalCount?: number }) => {
  if (request.action === 'updateStats' && request.totalCount !== undefined) {
    renderStats(request.totalCount);
  }
});

function renderStats(totalCount: number): void {
  const rank = getCurrentRank(totalCount);
  const next = getNextRank(totalCount);
  const progress = getProgressToNextRank(totalCount);

  // Hero card
  const heroEmoji = document.getElementById('hero-emoji');
  const heroRankName = document.getElementById('hero-rank-name');
  const heroCount = document.getElementById('hero-count');
  if (heroEmoji) heroEmoji.textContent = rank.emoji;
  if (heroRankName) {
    heroRankName.textContent = rank.name;
    heroRankName.style.color = rank.color;
  }
  if (heroCount) heroCount.textContent = totalCount.toLocaleString();

  // Progress bar
  const progressSection = document.getElementById('progress-section');
  const progressMax = document.getElementById('progress-max');
  if (next) {
    if (progressSection) progressSection.style.display = '';
    if (progressMax) progressMax.style.display = 'none';

    const progressText = document.getElementById('progress-text');
    const progressPercent = document.getElementById('progress-percent');
    const progressFill = document.getElementById('progress-fill');
    if (progressText) progressText.textContent = `次のランク「${next.emoji} ${next.name}」まで あと${next.threshold - totalCount}件`;
    if (progressPercent) progressPercent.textContent = `${progress}%`;
    if (progressFill) {
      progressFill.style.width = `${progress}%`;
      progressFill.style.backgroundColor = rank.color;
    }
  } else {
    if (progressSection) progressSection.style.display = 'none';
    if (progressMax) {
      progressMax.style.display = '';
      progressMax.textContent = '最高ランクに到達しました！';
    }
  }

  // Rank list
  renderRankList(totalCount);
}

function renderRankList(totalCount: number): void {
  const container = document.getElementById('rank-list');
  if (!container) return;

  const currentRank = getCurrentRank(totalCount);
  container.innerHTML = '';

  for (const rank of RANKS) {
    const isUnlocked = totalCount >= rank.threshold;
    const isCurrent = rank.threshold === currentRank.threshold;

    const item = document.createElement('div');
    item.className = 'rank-item';
    if (isCurrent) item.classList.add('rank-item--current');
    if (!isUnlocked) item.classList.add('rank-item--locked');

    const emoji = document.createElement('span');
    emoji.className = 'rank-item__emoji';
    emoji.textContent = rank.emoji;

    const info = document.createElement('div');
    info.className = 'rank-item__info';

    const name = document.createElement('div');
    name.className = 'rank-item__name';
    name.textContent = rank.name;
    if (isCurrent) name.style.color = rank.color;

    const threshold = document.createElement('div');
    threshold.className = 'rank-item__threshold';
    threshold.textContent = rank.threshold === 0 ? '初期ランク' : `${rank.threshold.toLocaleString()}件で解放`;

    info.appendChild(name);
    info.appendChild(threshold);

    const check = document.createElement('span');
    check.className = 'rank-item__check';
    check.textContent = isUnlocked ? '✓' : '🔒';

    item.appendChild(emoji);
    item.appendChild(info);
    item.appendChild(check);
    container.appendChild(item);
  }
}
