// Kept free of imports so the MAIN-world content scripts stay small.
export const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const PAGE_SUBMISSION_MESSAGE = 'leetwithgit:submission';
export const PAGE_PROFILE_MESSAGE = 'leetwithgit:profile';
export const NEW_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=LeetWithGit&description=Saves%20accepted%20LeetCode%20solutions&contents=write';
