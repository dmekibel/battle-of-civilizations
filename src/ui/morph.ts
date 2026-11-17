// Updates the page in place instead of rebuilding it. Rebuilding threw away every picture on the
// board (and the big ground painting) on each redraw, which showed as blinking while the camera moved.

/** Things that play an animation when they appear: these are swapped for new ones so it starts afresh. */
const FRESH = /(^|\s)(slide|hop|lunge|hit|ghost|float|spark|dust|tracer|muzzle|smoke|arrow|flight|bump)(\s|$)/;
/** Nodes the page adds by hand (the ground painting): left alone. */
const kept = (n: Node) => n.nodeType === 1 && (n as HTMLElement).dataset?.keep === '1';

/** Makes `old` look like `next`, keeping every element that is still the same kind of thing. */
export function morph(old: Element, next: Element, freshBoards = false) {
  for (const a of Array.from(old.attributes)) if (!next.hasAttribute(a.name)) old.removeAttribute(a.name);
  for (const a of Array.from(next.attributes)) if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
  if (old instanceof HTMLInputElement && next instanceof HTMLInputElement) {
    if (old.value !== next.value) old.value = next.value;
    if (old.checked !== next.checked) old.checked = next.checked;
  }
  const was = Array.from(old.childNodes).filter((n) => !kept(n));
  const now = Array.from(next.childNodes);
  for (let i = 0; i < now.length; i++) {
    const o = was[i];
    const n = now[i];
    if (!o) old.appendChild(n);
    else if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName) (o as ChildNode).replaceWith(n);
    else if (n.nodeType !== 1) {
      if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
    } else {
      const [oe, ne] = [o as Element, n as Element];
      const cls = ne.getAttribute('class') ?? '';
      // A board that carries moves or blows to play is put in whole, so every animation runs from its start.
      if ((freshBoards && ne.nodeName === 'svg' && /(^|\s)board(\s|$)/.test(cls)) || FRESH.test(cls)) oe.replaceWith(ne);
      else morph(oe, ne, freshBoards);
    }
  }
  for (let i = now.length; i < was.length; i++) (was[i] as ChildNode).remove();
}

/** Makes the inside of `host` match `html`. */
export function morphInto(host: Element, html: string, freshBoards = false) {
  const t = document.createElement('template');
  t.innerHTML = html;
  const shell = host.cloneNode(false) as Element;
  shell.append(...Array.from(t.content.childNodes));
  morph(host, shell, freshBoards);
}
