// The existing Appointment pathway graph.
// Spoken lines are instructions for the voice agent. There is no booking API
// and no calendar in this project, so this flow collects details and says so.
// Other pathways must not import this graph.

const GREETING =
  "Hello, I'm an AI voice assistant. I can help you arrange an appointment. What type of appointment do you need?";

function node(id, type, x, y, data) {
  return { id, type, position: { x, y }, data: { status: "Active", ...data } };
}

function route(id, x, y, name, guidance, conditions, otherwise) {
  return node(id, "route", x, y, {
    name,
    description: guidance,
    conditions,
    otherwise,
  });
}

function edge(source, target, sourceHandle = "out") {
  return {
    id: `e-${source}-${sourceHandle}-${target}`,
    source,
    sourceHandle,
    target,
  };
}

function when(id, value) {
  return { id, value };
}

const busy = () => when("busy", "The caller is busy, unavailable, or asks to talk later");
const no = () => when("no", "The caller does not want an appointment");
const cancel = () => when("cancel", "The caller wants to cancel an appointment");

export const APPOINTMENT_NODES = [
  node("start-1", "start", 480, 24, {
    name: "Greeting",
    description: GREETING,
    flow: "arrange-appointment",
    languageMode: "follow-caller",
  }),
  route(
    "route-intent",
    480,
    216,
    "Appointment intent",
    "Classify the reply. Do not ask a new question.",
    [
      when("type", "The caller wants an appointment and has named the type, or clearly agrees to arrange one and states the purpose"),
      busy(),
      no(),
      cancel(),
    ],
    "The reply is unclear or about something unrelated",
  ),
  node("clarify-type", "default", 48, 408, {
    name: "Clarify appointment type",
    description:
      "If the caller asked something unrelated, answer in one short sentence, then ask what type of appointment they need. If the answer was unclear, politely ask them to say the type once more. Ask only that. If they are speaking Hindi or Gujarati, ask in that language.",
  }),
  node("ask-date", "default", 480, 408, {
    name: "Ask preferred date",
    description:
      "Ask only for their preferred date. Understand today, tomorrow, next week, and next Monday, and repeat the actual date in the same sentence to check it. If they also mentioned a time, remember it but do not ask about it yet. If the date is unclear, ask one short clarifying question. If they asked something unrelated, answer in one short sentence and then ask for the date again. If appointment_date was supplied and is a real date, offer that date instead of inventing one. Never say a date is available or unavailable, and never offer open slots.",
  }),
  route(
    "route-date",
    480,
    600,
    "Date reply",
    "Decide whether the preferred date is clear.",
    [
      when("ok", "A preferred date is clear, including today, tomorrow, next week, or next Monday"),
      busy(),
      no(),
      cancel(),
    ],
    "The date is unclear, they want a different date, or the reply is about something else",
  ),
  node("ask-time", "default", 480, 792, {
    name: "Ask preferred time",
    description:
      "Ask only for their preferred time. Understand morning, afternoon, and after 5 PM, and repeat a clock time to check it. If they already said a time, confirm that time instead of asking from scratch. If it is unclear, ask one short clarifying question. If they asked something unrelated, answer briefly and ask for the time again. If appointment_time was supplied and is a real time, offer that time. Never say the time is free, unavailable, or booked.",
  }),
  route(
    "route-time",
    480,
    984,
    "Time reply",
    "Decide whether the preferred time is clear.",
    [
      when("ok", "A preferred time is clear, including morning, afternoon, or after 5 PM"),
      busy(),
      no(),
      cancel(),
    ],
    "The time is unclear, they want a different time, or the reply is about something else",
  ),
  node("verify-when", "default", 480, 1176, {
    name: "Verify date and time",
    description:
      "Repeat the selected date and the selected time in one short sentence, then ask if both are correct. Wait for the answer. Do not say the slot is available, unavailable, booked, or held. If they asked something unrelated, answer briefly and repeat the date and time.",
  }),
  route(
    "route-verify",
    480,
    1368,
    "Verify reply",
    "Decide whether the caller accepts this date and time.",
    [
      when("ok", "The caller confirms the date and time"),
      when("change", "The caller wants a different date or time, or says that date or time does not work"),
      busy(),
      no(),
      cancel(),
    ],
    "The answer is unclear or about something unrelated",
  ),
  node("ask-name", "default", 480, 1560, {
    name: "Ask full name",
    description:
      "If customer_name was supplied and is a real person's name, repeat it and ask if it is correct. Otherwise ask for their full name. Ask nothing else. If the name is unclear, ask once more. Never read a variable name, braces, or an empty value aloud.",
  }),
  route(
    "route-name",
    480,
    1752,
    "Name reply",
    "Decide whether the caller's name is clear.",
    [
      when("ok", "The caller gave a full name, or confirmed the name already supplied"),
      busy(),
      no(),
      cancel(),
    ],
    "The name is unclear or the reply is about something else",
  ),
  node("contact", "default", 480, 1944, {
    name: "Contact details",
    description:
      "Ask for a preferred contact detail only if you still have no phone number for this caller, or they want a different number or contact method. If this call already has their number, do not ask a question and do not invent an email or another number. If you do ask, ask only that and wait. If you do not ask, go straight on without waiting.",
  }),
  node("summary", "default", 480, 2136, {
    name: "Summarize details",
    description:
      'In one or two short sentences, summarize the appointment purpose, the caller\'s name, the selected date, and the selected time. Then ask exactly: "Would you like me to confirm these details?" If the caller is speaking Hindi or Gujarati, ask that same question in their language. Do not add a booking reference. Do not say the appointment is booked, confirmed, or scheduled. Wait for the answer.',
  }),
  route(
    "route-summary",
    480,
    2328,
    "Summary reply",
    "Decide what the caller wants to do with the summarized details.",
    [
      when("yes", "The caller wants these details confirmed"),
      when("reschedule", "The caller wants to reschedule or change the date or time"),
      when("change", "The caller wants to change the appointment purpose or their name"),
      no(),
      busy(),
      cancel(),
    ],
    "The answer is unclear or about something unrelated",
  ),
  node("collected", "default", 480, 2520, {
    name: "Details collected",
    description:
      "Thank them in a few words. Repeat the purpose, name, date, and time once. Then say clearly that these details have been collected, but the appointment is not yet confirmed, because no booking system is connected. Do not invent a confirmation number. Do not say booked, confirmed, reserved, or scheduled.",
  }),
  node("end-call", "endCall", 480, 2712, {
    name: "Polite ending",
    description: "Thank you for your time. Goodbye.",
  }),
  node("change", "default", 960, 2328, {
    name: "Change a detail",
    description:
      "Ask which detail they want to change: the purpose, the date, the time, or their name. One question only.",
  }),
  route(
    "route-change",
    960,
    2520,
    "Change reply",
    "Choose which detail to collect again.",
    [
      when("purpose", "The caller wants to change the appointment type or purpose"),
      when("when", "The caller wants to change the date or time, or wants to reschedule"),
      when("name", "The caller wants to change their name"),
      busy(),
      no(),
      cancel(),
    ],
    "The answer is unclear",
  ),
  node("update-purpose", "default", 960, 2712, {
    name: "Update purpose",
    description:
      "Ask what type of appointment they need now. One question. If they asked something unrelated, answer briefly and ask the type again.",
  }),
  route(
    "route-purpose",
    960,
    2904,
    "Purpose reply",
    "Decide whether the new appointment type is clear.",
    [
      when("ok", "The caller named the type of appointment"),
      busy(),
      no(),
      cancel(),
    ],
    "The type is unclear or the reply is about something else",
  ),
  node("busy", "default", 48, 792, {
    name: "Caller is busy",
    description:
      "Say you understand they are busy. In one short question, offer to continue later or to end the call now. Do not ask for an appointment detail in this sentence.",
  }),
  route(
    "route-busy",
    48,
    984,
    "Busy reply",
    "Decide whether to continue the call or end it.",
    [
      when("continue", "The caller wants to continue the appointment now"),
      when("end", "The caller wants to end the call or continue later"),
    ],
    "The answer is unclear",
  ),
  node("resume", "default", 48, 1176, {
    name: "Continue appointment",
    description:
      "Pick up from the first detail you still do not have. Ask only one question: the appointment type, or if you have that, the preferred date, or if you have that, the preferred time, or if the date and time are not yet verified, whether they are correct, or if you still need it, their full name. If you already have everything, say nothing.",
  }),
  route(
    "route-resume",
    48,
    1368,
    "Continue reply",
    "Match the detail the caller just gave.",
    [
      when("type", "The caller just gave the appointment type, and the date is still unknown"),
      when("date", "The caller just gave a preferred date, and the time is still unknown"),
      when("time", "The caller just gave a preferred time"),
      when("confirmed", "The caller just confirmed the date and time, and their name is still missing"),
      when("name", "The caller just gave or confirmed their name"),
      busy(),
      no(),
      cancel(),
    ],
    "They only agreed to continue, or the answer is unclear, so ask the next missing detail",
  ),
  node("cancel", "default", 48, 1560, {
    name: "Cancellation",
    description:
      "Explain that a cancellation has to be done in the booking system, and that you cannot cancel an appointment on this call. Do not say a cancellation was completed. Then ask whether they want help arranging an appointment, or they want to end the call. One question.",
  }),
  route(
    "route-cancel",
    48,
    1752,
    "Cancel reply",
    "Decide whether they still want to arrange an appointment.",
    [
      when("arrange", "The caller wants help arranging an appointment"),
      when("end", "The caller wants to end the call"),
      busy(),
      no(),
    ],
    "The answer is unclear",
  ),
  node("decline", "default", 48, 2136, {
    name: "No appointment",
    description:
      "Acknowledge that they do not want an appointment. Thank them briefly. Do not try to persuade them and do not ask another appointment question.",
  }),
];

export const APPOINTMENT_EDGES = [
  edge("start-1", "route-intent"),
  edge("route-intent", "ask-date", "condition-type"),
  edge("route-intent", "busy", "condition-busy"),
  edge("route-intent", "decline", "condition-no"),
  edge("route-intent", "cancel", "condition-cancel"),
  edge("route-intent", "clarify-type", "out-b"),
  edge("clarify-type", "route-intent"),

  edge("ask-date", "route-date"),
  edge("route-date", "ask-time", "condition-ok"),
  edge("route-date", "busy", "condition-busy"),
  edge("route-date", "decline", "condition-no"),
  edge("route-date", "cancel", "condition-cancel"),
  edge("route-date", "ask-date", "out-b"),

  edge("ask-time", "route-time"),
  edge("route-time", "verify-when", "condition-ok"),
  edge("route-time", "busy", "condition-busy"),
  edge("route-time", "decline", "condition-no"),
  edge("route-time", "cancel", "condition-cancel"),
  edge("route-time", "ask-time", "out-b"),

  edge("verify-when", "route-verify"),
  edge("route-verify", "ask-name", "condition-ok"),
  edge("route-verify", "ask-date", "condition-change"),
  edge("route-verify", "busy", "condition-busy"),
  edge("route-verify", "decline", "condition-no"),
  edge("route-verify", "cancel", "condition-cancel"),
  edge("route-verify", "verify-when", "out-b"),

  edge("ask-name", "route-name"),
  edge("route-name", "contact", "condition-ok"),
  edge("route-name", "busy", "condition-busy"),
  edge("route-name", "decline", "condition-no"),
  edge("route-name", "cancel", "condition-cancel"),
  edge("route-name", "ask-name", "out-b"),

  edge("contact", "summary"),
  edge("summary", "route-summary"),
  edge("route-summary", "collected", "condition-yes"),
  edge("route-summary", "ask-date", "condition-reschedule"),
  edge("route-summary", "change", "condition-change"),
  edge("route-summary", "decline", "condition-no"),
  edge("route-summary", "busy", "condition-busy"),
  edge("route-summary", "cancel", "condition-cancel"),
  edge("route-summary", "summary", "out-b"),
  edge("collected", "end-call"),

  edge("change", "route-change"),
  edge("route-change", "update-purpose", "condition-purpose"),
  edge("route-change", "ask-date", "condition-when"),
  edge("route-change", "ask-name", "condition-name"),
  edge("route-change", "busy", "condition-busy"),
  edge("route-change", "decline", "condition-no"),
  edge("route-change", "cancel", "condition-cancel"),
  edge("route-change", "change", "out-b"),

  edge("update-purpose", "route-purpose"),
  edge("route-purpose", "summary", "condition-ok"),
  edge("route-purpose", "busy", "condition-busy"),
  edge("route-purpose", "decline", "condition-no"),
  edge("route-purpose", "cancel", "condition-cancel"),
  edge("route-purpose", "update-purpose", "out-b"),

  edge("busy", "route-busy"),
  edge("route-busy", "resume", "condition-continue"),
  edge("route-busy", "end-call", "condition-end"),
  edge("route-busy", "busy", "out-b"),

  edge("resume", "route-resume"),
  edge("route-resume", "ask-date", "condition-type"),
  edge("route-resume", "ask-time", "condition-date"),
  edge("route-resume", "verify-when", "condition-time"),
  edge("route-resume", "ask-name", "condition-confirmed"),
  edge("route-resume", "contact", "condition-name"),
  edge("route-resume", "busy", "condition-busy"),
  edge("route-resume", "decline", "condition-no"),
  edge("route-resume", "cancel", "condition-cancel"),
  edge("route-resume", "resume", "out-b"),

  edge("cancel", "route-cancel"),
  edge("route-cancel", "resume", "condition-arrange"),
  edge("route-cancel", "end-call", "condition-end"),
  edge("route-cancel", "busy", "condition-busy"),
  edge("route-cancel", "decline", "condition-no"),
  edge("route-cancel", "cancel", "out-b"),

  edge("decline", "end-call"),
];

export function createAppointmentPathway() {
  return {
    nodes: structuredClone(APPOINTMENT_NODES),
    edges: structuredClone(APPOINTMENT_EDGES),
  };
}
