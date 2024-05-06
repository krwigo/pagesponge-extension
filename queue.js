function queueRefresh(queue) {
  if (!Array.isArray(queue)) return;
  const listEl = document.querySelector("#queueList tbody");
  listEl.replaceChildren();
  for (const job of queue) {
    let tr = document.createElement("TR");
    let status = document.createElement("TD");
    status.textContent = job?.status;
    let url = document.createElement("TD");
    let a = document.createElement("A");
    a.textContent = job?.url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.href = job?.url;
    url.appendChild(a);
    let fails = document.createElement("TD");
    if (job?.status != "complete") fails.textContent = job?.fails || 0;
    let reason = document.createElement("TD");
    if (job?.status != "complete") reason.textContent = job?.failReason;
    let actions = document.createElement("TD");
    actions.textContent = null;
    let removeBtn = document.createElement("BUTTON");
    removeBtn.textContent = "Remove";
    (function (job) {
      removeBtn.addEventListener("click", function (e) {
        chrome.runtime
          .sendMessage({ cmd: "queueRemoveUUID", uuid: job?.uuid })
          .then(console.log, console.warn);
      });
    })(job);
    tr.appendChild(status);
    tr.appendChild(url);
    tr.appendChild(fails);
    tr.appendChild(reason);
    tr.appendChild(actions);
    actions.appendChild(removeBtn);
    listEl.appendChild(tr);
  }
}

document.querySelector("#bulkAdd").addEventListener("click", (ev) => {
  // note: firefox permissions
  chrome.permissions
    .request({ origins: ["<all_urls>"] })
    .then(function (success) {
      if (!success) return alert("Insufficient permissions to continue.");
      const textEl = document.querySelector("#bulkText");
      const urls = Array.from(textEl.value.matchAll(/\w+:\/\/[^\r\n]+/g))
        .map((v) => v?.[0])
        .filter((v) => v?.trim)
        .map((v) => v.trim())
        .filter((v) => URL.canParse(v))
        .map((v) => new URL(v).toString());
      if (urls?.length) {
        chrome.runtime
          .sendMessage({ cmd: "bulkAdd", urls })
          .then(console.log, console.warn);
      } else {
        alert("No URLs added.");
      }
    });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (changes?.queue?.newValue) queueRefresh(changes?.queue?.newValue);
});

chrome.storage.local.get(["queue"]).then(({ queue }) => {
  queueRefresh(queue);
});

document.querySelector("#removeAll").addEventListener("click", (ev) => {
  chrome.runtime
    .sendMessage({ cmd: "queueRemoveAll" })
    .then(console.log, console.warn);
});

document.querySelector("#removeComplete").addEventListener("click", (ev) => {
  chrome.runtime
    .sendMessage({ cmd: "queueRemoveComplete" })
    .then(console.log, console.warn);
});

document.querySelector("#resetFailAll").addEventListener("click", (ev) => {
  chrome.runtime
    .sendMessage({ cmd: "resetFailAll" })
    .then(console.log, console.warn);
});
