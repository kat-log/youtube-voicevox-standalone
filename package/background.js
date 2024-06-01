// background.js
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (!request.apiKeyVOICEVOX) {
    sendResponse({ status: "error", message: "APIキーが入力されていません。" });
    return true; // Will respond asynchronously.
  }

  let text = encodeURIComponent(request.title); // ページのタイトルをエンコード

  let url = `https://deprecatedapis.tts.quest/v2/voicevox/audio/?key=${request.apiKeyVOICEVOX}&speaker=0&pitch=0&intonationScale=1&speed=1&text=${text}`;

  // APIリクエストを行う
  fetch(url)
    .then((response) => {
      if (!response.ok) {
        // レスポンスがエラーを含む場合、エラーメッセージを返す
        return response.text().then((text) => {
          sendResponse({ status: "error", message: text });
        });
      }

      // エラーがなければ音声URLを返す
      sendResponse({ status: "success", audioUrl: response.url });
    })
    .catch((error) => {
      // ネットワークエラーやその他のエラーを処理する
      sendResponse({ status: "error", message: error.message });
    });

  return true; // Will respond asynchronously.
});
