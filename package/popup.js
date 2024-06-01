document.getElementById("play").addEventListener("click", () => {
  const apiKey = document.getElementById("apikey").value;
  chrome.runtime.sendMessage({ apiKey: apiKey }, function (response) {
    if (response.status === "success") {
      let audio = new Audio(response.audioUrl);
      audio.play();
    } else {
      console.error("Error: ", response.message);
    }
  });
});
