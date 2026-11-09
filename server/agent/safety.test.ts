import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRisk, isAffirmative, isNegative, matchesPending } from './safety.ts';

const btn = (label: string, extra: Record<string, unknown> = {}) => ({ id: 'e1', role: 'button', label, ...extra });

test('consequential clicks need confirmation', () => {
  for (const label of ['Buy now', 'Place your order', 'Proceed to checkout', 'Send', 'Post', 'Delete account', 'Subscribe', 'Pay ₹499']) {
    assert.equal(classifyRisk('click_element', {}, btn(label), 'https://example.com').level, 'needs_confirmation', label);
  }
  assert.equal(
    classifyRisk('click_element', {}, { id: 'e2', role: 'link', label: 'Continue', href: 'https://shop.example/checkout' }, 'https://shop.example').level,
    'needs_confirmation'
  );
});

test('harmless clicks are allowed', () => {
  for (const label of ['Videos', 'Next page', 'Show more', 'Play', 'Settings menu', 'Learn React']) {
    assert.equal(classifyRisk('click_element', {}, btn(label), 'https://www.google.com/search?q=x').level, 'safe', label);
  }
});

test('typing: search boxes are fine, other submits and passwords are not', () => {
  const search = { id: 'e3', role: 'input', label: 'Search mail', inputType: 'text', form: 'other' as const };
  assert.equal(classifyRisk('type_text', { submit: true }, search, 'https://mail.google.com').level, 'safe');
  const q = { id: 'e4', role: 'input', label: 'q', inputType: 'text', form: 'search' as const };
  assert.equal(classifyRisk('type_text', { submit: true }, q, 'https://www.google.com').level, 'safe');
  const comment = { id: 'e5', role: 'textarea', label: 'Add a comment', inputType: 'textarea', form: 'other' as const };
  assert.equal(classifyRisk('type_text', { submit: true }, comment, 'https://www.youtube.com/watch?v=1').level, 'needs_confirmation');
  assert.equal(classifyRisk('type_text', { submit: false }, comment, 'https://www.youtube.com/watch?v=1').level, 'safe');
  const pwd = { id: 'e6', role: 'input', label: 'Password', inputType: 'password' };
  assert.equal(classifyRisk('type_text', { submit: false }, pwd, 'https://accounts.google.com').level, 'needs_confirmation');
});

test('non-web URLs are refused', () => {
  assert.equal(classifyRisk('open_url', { url: 'javascript:alert(1)' }, undefined, undefined).level, 'needs_confirmation');
  assert.equal(classifyRisk('open_url', { url: 'https://youtube.com' }, undefined, undefined).level, 'safe');
});

test('confirmation replies in English, Hindi and Bengali', () => {
  for (const yes of ['yes', 'Yes, go ahead', 'sure', 'ok do it', 'haan', 'हाँ', 'ठीक है', 'হ্যাঁ', 'Sage, yes']) assert.ok(isAffirmative(yes), yes);
  for (const no of ['no', "don't", 'cancel', 'नहीं', 'না', 'wait']) {
    assert.ok(isNegative(no), no);
    assert.ok(!isAffirmative(no), no);
  }
  assert.ok(!isAffirmative('search for yesterday news'));
});

test('approval only matches the exact pending action', () => {
  const pending = { tool: 'click_element', args: { element_id: 'e5' }, summary: 'buy', createdAt: Date.now() };
  assert.ok(matchesPending(pending, 'click_element', { element_id: 'e5' }));
  assert.ok(!matchesPending(pending, 'click_element', { element_id: 'e6' }));
  assert.ok(!matchesPending({ ...pending, createdAt: Date.now() - 10 * 60_000 }, 'click_element', { element_id: 'e5' }), 'approvals expire');
});
