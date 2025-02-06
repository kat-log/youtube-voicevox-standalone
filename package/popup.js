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
    }
  );
};

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
        document.getElementById("error").textContent = response.message;
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
});

document.getElementById("increase-speed").addEventListener("click", () => {
  window.speed = Math.min(2.0, window.speed + 0.1);
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
