// Source-level check (P15) for the defect that has now happened THREE TIMES in
// two days, and that nothing else in this project can catch.
//
// ⚠️ AN UNDEFINED CUSTOM PROPERTY INVALIDATES THE WHOLE DECLARATION, AND THE
// BROWSER DROPS IT IN SILENCE. No console warning, no error, nothing on screen
// saying why — the element simply inherits whatever was around it, and the CSS
// goes on reading as correct and deliberate to anybody who looks at it.
//
//   11 Aug 2026 (v268)  six rules wrote `font-size: var(--text-3)`. The
//                       --text-N names are COLOURS and there is no --text-1.
//   12 Aug 2026 (v273)  --space-2/3/4 were used by TWENTY declarations and
//                       defined nowhere. Two whole screens rendered with no
//                       padding and no gaps, flush to the edge of the phone,
//                       for a day. A measuring pass had reported "no problems"
//                       immediately before — nothing had asked whether anything
//                       had padding at all.
//   12 Aug 2026 (this)  `border: 1.5px solid var(--rim)` in foodcost.css. The
//                       token is --rim-border. Food Cost's header button had no
//                       rim while the identical button on Orders, the Catalogue
//                       and the help screens had one.
//
// A measurement only finds what it is told to look for. This asks the question
// once, for every stylesheet at once, and it costs milliseconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sheets = readdirSync(root).filter(name => name.endsWith('.css'));

// Comments are stripped first: the warnings above are written IN the CSS and
// name the very tokens that must not be used, so a scan that reads them reports
// the documentation as the bug.
const withoutComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '');

function scan() {
  const defined = new Set();
  const used = new Map();          // name -> Set of files
  for (const name of sheets) {
    const src = withoutComments(readFileSync(new URL(name, root), 'utf8'));
    for (const m of src.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) defined.add(m[1]);
    for (const m of src.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1]).add(name);
    }
  }
  return { defined, used };
}

test('every var(--name) in every stylesheet is defined somewhere', () => {
  const { defined, used } = scan();
  const missing = [...used]
    .filter(([name]) => !defined.has(name))
    .map(([name, files]) => `${name} (used in ${[...files].join(', ')})`);

  assert.deepEqual(missing, [],
    'these resolve to nothing, so the browser discards the whole declaration '
    + 'without a word:\n  ' + missing.join('\n  '));
});

// A fallback — var(--x, 12px) — is NOT an excuse: it saves the declaration but
// means the intended token never applies, which is the same silent wrong answer
// with a different value. This is a smaller net than the test above on purpose;
// it just refuses to let a fallback hide a name that exists nowhere.
test('the check looks at every stylesheet the app ships', () => {
  // If a stylesheet is ever added and this list is not how it is found, the
  // check above silently stops covering it — the failure mode this whole file
  // exists to prevent.
  for (const expected of ['tokens.css', 'auth.css', 'style.css', 'orders.css',
                          'catalogue.css', 'foodcost.css']) {
    assert.ok(sheets.includes(expected), `${expected} is not being scanned`);
  }
});

// ⚠️ THE ONE THAT WOULD HAVE CAUGHT 12 AUGUST. --space-N is the spacing scale
// the staff and sign-in screens are built from; it was added to the markup a day
// before it was added to tokens.css. Pinning the names means the next screen
// that reaches for one cannot find it missing.
test('the spacing scale exists, all four steps of it', () => {
  const { defined } = scan();
  for (const step of ['--space-1', '--space-2', '--space-3', '--space-4']) {
    assert.ok(defined.has(step), `${step} is used by layout rules and must exist`);
  }
});
