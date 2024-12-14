chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message.type);

  if (message.type === "debug") {
    console.log("Debug:", message.message);
    return;
  }

  if (message.type === "push_to_github") {
    handleGitHubPush(message.payload);
  }
});

async function handleGitHubPush(payload) {
  try {
    console.log("Attempting GitHub push for:", payload.problemTitle);

    // Retrieve settings
    const settings = await chrome.storage.sync.get([
      "githubToken",
      "repoName",
      "branchName",
      "debugMode",
    ]);

    if (!settings.githubToken || !settings.repoName) {
      console.error("GitHub settings not configured");
      return;
    }

    // Create language-specific filename
    const fileName = `${payload.problemTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")}.${payload.language}`;

    const fileContent = `/*
 * ${payload.problemTitle}
 * Difficulty: ${payload.difficulty}
 * 
 * ${payload.description}
 */

${payload.code}`;

    const apiUrl = `https://api.github.com/repos/${settings.repoName}/contents/leetcode/${fileName}`;

    const response = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        Authorization: `token ${settings.githubToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({
        message: `Add LeetCode solution: ${fileName}`,
        content: btoa(unescape(encodeURIComponent(fileContent))),
        branch: settings.branchName || "main",
      }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      throw new Error(
        `GitHub API error: ${response.status} - ${JSON.stringify(responseData)}`
      );
    }

    console.log("Successfully pushed to GitHub");

    // Chrome notification
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon48.png",
      title: "LeetWithGit",
      message: `Successfully pushed ${payload.problemTitle} to GitHub!`,
    });
  } catch (error) {
    console.error("GitHub push error:", error);

    // Error notification
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon48.png",
      title: "LeetWithGit Error",
      message: `Failed to push solution: ${error.message}`,
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("LeetWithGit extension installed");
});
