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

const asList = (ref) => (!ref ? [] : Array.isArray(ref) ? ref : [ref]);

// The list rows a question sits in, outermost first, as { questions, row }.
// Older callers pass an object { listId: row }: those rows only count as "own rows" (see resolve).
function frameList(owners) {
  if (!owners) return [];
  if (Array.isArray(owners)) return owners;
  return Object.values(owners).map((row) => ({ questions: null, row }));
}

// Answers found at a path, as [row, text] pairs:
//   "servers.name"              every "name" in the list "servers" of the nearest row (or the top level)
//                               that has a "servers" question: inside a site block, that site's servers
//   "/servers.name"             from the top level, wherever the question sits
//   "/other_sites.servers.name" every server name of every other site
//   "/primary_site"             one top-level answer
// The rows the question sits in are left out, so a row never offers itself.
// Keep in step with resolve() in backend/app/core/validation.py.
export function resolve(path, root, owners) {
  return resolveChains(path, root, owners).map(([row, text]) => [row, text]);
}

// Like resolve, with each answer's chain of rows: its own row, the rows around it, then the top level.
function resolveChains(path, root, owners) {
  const frames = frameList(owners);
  const parts = path.replace(/^\/+/, "").split(".");
  let chain = [root];
  if (!path.startsWith("/")) {
    for (let k = frames.length - 1; k >= 0; k--) {
      const { questions } = frames[k];
      if (questions && questions.some((q) => q && q.id === parts[0])) {
        chain = [...frames.slice(0, k + 1).map((f) => f.row).reverse(), root];
        break;
      }
    }
  }
  const own = frames.map((f) => f.row);
  const isRow = (r) => r && typeof r === "object" && !Array.isArray(r);
  let found = isRow(chain[0]) ? [chain] : [];
  for (const part of parts.slice(0, -1)) {
    found = found.flatMap((c) => (Array.isArray(c[0][part]) ? c[0][part].filter(isRow).map((r) => [r, ...c]) : []));
  }
  const out = [];
  for (const c of found) {
    const row = c[0];
    if (row !== root && own.includes(row)) continue;
    const v = row[parts[parts.length - 1]];
    if (typeof v === "string" && v.trim()) out.push([row, v.trim(), c]);
  }
  return out;
}

// "options_from" as [path, label pattern] pairs. Each entry is a path, or { path, label } where the label is
// a pattern for the option's text, e.g. "{value} ({site|primary_site})" (see fillLabel).
export const optionSources = (question) =>
  asList(question.options_from).map((ref) => (ref && typeof ref === "object" ? [ref.path || "", ref.label] : [ref, null]));

// "{value} ({site|primary_site})" -> "DB (Sapir)". {value} is the answer found; {a|b} is the first answer to
// question a (or else b) in the row the answer was found in, or the rows around it, out to the top level.
export function fillLabel(pattern, value, chain) {
  if (!pattern) return value;
  return pattern.replace(/\{([^{}]+)\}/g, (_, name) => {
    if (name === "value") return value;
    for (const scope of chain) {
      for (const id of name.split("|")) {
        const v = scope[id];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
    return "?";
  });
}

// Options of a choice question: the answers found at its "options_from" paths (see resolve), then its
// fixed "options", minus every answer found at its "exclude" paths (e.g. sites already chosen) and the
// answer of its "differs_from" question in the same row.
// owners: the rows the question sits in (see frameList). A row never offers itself: a server's
// "Connected to" does not list that same server, and a site block does not hide its own site.
// Keep in step with choice_options() in backend/app/core/validation.py.
export function choiceOptions(question, root, owners) {
  const options = [];
  for (const [path, pattern] of optionSources(question)) {
    for (const [, v, chain] of resolveChains(path, root, owners)) {
      const text = fillLabel(pattern, v, chain);
      if (!options.includes(text)) options.push(text);
    }
  }
  for (const o of question.options || []) if (!options.includes(o)) options.push(o);
  const taken = new Set(asList(question.exclude).flatMap((ref) => resolve(ref, root, owners).map(([, v]) => v)));
  const frames = frameList(owners);
  if (question.differs_from && frames.length) { // e.g. "To" never offers what is chosen in "From"
    const other = frames[frames.length - 1].row[question.differs_from];
    for (const v of Array.isArray(other) ? other : [other]) taken.add(v);
  }
  return options.filter((o) => !taken.has(o));
}

// ---- IPv4 addresses and subnet masks. Same rules as backend/app/core/validation.py ----
const IPV4_RE = /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$/;

// "10.1.2.3" -> its number, or null when it is not an IPv4 address.
export function ipv4Number(text) {
  if (typeof text !== "string" || !IPV4_RE.test(text.trim())) return null;
  return text.trim().split(".").reduce((n, x) => n * 256 + Number(x), 0);
}

export const maskNumber = (prefix) => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);
export const ipv4Text = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");

// "14.151.0.0/24" -> [network number, 24], or null when it is not a subnet written that way.
// The address must be the network itself: "14.151.0.5/24" is refused (it should be 14.151.0.0/24).
export function cidr(text) {
  if (typeof text !== "string" || text.split("/").length !== 2) return null;
  const [address, length] = text.trim().split("/").map((x) => x.trim());
  const n = ipv4Number(address);
  if (n === null || !/^([0-9]|[12][0-9]|3[0-2])$/.test(length)) return null;
  const prefix = Number(length);
  return ((n & maskNumber(prefix)) >>> 0) === n ? [n, prefix] : null;
}

export const FORMATS = {
  ipv4: [(v) => ipv4Number(v) !== null, "Must be an IP address like 10.20.30.40"],
  cidr: [(v) => cidr(v) !== null, "Must be a subnet like 14.151.0.0/24 (the network address, then / and the mask length)"],
};

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
// root: the top-level answers (used by "options_from"); defaults to answers.
// owners: the list rows these answers sit in (see frameList).
export function validate(questions, answers, prefix = "", root = answers, owners = []) {
  owners = frameList(owners);
  const errors = [];
  for (const q of questions) {
    const path = prefix + q.id;
    if (!isVisible(q, answers)) continue;
    const value = answers[q.id];
    if (isEmpty(value)) {
      if (q.required) errors.push({ path, message: "This answer is required" });
      continue;
    }
    const before = errors.length;
    switch (q.type) {
      case "text":
        if (typeof value !== "string") errors.push({ path, message: "Must be text" });
        else if (FORMATS[q.format] && !FORMATS[q.format][0](value)) errors.push({ path, message: FORMATS[q.format][1] });
        else {
          // "not_in": the answer must not be one found at these paths (e.g. a server named like a segment of
          // its own site). Upper/lower case and spaces around the text do not count.
          const ref = asList(q.not_in).find((r) => resolve(r, root, owners).some(([, v]) => v.toLowerCase() === value.trim().toLowerCase()));
          if (ref) errors.push({ path, message: `Already used here (see the answers to ${ref})` });
        }
        break;
      case "number":
        if (!isNumber(value)) errors.push({ path, message: "Must be a number" });
        else if (q.min !== undefined && value < q.min) errors.push({ path, message: `Must be ${q.min} or more` });
        else if (q.max !== undefined && value > q.max) errors.push({ path, message: `Must be ${q.max} or less` });
        break;
      case "boolean":
        if (typeof value !== "boolean") errors.push({ path, message: "Choose yes or no" });
        break;
      case "choice": {
        const options = choiceOptions(q, root, owners);
        if (q.multiple) { // several options may be picked: a list of them, each once
          if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) errors.push({ path, message: "Must be a list of options" });
          else if (new Set(value).size !== value.length) errors.push({ path, message: "An option is picked twice" });
          else if (value.some((v) => !options.includes(v))) errors.push({ path, message: "Choose only from the options" });
        } else if (!options.includes(value)) errors.push({ path, message: "Choose one of the options" });
        break;
      }
      case "list":
        if (!Array.isArray(value)) {
          errors.push({ path, message: "Must be a list" });
        } else {
          value.forEach((row, i) => errors.push(...validate(q.item, row, `${path}[${i}].`, root, [...owners, { questions: q.item, row }])));
          errors.push(...distinctErrors(q, value, path));
        }
        break;
      default:
        errors.push({ path, message: `Unknown question type '${q.type}'` });
    }
    if (errors.length > before) continue;
    if (q.differs_from && value === answers[q.differs_from]) {
      const other = questions.find((x) => x.id === q.differs_from);
      errors.push({ path, message: `Must be different from “${other ? other.label : q.differs_from}”` });
    }
  }
  if (!prefix) errors.push(...uniqueErrors(questions, answers)); // once, for the whole form
  return errors;
}

// Questions with the same "unique" group (e.g. every server name, in any list) need different answers.
// Upper/lower case and spaces around the text do not make two answers different.
// Keep in step with unique_errors() in backend/app/core/validation.py.
export function uniqueErrors(questions, answers, prefix = "", seen = new Map()) {
  const errors = [];
  for (const q of questions) {
    const path = prefix + q.id;
    if (!isVisible(q, answers)) continue;
    const value = answers[q.id];
    if (q.type === "list" && Array.isArray(value)) {
      value.forEach((row, i) => {
        if (row && typeof row === "object") errors.push(...uniqueErrors(q.item, row, `${path}[${i}].`, seen));
      });
    } else if (q.unique && typeof value === "string" && value.trim()) {
      const key = `${q.unique}\u0000${value.trim().toLowerCase()}`;
      if (seen.has(key)) errors.push({ path, message: `Already used (see ${seen.get(key)}); each answer here must be different` });
      else seen.set(key, path);
    }
  }
  return errors;
}

// "distinct": true on a question in a list's rows: the rows of that one list need different answers
// (e.g. segment names in one site). Upper/lower case and spaces around the text do not count.
// Keep in step with _distinct_errors() in backend/app/core/validation.py.
export function distinctErrors(q, rows, path) {
  const errors = [];
  for (const item of q.item) {
    if (!item.distinct) continue;
    const seen = new Map();
    rows.forEach((row, i) => {
      const v = row && isVisible(item, row) ? row[item.id] : undefined;
      if (typeof v !== "string" || !v.trim()) return;
      const k = v.trim().toLowerCase();
      if (seen.has(k)) errors.push({ path: `${path}[${i}].${item.id}`, message: `Already used in this list (see ${path}[${seen.get(k)}].${item.id})` });
      else seen.set(k, i);
    });
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
