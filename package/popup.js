window.onload = function () {
  chrome.storage.sync.get(["apiKeyVOICEVOX", "apiKeyYoutube"], function (data) {
    document.getElementById("apiKeyVOICEVOX").value = data.apiKeyVOICEVOX || "";
    document.getElementById("apiKeyYoutube").value = data.apiKeyYoutube || "";
  });
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
    { apiKeyVOICEVOX: apiKeyVOICEVOX, apiKeyYoutube: apiKeyYoutube },
    function () {
      console.log("API keys saved");
    }
  );

  chrome.runtime.sendMessage(
    { action: "start", apiKeyVOICEVOX, apiKeyYoutube },
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
