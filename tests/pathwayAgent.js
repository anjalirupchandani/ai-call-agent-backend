// tests/pathwayAgent.test.js
// Run with:  node --test tests/
//
// No network, no MongoDB, no Edesy credits: global fetch is replaced with a
// recorder and the Mongoose models are stubbed. The REAL controller, service,
// prompt builder and Edesy client run.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

process.env.EDESY_API_KEY = "test-key";
process.env.EDESY_AGENT_ID = "42";

const Pathway = (await import("../lib/models/Pathway.js")).default;
const Call = (await import("../lib/models/Call.js")).default;
const { createEdesyCall } = await import("../controllers/callController.js");

const userId = new mongoose.Types.ObjectId();
const idA = new mongoose.Types.ObjectId();
const idB = new mongoose.Types.ObjectId();

const edge = (source, target, sourceHandle) => ({ source, target, ...(sourceHandle ? { sourceHandle } : {}) });

const pathwayA = {
  _id: idA, name: "Pathway A", status: "deployed", userId,
  nodes: [
    { id: "s", type: "start", data: { name: "Greeting", description: "Hello, this is the A team." } },
    { id: "q", type: "default", data: { name: "Interest", description: "Ask customer if interested", ifCondition: "customer says Yes", otherwise: "customer says No" } },
    { id: "y", type: "default", data: { name: "Product", description: "Explain product" } },
    { id: "n", type: "default", data: { name: "Thanks", description: "Thank customer" } },
    { id: "e", type: "endCall", data: { name: "End", description: "Goodbye" } },
  ],
  edges: [edge("s", "q"), edge("q", "y", "out-a"), edge("q", "n", "out-b"), edge("y", "e"), edge("n", "e")],
};

const pathwayB = {
  _id: idB, name: "Pathway B", status: "deployed", userId,
  nodes: [
    { id: "s", type: "start", data: { name: "Greeting", description: "Hi, calling about your order." } },
    { id: "q", type: "default", data: { name: "Status", description: "Ask about order status", ifCondition: "order was Delivered", otherwise: "order not delivered" } },
    { id: "y", type: "default", data: { name: "Feedback", description: "Ask for feedback" } },
    { id: "n", type: "default", data: { name: "Assist", description: "Offer delivery assistance" } },
    { id: "e", type: "endCall", data: { name: "End", description: "Bye" } },
  ],
  edges: [edge("s", "q"), edge("q", "y", "out-a"), edge("q", "n", "out-b"), edge("y", "e"), edge("n", "e")],
};

let requests; // every Edesy HTTP request, in order
let patchStatus; // simulated status for PATCH /agents/:id
let phoneCounter = 0;

beforeEach(() => {
  requests = [];
  patchStatus = 200;

  const store = { [String(idA)]: pathwayA, [String(idB)]: pathwayB };
  Pathway.findOne = async ({ _id }) => store[String(_id)] || null;
  Call.findOne = () => ({ select: async () => null }); // no duplicate call
  Call.create = async (doc) => ({ _id: new mongoose.Types.ObjectId(), ...doc });

  globalThis.fetch = async (url, opts) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    requests.push({ method: opts.method, url, body });
    if (opts.method === "PATCH") {
      const ok = patchStatus === 200;
      return new Response(JSON.stringify(ok ? { success: true } : { success: false, error: "denied" }), { status: patchStatus });
    }
    return new Response(
      JSON.stringify({ success: true, data: { conversationId: "conv-1", callSid: "sid-1", status: "initiated" } }),
      { status: 200 }
    );
  };
});

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

async function startCall(pathwayId) {
  phoneCounter += 1;
  const res = fakeRes();
  await createEdesyCall(
    { userId, body: { phoneNumber: `+9198765${String(10000 + phoneCounter)}`, customerName: "Test", pathwayId: String(pathwayId) } },
    res
  );
  return res;
}

test("Test 1 — Pathway A: agent is updated with A's prompt BEFORE the call starts", async () => {
  const res = await startCall(idA);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`), [
    "PATCH /api/v1/agents/42",
    "POST /api/v1/calls",
  ]);
  const patch = requests[0].body;
  assert.match(patch.prompt, /Ask customer if interested/);
  assert.match(patch.prompt, /Explain product/);
  assert.equal(patch.greetingMessage, "Hello, this is the A team.");
  assert.equal(requests[1].body.agentId, 42); // same single agent
});

test("Test 2 — Pathway A then B: agent instructions are replaced automatically", async () => {
  await startCall(idA);
  const before = requests.length;
  const res = await startCall(idB);
  assert.equal(res.statusCode, 201);
  const patchB = requests.slice(before).find((r) => r.method === "PATCH").body;
  assert.match(patchB.prompt, /Ask about order status/);
  assert.match(patchB.prompt, /Offer delivery assistance/);
  assert.doesNotMatch(patchB.prompt, /Ask customer if interested/);
  assert.doesNotMatch(patchB.prompt, /Explain product/);
  assert.equal(patchB.greetingMessage, "Hi, calling about your order.");
  assert.equal(requests.filter((r) => r.method === "PATCH").length, 2);
});

test("Test 3 — If/Otherwise: both branches are in the generated prompt", async () => {
  await startCall(idA);
  const { prompt } = requests[0].body;
  assert.match(prompt, /IF customer says Yes → go to STEP \d/);
  assert.match(prompt, /OTHERWISE \(customer says No\) → go to STEP \d/);
  assert.match(prompt, /Explain product/);
  assert.match(prompt, /Thank customer/);
});

test("Test 4 — Edesy update fails: call does NOT start, frontend gets a clear error", async () => {
  patchStatus = 403; // e.g. key without agents:write
  let saved = false;
  Call.create = async () => { saved = true; return {}; };

  const res = await startCall(idA);

  assert.equal(requests.some((r) => r.method === "POST"), false, "call must not be placed");
  assert.equal(saved, false, "no call record must be saved");
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Unable to prepare the Edesy agent for this pathway\. The call was not started\./);
  assert.equal(res.body.code, "AGENT_UPDATE_FAILED");
  assert.ok(res.statusCode >= 400 && res.statusCode !== 401);
});

test("Unknown or undeployed pathway: no Edesy request at all", async () => {
  const res = await startCall(new mongoose.Types.ObjectId());
  assert.equal(res.statusCode, 404);
  assert.equal(requests.length, 0);

  pathwayB.status = "draft";
  const res2 = await startCall(idB);
  pathwayB.status = "deployed";
  assert.equal(res2.body.code, "PATHWAY_NOT_DEPLOYED");
  assert.equal(requests.length, 0);
});