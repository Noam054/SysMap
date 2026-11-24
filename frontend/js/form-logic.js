// Pure form logic (no DOM). The server repeats these checks and has the final word;
// doing them here only gives the user instant feedback.

export const isEmpty = (v) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

export function isVisible(question, answers) {
  const cond = question.show_if;
  if (!cond) return true;
  return answers[cond.question] === cond.equals;
}

// Drop answers to hidden questions and blank rows, so only meaningful data is sent.
export function pruneHidden(questions, answers) {
  const out = {};
  for (const q of questions) {
    if (!isVisible(q, answers)) continue;
    const value = answers[q.id];
    if (isEmpty(value)) continue;
    if (q.type === "list") {
      const rows = value
        .map((row) => pruneHidden(q.item, row))
        .filter((row) => Object.keys(row).length > 0);
      if (rows.length) out[q.id] = rows;
    } else {
      out[q.id] = value;
    }
  }
  return out;
}

// Returns [{ path, message }]. Paths look like "servers[0].site".
export function validate(questions, answers, prefix = "") {
  const errors = [];
  for (const q of questions) {
    const path = prefix + q.id;
    if (!isVisible(q, answers)) continue;
    const value = answers[q.id];
    if (isEmpty(value)) {
      if (q.required) errors.push({ path, message: "This answer is required" });
      continue;
    }
    switch (q.type) {
      case "text":
        if (typeof value !== "string") errors.push({ path, message: "Must be text" });
        break;
      case "number":
        if (!isNumber(value)) errors.push({ path, message: "Must be a number" });
        else if (q.min !== undefined && value < q.min) errors.push({ path, message: `Must be ${q.min} or more` });
        else if (q.max !== undefined && value > q.max) errors.push({ path, message: `Must be ${q.max} or less` });
        break;
      case "boolean":
        if (typeof value !== "boolean") errors.push({ path, message: "Choose yes or no" });
        break;
      case "choice":
        if (!(q.options || []).includes(value)) errors.push({ path, message: "Choose one of the options" });
        break;
      case "list":
        if (!Array.isArray(value)) {
          errors.push({ path, message: "Must be a list" });
        } else {
          value.forEach((row, i) => errors.push(...validate(q.item, row, `${path}[${i}].`)));
        }
        break;
      default:
        errors.push({ path, message: `Unknown question type '${q.type}'` });
    }
  }
  return errors;
}

// Server errors arrive as "path: message" strings.
export function parseServerErrors(list) {
  return list.map((s) => {
    const i = s.indexOf(": ");
    return i === -1 ? { path: "", message: s } : { path: s.slice(0, i), message: s.slice(i + 2) };
  });
}
