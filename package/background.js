let audioQueue = [];
let isPlaying = false;
let liveChatId = null;
let intervalId = null;
let nextPageToken = null;
let commentQueue = [];
let commentIntervalId = null;

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "start") {
    const { apiKeyVOICEVOX, apiKeyYoutube, speed } = request;

    if (!apiKeyVOICEVOX || !apiKeyYoutube) {
      sendResponse({
        status: "error",
        message: "APIキーが入力されていません。",
      });
      return true;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (chrome.runtime.lastError) {
        console.error("APIキー取得エラー:", chrome.runtime.lastError.message);
        sendResponse({
          status: "error",
          message: chrome.runtime.lastError.message,
        });
        return;
      }

      if (!tabs || tabs.length === 0) {
        console.error(
          "アクティブタブエラー: アクティブなタブが見つかりません。"
        );
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
        console.error("ビデオIDエラー: ビデオIDが見つかりません。");
        sendResponse({
          status: "error",
          message: "ビデオIDが見つかりません。",
        });
        return;
      }

      if (!liveChatId) {
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
              console.error("ライブストリーミングの詳細が見つかりません。");
              sendResponse({
                status: "error",
                message: "ライブストリーミングの詳細が見つかりません。",
              });
              return;
            }

            liveChatId = data.items[0].liveStreamingDetails.activeLiveChatId;
            if (!liveChatId) {
              console.error(
                "ライブチャットIDエラー: ライブチャットIDが見つかりません。"
              );
              sendResponse({
                status: "error",
                message: "ライブチャットIDが見つかりません。",
              });
              return;
            }

            startFetchingComments(
              apiKeyVOICEVOX,
              apiKeyYoutube,
              speed,
              tabs[0].id,
              true
            );
            sendResponse({ status: "success" });
          })
          .catch((error) => {
            console.error("YouTube APIリクエストエラー:", error.message);
            sendResponse({ status: "error", message: error.message });
          });
      } else {
        startFetchingComments(
          apiKeyVOICEVOX,
          apiKeyYoutube,
          speed,
          tabs[0].id,
          true
        );
        sendResponse({ status: "success" });
      }
    });

    return true; // Will respond asynchronously.
  } else if (request.action === "stop") {
    stopFetchingComments();
    sendResponse({ status: "success" });
    return true;
  }

  return true;
});

function startFetchingComments(
  apiKeyVOICEVOX,
  apiKeyYoutube,
  speed,
  tabId,
  isFirstFetch
) {
  const requestUrl = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${liveChatId}&part=snippet,authorDetails&key=${apiKeyYoutube}${
    nextPageToken ? `&pageToken=${nextPageToken}` : ""
  }`;
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

        if (isFirstFetch) {
          // 最初の取得では最新の1件のみを取得
          let latestItem = data.items[data.items.length - 1];
          let newMessage = latestItem.snippet.displayMessage;
          if (newMessage !== latestMessage) {
            latestMessage = newMessage;
            commentQueue.push({ apiKeyVOICEVOX, newMessage, speed, tabId });
          }
          isFirstFetch = false;
        } else {
          // 2回目以降は差分を取得
          data.items.forEach((item) => {
            let newMessage = item.snippet.displayMessage;
            if (newMessage !== latestMessage) {
              latestMessage = newMessage;
              commentQueue.push({ apiKeyVOICEVOX, newMessage, speed, tabId });
            }
          });
        }

        nextPageToken = data.nextPageToken || null;
        intervalId = setTimeout(checkNewComments, 4000);
      })
      .catch((error) => {
        console.error("YouTube APIリクエストエラー:", error);
      });
  };

  if (!commentIntervalId) {
    commentIntervalId = setInterval(processCommentQueue, 3000);
  }

  checkNewComments();
}

function stopFetchingComments() {
  audioQueue = [];
  isPlaying = false;
  if (intervalId) {
    clearTimeout(intervalId);
    intervalId = null;
  }
  if (commentIntervalId) {
    clearInterval(commentIntervalId);
    commentIntervalId = null;
  }
  commentQueue = [];

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs.length > 0) {
      let activeTabId = tabs[0].id;
      chrome.scripting.executeScript(
        {
          target: { tabId: activeTabId },
          func: () => {
            if (window.currentAudio) {
              window.currentAudio.pause();
              window.currentAudio = null;
            }
          },
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error("音声停止エラー:", chrome.runtime.lastError.message);
          }
        }
      );
    }
  });
}

function playNextAudio(tabId) {
  if (isPlaying || audioQueue.length === 0) {
    return;
  }

  const audioUrl = audioQueue.shift();
  isPlaying = true;

  chrome.scripting.executeScript(
    {
      target: { tabId: tabId },
      func: (audioUrl) => {
        if (window.currentAudio) {
          window.currentAudio.pause();
        }
        let audio = new Audio(audioUrl);
        window.currentAudio = audio;
        audio.play();
        audio.onended = () => {
          chrome.runtime.sendMessage({ action: "audioEnded" });
        };
      },
      args: [audioUrl],
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error("VoiceVoxエラー:", chrome.runtime.lastError.message);
        isPlaying = false;
      }
    }
  );
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "audioEnded") {
    isPlaying = false;
    playNextAudio(sender.tab.id);
    sendResponse({ status: "success" });
    return true;
  }
});

function processCommentQueue() {
  if (commentQueue.length === 0) {
    return;
  }

  const { apiKeyVOICEVOX, newMessage, speed, tabId } = commentQueue.shift();

  fetchVoiceVox(apiKeyVOICEVOX, newMessage, speed)
    .then((audioUrl) => {
      audioQueue.push(audioUrl);
      playNextAudio(tabId);
    })
    .catch((error) => {
      console.error("VoiceVoxエラー:", error);
    });
}

function fetchVoiceVox(apiKey, text, speed) {
  const encodedText = encodeURIComponent(text);
  const url = `https://deprecatedapis.tts.quest/v2/voicevox/audio/?key=${apiKey}&speaker=1&pitch=0&intonationScale=1&speed=${speed}&text=${encodedText}`;

  console.log("VoiceVox API URL:", url); // コンソールにAPI URLを表示

  return fetch(url).then((response) => {
    if (!response.ok) {
      return response.text().then((text) => {
        throw new Error(text);
      });
    }
    return response.url;
  });
}
