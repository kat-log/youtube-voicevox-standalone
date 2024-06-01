// popup.js
document.getElementById("play").addEventListener("click", () => {
  const apiKey = document.getElementById("apikey").value;
  // APIキーを保存
  chrome.storage.sync.set({ apiKey: apiKey }, function () {
    console.log("API key saved");
  });

  // 現在のタブでスクリプトを実行してタイトルを取得
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabs[0].id },
        function: function () {
          let titleElement = document.querySelector(
            ".style-scope ytd-watch-metadata h1"
          );
          return titleElement
            ? titleElement.textContent
            : "タイトル要素が見つかりません";
        },
      },
      function (result) {
        // スクリプトの実行結果を取得
        let pageTitle = result[0].result;

        // メッセージにタイトルを含めて送信
        chrome.runtime.sendMessage(
          { apiKey: apiKey, title: pageTitle },
          function (response) {
            if (response.status === "success") {
              let audio = new Audio(response.audioUrl);
              audio.play();
              document.getElementById("error").textContent = "エラーなし"; // エラーメッセージなしの場合
            } else {
              document.getElementById("error").textContent =
                "Error: " + response.message; // エラーメッセージを表示
            }
          }
        );

        // デバッグのためにタイトルを出力
        document.getElementById("debug").textContent = "Title: " + pageTitle;
      }
    );
  });
});
