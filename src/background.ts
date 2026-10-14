const QUEUE_KEY = "pendingSubmissions" as const;
const RECENT_KEY = "recentSubmissionKeys" as const;
const RETRY_ALARM = "retry-pending-submissions";
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
let processingQueue = false;
let queueMutation: Promise<unknown> = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "push_to_github") {
    if (!isLeetCodeSender(sender)) {
      sendResponse({ ok: false, error: "Submission did not come from LeetCode." });
      return false;
    }

    enqueueSubmission(message.payload)
      .then(async (result) => {
        sendResponse(result);
        if (result.ok && !result.duplicate) await processQueue();
      })
      .catch((error: unknown) => {
        sendResponse({ ok: false, error: errorMessage(error) });
      });
    return true;
  }

  if (message?.type === "process_pending_submissions") {
    processQueue().then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !isLeetCodeUrl(tab?.url)) return;

  chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: installSubmissionCapture,
  }).catch((error: unknown) => console.warn("LeetWithGit could not attach to this LeetCode tab:", error));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) processQueue();
});

chrome.runtime.onInstalled.addListener(() => processQueue());
chrome.runtime.onStartup.addListener(() => processQueue());

function isLeetCodeUrl(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).hostname === "leetcode.com";
  } catch {
    return false;
  }
}

function isLeetCodeSender(sender: chrome.runtime.MessageSender): boolean {
  return Boolean(sender.tab && isLeetCodeUrl(sender.url));
}

function withQueueMutation<T>(callback: () => Promise<T>): Promise<T> {
  const next = queueMutation.then(callback, callback);
  queueMutation = next.catch(() => {});
  return next;
}

// This function is serialized into LeetCode's page world. It only observes the
// page's own submission requests; extension APIs remain in the service worker.
function installSubmissionCapture(): void {
  if (window.__leetWithGitCaptureInstalled) return;
  window.__leetWithGitCaptureInstalled = true;

  const originalFetch = window.fetch;
  interface CapturedSubmission {
    questionId: string;
    problemSlug: string;
    code: string;
    language: string;
    createdAt: number;
    submissionId: string;
  }

  interface AcceptedSubmissionResult {
    question_id?: string | number;
    state?: string;
    status_msg?: string;
  }

  interface ProblemListEntry {
    stat: { question_id: string | number; question__title_slug: string };
  }

  interface ProblemDetailsResponse {
    data?: { question?: { title?: string; difficulty?: string; content?: string } | null };
  }

  const bySubmissionId = new Map<string, CapturedSubmission>();
  const byQuestionId = new Map<string, CapturedSubmission[]>();
  const completedSubmissionIds = new Set<string>();
  const processingRecords = new WeakSet<CapturedSubmission>();
  const expireAfterMs = 10 * 60 * 1000;

  function isCapturedRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  function removePending(record: CapturedSubmission): void {
    if (record.submissionId) bySubmissionId.delete(record.submissionId);
    const records = byQuestionId.get(record.questionId) || [];
    const remaining = records.filter((item) => item !== record);
    if (remaining.length) byQuestionId.set(record.questionId, remaining);
    else byQuestionId.delete(record.questionId);
  }

  function pruneExpiredRecords(): void {
    const cutoff = Date.now() - expireAfterMs;
    for (const records of byQuestionId.values()) {
      for (const record of [...records]) {
        if (record.createdAt < cutoff) removePending(record);
      }
    }
    while (completedSubmissionIds.size > 1000) {
      const oldest = completedSubmissionIds.values().next().value;
      if (oldest === undefined) break;
      completedSubmissionIds.delete(oldest);
    }
  }

  function getSubmissionRequest(url: URL, options: RequestInit): CapturedSubmission | null {
    if (!url.pathname.includes("/submit/")) return null;
    try {
      if (typeof options.body !== "string") return null;
      const body = JSON.parse(options.body) as { question_id?: unknown; typed_code?: unknown; lang?: unknown };
      const questionId = String(body.question_id ?? "");
      const code = body.typed_code;
      const language = body.lang;
      if (!/^\d+$/.test(questionId) || typeof code !== "string" || typeof language !== "string") return null;

      const slugMatch = url.pathname.match(/\/problems\/([^/]+)\/submit\/?/);
      return {
        questionId,
        problemSlug: slugMatch?.[1] || "",
        code,
        language,
        createdAt: Date.now(),
        submissionId: "",
      };
    } catch {
      return null;
    }
  }

  async function getJson(response: Response): Promise<unknown> {
    try {
      return await response.clone().json();
    } catch {
      return null;
    }
  }

  async function fetchProblemDetails(
    this: CapturedSubmission,
    problemSlug: string,
  ): Promise<LeetCodeProblemDetails> {
    let slug: string | undefined = problemSlug;
    if (!slug) {
      const response = await originalFetch.call(window, "https://leetcode.com/api/problems/all/");
      const data = await response.json() as { stat_status_pairs?: ProblemListEntry[] };
      const problem = data.stat_status_pairs?.find((item) => String(item.stat.question_id) === this.questionId);
      slug = problem?.stat.question__title_slug;
    }
    if (!slug) throw new Error("Could not identify the submitted LeetCode problem.");

    const query = {
      query: "query getQuestionDetail($titleSlug: String!) { question(titleSlug: $titleSlug) { title difficulty content } }",
      variables: { titleSlug: slug },
    };
    const response = await originalFetch.call(window, "https://leetcode.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });
    if (!response.ok) throw new Error(`LeetCode problem lookup failed (${response.status}).`);
    const json = await response.json() as ProblemDetailsResponse;
    const question = json.data?.question;
    if (!question) throw new Error("LeetCode did not return problem details.");
    const document = new DOMParser().parseFromString(question.content || "", "text/html");
    return {
      title: question.title || "LeetCode solution",
      difficulty: question.difficulty || "Unknown",
      description: document.body.textContent || "",
    };
  }

  async function publishAccepted(
    result: AcceptedSubmissionResult,
    record: CapturedSubmission | undefined,
    submissionId: string,
  ): Promise<void> {
    if (!record || !result.question_id) return;
    if (submissionId && completedSubmissionIds.has(submissionId)) return;
    if (processingRecords.has(record)) return;
    processingRecords.add(record);

    try {
      const details = await fetchProblemDetails.call(record, record.problemSlug);
      window.postMessage({
        type: "leetcode_submission",
        payload: {
          submissionId,
          questionId: String(result.question_id),
          problemTitle: details.title,
          language: record.language,
          difficulty: details.difficulty,
          description: details.description,
          code: record.code,
        },
      }, window.location.origin);
      removePending(record);
      if (submissionId) completedSubmissionIds.add(submissionId);
    } catch (error: unknown) {
      console.error("LeetWithGit could not prepare the accepted submission:", error);
    } finally {
      processingRecords.delete(record);
    }
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const inputUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const requestUrl = new URL(inputUrl, window.location.href);
    const options = init || {};
    const submissionRequest = getSubmissionRequest(requestUrl, options);
    if (submissionRequest) {
      const records = byQuestionId.get(submissionRequest.questionId) || [];
      records.push(submissionRequest);
      byQuestionId.set(submissionRequest.questionId, records);
    }

    const response = await originalFetch.call(window, input, init);
    if (submissionRequest) {
      getJson(response).then((data) => {
        if (!isCapturedRecord(data)) return;
        const id = String(data.submission_id ?? data.submissionId ?? "");
        if (id) {
          submissionRequest.submissionId = id;
          bySubmissionId.set(id, submissionRequest);
        }
      });
    }

    if (requestUrl.pathname.includes("/submissions/detail/")) {
      getJson(response).then((data) => {
        if (!isCapturedRecord(data)) return;
        const accepted = data as AcceptedSubmissionResult;
        if (accepted.state !== "SUCCESS" || accepted.status_msg !== "Accepted") return;
        const idMatch = requestUrl.pathname.match(/\/submissions\/detail\/([^/]+)/);
        const submissionId = idMatch?.[1] || "";
        pruneExpiredRecords();
        let record = bySubmissionId.get(submissionId);
        const questionId = String(accepted.question_id ?? "");
        if (!record && questionId) record = (byQuestionId.get(questionId) || [])[0];
        publishAccepted(accepted, record, submissionId).catch((error: unknown) => {
          console.error("LeetWithGit submission capture failed:", error);
        });
      });
    }
    return response;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePayload(payload: unknown): SubmissionPayload {
  if (!payload || typeof payload !== "object") throw new Error("Submission data is missing.");
  const data = payload as Record<string, unknown>;
  const questionId = String(data.questionId ?? "");
  const problemTitle = String(data.problemTitle ?? "").trim();
  const language = String(data.language ?? "").trim();
  const code = data.code;
  const description = typeof data.description === "string" ? data.description : "";
  const difficulty = typeof data.difficulty === "string" ? data.difficulty : "Unknown";

  if (!/^\d+$/.test(questionId)) throw new Error("LeetCode question ID is invalid.");
  if (!problemTitle || problemTitle.length > 200) throw new Error("Problem title is invalid.");
  if (!/^[a-zA-Z0-9+#.-]{1,32}$/.test(language)) throw new Error("Programming language is invalid.");
  if (typeof code !== "string" || !code.length || code.length > 500_000) {
    throw new Error("Solution code is empty or too large to queue.");
  }
  if (description.length > 100_000) throw new Error("Problem description is too large.");

  return {
    submissionId: String(data.submissionId ?? "").slice(0, 100),
    questionId,
    problemTitle,
    language,
    difficulty: difficulty.slice(0, 32),
    description,
    code,
  };
}

async function makeSubmissionKey(payload: SubmissionPayload): Promise<string> {
  if (payload.submissionId) return `leetcode:${payload.submissionId}`;
  const input = new TextEncoder().encode(`${payload.questionId}\n${payload.language}\n${payload.code}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

async function enqueueSubmission(rawPayload: unknown): Promise<{ ok: true; duplicate: boolean }> {
  const payload = normalizePayload(rawPayload);
  const submissionKey = await makeSubmissionKey(payload);
  return withQueueMutation(async () => {
    const stored = await chrome.storage.local.get([QUEUE_KEY, RECENT_KEY]);
    const queue = stored[QUEUE_KEY] || [];
    const recent = stored[RECENT_KEY] || [];
    if (queue.some((item) => item.submissionKey === submissionKey) || recent.includes(submissionKey)) {
      return { ok: true, duplicate: true };
    }

    queue.push({ payload, submissionKey, attempts: 0, nextAttemptAt: Date.now() });
    await chrome.storage.local.set({ pendingSubmissions: queue });
    return { ok: true, duplicate: false };
  });
}

async function processQueue(): Promise<void> {
  if (processingQueue) return;
  processingQueue = true;
  try {
    const stored = await chrome.storage.local.get([QUEUE_KEY]);
    const queue = stored[QUEUE_KEY] || [];
    const now = Date.now();

    for (const item of [...queue]) {
      if (item.nextAttemptAt > now) continue;

      try {
        await pushToGitHub(item.payload);
        await withQueueMutation(async () => {
          const current = await chrome.storage.local.get([QUEUE_KEY, RECENT_KEY]);
          const currentQueue = current[QUEUE_KEY] || [];
          const index = currentQueue.findIndex((queued) => queued.submissionKey === item.submissionKey);
          if (index !== -1) currentQueue.splice(index, 1);
          const recent = current[RECENT_KEY] || [];
          recent.push(item.submissionKey);
          await chrome.storage.local.set({
            pendingSubmissions: currentQueue,
            recentSubmissionKeys: recent.slice(-1000),
            lastSyncStatus: {
              status: "success",
              message: `Saved ${item.payload.problemTitle} to GitHub.`,
              updatedAt: Date.now(),
            },
          });
        });
        showNotification("LeetWithGit", `Saved ${item.payload.problemTitle} to GitHub.`);
      } catch (error: unknown) {
        const queued = await withQueueMutation(async () => {
          const current = await chrome.storage.local.get([QUEUE_KEY]);
          const currentQueue = current[QUEUE_KEY] || [];
          const currentItem = currentQueue.find((entry) => entry.submissionKey === item.submissionKey);
          if (!currentItem) return null;
          currentItem.attempts += 1;
          const delay = Math.min(30_000 * (2 ** Math.min(currentItem.attempts - 1, 7)), MAX_RETRY_DELAY_MS);
          currentItem.nextAttemptAt = Date.now() + delay;
          await chrome.storage.local.set({
            pendingSubmissions: currentQueue,
            lastSyncStatus: {
              status: "retrying",
              message: `Could not save ${currentItem.payload.problemTitle}: ${errorMessage(error)}. It will retry automatically.`,
              updatedAt: Date.now(),
            },
          });
          return currentItem;
        });
        if (!queued) continue;
        if (queued.attempts === 1) showNotification("LeetWithGit: upload queued", "A submission will retry when GitHub is reachable.");
      }
    }
  } finally {
    processingQueue = false;
    try {
      const latest = await chrome.storage.local.get(QUEUE_KEY);
      const pending = latest[QUEUE_KEY] || [];
      if (!pending.length) {
        await chrome.alarms.clear(RETRY_ALARM);
      } else {
        const nextAttemptAt = Math.min(...pending.map((item) => item.nextAttemptAt || Date.now()));
        chrome.alarms.create(RETRY_ALARM, { when: Math.max(Date.now() + 1000, nextAttemptAt) });
      }
    } catch (error: unknown) {
      console.error("LeetWithGit could not schedule queued uploads:", error);
    }
  }
}

function showNotification(title: string, message: string): void {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon48.png",
    title,
    message,
  });
}

function buildFileName(payload: SubmissionPayload): string {
  const title = payload.problemTitle
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 100);
  const extension = payload.language.toLowerCase().replace(/[^a-z0-9+#.-]/g, "").slice(0, 32);
  return `${payload.questionId}-${title || "solution"}.${extension}`;
}

interface GitHubRequestOptions {
  method?: "GET" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

async function githubRequest(
  url: string,
  token: string,
  options: GitHubRequestOptions = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  let data: Record<string, unknown> = {};
  try {
    data = await response.json() as Record<string, unknown>;
  } catch {
    // Keep the HTTP status as the useful error when a proxy returns non-JSON.
  }
  if (!response.ok) {
    const detail = typeof data.message === "string" ? data.message : `GitHub returned HTTP ${response.status}.`;
    throw new Error(detail);
  }
  return data;
}

async function pushToGitHub(payload: SubmissionPayload): Promise<void> {
  const settings = await chrome.storage.sync.get(["repoName", "branchName"]);
  const secrets = await chrome.storage.local.get("githubToken");
  const token = secrets.githubToken;
  const repoName = String(settings.repoName || "").trim();
  const branch = String(settings.branchName || "main").trim() || "main";
  if (!token || !repoName) throw new Error("Open extension settings and save a GitHub token and repository.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoName)) {
    throw new Error("Repository must use the OWNER/REPOSITORY format.");
  }

  const fileName = buildFileName(payload);
  const apiUrl = `https://api.github.com/repos/${repoName}/contents/leetcode/${encodeURIComponent(fileName)}`;
  const fileContent = `/*\n * ${payload.problemTitle}\n * Difficulty: ${payload.difficulty}\n *\n * ${payload.description}\n */\n\n${payload.code}`;
  const body = {
    message: `Add LeetCode solution: ${fileName}`,
    content: btoa(unescape(encodeURIComponent(fileContent))),
    branch,
  };

  try {
    await githubRequest(apiUrl, token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error: unknown) {
    // Existing behavior retained for now: a 422 triggers delete-then-retry.
    // See README for why this should become an explicit overwrite/skip policy.
    const message = errorMessage(error);
    if (!/already exists|sha/i.test(message) && message !== "Validation Failed") throw error;

    const file = await githubRequest(apiUrl, token);
    await githubRequest(apiUrl, token, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Delete existing LeetCode solution: ${fileName}`,
        sha: file.sha,
        branch,
      }),
    });
    await githubRequest(apiUrl, token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
