import { NEW_TOKEN_URL, REPOSITORY_PATTERN } from '@/lib/constants';
import { fetchViewer, listWritableRepositories, verifyRepository } from '@/lib/api/github';
import { sendMessage } from '@/lib/api/messages';
import { branchName, githubToken, repoName } from '@/lib/api/storage';
import type { Repository, Viewer } from '@/lib/types/github';
import { errorMessage } from '@/lib/utils/helpers';
import { h } from '../dom';
import { icon } from '../icons';

interface SetupState {
  step: 'token' | 'repository';
  token: string;
  viewer: Viewer | null;
  repositories: Repository[];
  repo: string;
  branch: string;
  filter: string;
  busy: boolean;
  error: string;
}

export function setupView({ onConnected }: { onConnected: () => void }): HTMLElement {
  const state: SetupState = {
    step: 'token',
    token: '',
    viewer: null,
    repositories: [],
    repo: '',
    branch: 'main',
    filter: '',
    busy: false,
    error: '',
  };
  const body = h('div', { class: 'setup-body' });
  const hero = h(
    'div',
    { class: 'hero' },
    h('div', { class: 'hero-mark' }, icon('logo', 'logo-lg')),
    h('h1', null, 'Sync LeetCode to GitHub'),
    h('p', { class: 'muted' }, 'Every accepted solution, committed automatically.'),
  );
  const view = h('div', { class: 'screen setup' }, hero, body);

  function update(patch: Partial<SetupState>, rerender = true): void {
    Object.assign(state, patch);
    if (rerender) render();
  }

  function render(): void {
    hero.classList.toggle('compact', state.step === 'repository');
    body.replaceChildren(stepper(state.step), state.step === 'token' ? tokenStep() : repositoryStep());
  }

  function tokenStep(): HTMLElement {
    const input = h('input', {
      id: 'token',
      class: 'input mono',
      type: 'password',
      placeholder: 'github_pat_…',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-invalid': state.error ? 'true' : undefined,
    });
    input.value = state.token;
    input.addEventListener('input', () => update({ token: input.value.trim(), error: '' }, false));
    queueMicrotask(() => input.focus());

    return h(
      'form',
      { class: 'step', onsubmit: (event: Event) => (event.preventDefault(), void continueWithToken()) },
      h(
        'div',
        { class: 'field' },
        h(
          'div',
          { class: 'label-row' },
          h('label', { for: 'token' }, 'GitHub token'),
          h('a', { class: 'link', href: NEW_TOKEN_URL, target: '_blank' }, 'Create one', icon('external', 'icon-xs')),
        ),
        input,
        state.error
          ? h('p', { class: 'field-error', role: 'alert' }, state.error)
          : h('p', { class: 'field-hint' }, 'Fine-grained · ', h('span', { class: 'kbd' }, 'Contents: Read and write')),
      ),
      submitButton(state.busy ? 'Checking' : 'Continue'),
    );
  }

  async function continueWithToken(): Promise<void> {
    if (!state.token) return update({ error: 'Paste a token to continue.' });
    update({ busy: true, error: '' });
    try {
      const viewer = await fetchViewer(state.token);
      const repositories = await listWritableRepositories(state.token).catch(() => []);
      const first = repositories[0];
      update({
        step: 'repository',
        viewer,
        repositories,
        repo: first?.full_name ?? '',
        branch: first?.default_branch ?? 'main',
        busy: false,
      });
    } catch (error: unknown) {
      update({ busy: false, error: errorMessage(error) });
    }
  }

  function repositoryStep(): HTMLElement {
    const branchInput = h('input', {
      id: 'branch',
      class: 'input mono',
      placeholder: 'main',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    branchInput.value = state.branch;
    branchInput.addEventListener('input', () => update({ branch: branchInput.value.trim(), error: '' }, false));

    return h(
      'form',
      { class: 'step', onsubmit: (event: Event) => (event.preventDefault(), void connect()) },
      state.viewer &&
        h(
          'div',
          { class: 'account' },
          h('img', { class: 'avatar', src: avatarUrl(state.viewer.avatar_url), alt: '' }),
          h('span', { class: 'mono' }, `@${state.viewer.login}`),
          h(
            'button',
            { type: 'button', class: 'link', onclick: () => update({ step: 'token', error: '' }) },
            'Change',
          ),
        ),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'repo' }, 'Repository'),
        state.repositories.length ? repositoryPicker() : repositoryInput(),
      ),
      h('div', { class: 'field' }, h('label', { for: 'branch' }, 'Branch'), branchInput),
      state.error && h('p', { class: 'field-error', role: 'alert' }, state.error),
      submitButton(state.busy ? 'Verifying' : 'Connect repository'),
    );
  }

  function repositoryPicker(): HTMLElement {
    const visible = state.repositories.filter((repository) =>
      repository.full_name.toLowerCase().includes(state.filter.toLowerCase()),
    );
    const list = h(
      'div',
      { class: 'picker-list', role: 'radiogroup', 'aria-label': 'Repository' },
      ...visible.map((repository) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: 'picker-row',
            'aria-checked': String(repository.full_name === state.repo),
            onclick: () => update({ repo: repository.full_name, branch: repository.default_branch, error: '' }),
          },
          h('span', { class: 'radio' }),
          h('span', { class: 'picker-name mono' }, repository.full_name),
          repository.private && icon('lock', 'icon-xs dim'),
        ),
      ),
      !visible.length && h('p', { class: 'picker-empty' }, 'No matches'),
    );

    if (state.repositories.length <= 4) return h('div', { class: 'picker' }, list);

    const filter = h('input', {
      class: 'picker-filter mono',
      placeholder: 'Filter repositories',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    filter.value = state.filter;
    filter.addEventListener('input', () => {
      update({ filter: filter.value }, false);
      list.replaceWith(repositoryPicker().querySelector('.picker-list')!);
    });
    return h('div', { class: 'picker' }, filter, list);
  }

  function repositoryInput(): HTMLElement {
    const input = h('input', {
      id: 'repo',
      class: 'input mono',
      placeholder: state.viewer ? `${state.viewer.login}/leetcode` : 'owner/repository',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    input.value = state.repo;
    input.addEventListener('input', () => update({ repo: input.value.trim(), error: '' }, false));
    queueMicrotask(() => input.focus());
    return input;
  }

  async function connect(): Promise<void> {
    const branch = state.branch || 'main';
    if (!REPOSITORY_PATTERN.test(state.repo)) return update({ error: 'Use the owner/repository format.' });
    update({ busy: true, error: '' });
    try {
      await verifyRepository(state.token, state.repo, branch);
      await Promise.all([githubToken.setValue(state.token), repoName.setValue(state.repo), branchName.setValue(branch)]);
      sendMessage({ type: 'process-queue' }).catch(() => {});
      onConnected();
    } catch (error: unknown) {
      update({ busy: false, error: errorMessage(error) });
    }
  }

  function submitButton(label: string): HTMLElement {
    return h(
      'button',
      { type: 'submit', class: 'button primary', disabled: state.busy, 'aria-busy': String(state.busy) },
      state.busy ? h('span', { class: 'spinner' }) : null,
      label,
      state.busy ? null : icon('arrow', 'icon-sm'),
    );
  }

  render();
  return view;
}

function stepper(step: SetupState['step']): HTMLElement {
  const done = step === 'repository';
  return h(
    'ol',
    { class: 'stepper' },
    h('li', { class: done ? 'done' : 'current' }, h('span', { class: 'step-dot' }, done ? icon('check', 'icon-xs') : '1'), 'Token'),
    h('li', { class: 'step-line' + (done ? ' done' : '') }),
    h('li', { class: done ? 'current' : '' }, h('span', { class: 'step-dot' }, '2'), 'Repository'),
  );
}

function avatarUrl(url: string): string {
  const avatar = new URL(url);
  avatar.searchParams.set('s', '48');
  return avatar.href;
}
