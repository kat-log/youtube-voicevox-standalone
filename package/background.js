// 2.0: 初回インストール時にセットアップガイドを開く
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({
      url: "https://github.com/kat-log/chrome-extension-youtube_live-voicevox#-セットアップ方法",
    });
  }
});

let audioQueue = [];
let isPlaying = false;
let liveChatId = null;
let intervalId = null;
let nextPageToken = null;
let commentQueue = [];
let commentIntervalId = null;
let latestTimestamp = null; // 最新のコメントのタイムスタンプを保存する変数を追加
let latestOnlyMode = false;
let activeTabId = null; // 0.1/0.2: 音声注入先タブIDを固定保持
let playingTimeout = null; // 0.1: デッドロック防止用フェイルセーフタイマー
let consecutiveErrors = 0; // 0.4: 連続エラーカウンタ（指数バックオフ用）
let commentCount = 0; // 1.0: 読み上げ済みコメント数
let sessionId = 0; // 1.0: セッションID（Stop時にインクリメントして非同期処理を無効化）

// 0.1: タブが閉じられた場合のクリーンアップ
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    stopFetchingComments();
    activeTabId = null;
  }
});

// 0.1: タブがYouTube以外に遷移した場合のクリーンアップ
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeTabId && changeInfo.url) {
    if (!changeInfo.url.includes("youtube.com/watch")) {
      stopFetchingComments();
      activeTabId = null;
    }
  }
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "start") {
    const {
      apiKeyVOICEVOX,
      apiKeyYoutube,
      speed,
      latestOnlyMode: newMode,
    } = request;
    latestOnlyMode = newMode; // モード設定を保存

    if (!apiKeyYoutube) {
      sendResponse({
        status: "error",
        message: "YouTube APIキーが入力されていません。",
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

      // 0.2: タブIDを保存
      activeTabId = tabs[0].id;

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

      sendStatus("connecting"); // 1.0

      fetch(
        `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=liveStreamingDetails,snippet&key=${apiKeyYoutube}`
      )
        .then((response) => response.json())
        .then((data) => {
          // デバッグ情報をコンソールに出力
          console.log("YouTube API Response:", data);
          console.log("Video Details:", data.items?.[0]);
          console.log(
            "LiveStreamingDetails:",
            data.items?.[0]?.liveStreamingDetails
          );

          if (!data.items || data.items.length === 0) {
            throw new Error("動画情報が見つかりません。");
          }

          const videoDetails = data.items[0];

          if (!videoDetails.liveStreamingDetails) {
            throw new Error("この動画はライブ配信ではありません。");
          }

          // デバッグ情報をポップアップに表示
          const debugInfo = `
            Video ID: ${videoId}
            Is Live: ${!!videoDetails.liveStreamingDetails.activeLiveChatId}
            LiveStreamingDetails: ${JSON.stringify(
              videoDetails.liveStreamingDetails,
              null,
              2
            )}
          `;
          chrome.runtime.sendMessage({
            action: "debugInfo",
            message: debugInfo,
          });

          liveChatId = videoDetails.liveStreamingDetails.activeLiveChatId;
          if (!liveChatId) {
            const error = new Error(
              "このライブ配信ではチャットを取得できません。チャットが無効になっている可能性があります。"
            );
            error.details = videoDetails.liveStreamingDetails;
            throw error;
          }

          startFetchingComments(
            apiKeyVOICEVOX,
            apiKeyYoutube,
            speed,
            activeTabId,
            true
          );
          sendStatus("listening"); // 1.0
          sendResponse({ status: "success" });
        })
        .catch((error) => {
          console.error("YouTube APIリクエストエラー:", error);
          console.error("エラー詳細:", error.details);
          sendStatus("error", error.message); // 1.0
          sendResponse({
            status: "error",
            message: error.message,
            details: error.details
              ? JSON.stringify(error.details, null, 2)
              : undefined,
          });
        });

      return true;
    });
  } else if (request.action === "stop") {
    stopFetchingComments();
    sendResponse({ status: "success" });
    return true;
  } else if (request.action === "updateLatestOnlyMode") {
    latestOnlyMode = request.latestOnlyMode;

    // コメントキューをクリア（モード切替時に古いキューを消去）
    if (latestOnlyMode) {
      commentQueue = [];
    }

    // 現在のタイムスタンプを更新（新しいモードでの基準点として使用）
    latestTimestamp = Date.now();

    sendResponse({ status: "success" });
    return true;
  } else if (request.action === "updateSpeaker") {
    // コメントキューの話者IDを更新
    commentQueue = commentQueue.map((comment) => {
      return { ...comment, speakerId: request.speakerId };
    });
    sendResponse({ status: "success" });
    return true;
  } else if (request.action === "getStatus") {
    // 1.0: popup再オープン時に現在のステータスを返す
    const currentStatus =
      intervalId !== null || commentIntervalId !== null ? "listening" : "idle";
    sendResponse({ status: currentStatus, commentCount });
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
  // 0.4: ポーリング開始時にエラーカウンタをリセット
  consecutiveErrors = 0;
  let latestMessage = "";

  const checkNewComments = () => {
    // 0.3: 毎回最新のnextPageTokenでURLを構築
    const requestUrl = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${liveChatId}&part=snippet,authorDetails&key=${apiKeyYoutube}${
      nextPageToken ? `&pageToken=${nextPageToken}` : ""
    }`;

    fetch(requestUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error("YouTube APIリクエストに失敗しました。");
        }
        return response.json();
      })
      .then((data) => {
        // 0.4: 成功時にエラーカウンタをリセット
        consecutiveErrors = 0;

        if (!data.items || data.items.length === 0) {
          // 新規コメントなし（正常系）- nextPageTokenだけ更新して次のポーリングへ
          chrome.runtime.sendMessage({
            action: "debugInfo",
            message: "新規コメントなし",
          });
          nextPageToken = data.nextPageToken || null;
          return;
        }

        if (isFirstFetch || latestOnlyMode) {
          // 最初の取得または最新のみモードでは最新の1件のみを取得
          let latestItem = data.items[data.items.length - 1];
          let newMessage = latestItem.snippet.displayMessage;
          if (newMessage !== latestMessage) {
            latestMessage = newMessage;
            latestTimestamp = new Date(
              latestItem.snippet.publishedAt
            ).getTime();
            commentQueue.push({ apiKeyVOICEVOX, newMessage, speed, tabId });
          }
          isFirstFetch = false;
        } else {
          // 通常モードでは差分をすべて取得
          data.items.forEach((item) => {
            let newMessage = item.snippet.displayMessage;
            let timestamp = new Date(item.snippet.publishedAt).getTime();

            if (!latestTimestamp || timestamp > latestTimestamp) {
              latestTimestamp = timestamp;
              latestMessage = newMessage;
              commentQueue.push({ apiKeyVOICEVOX, newMessage, speed, tabId });
            }
          });
        }

        nextPageToken = data.nextPageToken || null;
      })
      .catch((error) => {
        // 0.4: エラーカウンタをインクリメント
        consecutiveErrors++;
        console.error("YouTube APIリクエストエラー:", error);
        chrome.runtime.sendMessage({
          action: "debugInfo",
          message: `YouTube APIエラー（${consecutiveErrors}回連続）: ${error.message}`,
        }).catch(() => {});
        sendStatus("error", error.message); // 1.0
      })
      .finally(() => {
        // 0.4: 成功・失敗どちらでも必ずポーリングを再スケジュール
        // 指数バックオフ: 3秒→6秒→12秒→最大30秒
        const delay = Math.min(3000 * Math.pow(2, consecutiveErrors), 30000);
        intervalId = setTimeout(checkNewComments, delay);
      });
  };

  if (!commentIntervalId) {
    commentIntervalId = setInterval(processCommentQueue, 2000);
  }

  checkNewComments();
}

function stopFetchingComments() {
  sessionId++; // 1.0: セッションを無効化（進行中の非同期処理を破棄）
  audioQueue = []; // オーディオキューをクリア
  commentQueue = []; // コメントキューをクリア
  isPlaying = false;
  commentCount = 0; // 1.0: カウントリセット
  sendStatus("idle"); // 1.0

  // 0.1: フェイルセーフタイマーをクリア
  if (playingTimeout) {
    clearTimeout(playingTimeout);
    playingTimeout = null;
  }

  if (intervalId) {
    clearTimeout(intervalId);
    intervalId = null;
  }
  if (commentIntervalId) {
    clearInterval(commentIntervalId);
    commentIntervalId = null;
  }

  // 0.2: activeTabIdを使用して正しいタブの音声を停止
  if (activeTabId) {
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
}

function playNextAudio(tabId) {
  if (isPlaying || audioQueue.length === 0) {
    return;
  }

  const audioUrl = audioQueue.shift();
  isPlaying = true;

  // 0.1: フェイルセーフタイマー（30秒で強制リセット）
  if (playingTimeout) {
    clearTimeout(playingTimeout);
  }
  playingTimeout = setTimeout(() => {
    if (isPlaying) {
      console.warn("音声再生タイムアウト: isPlayingを強制リセット");
      isPlaying = false;
      playNextAudio(activeTabId || tabId);
    }
  }, 30000);

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
          // 0.1: エラー時もフェイルセーフタイマーをクリア
          if (playingTimeout) {
            clearTimeout(playingTimeout);
            playingTimeout = null;
          }
        }
      }
    );
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "audioEnded") {
    isPlaying = false;
    // 0.1: フェイルセーフタイマーをクリア
    if (playingTimeout) {
      clearTimeout(playingTimeout);
      playingTimeout = null;
    }
    if (sender && sender.tab && sender.tab.id) {
      playNextAudio(sender.tab.id);
      sendResponse({ status: "success" });
    }
    return true;
  } else if (request.action === "setVolume" && request.volume !== undefined) {
    // 0.2: activeTabIdを使用
    if (!activeTabId) {
      sendResponse({ status: "error", message: "再生中のタブがありません" });
      return true;
    }
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
    return true;
  } else if (request.action === "setSpeed" && request.speed !== undefined) {
    // 0.2: activeTabIdを使用
    if (!activeTabId) {
      sendResponse({ status: "error", message: "再生中のタブがありません" });
      return true;
    }
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

  const comment = commentQueue.shift();

  // デバッグログにVOICEVOXへのリクエストを表示
  chrome.runtime.sendMessage({
    action: "debugInfo",
    message: `VOICEVOX REQUEST：${comment.newMessage}`,
  });

  // 0.5: リトライ機構付きで音声合成を実行
  synthesizeWithRetry(comment, 0);
}

// 0.5: VOICEVOX APIエラー時のリトライ機構（最大3回）
function synthesizeWithRetry(comment, retryCount) {
  const maxRetries = 3;
  const currentSession = sessionId; // 1.0: 開始時のセッションIDを記録
  const { apiKeyVOICEVOX, newMessage, speed, tabId, speakerId } = comment;

  fetchVoiceVox(apiKeyVOICEVOX, newMessage, speakerId)
    .then((audioUrl) => {
      // 1.0: Stop後に完了した古いリクエストは破棄
      if (sessionId !== currentSession) return;

      // デバッグログにVOICEVOXからのレスポンスを表示
      chrome.runtime.sendMessage({
        action: "debugInfo",
        message: `VOICEVOX RESPONSE：${audioUrl}`,
      });

      audioQueue.push(audioUrl);
      commentCount++; // 1.0
      sendStatus("listening"); // 1.0
      playNextAudio(tabId);
    })
    .catch((error) => {
      // 1.0: Stop後に完了した古いリクエストは破棄
      if (sessionId !== currentSession) return;

      if (retryCount < maxRetries) {
        chrome.runtime.sendMessage({
          action: "debugInfo",
          message: `VOICEVOXリトライ（${retryCount + 1}/${maxRetries}）: ${newMessage}`,
        });
        setTimeout(() => synthesizeWithRetry(comment, retryCount + 1), 1000);
      } else {
        // リトライ上限到達: コメントをスキップ
        chrome.runtime.sendMessage({
          action: "debugInfo",
          message: `VOICEVOXエラー（スキップ）: ${error.message} - "${newMessage}"`,
        });
        console.error("VoiceVoxエラー:", error);
      }
    });
}

// TTS Quest v3 API で音声合成を行い、音声URLを返す
// apiKey は任意（有効なキーがあれば高速処理される）
async function fetchVoiceVox(apiKey, text, speakerId) {
  const encodedText = encodeURIComponent(text);
  const effectiveSpeakerId =
    speakerId ||
    (await chrome.storage.sync.get(["speakerId"])).speakerId ||
    "1";

  let url = `https://api.tts.quest/v3/voicevox/synthesis?text=${encodedText}&speaker=${effectiveSpeakerId}`;
  if (apiKey) {
    url += `&key=${encodeURIComponent(apiKey)}`;
  }

  const response = await fetch(url);

  // レート制限（HTTP 429）
  if (response.status === 429) {
    const data = await response.json();
    const waitMs = (data.retryAfter || 5) * 1000;
    chrome.runtime.sendMessage({
      action: "debugInfo",
      message: `レート制限: ${data.retryAfter || 5}秒待機中...`,
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchVoiceVox(apiKey, text, speakerId);
  }

  if (!response.ok) {
    throw new Error(`TTS Quest API エラー (${response.status})`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.errorMessage || "TTS Quest APIリクエスト失敗");
  }

  // mp3StreamingUrl を優先（ポーリング不要で即時利用可能）
  if (data.mp3StreamingUrl) {
    return data.mp3StreamingUrl;
  }

  // フォールバック: ポーリングして mp3DownloadUrl を使用
  const audioUrl = data.mp3DownloadUrl || data.wavDownloadUrl;
  if (!audioUrl || !data.audioStatusUrl) {
    throw new Error("音声URLが取得できません");
  }
  await waitForAudio(data.audioStatusUrl);
  return audioUrl;
}

// audioStatusUrl をポーリングして音声生成完了を待つ（フォールバック用）
async function waitForAudio(audioStatusUrl, maxAttempts = 30, intervalMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const res = await fetch(audioStatusUrl);
      if (!res.ok) continue;
      const status = await res.json();
      if (status.isAudioError) throw new Error("音声生成エラー");
      if (status.isAudioReady) return;
    } catch (e) {
      if (e.message === "音声生成エラー") throw e;
      continue; // ネットワークエラーは続行
    }
  }
  throw new Error(`音声生成タイムアウト（${maxAttempts}秒）`);
}

// ショートカットキーのリスナーを追加
chrome.commands.onCommand.addListener(function (command) {
  if (command === "start-reading") {
    // 保存されたAPIキーと設定を取得して読み上げを開始
    chrome.storage.sync.get(
      [
        "apiKeyVOICEVOX",
        "apiKeyYoutube",
        "speed",
        "volume",
        "latestOnlyMode",
        "speakerId",
      ],
      function (data) {
        if (!data.apiKeyYoutube) {
          console.error("YouTube APIキーが設定されていません。");
          updateErrorMessage("YouTube APIキーが設定されていません。");
          return;
        }

        chrome.tabs.query(
          { active: true, currentWindow: true },
          function (tabs) {
            if (!tabs || tabs.length === 0) {
              console.error("アクティブなタブが見つかりません。");
              updateErrorMessage("アクティブなタブが見つかりません。");
              return;
            }

            // 0.2: タブIDを保存
            activeTabId = tabs[0].id;

            let videoId;
            const url = new URL(tabs[0].url);

            if (url.hostname === "www.youtube.com") {
              videoId = new URLSearchParams(url.search).get("v");
            } else if (url.hostname === "youtu.be") {
              videoId = url.pathname.slice(1);
            }

            if (!videoId) {
              console.error("ビデオIDが見つかりません。");
              updateErrorMessage("ビデオIDが見つかりません。");
              return;
            }

            sendStatus("connecting"); // 1.0

            fetch(
              `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=liveStreamingDetails,snippet&key=${data.apiKeyYoutube}`
            )
              .then((response) => response.json())
              .then((responseData) => {
                if (!responseData.items || responseData.items.length === 0) {
                  throw new Error("動画情報が見つかりません。");
                }

                const videoDetails = responseData.items[0];

                if (!videoDetails.liveStreamingDetails) {
                  throw new Error("この動画はライブ配信ではありません。");
                }

                liveChatId = videoDetails.liveStreamingDetails.activeLiveChatId;
                if (!liveChatId) {
                  throw new Error(
                    "このライブ配信ではチャットを取得できません。チャットが無効になっている可能性があります。"
                  );
                }

                startFetchingComments(
                  data.apiKeyVOICEVOX,
                  data.apiKeyYoutube,
                  data.speed || 1.0,
                  activeTabId,
                  true
                );

                sendStatus("listening"); // 1.0
                updateErrorMessage("エラーなし");
              })
              .catch((error) => {
                console.error("YouTube APIリクエストエラー:", error);
                sendStatus("error", error.message); // 1.0
                updateErrorMessage(error.message);
              });
          }
        );
      }
    );
  } else if (command === "stop-reading") {
    // 読み上げを停止
    stopFetchingComments();

    // デバッグ情報を送信
    chrome.runtime.sendMessage({
      action: "debugInfo",
      message: "ショートカットキーによる停止コマンドを実行しました",
    });

    // 停止時の状態をクリア
    audioQueue = [];
    commentQueue = [];
    isPlaying = false;

    // 0.2: activeTabIdを使用して現在再生中のオーディオを停止
    if (activeTabId) {
      chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: () => {
          if (window.currentAudio) {
            window.currentAudio.pause();
            window.currentAudio = null;
          }
        },
      });
    }

    // 停止メッセージを表示
    updateErrorMessage("停止しました");
  }
});

// エラーメッセージをポップアップに表示する関数
function updateErrorMessage(message) {
  chrome.runtime.sendMessage({
    action: "updateErrorMessage",
    message: message,
  }).catch(() => {});
}

// 1.0: ステータス情報をポップアップに送信する関数
function sendStatus(status, message = "") {
  chrome.runtime.sendMessage({
    action: "updateStatus",
    status,
    message,
    commentCount,
  }).catch(() => {});
}
