const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

document.getElementById("save").addEventListener("click", saveSettings);
document.getElementById("test-connection").addEventListener("click", testConnection);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.lastSyncStatus) renderSyncStatus(changes.lastSyncStatus.newValue);
});

async function loadSettings() {
  const [local, synced] = await Promise.all([
    chrome.storage.local.get(["githubToken", "lastSyncStatus"]),
    chrome.storage.sync.get(["repoName", "branchName", "githubToken"]),
  ]);

  // Migrate tokens saved by older versions out of sync storage. Never repopulate
  // the password input, so the token cannot be exposed by opening the popup.
  if (!local.githubToken && synced.githubToken) {
    await chrome.storage.local.set({ githubToken: synced.githubToken });
    local.githubToken = synced.githubToken;
  }
  if (synced.githubToken) await chrome.storage.sync.remove("githubToken");

  document.getElementById("repo-name").value = synced.repoName || "";
  document.getElementById("branch-name").value = synced.branchName || "";
  document.getElementById("token-state").textContent = local.githubToken
    ? "A token is saved on this browser. Leave this field blank to keep it."
    : "No token saved yet. It is kept on this browser and is not synced.";
  renderSyncStatus(local.lastSyncStatus);
}

async function saveSettings() {
  const tokenInput = document.getElementById("github-token");
  const token = tokenInput.value.trim();
  const repoName = document.getElementById("repo-name").value.trim();
  const branchName = document.getElementById("branch-name").value.trim() || "main";

  if (!REPOSITORY_PATTERN.test(repoName)) {
    showStatus("Enter a repository as OWNER/REPOSITORY.", false);
    return;
  }

  const saved = await chrome.storage.local.get("githubToken");
  if (!token && !saved.githubToken) {
    showStatus("Add a GitHub token before saving settings.", false);
    return;
  }

  setBusy(true);
  try {
    if (token) await chrome.storage.local.set({ githubToken: token });
    await chrome.storage.sync.set({ repoName, branchName });
    tokenInput.value = "";
    document.getElementById("token-state").textContent = "A token is saved on this browser. Leave this field blank to keep it.";
    showStatus("Settings saved. Testing the connection is recommended.", true);
    chrome.runtime.sendMessage({ type: "process_pending_submissions" }).catch(() => {});
  } catch (error) {
    showStatus(`Could not save settings: ${error.message}`, false);
  } finally {
    setBusy(false);
  }
}

async function testConnection() {
  const tokenInput = document.getElementById("github-token");
  const repoName = document.getElementById("repo-name").value.trim();
  const branchName = document.getElementById("branch-name").value.trim() || "main";
  if (!REPOSITORY_PATTERN.test(repoName)) {
    showStatus("Enter a repository as OWNER/REPOSITORY.", false);
    return;
  }

  const stored = await chrome.storage.local.get("githubToken");
  const token = tokenInput.value.trim() || stored.githubToken;
  if (!token) {
    showStatus("Enter a GitHub token to test the connection.", false);
    return;
  }

  setBusy(true);
  showStatus("Checking token, repository, and branch…", null);
  try {
    const repository = await githubGet(`https://api.github.com/repos/${repoName}`, token);
    await githubGet(`https://api.github.com/repos/${repoName}/branches/${encodeURIComponent(branchName)}`, token);
    if (repository.permissions?.push === false) {
      throw new Error("The token can read this repository but does not have write access.");
    }
    showStatus(`Connection works. Repository and branch “${branchName}” are accessible. Confirm the token has Contents: Read and write to upload solutions.`, true);
  } catch (error) {
    showStatus(`Connection check failed: ${error.message}`, false);
  } finally {
    setBusy(false);
  }
}

async function githubGet(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    // Use the HTTP status if an intermediary returned a non-JSON response.
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("GitHub rejected the token. Check that it is active.");
    if (response.status === 404) throw new Error("Repository or branch was not found, or the token cannot access it.");
    throw new Error(data.message || `GitHub returned HTTP ${response.status}.`);
  }
  return data;
}

function renderSyncStatus(syncStatus) {
  const element = document.getElementById("sync-status");
  if (!syncStatus?.message) {
    element.textContent = "";
    element.className = "status";
    return;
  }
  element.textContent = `Latest sync: ${syncStatus.message}`;
  element.className = `status ${syncStatus.status === "success" ? "success" : "neutral"}`;
}

function showStatus(message, isSuccess) {
  const element = document.getElementById("status");
  element.textContent = message;
  element.className = `status ${isSuccess === null ? "neutral" : isSuccess ? "success" : "error"}`;
}

function setBusy(busy) {
  for (const id of ["save", "test-connection"]) {
    document.getElementById(id).disabled = busy;
  }
}

loadSettings().catch((error) => showStatus(`Could not load settings: ${error.message}`, false));
