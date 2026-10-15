type Child = Node | string | false | null | undefined;
type Props = Record<string, string | boolean | EventListener | undefined>;

// Small element builder. Text children are always inserted as text, never parsed as HTML.
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') element.addEventListener(key.replace(/^on/, ''), value);
    else if (value === true) element.setAttribute(key, '');
    else element.setAttribute(key, value);
  }
  for (const child of children) if (child) element.append(child);
  return element;
}
