import { defineContentScript } from 'wxt/utils/define-content-script';
import { PAGE_SUBMISSION_MESSAGE } from '@/lib/constants';
import type { SubmissionInput } from '@/lib/types/submission';

interface PendingSubmission {
  questionId: string;
  problemSlug: string;
  code: string;
  language: string;
  createdAt: number;
  submissionId?: string;
}

interface ProblemDetails {
  title: string;
  difficulty: string;
  description: string;
}

const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_COMPLETED_IDS = 1000;

// Runs in LeetCode's page world to observe its own submit and result requests.
// It has no extension API access and hands accepted submissions to leetcode.content.ts.
export default defineContentScript({
  matches: ['https://leetcode.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main: installSubmissionCapture,
});

function installSubmissionCapture(): void {
  const originalFetch = window.fetch.bind(window);
  const pendingByQuestion = new Map<string, PendingSubmission[]>();
  const pendingById = new Map<string, PendingSubmission>();
  const completedIds = new Set<string>();
  const inFlight = new WeakSet<PendingSubmission>();

  function track(record: PendingSubmission): void {
    pendingByQuestion.set(record.questionId, [...(pendingByQuestion.get(record.questionId) ?? []), record]);
  }

  function untrack(record: PendingSubmission): void {
    if (record.submissionId) pendingById.delete(record.submissionId);
    const remaining = (pendingByQuestion.get(record.questionId) ?? []).filter((item) => item !== record);
    if (remaining.length) pendingByQuestion.set(record.questionId, remaining);
    else pendingByQuestion.delete(record.questionId);
  }

  function prune(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const records of [...pendingByQuestion.values()]) {
      for (const record of records) if (record.createdAt < cutoff) untrack(record);
    }
    for (const id of completedIds) {
      if (completedIds.size <= MAX_COMPLETED_IDS) break;
      completedIds.delete(id);
    }
  }

  async function fetchProblemDetails(record: PendingSubmission): Promise<ProblemDetails> {
    const slug = record.problemSlug || (await findProblemSlug(record.questionId));
    if (!slug) throw new Error('Could not identify the submitted LeetCode problem.');

    const response = await originalFetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query getQuestionDetail($titleSlug: String!) { question(titleSlug: $titleSlug) { title difficulty content } }',
        variables: { titleSlug: slug },
      }),
    });
    if (!response.ok) throw new Error(`LeetCode problem lookup failed (${response.status}).`);

    const json = (await response.json()) as {
      data?: { question?: { title?: string; difficulty?: string; content?: string } | null };
    };
    const question = json.data?.question;
    if (!question) throw new Error('LeetCode did not return problem details.');
    return {
      title: question.title || 'LeetCode solution',
      difficulty: question.difficulty || 'Unknown',
      description: new DOMParser().parseFromString(question.content ?? '', 'text/html').body.textContent,
    };
  }

  async function findProblemSlug(questionId: string): Promise<string | undefined> {
    const response = await originalFetch('https://leetcode.com/api/problems/all/');
    const data = (await response.json()) as {
      stat_status_pairs?: { stat: { question_id: string | number; question__title_slug: string } }[];
    };
    return data.stat_status_pairs?.find((item) => String(item.stat.question_id) === questionId)?.stat
      .question__title_slug;
  }

  async function publishAccepted(questionId: string, submissionId: string): Promise<void> {
    prune();
    const record = pendingById.get(submissionId) ?? pendingByQuestion.get(questionId)?.[0];
    if (!record || completedIds.has(submissionId) || inFlight.has(record)) return;

    inFlight.add(record);
    try {
      const details = await fetchProblemDetails(record);
      const payload: SubmissionInput = {
        submissionId,
        questionId,
        problemTitle: details.title,
        language: record.language,
        difficulty: details.difficulty,
        description: details.description,
        code: record.code,
      };
      window.postMessage({ type: PAGE_SUBMISSION_MESSAGE, payload }, location.origin);
      untrack(record);
      if (submissionId) completedIds.add(submissionId);
    } finally {
      inFlight.delete(record);
    }
  }

  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const submission = parseSubmitRequest(url, init);
    if (submission) track(submission);

    const response = await originalFetch(input, init);

    if (submission) {
      void readJson(response).then((data) => {
        const id = String(data?.submission_id ?? data?.submissionId ?? '');
        if (!id) return;
        submission.submissionId = id;
        pendingById.set(id, submission);
      });
    }

    const resultId = url.pathname.match(/\/submissions\/detail\/([^/]+)/)?.[1];
    if (resultId) {
      void readJson(response).then((data) => {
        if (data?.state !== 'SUCCESS' || data.status_msg !== 'Accepted' || !data.question_id) return;
        publishAccepted(String(data.question_id), resultId).catch((error: unknown) => {
          console.error('LeetWithGit could not prepare the accepted submission:', error);
        });
      });
    }

    return response;
  };
}

function parseSubmitRequest(url: URL, init: RequestInit | undefined): PendingSubmission | null {
  if (!url.pathname.includes('/submit/') || typeof init?.body !== 'string') return null;
  try {
    const body = JSON.parse(init.body) as { question_id?: unknown; typed_code?: unknown; lang?: unknown };
    const questionId = String(body.question_id ?? '');
    if (!/^\d+$/.test(questionId) || typeof body.typed_code !== 'string' || typeof body.lang !== 'string') return null;
    const problemSlug = url.pathname.match(/\/problems\/([^/]+)\/submit/)?.[1] ?? '';
    return { questionId, problemSlug, code: body.typed_code, language: body.lang, createdAt: Date.now() };
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await response.clone().json();
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
