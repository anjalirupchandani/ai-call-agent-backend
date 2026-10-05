// lib/pathwayAgent.js
// Prepares the ONE shared Edesy agent for a specific pathway.
//
//   pathwayId → load pathway from MongoDB → build prompt + greeting
//             → PATCH the existing Edesy agent → confirm it succeeded
//
// The caller (callController.createEdesyCall) must `await` this and only then
// place the call. If this function throws, the call MUST NOT be started.
//
// ─────────────────────────────────────────────────────────────────────────────
// CONCURRENCY WARNING
// The Edesy agent is shared between calls. Updating the agent before each call
// can cause a race condition if multiple calls using different pathways are
// started simultaneously. For production concurrent calling, use separate
// agents per pathway or a different stateful/deterministic architecture.
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import Pathway from "./models/Pathway.js";
import { EdesyError, updateAgentPrompt } from "./edesy.js";
import { buildPathwayPrompt, PathwayPromptError } from "./pathwayPrompt.js";

export const AGENT_PREPARE_FAILED_MESSAGE =
  "Unable to prepare the Edesy agent for this pathway. The call was not started.";

function pathwayError(message, code, status) {
  const err = new PathwayPromptError(message, code);
  err.status = status;
  return err;
}

async function defaultLoadPathway(pathwayId) {
  // Pathways are shared by all users, so look it up by id only.
  return Pathway.findOne({ _id: pathwayId });
}

/**
 * Loads the pathway with the given id (always fresh from MongoDB — never from
 * frontend state or a cache), turns it into the agent prompt + greeting and
 * writes both onto the existing Edesy agent.
 *
 * Resolves only after Edesy has confirmed the update (HTTP 2xx).
 *
 * @param {string} pathwayId  the pathwayId submitted with THIS call request
 * @param {string} userId     owner of the pathway
 * @param {object} [deps]     injectable for tests
 * @returns {Promise<{pathwayId: string, pathwayName: string, agentId: number,
 *                    stepCount: number, warnings: string[], updated: true}>}
 * @throws {PathwayPromptError} pathway missing / not deployed / invalid
 * @throws {EdesyError} code AGENT_UPDATE_FAILED (or NOT_CONFIGURED) when Edesy
 *                      could not be updated
 */
export async function updateEdesyAgentForPathway(
  pathwayId,
  userId,
  { loadPathway = defaultLoadPathway, updateAgent = updateAgentPrompt } = {}
) {
  if (!mongoose.Types.ObjectId.isValid(pathwayId)) {
    throw pathwayError("Invalid pathwayId.", "INVALID_PATHWAY_ID", 400);
  }

  // 1. Load the pathway that was submitted with this request.
  const pathway = await loadPathway(pathwayId, userId);
  if (!pathway) {
    throw pathwayError("Pathway not found.", "PATHWAY_NOT_FOUND", 404);
  }
  if (pathway.status !== "deployed") {
    throw pathwayError(
      `Pathway "${pathway.name}" is not deployed yet. Open it in the Pathways editor and click Deploy before starting a call.`,
      "PATHWAY_NOT_DEPLOYED",
      400
    );
  }

  // 2. Steps, connections, If/Otherwise branches, greeting → prompt.
  let compiled;
  try {
    compiled = buildPathwayPrompt(pathway);
  } catch (err) {
    if (err instanceof PathwayPromptError) {
      throw pathwayError(
        `Pathway "${pathway.name}" is invalid: ${err.message}`,
        err.code,
        err.status || 400
      );
    }
    throw err;
  }
  if (compiled.warnings?.length) {
    console.warn(`[pathway] warnings for "${pathway.name}":`, compiled.warnings.join(" | "));
  }

  // 3. Replace the agent's system prompt + greeting on Edesy and WAIT for the
  //    result. Any failure here is turned into one clear error for the frontend.
  let agentId;
  try {
    ({ agentId } = await updateAgent({
      prompt: compiled.prompt,
      greetingMessage: compiled.greeting,
    }));
  } catch (err) {
    console.error(
      `[pathway] Edesy agent update failed for pathway ${pathwayId}:`,
      err?.code || "-",
      err?.message
    );
    if (err instanceof EdesyError) {
      // Keep Edesy's own reason (bad key, missing agents:write, credits, …) but
      // lead with the message the UI should show.
      const wrapped = new EdesyError(`${AGENT_PREPARE_FAILED_MESSAGE} ${err.message}`, {
        status: err.status,
        code: err.code === "NOT_CONFIGURED" ? err.code : "AGENT_UPDATE_FAILED",
      });
      wrapped.cause = err;
      throw wrapped;
    }
    throw new EdesyError(AGENT_PREPARE_FAILED_MESSAGE, {
      status: 502,
      code: "AGENT_UPDATE_FAILED",
    });
  }

  console.log(
    `[pathway] Edesy agent ${agentId} now runs pathway "${pathway.name}" (${compiled.stepCount} steps)`
  );

  return {
    pathwayId: String(pathway._id),
    pathwayName: pathway.name,
    agentId,
    stepCount: compiled.stepCount,
    warnings: compiled.warnings || [],
    updated: true,
  };
}