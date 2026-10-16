import type { Repository, RepositoryPage } from '@/lib/types/github';
import { h } from '../dom';
import { icon } from '../icons';

interface PickerOptions {
  first: RepositoryPage;
  loadPage: (page: number) => Promise<RepositoryPage>;
  selected: string;
  onSelect: (repository: Repository) => void;
}

// Shows one page of repositories and fetches the next only when asked. The filter searches loaded pages.
export function repositoryPicker({ first, loadPage, selected, onSelect }: PickerOptions): HTMLElement {
  const repositories = [...first.repositories];
  let next = first.next;
  let filter = '';
  const list = h('div', { class: 'picker-list', role: 'radiogroup', 'aria-label': 'Repository' });

  function render(): void {
    const visible = repositories.filter((repository) => repository.full_name.toLowerCase().includes(filter));
    const rows: Node[] = visible.length ? visible.map(row) : [h('p', { class: 'picker-empty' }, 'No matches')];
    if (next) rows.push(loadMoreButton(next));
    list.replaceChildren(...rows);
  }

  function row(repository: Repository): HTMLElement {
    return h(
      'button',
      {
        type: 'button',
        role: 'radio',
        class: 'picker-row',
        'aria-checked': String(repository.full_name === selected),
        onclick: () => {
          selected = repository.full_name;
          render();
          onSelect(repository);
        },
      },
      h('span', { class: 'radio' }),
      h('span', { class: 'picker-name mono', title: repository.full_name }, repository.full_name),
      repository.private && icon('lock', 'icon-xs dim'),
    );
  }

  function loadMoreButton(page: number): HTMLElement {
    const button = h('button', { type: 'button', class: 'picker-more' }, 'Load more');
    button.addEventListener('click', async () => {
      button.setAttribute('disabled', '');
      button.replaceChildren(h('span', { class: 'spinner sm' }), 'Loading');
      try {
        const result = await loadPage(page);
        repositories.push(...result.repositories);
        next = result.next;
        render();
      } catch {
        button.removeAttribute('disabled');
        button.replaceChildren('Could not load. Try again');
      }
    });
    return button;
  }

  render();
  if (repositories.length <= 4 && !next) return h('div', { class: 'picker' }, list);

  const filterInput = h('input', {
    class: 'picker-filter mono',
    placeholder: 'Filter repositories',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  filterInput.addEventListener('input', () => {
    filter = filterInput.value.trim().toLowerCase();
    render();
  });
  return h('div', { class: 'picker' }, filterInput, list);
}
