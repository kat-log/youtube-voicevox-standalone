document.getElementById("play").addEventListener("click", () => {
  console.log("クリックされました！");
  const apiKeyVOICEVOX = document.getElementById("apiKeyVOICEVOX").value;
  const apiKeyYoutube = document.getElementById("apiKeyYoutube").value; // YouTube APIキーを取得
  const videoId = "xSjK94lmRRQ"; // ビデオIDを設定

  // APIキーが空かどうかをチェック
  if (!apiKeyYoutube) {
    console.error("YouTube APIキーが設定されていません。");
    document.getElementById("error").textContent =
      "YouTube APIキーが設定されていません。";
    return; // 処理を中断
  }

  // APIキーを保存
  chrome.storage.sync.set({ apiKeyVOICEVOX: apiKeyVOICEVOX }, function () {
    console.log("VOICEVOX API key saved");
  });

  // ライブチャットIDを取得するためのリクエストを実行
  fetch(
    `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=liveStreamingDetails&key=${apiKeyYoutube}`
  )
    .then((response) => response.json())
    .then((data) => {
      const liveChatId = data.items[0].liveStreamingDetails.activeLiveChatId;
      if (!liveChatId) {
        throw new Error("ライブチャットIDが見つかりません。");
      }
      console.log("Live Chat ID:", liveChatId);

      // ライブチャットのメッセージを取得するリクエスト
      const requestUrl = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${liveChatId}&part=snippet,authorDetails&key=${apiKeyYoutube}`;
      console.log("投げているリクエストURL: ", requestUrl);

      return fetch(requestUrl);
    })
    .then((response) => {
      if (!response.ok) {
        throw new Error("YouTube APIリクエストに失敗しました。");
      }
      return response.json();
    })
    .then((data) => {
      console.log("data : ", data);
      let messages = data.items.map((item) => item.snippet.displayMessage);
      document.getElementById("debug").textContent =
        "Messages: " + messages.join(", ");

      // メッセージにタイトルとメッセージを含めて送信
      chrome.runtime.sendMessage(
        { apiKeyVOICEVOX: apiKeyVOICEVOX, messages: messages },
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
    })
    .catch((error) => {
      console.error("Error:", error);
      document.getElementById("error").textContent = error.message;
    });
});
