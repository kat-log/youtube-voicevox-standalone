document.getElementById("play").addEventListener("click", () => {
  const apiKey = document.getElementById("apikey").value;
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
