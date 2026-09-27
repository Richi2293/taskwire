import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentMarkdown } from '../src/shape.ts';
import type { RawCommentBlock } from '../src/clickup-types.ts';

// Blocks returned by GET /task/{id}/comment for a comment written with comment_markdown (checked live).
const blocks: RawCommentBlock[] = [
  { text: 'Done:', attributes: { bold: true } },
  { text: ' first line with ', attributes: {} },
  { text: 'code', attributes: { code: true } },
  { text: ' and a ', attributes: {} },
  { text: 'link', attributes: { link: 'https://example.com' } },
  { text: '.', attributes: {} },
  { text: '\n\n', attributes: { blockquote: {} } },
  { text: 'Status:', attributes: { bold: true } },
  { text: ' second quote line.', attributes: {} },
  { text: '\n', attributes: { blockquote: {} } },
  { type: 'divider', attributes: {}, divider: true },
  { text: '\nDetails', attributes: {} },
  { text: '\n', attributes: { header: 3 } },
  { text: '\n', attributes: {} },
  { text: 'Branch:', attributes: { bold: true } },
  { text: ' ', attributes: {} },
  { text: 'feat/x', attributes: { code: true } },
  { text: ', commit ', attributes: {} },
  { text: 'abc123', attributes: { code: true } },
  { text: '\n', attributes: { list: 'bullet' } },
  { text: 'plain bullet with ', attributes: {} },
  { text: 'italic', attributes: { italic: true } },
  { text: ' and ', attributes: {} },
  { text: 'strike', attributes: { strike: true } },
  { text: '\n', attributes: { list: 'bullet' } },
  { text: 'nested bullet', attributes: {} },
  { text: '\n', attributes: { list: 'bullet', indent: 1 } },
  { text: '\nfirst step', attributes: {} },
  { text: '\n', attributes: { list: 'ordered' } },
  { text: 'second step', attributes: {} },
  { text: '\n', attributes: { list: 'ordered' } },
  { text: '\nopen item', attributes: {} },
  { text: '\n', attributes: { list: 'unchecked' } },
  { text: 'done item', attributes: {} },
  { text: '\n', attributes: { list: 'checked' } },
  { text: '\nHeading two', attributes: {} },
  { text: '\n', attributes: { header: 2 } },
  { text: '\nParagraph line one\nline two after a single break.\n\ncode block line 1', attributes: {} },
  { text: '\n', attributes: { 'code-block': { 'code-block': true } } },
  { text: 'code block line 2', attributes: {} },
  { text: '\n', attributes: { 'code-block': { 'code-block': true } } },
  { text: '\nText with snake_case_name, 2 * 3, #123 and a/path/file.ts.\n', attributes: {} },
];

test('commentMarkdown rebuilds the markdown of a formatted comment', () => {
  assert.equal(
    commentMarkdown(blocks, 'plain'),
    [
      '> **Done:** first line with `code` and a [link](https://example.com).',
      '> **Status:** second quote line.',
      '',
      '---',
      '',
      '### Details',
      '',
      '- **Branch:** `feat/x`, commit `abc123`',
      '- plain bullet with *italic* and ~~strike~~',
      '  - nested bullet',
      '',
      '1. first step',
      '2. second step',
      '',
      '- [ ] open item',
      '- [x] done item',
      '',
      '## Heading two',
      '',
      'Paragraph line one',
      'line two after a single break.',
      '',
      '```',
      'code block line 1',
      'code block line 2',
      '```',
      '',
      'Text with snake_case_name, 2 * 3, #123 and a/path/file.ts.',
    ].join('\n'),
  );
});

test('commentMarkdown keeps a plain text comment as it is', () => {
  assert.equal(commentMarkdown([{ text: 'Done\nsecond line\n', attributes: {} }], 'Done\nsecond line'), 'Done\nsecond line');
});

test('commentMarkdown restarts the numbering of each ordered list', () => {
  const ordered: RawCommentBlock[] = [
    { text: 'a', attributes: {} },
    { text: '\n', attributes: { list: 'ordered' } },
    { text: 'b', attributes: {} },
    { text: '\n', attributes: { list: 'ordered' } },
    { text: '\nc', attributes: {} },
    { text: '\n', attributes: { list: 'ordered' } },
  ];
  assert.equal(commentMarkdown(ordered, 'plain'), '1. a\n2. b\n\n1. c');
});

test('commentMarkdown combines inline formats', () => {
  const combined: RawCommentBlock[] = [
    { text: 'bold link', attributes: { bold: true, link: 'https://example.com' } },
    { text: '\n', attributes: {} },
  ];
  assert.equal(commentMarkdown(combined, 'plain'), '[**bold link**](https://example.com)');
});

test('commentMarkdown falls back to the plain text when a block is unknown', () => {
  const withMention: RawCommentBlock[] = [
    { text: 'Hello ', attributes: {} },
    { type: 'tag', user: { id: 7, username: 'jane' } },
    { text: '\n', attributes: {} },
  ];
  assert.equal(commentMarkdown(withMention, 'Hello @jane'), 'Hello @jane');
});

test('commentMarkdown falls back to the plain text without blocks', () => {
  assert.equal(commentMarkdown(undefined, 'Done'), 'Done');
  assert.equal(commentMarkdown([], 'Done'), 'Done');
});

test('commentMarkdown ignores inline formats it does not know', () => {
  const colored: RawCommentBlock[] = [
    { text: 'red', attributes: { color: '#ff0000' } },
    { text: '\n', attributes: {} },
  ];
  assert.equal(commentMarkdown(colored, 'red'), 'red');
});
