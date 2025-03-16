window.addEventListener("message", (event) => {
  // Ensure the message is from the correct source
  if (event.source !== window || !event.data.type) return;

  if (event.data.type === "leetcode_submission") {
      chrome.runtime.sendMessage({
          type: "push_to_github",
          payload: event.data.payload
      });
  }
});
