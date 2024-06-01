document.getElementById("play").addEventListener("click", () => {
  console.log("クリックされました！");
  const apiKeyVOICEVOX = document.getElementById("apiKeyVOICEVOX").value;
  const apiKeyYoutube = document.getElementById("apiKeyYoutube").value; // YouTube APIキーを取得

  // APIキーが空かどうかをチェック
  if (!apiKeyYoutube) {
    console.error("YouTube APIキーが設定されていません。");
    document.getElementById("error").textContent =
      "YouTube APIキーが設定されていません。";
    return; // 処理を中断
  }

  const liveChatId = "KgvMZqlKu_c"; // ライブチャットIDを設定

  // APIキーを保存
  chrome.storage.sync.set({ apiKeyVOICEVOX: apiKeyVOICEVOX }, function () {
    console.log("VOICEVOX API key saved");
  });

  const requestUrl = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${liveChatId}&part=snippet,authorDetails&key=${apiKeyYoutube}`;
  console.log("投げているリクエストURL: ", requestUrl); // リクエストURLをログに出力

  // YouTube Data APIを呼び出してライブチャットのメッセージを取得
  fetch(
    `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${liveChatId}&part=snippet,authorDetails&key=${apiKeyYoutube}`
  )
    .then((response) => {
      console.log("response : ", response);
      console.log("response status: ", response.status); // ステータスコードをログに出力

      if (!response.ok) {
        console.error("投げているリクエストURL: ", requestUrl); // リクエストURLをログに出力
        console.error("エラーでございます。 response : ", response);
        console.error("response status: ", response.status); // ステータスコードをログに出力

        return response.json().then((errorData) => {
          console.error("エラー詳細: ", errorData);
          throw new Error(
            "YouTube APIキーが無効か、リクエストが拒否されました。"
          );
        });
      }
      return response.json();
    })
    .then((data) => {
      console.log("data : ", data); // レスポンスデータを出力

      let messages = []; // ここでmessagesを定義

      if (data.items) {
        messages = data.items.map((item) => item.snippet.displayMessage);
        // 以降のコード...
      } else {
        console.error(
          "Error: items property is missing in the responseでございます"
        );
        document.getElementById("error").textContent =
          "ライブチャットデータが見つかりません。";
      }

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

      // デバッグのためにメッセージを出力
      document.getElementById("debug").textContent =
        "Messages: " + messages.join(", ");
    })
    .catch((error) => {
      console.error("Error:", error);
      document.getElementById("error").textContent = error.message; // エラーメッセージを表示
    });
});
