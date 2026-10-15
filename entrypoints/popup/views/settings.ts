import { browser } from 'wxt/browser';
import { errorMessage } from '@/lib/errors';
import { REPOSITORY_PATTERN } from '@/lib/github';
import { sendMessage } from '@/lib/messages';
import { branchName, githubToken, repoName } from '@/lib/storage';
import { NEW_TOKEN_URL, verifyRepository } from '../api';
import { h, icon } from '../dom';

interface Settings {
  token: string | null;
  repo: string;
  branch: string;
}

export function settingsView(
  current: Settings,
  { onBack, onDisconnected }: { onBack: () => void; onDisconnected: () => void },
): HTMLElement {
  const repoInput = textInput('repo', current.repo, 'owner/repository');
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

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const repo = repoInput.value.trim();
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
      h('div', { class: 'field' }, h('label', { for: 'repo' }, 'Repository'), repoInput),
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

function maskToken(token: string): string {
  return `${token.slice(0, token.startsWith('github_pat_') ? 11 : 4)}••••${token.slice(-4)}`;
}
