window.onload = function () {
  chrome.storage.sync.get(
    [
      "apiKeyVOICEVOX",
      "apiKeyYoutube",
      "speed",
      "volume",
      "latestOnlyMode",
      "speakerId",
    ],
    function (data) {
      document.getElementById("apiKeyVOICEVOX").value =
        data.apiKeyVOICEVOX || "";
      document.getElementById("apiKeyYoutube").value = data.apiKeyYoutube || "";
      window.speed = data.speed || 1.0;
      const speedSlider = document.getElementById("speed");
      speedSlider.value = window.speed;
      document.getElementById(
        "current-speed"
      ).textContent = `Current Speed: ${window.speed.toFixed(1)}`;
      window.volume = data.volume || 1.0;
      document.getElementById("volume").value = window.volume;
      document.getElementById(
        "current-volume"
      ).textContent = `Current Volume: ${window.volume}`;
      document.getElementById("latestOnlyMode").checked =
        data.latestOnlyMode || false;

      // 話者一覧を取得して選択メニューを作成
      fetch("https://static.tts.quest/voicevox_speakers.json")
        .then((response) => response.json())
        .then((speakers) => {
          const select = document.getElementById("speaker");
          speakers.forEach((speaker, index) => {
            if (speaker) {
              // null以外の話者のみ追加
              const option = document.createElement("option");
              option.value = index;
              option.textContent = speaker;
              select.appendChild(option);
            }
          });
          // 保存された話者IDを選択
          select.value = data.speakerId || "1";
        });

      // OSに応じてツールチップのテキストを更新
      updateShortcutTooltips();

      // 1.0: 現在のステータスを取得
      chrome.runtime.sendMessage({ action: "getStatus" }, function (response) {
        if (chrome.runtime.lastError) return;
        if (response) {
          updateStatusUI(response.status || "idle", "", response.commentCount || 0);
        }
      });

      // 1.0: 初期バリデーション
      validateInputs();
    }
  );
};

// OSに応じてショートカットキーのツールチップを更新する関数
function updateShortcutTooltips() {
  // OSを検出
  let os = "unknown";
  const userAgent = navigator.userAgent;

  if (userAgent.indexOf("Win") !== -1) os = "Windows";
  else if (userAgent.indexOf("Mac") !== -1) os = "Mac";
  else if (userAgent.indexOf("Linux") !== -1) os = "Linux";
  else if (userAgent.indexOf("CrOS") !== -1) os = "ChromeOS";

  // Macの場合は特殊な表記に変更
  let startShortcut = "Alt+Shift+S";
  let stopShortcut = "Alt+Shift+Q";

  if (os === "Mac") {
    startShortcut = "⌥⇧S"; // Option(Alt)+Shift+S
    stopShortcut = "⌥⇧Q"; // Option(Alt)+Shift+Q
  }

  // ツールチップのテキストを更新
  document.getElementById(
    "play-tooltip"
  ).textContent = `ショートカット: ${startShortcut}`;
  document.getElementById(
    "stop-tooltip"
  ).textContent = `ショートカット: ${stopShortcut}`;
}

document.getElementById("play").addEventListener("click", () => {
  const apiKeyVOICEVOX = document.getElementById("apiKeyVOICEVOX").value;
  const apiKeyYoutube = document.getElementById("apiKeyYoutube").value;
  const speakerId = document.getElementById("speaker").value;

  if (!apiKeyYoutube) {
    document.getElementById("error").textContent =
      "YouTube APIキーが設定されていません。";
    return;
  }

  chrome.storage.sync.set(
    {
      apiKeyVOICEVOX: apiKeyVOICEVOX,
      apiKeyYoutube: apiKeyYoutube,
      speed: window.speed,
      volume: window.volume,
      latestOnlyMode: document.getElementById("latestOnlyMode").checked,
      speakerId: speakerId,
    },
    function () {
      console.log("API keys, speed, and volume saved");
    }
  );

  chrome.runtime.sendMessage(
    {
      action: "start",
      apiKeyVOICEVOX,
      apiKeyYoutube,
      speed: window.speed,
      volume: window.volume,
      latestOnlyMode: document.getElementById("latestOnlyMode").checked,
      speakerId: speakerId,
    },
    function (response) {
      if (chrome.runtime.lastError) {
        document.getElementById("error").textContent =
          chrome.runtime.lastError.message;
      } else if (response && response.status === "error") {
        let errorMessage = response.message;
        if (response.details) {
          errorMessage += "\n\nデバッグ情報:\n" + response.details;
        }
        document.getElementById("error").textContent = errorMessage;
      } else {
        document.getElementById("error").textContent = "エラーなし";
      }
    }
  );
});

document.getElementById("stop").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stop" }, function (response) {
    if (chrome.runtime.lastError) {
      document.getElementById("error").textContent =
        chrome.runtime.lastError.message;
    } else if (response && response.status === "error") {
      document.getElementById("error").textContent = response.message;
    } else {
      document.getElementById("error").textContent = "停止しました";
    }
  });
});

document.getElementById("decrease-speed").addEventListener("click", () => {
  window.speed = Math.max(0.1, window.speed - 0.1);
  chrome.storage.sync.set({ speed: window.speed });
  document.getElementById(
    "current-speed"
  ).textContent = `Current Speed: ${window.speed.toFixed(1)}`;

  // 再生中のオーディオの速度を変更
  chrome.runtime.sendMessage({ action: "setSpeed", speed: window.speed });

  // キュー内のコメントの速度を変更
  chrome.runtime.sendMessage({
    action: "updateQueueSpeed",
    speed: window.speed,
  });

  document.getElementById("speed").value = window.speed;
});

document.getElementById("reset-speed").addEventListener("click", () => {
  window.speed = 1.0;
  chrome.storage.sync.set({ speed: window.speed });
  document.getElementById(
    "current-speed"
  ).textContent = `Current Speed: ${window.speed.toFixed(1)}`;

  // 再生中のオーディオの速度を変更
  chrome.runtime.sendMessage({ action: "setSpeed", speed: window.speed });

  // キュー内のコメントの速度を変更
  chrome.runtime.sendMessage({
    action: "updateQueueSpeed",
    speed: window.speed,
  });

  document.getElementById("speed").value = window.speed;
});

document.getElementById("increase-speed").addEventListener("click", () => {
  window.speed = Math.min(3.0, window.speed + 0.1);
  chrome.storage.sync.set({ speed: window.speed });
  document.getElementById(
    "current-speed"
  ).textContent = `Current Speed: ${window.speed.toFixed(1)}`;

  // 再生中のオーディオの速度を変更
  chrome.runtime.sendMessage({ action: "setSpeed", speed: window.speed });

  // キュー内のコメントの速度を変更
  chrome.runtime.sendMessage({
    action: "updateQueueSpeed",
    speed: window.speed,
  });

  document.getElementById("speed").value = window.speed;
});

document.getElementById("volume").addEventListener("input", (event) => {
  window.volume = event.target.value;
  chrome.storage.sync.set({ volume: window.volume });
  document.getElementById(
    "current-volume"
  ).textContent = `Current Volume: ${window.volume}`;
  chrome.runtime.sendMessage({ action: "setVolume", volume: window.volume });
});

document
  .getElementById("latestOnlyMode")
  .addEventListener("change", (event) => {
    const newMode = event.target.checked;
    chrome.storage.sync.set({ latestOnlyMode: newMode });

    // 実行中の場合は、新しいモードをbackground.jsに即時反映
    chrome.runtime.sendMessage({
      action: "updateLatestOnlyMode",
      latestOnlyMode: newMode,
    });
  });

// 話者選択の変更イベントリスナー
document.getElementById("speaker").addEventListener("change", (event) => {
  const newSpeakerId = event.target.value;
  chrome.storage.sync.set({ speakerId: newSpeakerId });

  // background.jsに話者変更を通知
  chrome.runtime.sendMessage({
    action: "updateSpeaker",
    speakerId: newSpeakerId,
  });
});

// エラーメッセージ更新のリスナーを追加
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  // 1.0: ステータス更新
  if (request.action === "updateStatus") {
    updateStatusUI(request.status, request.message, request.commentCount);
  } else if (request.action === "updateErrorMessage") {
    const errorElement = document.getElementById("error");
    if (errorElement) {
      errorElement.textContent = request.message;
    }
  }
  // 既存のデバッグメッセージリスナーはそのまま
  else if (request.action === "debugInfo") {
    const debugElement = document.getElementById("debug");
    if (debugElement) {
      // 新しいメッセージを既存のログの先頭に追加
      const timestamp = new Date().toLocaleTimeString();
      const newMessage = `[${timestamp}] ${request.message}\n${debugElement.textContent}`;
      debugElement.textContent = newMessage;
    }
  }
});

// アコーディオンの機能を追加
document
  .querySelector(".accordion-button")
  .addEventListener("click", function () {
    const content = this.nextElementSibling;
    content.classList.toggle("active");
  });

// スピードスライダーのイベントリスナー
document.getElementById("speed").addEventListener("input", (event) => {
  window.speed = parseFloat(event.target.value);
  chrome.storage.sync.set({ speed: window.speed });
  document.getElementById(
    "current-speed"
  ).textContent = `Current Speed: ${window.speed.toFixed(1)}`;

  // 再生中のオーディオの速度を変更
  chrome.runtime.sendMessage({ action: "setSpeed", speed: window.speed });

  // キュー内のコメントの速度を変更
  chrome.runtime.sendMessage({
    action: "updateQueueSpeed",
    speed: window.speed,
  });

  document.getElementById("speed").value = window.speed;
});

// 1.0: ステータスバーのUIを更新する関数
function updateStatusUI(status, message, count) {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  const countEl = document.getElementById("status-count");
  if (!dot || !text || !countEl) return;

  dot.className = "status-dot " + status;
  switch (status) {
    case "idle":
      text.textContent = "停止中";
      countEl.textContent = "";
      break;
    case "connecting":
      text.textContent = "接続中...";
      countEl.textContent = "";
      break;
    case "listening":
      text.textContent = "読み上げ中";
      countEl.textContent = count > 0 ? `（${count}件読上済）` : "";
      break;
    case "error":
      text.textContent = "エラー: " + (message || "不明");
      countEl.textContent = "";
      break;
  }
}

// 1.0: 入力バリデーション
function validateInputs() {
  const apiKey = document.getElementById("apiKeyYoutube").value.trim();
  const playBtn = document.getElementById("play");
  playBtn.disabled = !apiKey;
}

// 1.0: YouTube APIキー入力の変更を監視
document
  .getElementById("apiKeyYoutube")
  .addEventListener("input", validateInputs);
