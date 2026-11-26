"""Validate answers against a questionnaire definition (pure Python, no dependencies)."""
import re


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _empty(v):
    return v is None or v == "" or v == []


def _visible(question, answers):
    cond = question.get("show_if")
    if not cond:
        return True
    return answers.get(cond["question"]) == cond["equals"]


def options_sources(question):
    """'options_from' as a list of (path, label) pairs. Each entry is a path, or {"path": ..., "label": ...}
    where the label is a pattern for the option's text, e.g. "{value} ({site|primary_site})" (see _label)."""
    out = []
    for ref in _as_list(question.get("options_from")):
        if isinstance(ref, dict):
            out.append((ref.get("path", ""), ref.get("label")))
        else:
            out.append((ref, None))
    return out


def _label(pattern, value, chain):
    """"{value} ({site|primary_site})" -> "DB (Sapir)". {value} is the answer found; {a|b} is the first answer
    to question a (or else b) in the row the answer was found in, or the rows around it, out to the top level."""
    if not pattern:
        return value

    def fill(m):
        if m.group(1) == "value":
            return value
        for scope in chain:
            for qid in m.group(1).split("|"):
                v = scope.get(qid)
                if isinstance(v, str) and v.strip():
                    return v.strip()
        return "?"
    return re.sub(r"\{([^{}]+)\}", fill, pattern)


def _as_list(ref):
    if not ref:
        return []
    return [ref] if isinstance(ref, str) else list(ref)


def _frames(owners):
    """The list rows a question sits in, outermost first, as (questions of that row, row) pairs.
    Older callers pass a dict {list id: row}: those rows only count as "own rows" (see resolve)."""
    if not owners:
        return []
    if isinstance(owners, dict):
        return [(None, row) for row in owners.values()]
    return list(owners)


def resolve(path, root, owners=None):
    """Answers found at a path, as (row, text) pairs.

    "servers.name"             every 'name' in the list 'servers' of the nearest row (or the top level)
                               that has a 'servers' question: inside a site block, that site's servers
    "/servers.name"            from the top level, wherever the question sits
    "/other_sites.servers.name" every server name of every other site
    "/primary_site"            one top-level answer
    The rows the question sits in are left out, so a row never offers itself.
    Keep in step with resolve() in frontend/js/form-logic.js."""
    return [(row, text) for row, text, _chain in _resolve(path, root, owners)]


def _resolve(path, root, owners=None):
    """Like resolve, with each answer's chain of rows: its own row, the rows around it, then the top level."""
    frames = _frames(owners)
    parts = path.lstrip("/").split(".")
    chain = [root]
    if not path.startswith("/"):
        for k in range(len(frames) - 1, -1, -1):
            questions, row = frames[k]
            if questions is not None and any(isinstance(q, dict) and q.get("id") == parts[0] for q in questions):
                chain = [r for _q, r in reversed(frames[: k + 1])] + [root]
                break
    own = [row for _, row in frames]
    found = [chain] if isinstance(chain[0], dict) else []
    for part in parts[:-1]:
        found = [[r, *c] for c in found for r in (c[0].get(part) if isinstance(c[0].get(part), list) else []) if isinstance(r, dict)]
    out = []
    for c in found:
        row = c[0]
        if row is not root and any(row is o for o in own):
            continue
        v = row.get(parts[-1])
        if isinstance(v, str) and v.strip():
            out.append((row, v.strip(), c))
    return out


def choice_options(question, root, owners=None):
    """Options of a choice question: the answers found at its 'options_from' paths (see resolve), then its
    fixed 'options', minus every answer found at its 'exclude' paths (e.g. sites already chosen) and the
    answer of its 'differs_from' question in the same row.

    owners: the rows the question sits in (see _frames). A row never offers itself: a server's
    "Connected to" does not list that same server, and a site block does not hide its own site.
    Keep in step with choiceOptions() in frontend/js/form-logic.js."""
    options = []
    for path, pattern in options_sources(question):
        for _row, v, chain in _resolve(path, root, owners):
            text = _label(pattern, v, chain)
            if text not in options:
                options.append(text)
    for o in question.get("options", []):
        if o not in options:
            options.append(o)
    taken = {v for ref in _as_list(question.get("exclude")) for _row, v in resolve(ref, root, owners)}
    frames = _frames(owners)
    if question.get("differs_from") and frames:  # e.g. "To" never offers what is chosen in "From"
        other = frames[-1][1].get(question["differs_from"])
        taken.update(other if isinstance(other, list) else [other])
    return [o for o in options if o not in taken]


# ---- IPv4 addresses and subnet masks (no 'ipaddress' module, so the browser can do exactly the same) ----
_OCTET = r"(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])"
_IPV4_RE = re.compile(rf"^{_OCTET}(\.{_OCTET}){{3}}$")


def ipv4_number(text):
    """'10.1.2.3' -> its number, or None when it is not an IPv4 address."""
    if not isinstance(text, str) or not _IPV4_RE.match(text.strip()):
        return None
    a, b, c, d = (int(x) for x in text.strip().split("."))
    return (a << 24) | (b << 16) | (c << 8) | d


def mask_number(prefix):
    return (0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF


def ipv4_text(n):
    return ".".join(str((n >> s) & 255) for s in (24, 16, 8, 0))


def cidr(text):
    """'14.151.0.0/24' -> (network number, 24), or None when it is not a subnet written that way.
    The address must be the network itself: '14.151.0.5/24' is refused (it should be 14.151.0.0/24)."""
    if not isinstance(text, str) or text.count("/") != 1:
        return None
    address, length = (x.strip() for x in text.strip().split("/"))
    n = ipv4_number(address)
    if n is None or not re.match(r"^([0-9]|[12][0-9]|3[0-2])$", length):
        return None
    prefix = int(length)
    return (n, prefix) if n & mask_number(prefix) == n else None


FORMATS = {
    "ipv4": (lambda v: ipv4_number(v) is not None, "must be an IP address like 10.20.30.40"),
    "cidr": (lambda v: cidr(v) is not None,
             "must be a subnet like 14.151.0.0/24 (the network address, then / and the mask length)"),
}


def _check_value(q, value, path, errors, root, owners):
    t = q["type"]
    if t == "text":
        if not isinstance(value, str):
            errors.append(f"{path}: must be text")
        elif q.get("format") in FORMATS and not FORMATS[q["format"]][0](value):
            errors.append(f"{path}: {FORMATS[q['format']][1]}")
        else:
            # "not_in": the answer must not be one found at these paths (e.g. a server named like a segment
            # of its own site). Upper/lower case and spaces around the text do not count.
            for ref in _as_list(q.get("not_in")):
                if any(v.lower() == value.strip().lower() for _row, v in resolve(ref, root, owners)):
                    errors.append(f"{path}: is already used here (see the answers to {ref})")
                    break
    elif t == "number":
        if not _is_number(value):
            errors.append(f"{path}: must be a number")
        elif "min" in q and value < q["min"]:
            errors.append(f"{path}: must be >= {q['min']}")
        elif "max" in q and value > q["max"]:
            errors.append(f"{path}: must be <= {q['max']}")
    elif t == "boolean":
        if not isinstance(value, bool):
            errors.append(f"{path}: must be true or false")
    elif t == "choice":
        options = choice_options(q, root, owners)
        if q.get("multiple"):  # several options may be picked: a list of them, each once
            if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
                errors.append(f"{path}: must be a list of options")
            elif len(set(value)) != len(value):
                errors.append(f"{path}: an option is picked twice")
            elif any(v not in options for v in value):
                errors.append(f"{path}: must be some of {options}")
        elif value not in options:
            errors.append(f"{path}: must be one of {options}")
    elif t == "list":
        if not isinstance(value, list):
            errors.append(f"{path}: must be a list")
            return
        for i, row in enumerate(value):
            if not isinstance(row, dict):
                errors.append(f"{path}[{i}]: must be an object")
                continue
            errors.extend(validate_answers(
                {"questions": q["item"]}, row, prefix=f"{path}[{i}].", root=root, owners=[*owners, (q["item"], row)]
            ))
        errors.extend(_distinct_errors(q, value, path))
    else:
        errors.append(f"{path}: unknown question type '{t}'")


def _distinct_errors(q, rows, path):
    """"distinct": true on a question in a list's rows: the rows of that one list need different answers
    (e.g. segment names in one site). Upper/lower case and spaces around the text do not count."""
    errors = []
    for item in q["item"]:
        if not item.get("distinct"):
            continue
        seen = {}
        for i, row in enumerate(rows):
            v = row.get(item["id"]) if isinstance(row, dict) and _visible(item, row) else None
            if not isinstance(v, str) or not v.strip():
                continue
            k = v.strip().lower()
            if k in seen:
                errors.append(f"{path}[{i}].{item['id']}: is already used in this list (see {path}[{seen[k]}].{item['id']})")
            else:
                seen[k] = i
    return errors


def validate_answers(definition, answers, prefix="", root=None, owners=None):
    """Return a list of error strings (empty list means valid).
    root: the top-level answers (used by 'options_from'); defaults to answers.
    owners: the list rows these answers sit in (see _frames)."""
    if root is None:
        root = answers
    owners = _frames(owners)
    errors = []
    for q in definition["questions"]:
        path = prefix + q["id"]
        if not _visible(q, answers):
            continue
        value = answers.get(q["id"])
        if _empty(value):
            if q.get("required"):
                errors.append(f"{path}: is required")
            continue
        before = len(errors)
        _check_value(q, value, path, errors, root, owners)
        if len(errors) > before:
            continue
        other = q.get("differs_from")
        if other and value == answers.get(other):
            label = next((x.get("label", other) for x in definition["questions"] if x.get("id") == other), other)
            errors.append(f"{path}: must be different from \"{label}\"")
    if not prefix:  # once, for the whole form
        errors.extend(unique_errors(definition["questions"], answers))
    return errors


def unique_errors(questions, answers, prefix="", seen=None):
    """Questions with the same "unique" group (e.g. every server name, in any list) need different
    answers. Upper/lower case and spaces around the text do not make two answers different.
    Keep in step with uniqueErrors() in frontend/js/form-logic.js."""
    seen = {} if seen is None else seen
    errors = []
    for q in questions:
        path = prefix + q["id"]
        if not _visible(q, answers):
            continue
        value = answers.get(q["id"])
        if q["type"] == "list" and isinstance(value, list):
            for i, row in enumerate(value):
                if isinstance(row, dict):
                    errors.extend(unique_errors(q["item"], row, f"{path}[{i}].", seen))
        elif q.get("unique") and isinstance(value, str) and value.strip():
            key = (q["unique"], value.strip().lower())
            if key in seen:
                errors.append(f"{path}: is already used (see {seen[key]}); each answer here must be different")
            else:
                seen[key] = path
    return errors
