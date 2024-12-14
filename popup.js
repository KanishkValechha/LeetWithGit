document.getElementById("save").addEventListener("click", async () => {
  const token = document.getElementById("github-token").value;
  const repo = document.getElementById("repo-name").value;
  const branch = document.getElementById("branch-name").value || "main";

  if (!token || !repo) {
    showStatus("Please fill in all required fields", false);
    return;
  }

  try {
    await chrome.storage.sync.set({
      githubToken: token,
      repoName: repo,
      branchName: branch,
      debugMode: true, // Added debug mode for extra logging
    });
    showStatus("Settings saved successfully! Reload LeetCode page.", true);
  } catch (error) {
    showStatus("Error saving settings", false);
  }
});

function showStatus(message, isSuccess) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.className = `status ${isSuccess ? "success" : "error"}`;
}
