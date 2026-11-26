// All calls use relative URLs, so the app also works behind an ingress path prefix.
export class ApiError extends Error {
  constructor(status, message, errors = []) {
    super(message);
    this.status = status;
    this.errors = errors; // strings like "servers[0].site: is required"
  }
}

async function request(path, options = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const detail = body && typeof body === "object" ? body.detail : null;
    const errors = detail && Array.isArray(detail.errors) ? detail.errors : [];
    const message =
      typeof detail === "string" ? detail : errors.length ? "Some answers are not valid" : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, errors);
  }
  return body;
}

export const api = {
  questionnaires: () => request("api/questionnaires"),
  // version: a given version (to edit answers given in it); the latest when left out.
  questionnaire: (id, version) =>
    request(`api/questionnaires/${encodeURIComponent(id)}${version ? `?version=${encodeURIComponent(version)}` : ""}`),
  // edit, optional: { version, replaces } when saving edited answers (see POST /api/submissions).
  submit: (questionnaireId, answers, edit = {}) =>
    request("api/submissions", {
      method: "POST",
      body: JSON.stringify({ questionnaire_id: questionnaireId, answers, ...edit }),
    }),
  systemAnswers: (name) => request(`api/systems/answers?name=${encodeURIComponent(name)}`),
  submissions: () => request("api/submissions"),
  submission: (id) => request(`api/submissions/${encodeURIComponent(id)}`),
  model: () => request("api/model"),
  deleteSystem: (name) => request(`api/systems?name=${encodeURIComponent(name)}`, { method: "DELETE" }),
};
