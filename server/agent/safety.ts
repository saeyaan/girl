/**
 * Safety gate for consequential browser actions.
 *
 * Enforced in the tool executor (not just requested in the prompt): purchases, payments, sending
 * messages, posting, account changes, deletions and non-search form submissions are never run
 * unless the user has explicitly approved that exact action.
 */

import type { PageElement } from '../../src/utils/browserContextManager.ts';
import type { PendingConfirmation } from './workingMemory.ts';

export type Risk = { level: 'safe' } | { level: 'needs_confirmation'; reason: string };

const SENSITIVE_LABEL =
  /\b(buy|purchase|pay|payment|checkout|check out|place (?:your )?order|order now|add to cart|subscribe|join|donate|send|post|publish|tweet|reply all|delete|remove|deactivate|close account|unsubscribe|transfer|withdraw|confirm|submit|sign up|book now|reserve|upgrade|cancel (?:my )?(?:subscription|membership|order)|leave group)\b/i;

const SENSITIVE_URL = /(checkout|\/cart\b|\/payment|\/pay\b|billing|\/buy\b|\/order|paypal\.com|stripe\.com|razorpay|paytm)/i;

/**
 * Decide whether an action may run without asking. `element` is the target element from the
 * latest snapshot (for click/type), `pageUrl` the URL of the page being acted on.
 */
export function classifyRisk(
  tool: string,
  args: Record<string, unknown>,
  element: PageElement | undefined,
  pageUrl: string | undefined
): Risk {
  if (tool === 'click_element') {
    if (!element) return { level: 'safe' }; // executor separately refuses unknown ids
    const label = `${element.label} ${element.href || ''}`;
    if (SENSITIVE_LABEL.test(element.label)) {
      return { level: 'needs_confirmation', reason: `clicking "${element.label}" may buy, send, post, change or delete something` };
    }
    if (element.role === 'button' && element.form === 'other' && element.inputType === 'submit') {
      return { level: 'needs_confirmation', reason: `"${element.label}" submits a form` };
    }
    if (element.href && SENSITIVE_URL.test(element.href)) {
      return { level: 'needs_confirmation', reason: `"${element.label}" leads to a payment or checkout page` };
    }
    if (pageUrl && SENSITIVE_URL.test(pageUrl) && element.role === 'button') {
      return { level: 'needs_confirmation', reason: `this is a payment/checkout page and "${label.trim()}" is a button` };
    }
    return { level: 'safe' };
  }

  if (tool === 'type_text') {
    const submit = Boolean(args.submit);
    if (element && element.inputType === 'password') {
      return { level: 'needs_confirmation', reason: 'that is a password field; please type passwords yourself' };
    }
    if (submit && element && element.form !== 'search' && !isSearchLabel(element.label)) {
      return { level: 'needs_confirmation', reason: `submitting "${element.label || 'this form'}" may send or change something` };
    }
    if (submit && pageUrl && SENSITIVE_URL.test(pageUrl)) {
      return { level: 'needs_confirmation', reason: 'this is a payment/checkout page' };
    }
    return { level: 'safe' };
  }

  if (tool === 'open_url') {
    const url = String(args.url || '');
    if (/^(javascript|data|file|chrome):/i.test(url)) {
      return { level: 'needs_confirmation', reason: 'that is not a normal web address' };
    }
    return { level: 'safe' };
  }

  return { level: 'safe' };
}

function isSearchLabel(label: string): boolean {
  return /\bsearch\b|खोज|অনুসন্ধান|সার্চ/i.test(label || '');
}

/** Same tool + same important args = the action the user approved. */
export function matchesPending(pending: PendingConfirmation | null, tool: string, args: Record<string, unknown>): boolean {
  if (!pending || pending.tool !== tool) return false;
  if (Date.now() - pending.createdAt > 5 * 60_000) return false; // approvals expire
  const keys = ['element_id', 'url', 'text', 'submit'];
  return keys.every((k) => String(pending.args[k] ?? '') === String(args[k] ?? ''));
}

// `\b` doesn't work after Devanagari/Bengali letters in JS regexes, so end on an explicit boundary.
const END = String.raw`(?=$|[\s,.!?।])`;
const AFFIRMATIVE = new RegExp(
  `^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|go ahead|do it|confirm(?:ed)?|please do|proceed|absolutely|of course|haan ji|han ji|ji haan|haan|haa|ha|theek hai|thik hai|kar do|karo|হ্যাঁ|হাঁ|ঠিক আছে|করো|हाँ|हां|ठीक है|कर दो)${END}`,
  'i'
);
const NEGATIVE = new RegExp(
  `^(?:no|nope|nah|don'?t|do not|stop|cancel|never ?mind|wait|hold on|nahi|nahin|mat karo|করো না|নাহ|না|नहीं|मत करो|रुको)${END}`,
  'i'
);

export function isAffirmative(text: string): boolean {
  return AFFIRMATIVE.test(cleanReply(text)) && !NEGATIVE.test(cleanReply(text));
}

export function isNegative(text: string): boolean {
  return NEGATIVE.test(cleanReply(text));
}

function cleanReply(text: string): string {
  return text.trim().toLowerCase().replace(/^(?:hey |ok |okay )?(?:sage|maya)[,\s]*/i, '').trim();
}
