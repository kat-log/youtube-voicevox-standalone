chrome.action.onClicked.addListener((tab) => {
  fetch("https://voicevox.su-shiki.com/su-shikiapis/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: "こんにちは",
    }),
  })
    .then((response) => response.blob())
    .then((blob) => {
      let url = URL.createObjectURL(blob);
      let audio = new Audio(url);
      audio.play();
    });
});
