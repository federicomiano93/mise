// dom.js — tiny DOM construction helpers for the Food Cost screen.
//
// A COPY of js/catalogue/dom.js, byte-identical below this header. It is copied
// rather than imported because a feature folder never imports from another
// feature's folder (CLAUDE.md, "Modular by feature") — the rule that keeps each
// feature liftable into its own app. tests/copie-allineate.test.mjs is what stops
// the copies drifting apart unnoticed.
//
// CSP-safe by design: user data is set via textContent (never innerHTML), and
// styles are applied through the CSSOM (element.style), which the page CSP
// allows — unlike inline style="" attributes in markup.
//   anything else -> setAttribute
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key === 'icon') node.innerHTML = value; // static SVG only — never user data
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value);
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}
