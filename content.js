function isValidSubmission(payload) {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    /^\d+$/.test(String(payload.questionId ?? "")) &&
    typeof payload.problemTitle === "string" &&
    payload.problemTitle.trim().length > 0 &&
    payload.problemTitle.length <= 200 &&
    typeof payload.language === "string" &&
    /^[a-zA-Z0-9+#.-]{1,32}$/.test(payload.language) &&
    typeof payload.code === "string" &&
    payload.code.length > 0 &&
    payload.code.length <= 500_000 &&
    (payload.description === undefined ||
      (typeof payload.description === "string" && payload.description.length <= 100_000))
  );
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (event.data?.type !== "leetcode_submission" || !isValidSubmission(event.data.payload)) return;

  chrome.runtime.sendMessage({
    type: "push_to_github",
    payload: event.data.payload,
  }).catch((error) => {
    console.error("LeetWithGit could not queue this submission:", error);
  });
});
