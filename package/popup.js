// popup.js
document.addEventListener("DOMContentLoaded", () => {
  // ページが読み込まれたら、保存されたAPIキーを取得
  chrome.storage.sync.get(["apiKey"], function (result) {
    if (result.apiKey) {
      document.getElementById("apikey").value = result.apiKey;
    }
  });
});

document.getElementById("play").addEventListener("click", () => {
  const apiKey = document.getElementById("apikey").value;
  // APIキーを保存
  chrome.storage.sync.set({ apiKey: apiKey }, function () {
    console.log("API key saved");
  });

  chrome.runtime.sendMessage({ apiKey: apiKey }, function (response) {
    if (response.status === "success") {
      let audio = new Audio(response.audioUrl);
      audio.play();
      document.getElementById("error").textContent =
        "APIキーの入力を確認しました"; // エラーメッセージなしの場合
    } else {
      document.getElementById("error").textContent =
        "Error: " + response.message; // エラーメッセージを表示
    }
  });
});
