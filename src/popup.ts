const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

requirePopupElement<HTMLButtonElement>("save").addEventListener("click", saveSettings);
requirePopupElement<HTMLButtonElement>("test-connection").addEventListener("click", testConnection);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.lastSyncStatus) {
    renderSyncStatus(changes.lastSyncStatus.newValue as SyncStatus | undefined);
  }
});

function requirePopupElement<TElement extends HTMLElement>(id: string): TElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Popup element “${id}” is missing.`);
  return element as TElement;
}

async function loadSettings(): Promise<void> {
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

  requirePopupElement<HTMLInputElement>("repo-name").value = synced.repoName || "";
  requirePopupElement<HTMLInputElement>("branch-name").value = synced.branchName || "";
  requirePopupElement("token-state").textContent = local.githubToken
    ? "A token is saved on this browser. Leave this field blank to keep it."
    : "No token saved yet. It is kept on this browser and is not synced.";
  renderSyncStatus(local.lastSyncStatus);
}

async function saveSettings(): Promise<void> {
  const tokenInput = requirePopupElement<HTMLInputElement>("github-token");
  const token = tokenInput.value.trim();
  const repoName = requirePopupElement<HTMLInputElement>("repo-name").value.trim();
  const branchName = requirePopupElement<HTMLInputElement>("branch-name").value.trim() || "main";

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
    requirePopupElement("token-state").textContent = "A token is saved on this browser. Leave this field blank to keep it.";
    showStatus("Settings saved. Testing the connection is recommended.", true);
    chrome.runtime.sendMessage({ type: "process_pending_submissions" }).catch(() => {});
  } catch (error: unknown) {
    showStatus(`Could not save settings: ${popupErrorMessage(error)}`, false);
  } finally {
    setBusy(false);
  }
}

async function testConnection(): Promise<void> {
  const tokenInput = requirePopupElement<HTMLInputElement>("github-token");
  const repoName = requirePopupElement<HTMLInputElement>("repo-name").value.trim();
  const branchName = requirePopupElement<HTMLInputElement>("branch-name").value.trim() || "main";
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
    const repository = await githubGet<GitHubRepositoryResponse>(`https://api.github.com/repos/${repoName}`, token);
    await githubGet<Record<string, unknown>>(
      `https://api.github.com/repos/${repoName}/branches/${encodeURIComponent(branchName)}`,
      token,
    );
    if (repository.permissions?.push === false) {
      throw new Error("The token can read this repository but does not have write access.");
    }
    showStatus(`Connection works. Repository and branch “${branchName}” are accessible. Confirm the token has Contents: Read and write to upload solutions.`, true);
  } catch (error: unknown) {
    showStatus(`Connection check failed: ${popupErrorMessage(error)}`, false);
  } finally {
    setBusy(false);
  }
}

async function githubGet<TResponse extends object>(url: string, token: string): Promise<TResponse> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  let data: unknown = {};
  try {
    data = await response.json() as unknown;
  } catch {
    // Use the HTTP status if an intermediary returned a non-JSON response.
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("GitHub rejected the token. Check that it is active.");
    if (response.status === 404) throw new Error("Repository or branch was not found, or the token cannot access it.");
    const message = isPopupRecord(data) && typeof data.message === "string" ? data.message : `GitHub returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return data as TResponse;
}

function isPopupRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function renderSyncStatus(syncStatus: SyncStatus | undefined): void {
  const element = requirePopupElement("sync-status");
  if (!syncStatus?.message) {
    element.textContent = "";
    element.className = "status";
    return;
  }
  element.textContent = `Latest sync: ${syncStatus.message}`;
  element.className = `status ${syncStatus.status === "success" ? "success" : "neutral"}`;
}

function showStatus(message: string, isSuccess: boolean | null): void {
  const element = requirePopupElement("status");
  element.textContent = message;
  element.className = `status ${isSuccess === null ? "neutral" : isSuccess ? "success" : "error"}`;
}

function setBusy(busy: boolean): void {
  for (const id of ["save", "test-connection"]) {
    requirePopupElement<HTMLButtonElement>(id).disabled = busy;
  }
}

function popupErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

loadSettings().catch((error: unknown) => showStatus(`Could not load settings: ${popupErrorMessage(error)}`, false));
