// background.js
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (!request.apiKey) {
    sendResponse({ status: "error", message: "APIキーが入力されていません。" });
    return true; // Will respond asynchronously.
  }

  let text = encodeURIComponent("こんにちは"); // 日本語の文字列をエンコード
  let url = `https://deprecatedapis.tts.quest/v2/voicevox/audio/?key=${request.apiKey}&speaker=0&pitch=0&intonationScale=1&speed=1&text=${text}`;
  sendResponse({ status: "success", audioUrl: url });
  return true; // Will respond asynchronously.
});
