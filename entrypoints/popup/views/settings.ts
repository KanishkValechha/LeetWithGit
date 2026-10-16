import { browser } from 'wxt/browser';
import { NEW_TOKEN_URL, REPOSITORY_PATTERN } from '@/lib/constants';
import { listWritableRepositories, verifyRepository } from '@/lib/api/github';
import { sendMessage } from '@/lib/api/messages';
import { branchName, githubToken, repoName } from '@/lib/api/storage';
import { errorMessage, maskToken } from '@/lib/utils/helpers';
import { h } from '../dom';
import { icon } from '../icons';
import { repositoryPicker } from './repo-picker';

interface Settings {
  token: string | null;
  repo: string;
  branch: string;
}

export function settingsView(
  current: Settings,
  { onBack, onDisconnected }: { onBack: () => void; onDisconnected: () => void },
): HTMLElement {
  let repo = current.repo;
  const repoField = h('div');
  const branchInput = textInput('branch', current.branch, 'main');
  const tokenInput = h('input', {
    id: 'token',
    class: 'input mono',
    type: 'password',
    placeholder: 'Paste a new token to replace it',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const feedback = h('p', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
  const save = h('button', { type: 'submit', class: 'button primary' }, 'Save changes');

  function show(message: string, tone: 'success' | 'error'): void {
    feedback.className = `feedback ${tone}`;
    feedback.replaceChildren(icon(tone === 'success' ? 'check' : 'retry', 'icon-xs'), message);
  }

  function showRepo(): void {
    repoField.replaceChildren(
      h(
        'div',
        { class: 'repo-current' },
        h('span', { class: 'mono', title: repo }, repo || 'No repository'),
        h('button', { type: 'button', class: 'link', onclick: () => void chooseRepo() }, 'Change'),
      ),
    );
  }

  // Lists what the token can write to, so nobody has to remember OWNER/REPOSITORY.
  async function chooseRepo(): Promise<void> {
    const token = tokenInput.value.trim() || current.token;
    if (!token) return show('Add a GitHub token.', 'error');
    feedback.replaceChildren();
    repoField.replaceChildren(h('div', { class: 'repo-current dim' }, h('span', { class: 'spinner sm' }), 'Loading repositories'));
    try {
      const first = await listWritableRepositories(token);
      if (!first.repositories.length && !first.next) throw new Error('This token cannot write to any repository.');
      repoField.replaceChildren(
        repositoryPicker({
          first,
          loadPage: (page) => listWritableRepositories(token, page),
          selected: repo,
          onSelect: (repository) => {
            repo = repository.full_name;
            branchInput.value = repository.default_branch;
            showRepo();
          },
        }),
      );
      repoField.querySelector('input')?.focus();
    } catch (error: unknown) {
      showRepo();
      show(errorMessage(error), 'error');
    }
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const branch = branchInput.value.trim() || 'main';
    const token = tokenInput.value.trim() || current.token;
    if (!REPOSITORY_PATTERN.test(repo)) return show('Use the owner/repository format.', 'error');
    if (!token) return show('Add a GitHub token.', 'error');

    save.setAttribute('disabled', '');
    save.replaceChildren(h('span', { class: 'spinner' }), 'Verifying');
    try {
      await verifyRepository(token, repo, branch);
      await Promise.all([githubToken.setValue(token), repoName.setValue(repo), branchName.setValue(branch)]);
      current.token = token;
      tokenInput.value = '';
      sendMessage({ type: 'process-queue' }).catch(() => {});
      show('Connected and saved', 'success');
    } catch (error: unknown) {
      show(errorMessage(error), 'error');
    } finally {
      save.removeAttribute('disabled');
      save.replaceChildren('Save changes');
    }
  }

  async function disconnect(): Promise<void> {
    await Promise.all([githubToken.removeValue(), repoName.setValue('')]);
    onDisconnected();
  }

  showRepo();
  return h(
    'div',
    { class: 'screen settings' },
    h(
      'header',
      { class: 'bar' },
      h(
        'button',
        { class: 'icon-button', type: 'button', 'aria-label': 'Back', onclick: onBack },
        icon('back'),
      ),
      h('span', { class: 'bar-title' }, 'Settings'),
      h('span', { class: 'bar-spacer' }),
    ),
    h(
      'form',
      { class: 'settings-body stagger', onsubmit: (event: Event) => void submit(event) },
      h('div', { class: 'field' }, h('label', null, 'Repository'), repoField),
      h('div', { class: 'field' }, h('label', { for: 'branch' }, 'Branch'), branchInput),
      h(
        'div',
        { class: 'field' },
        h(
          'div',
          { class: 'label-row' },
          h('label', { for: 'token' }, 'GitHub token'),
          h('a', { class: 'link', href: NEW_TOKEN_URL, target: '_blank' }, 'New token', icon('external', 'icon-xs')),
        ),
        current.token &&
          h(
            'div',
            { class: 'token-saved' },
            icon('key', 'icon-xs'),
            h('span', { class: 'mono' }, maskToken(current.token)),
            h('span', { class: 'dim' }, 'Stored on this device'),
          ),
        tokenInput,
      ),
      save,
      feedback,
      h(
        'div',
        { class: 'danger-row' },
        h('span', { class: 'dim' }, `v${browser.runtime.getManifest().version}`),
        h('button', { type: 'button', class: 'link danger', onclick: () => void disconnect() }, 'Disconnect'),
      ),
    ),
  );
}

function textInput(id: string, value: string, placeholder: string): HTMLInputElement {
  const input = h('input', { id, class: 'input mono', placeholder, autocomplete: 'off', spellcheck: 'false' });
  input.value = value;
  return input;
}
