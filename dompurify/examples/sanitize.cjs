const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('../dist/purify.cjs.js');

const window = new JSDOM('<!doctype html><body></body>').window;
try {
  const DOMPurify = createDOMPurify(window);
  const dirty =
    '<form id="location">' +
    '<a href="javascript:alert(1)" onclick="alert(2)">go</a>' +
    '<svg><circle pointer-events="all" onload="alert(3)" /></svg>' +
    '<script>alert(4)</script>' +
    '</form>';
  const clean = DOMPurify.sanitize(dirty);
  assert.equal(clean, '<form><a>go</a><svg><circle pointer-events="all"></circle></svg></form>');
  assert.equal(DOMPurify.removed.length, 5);
  console.log(clean);
  console.log('PASS: exact output; removed.length = 5');
} finally {
  window.close();
}
