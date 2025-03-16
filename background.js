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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.url?.includes("leetcode.com")) {
      chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",  // Ensures execution in the page context
          function: injectedScript
      });
  }
});

function injectedScript() {

function interceptFetch() {
  let latestSubmission = {};
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
      const [url, options] = args;

      if (!url.includes("/submissions/detail/") && !url.includes("/submit/")) {
          return originalFetch(...args);
      }

      if (url.includes("/submit/")) {
        try {
            let requestBody = options?.body ? JSON.parse(options.body) : {};
            latestSubmission = {
                code: requestBody.typed_code,
                language: requestBody.lang,
                questionId:requestBody.question_id
            };
            console.log(latestSubmission)
        } catch (e) { console.error("Error parsing submission request:", e); }
    }

      let requestBody = options?.body;
      if (requestBody) {
          try {
              requestBody = JSON.parse(requestBody);
          } catch (e) {}
      }

      const response = await originalFetch(...args);
      const clonedResponse = response.clone(); // Clone the response before reading it

      clonedResponse.json().then(data => {
          // console.log("📤 Fetch Request:", { url, requestBody });
          console.log("📥 Fetch Response:", { url, data });
          if (url.includes("/submissions/detail/") && data?.state === "SUCCESS") {
            console.log("Submission successful, fetching problem details...");
            handleSuccessfulSubmission(data,latestSubmission);
        }
      })
      return response;
  };
}
async function handleSuccessfulSubmission(data,latestSubmission) {
  let problemDetails = await fetchProblemDetails(data.question_id);
  if (!problemDetails) {
    console.error("Failed to fetch problem details.");
    return;
}

let payload = {
    problemTitle: problemDetails.title,
    language: latestSubmission.language,
    difficulty: problemDetails.difficulty,
    description: problemDetails.description,
    code: latestSubmission.code,
    questionId:data.question_id
};
window.postMessage({
  type: "leetcode_submission",
  payload: payload
}, "*");
}

// Function to fetch problem details
async function fetchProblemDetails(questionId) {
    try {
        let problemUrl = `https://leetcode.com/graphql`;
        let query = {
            query: `query getQuestionDetail($titleSlug: String!) {
                question(titleSlug: $titleSlug) {
                    title
                    difficulty
                    content
                }
            }`,
            variables: { titleSlug: await getProblemSlug(questionId) }
        };

        let response = await fetch(problemUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(query)
        });

        let json = await response.json();
        if (json.data && json.data.question) {
            return {
                title: json.data.question.title,
                difficulty: json.data.question.difficulty,
                description: json.data.question.content
            };
        }
    } catch (error) {
        console.error("Error fetching problem details:", error);
    }
    return null;
}

// Function to get problem slug from question ID
async function getProblemSlug(questionId) {
    let response = await fetch(`https://leetcode.com/api/problems/all/`);
    let json = await response.json();
    let problem = json.stat_status_pairs.find(q => q.stat.question_id == questionId);
    return problem ? problem.stat.question__title_slug : null;
}

interceptFetch();
}

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
    const fileName = `${payload.questionId}-${payload.problemTitle
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

// Attempt to push the file
const response = await fetch(apiUrl, {
  method: "PUT",
  headers: {
    Authorization: `token ${settings.githubToken}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.github.v3+json",
  },
  body: JSON.stringify({
    message: `Add Better LeetCode solution: ${fileName}`,
    content: btoa(unescape(encodeURIComponent(fileContent))),
    branch: settings.branchName || "main",
  }),
});

const responseData = await response.json();

if (!response.ok) {
  if (response.status === 422) {
    console.log("File already exists. Attempting to delete...");

    // Get SHA of the existing file
    const fileResponse = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Authorization: `token ${settings.githubToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const fileData = await fileResponse.json();

    if (!fileResponse.ok || !fileData.sha) {
      throw new Error(`Failed to get file SHA: ${JSON.stringify(fileData)}`);
    }

    // Delete the existing file
    const deleteResponse = await fetch(apiUrl, {
      method: "DELETE",
      headers: {
        Authorization: `token ${settings.githubToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({
        message: `Delete existing LeetCode solution: ${fileName}`,
        sha: fileData.sha, // Required for DELETE
        branch: settings.branchName || "main",
      }),
    });

    if (!deleteResponse.ok) {
      throw new Error(`Failed to delete file: ${JSON.stringify(await deleteResponse.json())}`);
    }

    console.log("File deleted successfully. Retrying push...");
    return handleGitHubPush(payload); // Retry after deletion
  }

  throw new Error(`GitHub API error: ${response.status} - ${JSON.stringify(responseData)}`);
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
