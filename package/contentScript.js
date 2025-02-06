// contentScript.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "playAudio" && request.audioUrl) {
    let audio = new Audio(request.audioUrl);
    audio
      .play()
      .then(() => {
        sendResponse({ status: "success" });
      })
      .catch((error) => {
        sendResponse({ status: "error", message: error.message });
      });
    return true; // Indicates asynchronous response.
  }
});
