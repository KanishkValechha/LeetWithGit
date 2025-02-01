// background.js
let pollingInterval;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "start_device_flow") {
    startDeviceFlow();
  }
});

async function startDeviceFlow() {
  try {
    const CLIENT_ID = "Ov23lioPqIdL2TJNlUbT"; // Replace with your ID

    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        scope: "repo",
      }),
    });

    const data = await response.json();

    if (data.error) {
      chrome.storage.local.set({ authError: data.error_description });
      return;
    }

    chrome.storage.local.set({
      deviceFlow: {
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        deviceCode: data.device_code,
        interval: data.interval || 5,
      },
    });

    startPolling(data.device_code, data.interval || 5);
  } catch (error) {
    chrome.storage.local.set({ authError: error.message });
  }
}

function startPolling(deviceCode, interval) {
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    try {
      const CLIENT_ID = "YOUR_CLIENT_ID"; // Replace with your ID

      const response = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        }
      );

      const data = await response.json();

      if (data.access_token) {
        clearInterval(pollingInterval);
        await chrome.storage.sync.set({ githubToken: data.access_token });

        // Add explicit UI update trigger
        chrome.runtime.sendMessage({
          type: "auth_complete",
          token: data.access_token,
        });

        // Clear device flow data
        await chrome.storage.local.remove(["deviceFlow"]);
      }
    } catch (error) {
      chrome.storage.local.set({ authError: error.message });
      clearInterval(pollingInterval);
    }
  }, interval * 1000);
}
