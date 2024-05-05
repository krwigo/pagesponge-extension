// Description.
//
// The controller (gController) handles text extraction and upload from the popup [Sponge] and queue [Bulk Add] buttons.
// To prevent multiple threads from writing to localStorage, the controller acts as a change queue to make changes and spawn jobs.
// Text is immediately available when the Sponge button is used, unlike Bulk Add which must create a new tab.

// Permissions:
// scripting: executeScript runs pageTextFunc() to extract text nodes from tabs.
// storage: localStorage keeps persistent jobs in the queue.
// webRequest: detect 4xx and 5xx http statuses when extracting text.

// Sponge & Bulk Add buttons => Runtime Messaging
// Queue & Popup buttons => Runtime Messaging
// Runtime Messaging => gController {pending changes}
// gController => start Job(s)
// jobExtractText => tabs.create => pageTextFunc() => Runtime Messaging
// jobUploadText => fetch() => Runtime Messaging

// Settings:
//
const wakeDelay = 5 * 1000; // delay after boot before loading the queue.
const textDelay = 5 * 1000; // delay after page loaded before extracting text.
const queueTimeout = 60 * 1000; // max timeout before a job fails.
const maxRetries = 3; // max number of automatic job retries.
const maxConcurrency = 3; // max number of concurrent jobs.
const denyNodeNames = ["NOSCRIPT", "SCRIPT", "STYLE"]; // exract text ignored nodes.

// Globals:
//
const gManifest = {};

chrome.management.getSelf(function (info) {
  Object.assign(
    gManifest,
    { isDev: ["development", "sideload"].includes(info?.installType) },
    // { version: info?.version },
    // info,
  );
  console.log("gManifest:", gManifest);
  // wakeup (boot)
  setTimeout(gController.apply, wakeDelay);
});

// Helpers:
//
function uuid() {
  return [Date.now(), Math.random()].join();
}

function pageTextFunc({ cmd, uuid, url, textDelay, denyNodeNames }) {
  console.log("pageTextFunc()");
  function rec(el, text = "") {
    for (const ch of el.childNodes) {
      if (
        ch.nodeType == Node.TEXT_NODE &&
        !denyNodeNames.includes(ch?.parentElement?.nodeName)
      ) {
        text += ch.nodeValue;
      } else if (ch.nodeType == Node.ELEMENT_NODE) {
        text += rec(ch);
      }
    }
    return text;
  }
  if (!url) url = window.location?.href;
  setTimeout(function () {
    let text = rec(document.body)
      .replaceAll(/[\r\n\t]/g, " ")
      .replaceAll(/\s{2,}/g, " ")
      .trim();
    console.log("pageTextFunc():", { cmd, uuid, url, text });
    chrome.runtime.sendMessage({ cmd, uuid, url, text });
  }, textDelay);
}

// Jobs:
//
function jobExtractText(job) {
  return new Promise(function (resolve, reject) {
    let _tabId;
    function onMessage(message, sender, sendResponse) {
      console.log("jobExtractText.onMessage:", { message, sender });
      if (sender?.tab?.id == _tabId && message?.cmd == "queueText") {
        destroy();
        resolve({
          cmd: "extractSuccess",
          uuid: job?.uuid,
          text: message?.text,
        });
      }
    }
    function onHeaders(details) {
      if (/^[45]/.test(details?.statusCode)) {
        console.log("jobExtractText.onHeaders:", details);
        destroy();
        reject({
          cmd: "extractFailure",
          uuid: job?.uuid,
          result: `page error: '${details?.statusLine || details?.statusCode}'`,
        });
      }
    }
    function onUpdated(tabId, changeInfo, tab) {
      console.log("jobExtractText.onUpdated:", { changeInfo });
      if (tabId == _tabId && changeInfo?.status == "complete") {
        console.log("jobExtractText.executeScript()");
        chrome.scripting
          .executeScript({
            target: { tabId },
            func: pageTextFunc,
            args: [
              { cmd: "queueText", uuid: job?.uuid, textDelay, denyNodeNames },
            ],
          })
          .then(console.log, console.warn);
      }
    }
    function onRemoved(tabId, removeInfo) {
      if (tabId == _tabId) {
        destroy();
        reject({
          cmd: "extractFailure",
          uuid: job?.uuid,
          result: "page closed",
        });
      }
    }
    function onTimeout(tabId) {
      if (tabId == _tabId) {
        destroy();
        reject({
          cmd: "extractFailure",
          uuid: job?.uuid,
          result: "page timeout",
        });
      }
    }
    function destroy() {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.webRequest.onHeadersReceived.removeListener(onHeaders);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.remove(_tabId).then(console.log, console.warn);
    }
    chrome.tabs
      .create({ url: job?.url, active: false })
      .then(function (tab) {
        _tabId = tab?.id;
        chrome.runtime.onMessage.addListener(onMessage);
        chrome.webRequest.onHeadersReceived.addListener(onHeaders, {
          urls: [job?.url],
          tabId: _tabId,
        });
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.onRemoved.addListener(onRemoved);
        setTimeout(onTimeout, queueTimeout);
      })
      .catch(function (e) {
        destroy();
        reject({
          cmd: "extractFailure",
          uuid: job?.uuid,
          result: `tab failure: '${e}'`,
        });
      });
  });
}

function jobUploadText(job) {
  return new Promise(function (resolve, reject) {
    fetch("https://pagesponge.com/api/post", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: job?.url,
        text: job?.text,
        manifest: gManifest,
      }),
    })
      .then((e) => e.json())
      .then((e) =>
        resolve({
          cmd: "uploadSuccess",
          uuid: job?.uuid,
          result: e,
        }),
      )
      .catch((e) =>
        reject({
          cmd: "uploadFailure",
          uuid: job?.uuid,
          result: e,
        }),
      );
  });
}

// gLoader: singleton for activity indicators.
//
const gLoader = (function () {
  const loaderFrames = Array(7)
    .fill()
    .map((_, i) => `/loader-1-${i + 1}.png`);
  let loaderId,
    loaderFrame = loaderFrames.length;
  function set(busy) {
    if (!busy && loaderId) {
      loaderId = clearInterval(loaderId);
      chrome.action.setIcon({ path: "/icon-128.png" });
    }
    if (busy && !loaderId) {
      loaderId = setInterval(function () {
        loaderFrame = (loaderFrame + 1) % loaderFrames.length;
        chrome.action.setIcon({ path: loaderFrames[loaderFrame] });
      }, 1000 / loaderFrames.length);
    }
    console.log("gLoader:", !!loaderId);
  }
  return { set };
})();

// gController: singleton for changing localStorage.
//
const gController = (function () {
  let busy = false;
  let promises = {};
  let changes = [];
  //
  function apply() {
    if (busy) return;
    busy = true;
    // load from storage
    chrome.storage.local.get(["queue"]).then(function ({ queue }) {
      console.log("gController.load:", queue);
      // verify data types
      if (!Array.isArray(queue)) queue = [];
      // filter old jobs without a uuid
      queue = queue.filter((job) => job?.uuid);
      // process storage changes
      let change;
      while ((change = changes.shift())) {
        console.log("gController.apply:", change);
        if (change?.cmd == "spongeText") {
          queue.push({
            uuid: uuid(),
            url: String(change?.url || ""),
            text: String(change?.text || ""),
            status: "initial",
            fails: 0,
            failReason: "",
            dateCreated: Date.now(),
            dateCompleted: null,
          });
        } else if (change?.cmd == "bulkAdd") {
          for (let url of change?.urls) {
            if (queue.find((obj) => obj.url == url)) {
              // ignore duplicate url during bulkAdd
              continue;
            }
            queue.push({
              uuid: uuid(),
              url: url,
              text: "",
              status: "initial",
              fails: 0,
              failReason: "",
              dateCreated: Date.now(),
              dateCompleted: null,
            });
          }
        } else if (change?.cmd == "extractSuccess") {
          let job = queue.find((obj) => obj?.uuid == change?.uuid);
          if (job) {
            job.text = change?.text;
            job.status = change?.cmd;
          }
        } else if (change?.cmd == "extractFailure") {
          let job = queue.find((obj) => obj?.uuid == change?.uuid);
          if (job) {
            job.fails = job?.fails || 0;
            job.fails += 1;
            job.failReason = String(change?.result);
            job.status = change?.cmd;
          }
        } else if (change?.cmd == "uploadSuccess") {
          let job = queue.find((obj) => obj?.uuid == change?.uuid);
          if (job) {
            job.status = change?.cmd;
            job.status = "complete";
            job.dateCompleted = Date.now();
          }
        } else if (change?.cmd == "uploadFailure") {
          let job = queue.find((obj) => obj?.uuid == change?.uuid);
          if (job) {
            job.fails = job?.fails || 0;
            job.fails += 1;
            job.failReason = "upload failure";
            job.status = change?.cmd;
          }
        } else if (change?.cmd == "queueRemoveUUID") {
          queue = queue.filter((job) => job?.uuid != change?.uuid);
        } else if (change?.cmd == "queueRemoveComplete") {
          queue = queue.filter((job) => job?.status != "complete");
        } else if (change?.cmd == "queueRemoveAll") {
          queue = [];
        } else if (change?.cmd == "resetFailAll") {
          for (let job of queue) {
            if (job?.status != "complete") {
              job.fails = 0;
              job.failReason = "";
              job.status = "initial";
            }
          }
        } else if (change) {
          console.warn("unknownChange:", change);
        }
      }
      // save to storage
      chrome.storage.local.set({ queue }).then(function () {
        console.log("gController.save:", queue);
        // start job(s)
        for (let job of queue) {
          if (
            // success
            job?.status == "complete" ||
            // failure
            (job?.fails || 0) >= maxRetries ||
            // active
            promises[job?.uuid]
          ) {
            continue;
          }
          if (Object.keys(promises).length >= maxConcurrency) {
            // busy
            break;
          }
          console.log("gController.job:", job?.uuid, !!job?.text, job);
          if (!job?.text) {
            // create tab and extract text
            promises[job?.uuid] = jobExtractText(job)
              .then(function (r) {
                console.log("jobExtractText.then:", r);
                delete promises[r?.uuid];
                gController.push(r);
              })
              .catch(function (r) {
                console.log("jobExtractText.catch:", r);
                delete promises[r?.uuid];
                gController.push(r);
              });
            continue;
          }
          if (job?.text) {
            // upload text
            promises[job?.uuid] = jobUploadText(job)
              .then(function (r) {
                console.log("jobUploadText.then:", r);
                delete promises[r?.uuid];
                gController.push(r);
              })
              .catch(function (r) {
                console.log("jobUploadText.catch:", r);
                delete promises[r?.uuid];
                gController.push(r);
              });
            continue;
          }
        }
        //
        busy = false;
        gLoader.set(!!Object.keys(promises).length);
        if (changes?.length) setTimeout(gController.apply);
      }); //set
    }); //get
  }
  function push(change) {
    console.log("gController.push:", change);
    apply(changes.push(change));
  }
  return { apply, push };
})();

// Messaging:
//
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  console.log("runtime.onMessage:", { message, sender });
  let { cmd } = message;
  if (cmd == "sponge") {
    chrome.scripting
      .executeScript({
        target: { tabId: message?.tabId },
        func: pageTextFunc,
        args: [{ cmd: "spongeText", textDelay, denyNodeNames }],
      })
      .then(console.log, console.warn);
  } else {
    gController.push(message);
  }
});

// Omnibox:
//
chrome.omnibox.setDefaultSuggestion({
  description: "Type the prompt for matching URL(s)",
});

chrome.omnibox.onInputEntered.addListener(function (text, disposition) {
  chrome.tabs.update({ url: `https://pagesponge.com/?q=${text}` });
});
