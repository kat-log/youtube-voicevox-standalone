chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "start") {
    const { apiKeyVOICEVOX, apiKeyYoutube } = request;

    if (!apiKeyVOICEVOX || !apiKeyYoutube) {
      sendResponse({
        status: "error",
        message: "APIキーが入力されていません。",
      });
      return true;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (chrome.runtime.lastError) {
        sendResponse({
          status: "error",
          message: chrome.runtime.lastError.message,
        });
        return;
      }

      if (!tabs || tabs.length === 0) {
        sendResponse({
          status: "error",
          message: "アクティブなタブが見つかりません。",
        });
        return;
      }

      let videoId;
      const url = new URL(tabs[0].url);

      if (url.hostname === "www.youtube.com") {
        videoId = new URLSearchParams(url.search).get("v");
      } else if (url.hostname === "youtu.be") {
        videoId = url.pathname.slice(1);
      }

      if (!videoId) {
        sendResponse({
          status: "error",
          message: "ビデオIDが見つかりません。",
        });
        return;
      }

      fetch(
        `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=liveStreamingDetails&key=${apiKeyYoutube}`
      )
        .then((response) => response.json())
        .then((data) => {
          if (
            !data.items ||
            data.items.length === 0 ||
            !data.items[0].liveStreamingDetails
          ) {
            sendResponse({
              status: "error",
              message: "ライブストリーミングの詳細が見つかりません。",
            });
            return;
          }

          const liveChatId =
            data.items[0].liveStreamingDetails.activeLiveChatId;
          if (!liveChatId) {
            sendResponse({
              status: "error",
              message:
                "ライブチャットIDが見つかりません。（or APIのクエリ上限に達しているかも）",
            });
            return;
          }

          const requestUrl = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${liveChatId}&part=snippet,authorDetails&key=${apiKeyYoutube}`;
          let latestMessage = "";

          const checkNewComments = () => {
            fetch(requestUrl)
              .then((response) => {
                if (!response.ok) {
                  throw new Error("YouTube APIリクエストに失敗しました。");
                }
                return response.json();
              })
              .then((data) => {
                if (!data.items || data.items.length === 0) {
                  throw new Error("ライブチャットメッセージが見つかりません。");
                }

                let newMessage =
                  data.items[data.items.length - 1].snippet.displayMessage;

                if (newMessage !== latestMessage) {
                  latestMessage = newMessage;

                  fetchVoiceVox(apiKeyVOICEVOX, newMessage)
                    .then((audioUrl) => {
                      chrome.scripting.executeScript(
                        {
                          target: { tabId: tabs[0].id },
                          func: (audioUrl) => {
                            let audio = new Audio(audioUrl);
                            audio.play();
                          },
                          args: [audioUrl],
                        },
                        () => {
                          if (chrome.runtime.lastError) {
                            console.error(
                              "VoiceVoxエラー:",
                              chrome.runtime.lastError.message
                            );
                          }
                        }
                      );
                    })
                    .catch((error) => {
                      console.error("VoiceVoxエラー:", error);
                    });
                }

                setTimeout(checkNewComments, 2000);
              })
              .catch((error) => {
                console.error("エラーをキャッチ:", error);
              });
          };

          checkNewComments();
          sendResponse({ status: "success" });
        })
        .catch((error) => {
          console.error("エラーをキャッチ:", error);
          sendResponse({ status: "error", message: error.message });
        });
    });

    return true; // Will respond asynchronously.
  }

  return true;
});

function fetchVoiceVox(apiKey, text) {
  const encodedText = encodeURIComponent(text);
  const url = `https://deprecatedapis.tts.quest/v2/voicevox/audio/?key=${apiKey}&speaker=0&pitch=0&intonationScale=1&speed=1&text=${encodedText}`;

  return fetch(url).then((response) => {
    if (!response.ok) {
      return response.text().then((text) => {
        throw new Error(text);
      });
    }
    return response.url;
  });
}
