// dom.js — tiny DOM construction helpers for the "who can get in" screen.
//
// A self-contained copy of js/catalogue/dom.js (which is itself a copy of the
// Orders original, minus groupBy — nothing here groups anything): the project
// rule is that a feature folder never imports from another feature's folder.
// Kept in sync by hand if the shared idea ever changes, and pinned by
// tests/copie-allineate.test.mjs so "by hand" is not the only thing watching.
//
// CSP-safe by design: user data is set via textContent (never innerHTML), and
// styles are applied through the CSSOM (element.style), which the page CSP allows
// — unlike inline style="" attributes in markup.

// Create an element. props keys:
//   class   -> className
//   text    -> textContent (safe for user data)
//   dataset -> Object.assign(node.dataset, ...)
//   style   -> Object.assign(node.style, ...)  (CSSOM, CSP-safe)
//   onX     -> addEventListener('x', fn)
//   icon    -> innerHTML for STATIC author-controlled SVG markup only
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
