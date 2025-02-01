

let isInitialized = false;

document.addEventListener("DOMContentLoaded", () => {
  if (isInitialized) return;
  isInitialized = true;

  // New: Force check auth status on every popup open
  chrome.runtime.sendMessage({ type: "force_refresh" }, checkAuthStatus);
});

// Update message listener
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "auth_complete") {
    accessToken = message.token;
    loadUserData().then(showRepoContainer);
  }
});

document.getElementById("debug-btn").addEventListener("click", () => {
  chrome.storage.sync.get("githubToken", (data) => {
    console.log("Stored Token:", data.githubToken);
  });
  chrome.storage.local.get("deviceFlow", (data) => {
    console.log("Device Flow State:", data.deviceFlow);
  });
});
// popup.js
document.addEventListener("DOMContentLoaded", () => {
  // DOM elements
  const authContainer = document.getElementById("auth-container");
  const repoContainer = document.getElementById("repo-container");
  const authButton = document.getElementById("github-auth");
  const verificationCode = document.getElementById("verification-code");
  const verificationInstructions = document.getElementById(
    "verification-instructions"
  );
  const openGitHubButton = document.getElementById("open-github");
  const logoutButton = document.getElementById("logout");
  const userAvatar = document.getElementById("user-avatar");
  const userName = document.getElementById("user-name");
  const repoSearch = document.getElementById("repo-search");
  const repoList = document.getElementById("repo-list");
  const branchInput = document.getElementById("branch-name");
  const saveButton = document.getElementById("save");
  const statusDiv = document.getElementById("status");

  let accessToken = "";
  let userRepos = [];

  // Initial setup
  checkAuthStatus();

  // Event listeners
  authButton.addEventListener("click", startAuthFlow);
  openGitHubButton.addEventListener("click", openGitHubVerification);
  logoutButton.addEventListener("click", logout);
  repoSearch.addEventListener("input", filterRepos);
  saveButton.addEventListener("click", saveSettings);

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.githubToken || changes.deviceFlow || changes.authError) {
      checkAuthStatus();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "auth_success") {
      checkAuthStatus();
    }
  });

  async function checkAuthStatus() {
    try {
      // Clear previous state
      resetAuthUI();

      // Check for existing token
      const { githubToken } = await chrome.storage.sync.get("githubToken");

      if (githubToken) {
        accessToken = githubToken;
        if (await validateToken()) {
          await loadUserData();
          showRepoContainer();
          return;
        }
      }

      // Check for active device flow
      const { deviceFlow } = await chrome.storage.local.get("deviceFlow");
      if (deviceFlow) {
        showVerificationUI(deviceFlow);
      } else {
        showAuthContainer();
      }
    } catch (error) {
      console.error("Auth check error:", error);
      showStatus("Authentication check failed", false);
      showAuthContainer();
    }
  }

  function startAuthFlow() {
    chrome.runtime.sendMessage({ type: "start_device_flow" });
  }

  function showVerificationUI(deviceFlow) {
    verificationCode.textContent = deviceFlow.userCode;
    verificationCode.style.display = "block";
    verificationInstructions.style.display = "block";
    openGitHubButton.style.display = "block";
    openGitHubButton.setAttribute("data-url", deviceFlow.verificationUri);
    authButton.style.display = "none";
  }

  async function validateToken() {
    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `token ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      // Add debug logging
      console.log("Token validation status:", response.status);
      return response.ok;
    } catch (error) {
      console.error("Validation error:", error);
      return false;
    }
  }

  async function loadUserData() {
    try {
      const [userResponse, reposResponse] = await Promise.all([
        fetch("https://api.github.com/user", {
          headers: {
            Authorization: `token ${accessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        }),
        fetch("https://api.github.com/user/repos?sort=updated&per_page=100", {
          headers: {
            Authorization: `token ${accessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        }),
      ]);

      const userData = await userResponse.json();
      userAvatar.src = userData.avatar_url;
      userName.textContent = userData.login;

      userRepos = await reposResponse.json();
      displayRepos(userRepos);
    } catch (error) {
      showStatus("Failed to load user data", false);
      logout();
    }
  }

  function displayRepos(repos) {
    repoList.innerHTML = repos
      .map(
        (repo) => `
      <div class="repo-item" data-repo="${repo.full_name}">
        ${repo.full_name}
      </div>
    `
      )
      .join("");

    repoList.querySelectorAll(".repo-item").forEach((item) => {
      item.addEventListener("click", () => selectRepo(item.dataset.repo));
    });
  }

  function selectRepo(repoName) {
    repoList.querySelectorAll(".repo-item").forEach((item) => {
      item.style.backgroundColor =
        item.dataset.repo === repoName ? "#e7f7ed" : "";
    });
  }

  function filterRepos(event) {
    const searchTerm = event.target.value.toLowerCase();
    repoList.querySelectorAll(".repo-item").forEach((item) => {
      const repoName = item.dataset.repo.toLowerCase();
      item.style.display = repoName.includes(searchTerm) ? "block" : "none";
    });
  }

  function showRepoContainer() {
    authContainer.style.display = "none";
    repoContainer.style.display = "block";
    statusDiv.textContent = "";
  }

  function showAuthContainer() {
    authContainer.style.display = "flex";
    repoContainer.style.display = "none";
  }

  function resetAuthUI() {
    verificationCode.style.display = "none";
    verificationInstructions.style.display = "none";
    openGitHubButton.style.display = "none";
    authButton.style.display = "block";
  }

  function showStatus(message, isSuccess) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${isSuccess ? "success" : "error"}`;
    if (message) setTimeout(() => (statusDiv.textContent = ""), 5000);
  }

  function openGitHubVerification() {
    const url = openGitHubButton.getAttribute("data-url");
    chrome.tabs.create({ url });
  }

  async function saveSettings() {
    try {
      const selectedRepo = repoList.querySelector(
        '.repo-item[style*="background-color"]'
      );
      if (!selectedRepo) throw new Error("Please select a repository");

      const repoName = selectedRepo.dataset.repo;
      const branch = branchInput.value.trim() || "main";

      const response = await fetch(`https://api.github.com/repos/${repoName}`, {
        headers: { Authorization: `token ${accessToken}` },
      });

      if (!response.ok) throw new Error("Repository access denied");

      await chrome.storage.sync.set({ repoName, branchName: branch });
      showStatus("Settings saved successfully!", true);

      chrome.runtime.sendMessage({ type: "settings_updated" });
    } catch (error) {
      showStatus(error.message, false);
    }
  }

  function logout() {
    clearInterval(pollingInterval);
    chrome.storage.sync.remove(
      ["githubToken", "repoName", "branchName"],
      () => {
        accessToken = "";
        userRepos = [];
        showAuthContainer();
        resetAuthUI();
      }
    );
  }
});
