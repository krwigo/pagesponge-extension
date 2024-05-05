for (const el of document.querySelectorAll(".sponge")) {
  el.addEventListener("click", (ev) => {
    // query active tab
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      let tabId = tabs?.[0]?.id;
      if (tabId)
        // notify background for injection
        chrome.runtime
          .sendMessage({ cmd: "sponge", tabId })
          .then(console.log, console.warn);
    });
  });
}

document.querySelector("#queue").addEventListener("click", (ev) => {
  // open queue.html in a new tab
  chrome.tabs
    .create({ url: chrome.runtime.getURL("queue.html") })
    .then(console.log, console.warn);
});

const promptEl = document.querySelector("#prompt");
const searchEl = document.querySelector("#search");

promptEl.addEventListener("keyup", function (event) {
  // invoke search on enter
  if (event?.key === "Enter") {
    searchEl.click();
  }
});

searchEl.addEventListener("click", (ev) => {
  let prompt = String(promptEl.value || "");
  // open queue.html in a new tab
  chrome.tabs
    .create({ url: `https://pagesponge.com/?q=${prompt}` })
    .then(console.log, console.warn);
});

promptEl.focus();
