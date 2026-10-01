// lib/scheduler.js
// Places the call when an appointment's date + time arrives.
//
// Every SCHEDULER_INTERVAL_SECONDS the server looks in MongoDB for appointments
// that are "pending" and due, claims each one atomically (so it can never be
// called twice, even if two server copies run), then places the call through the
// SAME code path as the Start Call button (lib/callStarter.js), pathway included.
//
// Credit safety (you have limited Edesy credits):s
//   • NO automatic retries. A failed appointment stays "failed" with the reason.
//   • An appointment later than SCHEDULER_GRACE_MINUTES is NOT called (e.g. the
//     server was off at that time) — it is marked failed ("missed") instead.
//   • A claimed appointment that was interrupted mid-way is never re-dialled.
//   • Calls are placed one at a time (the Edesy agent is shared).

import mongoose from "mongoose";
import ScheduledCall from "./models/ScheduledCall.js";
import { startCall, CallStartError } from "./callStarter.js";
import { normalizePhoneNumber } from "./edesy.js";
import { createNotification } from "../controllers/notificationController.js";

const INTERVAL_MS = Math.max(10, Number(process.env.SCHEDULER_INTERVAL_SECONDS) || 30) * 1000;
const GRACE_MS = Math.max(1, Number(process.env.SCHEDULER_GRACE_MINUTES) || 10) * 60_000;
const STALE_CLAIM_MS = 5 * 60_000;
const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";

let timer = null;
let ticking = false;

function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-IN", {
    timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}
function fmtTime(d) {
  return new Date(d).toLocaleTimeString("en-IN", {
    timeZone: TIMEZONE, hour: "numeric", minute: "2-digit", hour12: true,
  });
}

async function markFailed(job, message, { notify = true } = {}) {
  await ScheduledCall.updateOne(
    { _id: job._id },
    { $set: { status: "failed", errorMessage: String(message).slice(0, 500) } }
  );
  console.warn(`[scheduler] ✖ ${job._id} (${job.name || job.phoneNumber}): ${message}`);
  if (notify) {
    await createNotification(job.userId, {
      type: "call_failed",
      title: "Scheduled call failed",
      message: `${job.name || job.phoneNumber} — ${message}`,
      link: "/dashboard/scheduled-calls",
      meta: { scheduledCallId: String(job._id) },
    });
  }
}

// Returns "done" | "busy"
async function runJob(job) {
  const phone = normalizePhoneNumber(job.phoneNumber);
  if (!phone.ok) {
    await markFailed(job, phone.error);
    return "done";
  }

  const hasRealName = job.name && job.name !== job.phoneNumber;
  const variables = {
    appointment_date: fmtDate(job.scheduledAt),
    appointment_time: fmtTime(job.scheduledAt),
  };
  if (hasRealName) variables.customer_name = job.name;
  if (job.notes) variables.appointment_notes = job.notes.slice(0, 500);

  try {
    const { result, doc } = await startCall({
      userId: job.userId,
      phoneNumber: phone.value,
      customerName: hasRealName ? job.name : "",
      purpose: (job.notes || "Scheduled appointment").slice(0, 200),
      variables,
      pathwayId: job.pathwayId ? String(job.pathwayId) : null,
    });

    await ScheduledCall.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "completed",
          startedAt: new Date(),
          callId: result.conversationId,
          callDbId: doc._id,
          errorMessage: "",
        },
      }
    );
    console.log(`[scheduler] ✔ ${job._id} → call ${result.conversationId}`);
    await createNotification(job.userId, {
      type: "system",
      title: "Scheduled call started",
      message: `Calling ${job.name || job.phoneNumber} now. Follow it in Call History.`,
      link: "/dashboard/calls",
      meta: { scheduledCallId: String(job._id), callId: result.conversationId },
    });
    return "done";
  } catch (err) {
    // Another call was being started at this exact moment → try again next tick.
    if (err instanceof CallStartError && err.code === "CALL_IN_PROGRESS") {
      await ScheduledCall.updateOne(
        { _id: job._id, status: "calling" },
        { $set: { status: "pending", claimedAt: null } }
      );
      return "busy";
    }

    // The call WAS placed, only our Call record failed to save. Never retry.
    if (err instanceof CallStartError && err.code === "SAVE_FAILED") {
      await ScheduledCall.updateOne(
        { _id: job._id },
        {
          $set: {
            status: "completed",
            startedAt: new Date(),
            callId: err.conversationId || "",
            errorMessage: "Call placed, but it could not be saved to Call History.",
          },
        }
      );
      return "done";
    }

    await markFailed(job, err?.message || "Could not place the call.");
    return "done";
  }
}

export async function tick() {
  if (ticking) return;
  if (mongoose.connection.readyState !== 1) return;
  ticking = true;

  try {
    const now = Date.now();

    // 1. A claim older than 5 minutes means the server died mid-call. We can't
    //    know whether the call went out, so do NOT re-dial — flag it.
    await ScheduledCall.updateMany(
      { status: "calling", claimedAt: { $lt: new Date(now - STALE_CLAIM_MS) } },
      {
        $set: {
          status: "failed",
          errorMessage: "Interrupted while calling. Check Call History before calling again.",
        },
      }
    );

    // 2. Too late to call (server was off / DB was down at the appointment time).
    const cutoff = new Date(now - GRACE_MS);
    const missed = await ScheduledCall.find({ status: "pending", scheduledAt: { $lt: cutoff } }).limit(50);
    for (const job of missed) {
      const res = await ScheduledCall.updateOne(
        { _id: job._id, status: "pending" },
        {
          $set: {
            status: "failed",
            errorMessage: `Missed: the server was not able to call within ${Math.round(GRACE_MS / 60_000)} minutes of the appointment time.`,
          },
        }
      );
      if (res.modifiedCount) {
        await createNotification(job.userId, {
          type: "call_failed",
          title: "Scheduled call missed",
          message: `${job.name || job.phoneNumber} (${fmtDate(job.scheduledAt)}, ${fmtTime(job.scheduledAt)}) was not called in time.`,
          link: "/dashboard/scheduled-calls",
          meta: { scheduledCallId: String(job._id) },
        });
      }
    }

    // 3. Due now → claim atomically, then call, one at a time.
    for (let i = 0; i < 20; i++) {
      const job = await ScheduledCall.findOneAndUpdate(
        { status: "pending", scheduledAt: { $lte: new Date(), $gte: cutoff } },
        { $set: { status: "calling", claimedAt: new Date() } },
        { sort: { scheduledAt: 1 }, new: true }
      );
      if (!job) break;
      const outcome = await runJob(job);
      if (outcome === "busy") break;
    }
  } catch (err) {
    console.error("[scheduler] tick error:", err.message);
  } finally {
    ticking = false;
  }
}

export function startScheduler() {
  if (process.env.SCHEDULER_ENABLED === "false") {
    console.log("⏰ Scheduler disabled (SCHEDULER_ENABLED=false)");
    return;
  }
  if (timer) return;
  timer = setInterval(tick, INTERVAL_MS);
  setTimeout(tick, 5000);
  console.log(
    `⏰ Scheduler running — checks every ${INTERVAL_MS / 1000}s, grace ${GRACE_MS / 60_000} min, timezone ${TIMEZONE}`
  );
}