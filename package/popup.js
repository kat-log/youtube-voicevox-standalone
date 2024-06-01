// popup.js
document.getElementById("play").addEventListener("click", () => {
  const apiKeyVOICEVOX = document.getElementById("apiKeyVOICEVOX").value;
  // APIキーを保存
  chrome.storage.sync.set({ apiKeyVOICEVOX: apiKeyVOICEVOX }, function () {
    console.log("API key saved");
  });

  // 現在のタブでスクリプトを実行してタイトルとメッセージを取得
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabs[0].id },
        function: function () {
          let titleElement = document.querySelector(
            ".style-scope ytd-watch-metadata h1"
          );
          let title = titleElement
            ? titleElement.textContent
            : "タイトル要素が見つかりません";

          console.log("titleElement : ", titleElement);
          // 「style-scope yt-live-chat-item-list-renderer」内の「style-scope yt-live-chat-text-message-renderer」の要素を取得
          let messageElements = document.querySelectorAll(
            ".style-scope.yt-live-chat-item-list-renderer .style-scope.yt-live-chat-text-message-renderer"
          );
          console.log("コンソールです");
          console.log("messageElements : ", messageElements);
          let messages = Array.from(messageElements).map(
            (el) => el.textContent
          );

          return { title: title, messages: messages };
        },
      },
      function (result) {
        // スクリプトの実行結果を取得
        let pageTitle = result[0].result.title;
        let pageMessages = result[0].result.messages;

        // メッセージにタイトルとメッセージを含めて送信
        chrome.runtime.sendMessage(
          {
            apiKeyVOICEVOX: apiKeyVOICEVOX,
            title: pageTitle,
            messages: pageMessages,
          },
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

        // デバッグのためにタイトルとメッセージを出力
        document.getElementById("debug").textContent =
          "Title: " + pageTitle + ", Messages: " + pageMessages.join(", ");
      }
    );
  });
});
