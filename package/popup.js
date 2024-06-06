window.onload = function () {
  chrome.storage.sync.get(
    ["apiKeyVOICEVOX", "apiKeyYoutube", "speed"],
    function (data) {
      document.getElementById("apiKeyVOICEVOX").value =
        data.apiKeyVOICEVOX || "";
      document.getElementById("apiKeyYoutube").value = data.apiKeyYoutube || "";
      window.speed = data.speed || 1.0;
      document.getElementById(
        "current-speed"
      ).textContent = `Current Speed: ${window.speed.toFixed(1)}`;
    }
  );
};

document.getElementById("play").addEventListener("click", () => {
  const apiKeyVOICEVOX = document.getElementById("apiKeyVOICEVOX").value;
  const apiKeyYoutube = document.getElementById("apiKeyYoutube").value;

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
    },
    function () {
      console.log("API keys and speed saved");
    }
  );

  chrome.runtime.sendMessage(
    { action: "start", apiKeyVOICEVOX, apiKeyYoutube, speed: window.speed },
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
});

document.getElementById("reset-speed").addEventListener("click", () => {
  window.speed = 1.0;
  chrome.storage.sync.set({ speed: window.speed });
  document.getElementById(
    "current-speed"
  ).textContent = `Current Speed: ${window.speed.toFixed(1)}`;
});

document.getElementById("increase-speed").addEventListener("click", () => {
  window.speed = Math.min(2.0, window.speed + 0.1);
  chrome.storage.sync.set({ speed: window.speed });
  document.getElementById(
    "current-speed"
  ).textContent = `Current Speed: ${window.speed.toFixed(1)}`;
});
