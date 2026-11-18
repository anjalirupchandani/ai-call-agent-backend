// tests/knowledgeQa.test.js
// Real (non-mock) tests for the Q&A-aware knowledge search: a spoken question
// must match the stored Q&A pair (including natural variations) and return its
// answer, while an unrelated question must come back "not found".
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchKnowledgeQA } from "../lib/knowledgeSearch.js";

const ARTICLES = [
  {
    entryType: "qa",
    title: "Services provided",
    question: "What services does your company provide?",
    answer: "We provide software development, AI solutions and IT consulting.",
    variations: [
      "What do you offer?",
      "Which services are available?",
      "What does your company do?",
    ],
    language: "en",
    isActive: true,
  },
  {
    entryType: "qa",
    title: "Business hours",
    question: "What are your business hours?",
    answer: "We are open Monday to Friday, 9 AM to 6 PM.",
    variations: ["When are you open?", "What time do you work?"],
    language: "en",
    isActive: true,
  },
  {
    entryType: "document",
    title: "Pricing guide",
    content:
      "Our basic plan costs $10 per month. The pro plan costs $29 per month and includes priority support. Enterprise pricing is custom.",
    language: "en",
    isActive: true,
  },
];

test("matches the stored question and returns its stored answer", () => {
  const r = searchKnowledgeQA("What services does your company provide?", ARTICLES, {
    language: "en",
  });
  assert.equal(r.found, true);
  assert.equal(
    r.answer,
    "We provide software development, AI solutions and IT consulting."
  );
});

test("matches a natural variation of the question", () => {
  const r = searchKnowledgeQA("so what exactly do you guys offer", ARTICLES, {
    language: "en",
  });
  assert.equal(r.found, true);
  assert.match(r.answer, /software development/i);
});

test("returns not found for an unrelated question", () => {
  const r = searchKnowledgeQA("What is the capital of France?", ARTICLES, {
    language: "en",
  });
  assert.equal(r.found, false);
});

test("still works against document passages", () => {
  const r = searchKnowledgeQA("How much does the pro plan cost?", ARTICLES, {
    language: "en",
  });
  assert.equal(r.found, true);
  assert.match(r.answer, /\$29/);
});

test("ignores inactive entries", () => {
  const r = searchKnowledgeQA("What services does your company provide?", [
    { ...ARTICLES[0], isActive: false },
  ]);
  assert.equal(r.found, false);
});
