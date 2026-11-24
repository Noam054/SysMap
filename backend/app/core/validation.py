"""Validate answers against a questionnaire definition (pure Python, no dependencies)."""


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
    """'options_from' as a list of "list.field" texts (it may be one text or a list of them)."""
    ref = question.get("options_from")
    if not ref:
        return []
    return [ref] if isinstance(ref, str) else list(ref)


def choice_options(question, root, owners=None):
    """Options of a choice question: the answers typed in other lists when it has 'options_from'
    (e.g. "servers.name" = every server name typed in 'servers'), then its fixed 'options'.

    owners: the rows the question sits in, by list id (e.g. {"servers": <this server's row>}). A row
    never offers itself: a server's "Connected to" does not list that same server.
    Keep in step with choiceOptions() in frontend/js/form-logic.js."""
    owners = owners or {}
    options = []
    for ref in options_sources(question):
        list_id, field = ref.split(".", 1)
        own = owners.get(list_id)
        rows = root.get(list_id) if isinstance(root, dict) else None
        for row in rows if isinstance(rows, list) else []:
            if row is own:
                continue
            v = row.get(field) if isinstance(row, dict) else None
            if isinstance(v, str) and v.strip() and v.strip() not in options:
                options.append(v.strip())
    for o in question.get("options", []):
        if o not in options:
            options.append(o)
    return options


def _check_value(q, value, path, errors, root, owners):
    t = q["type"]
    if t == "text":
        if not isinstance(value, str):
            errors.append(f"{path}: must be text")
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
        if value not in options:
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
                {"questions": q["item"]}, row, prefix=f"{path}[{i}].", root=root, owners={**owners, q["id"]: row}
            ))
    else:
        errors.append(f"{path}: unknown question type '{t}'")


def validate_answers(definition, answers, prefix="", root=None, owners=None):
    """Return a list of error strings (empty list means valid).
    root: the top-level answers (used by 'options_from'); defaults to answers.
    owners: the list rows these answers sit in, by list id (see choice_options)."""
    if root is None:
        root = answers
    owners = owners or {}
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
        _check_value(q, value, path, errors, root, owners)
    return errors
