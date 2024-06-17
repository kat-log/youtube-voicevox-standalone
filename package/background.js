let audioQueue = [];
let isPlaying = false;
let liveChatId = null;
let intervalId = null;
let nextPageToken = null;
let commentQueue = [];
let commentIntervalId = null;
let latestTimestamp = null; // 最新のコメントのタイムスタンプを保存する変数を追加

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
            latestTimestamp = new Date(
              latestItem.snippet.publishedAt
            ).getTime(); // 最新コメントのタイムスタンプを保存
            commentQueue.push({ apiKeyVOICEVOX, newMessage, speed, tabId });
          }
          isFirstFetch = false;
        } else {
          // 2回目以降は差分を取得
          data.items.forEach((item) => {
            let newMessage = item.snippet.displayMessage;
            let timestamp = new Date(item.snippet.publishedAt).getTime(); // コメントのタイムスタンプを取得

            // 前回の最新コメント以降のコメントのみをキューに追加
            if (!latestTimestamp || timestamp > latestTimestamp) {
              latestTimestamp = timestamp;
              latestMessage = newMessage;
              commentQueue.push({ apiKeyVOICEVOX, newMessage, speed, tabId });
            }
          });
        }

        nextPageToken = data.nextPageToken || null;
        intervalId = setTimeout(checkNewComments, 3000);
      })
      .catch((error) => {
        console.error("YouTube APIリクエストエラー:", error);
      });
  };

  if (!commentIntervalId) {
    commentIntervalId = setInterval(processCommentQueue, 2000);
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

  chrome.storage.sync.get(["volume", "speed"], function (data) {
    const volume = data.volume !== undefined ? data.volume : 1.0;
    const speed = data.speed !== undefined ? data.speed : 1.0;

    chrome.scripting.executeScript(
      {
        target: { tabId: tabId },
        func: (audioUrl, volume, speed) => {
          if (window.currentAudio) {
            window.currentAudio.pause();
          }
          let audio = new Audio(audioUrl);
          audio.volume = volume;
          audio.playbackRate = speed; // 再生速度を設定
          window.currentAudio = audio;
          audio.play();
          audio.onended = () => {
            chrome.runtime.sendMessage({ action: "audioEnded" });
          };
        },
        args: [audioUrl, volume, speed],
      },
      (results) => {
        if (chrome.runtime.lastError) {
          console.error("VoiceVoxエラー:", chrome.runtime.lastError.message);
          isPlaying = false;
        }
      }
    );
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "audioEnded") {
    isPlaying = false;
    if (sender && sender.tab && sender.tab.id) {
      playNextAudio(sender.tab.id);
      sendResponse({ status: "success" });
    }
    return true;
  } else if (request.action === "setVolume" && request.volume !== undefined) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs.length > 0) {
        let activeTabId = tabs[0].id;
        chrome.scripting.executeScript(
          {
            target: { tabId: activeTabId },
            func: (volume) => {
              if (window.currentAudio) {
                window.currentAudio.volume = volume;
              }
            },
            args: [request.volume],
          },
          () => {
            if (chrome.runtime.lastError) {
              console.error(
                "音量設定エラー:",
                chrome.runtime.lastError.message
              );
            }
          }
        );
        sendResponse({ status: "success" });
      }
    });
    return true;
  } else if (request.action === "setSpeed" && request.speed !== undefined) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs.length > 0) {
        let activeTabId = tabs[0].id;
        chrome.scripting.executeScript(
          {
            target: { tabId: activeTabId },
            func: (speed) => {
              if (window.currentAudio) {
                window.currentAudio.playbackRate = speed;
              }
            },
            args: [request.speed],
          },
          () => {
            if (chrome.runtime.lastError) {
              console.error(
                "再生速度設定エラー:",
                chrome.runtime.lastError.message
              );
            }
          }
        );
        sendResponse({ status: "success" });
      }
    });
    return true;
  } else if (
    request.action === "updateQueueSpeed" &&
    request.speed !== undefined
  ) {
    commentQueue = commentQueue.map((comment) => {
      return { ...comment, speed: request.speed };
    });
    sendResponse({ status: "success" });
    return true;
  }
});

function processCommentQueue() {
  if (commentQueue.length === 0) {
    return;
  }

  const { apiKeyVOICEVOX, newMessage, speed, tabId } = commentQueue.shift();

  fetchVoiceVox(apiKeyVOICEVOX, newMessage)
    .then((audioUrl) => {
      audioQueue.push(audioUrl);
      playNextAudio(tabId);
    })
    .catch((error) => {
      console.error("VoiceVoxエラー:", error);
    });
}

function fetchVoiceVox(apiKey, text) {
  const encodedText = encodeURIComponent(text);
  const url = `https://deprecatedapis.tts.quest/v2/voicevox/audio/?key=${apiKey}&speaker=1&pitch=0&intonationScale=1&text=${encodedText}`;

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
