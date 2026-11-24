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


def _check_value(q, value, path, errors):
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
        if value not in q.get("options", []):
            errors.append(f"{path}: must be one of {q.get('options', [])}")
    elif t == "list":
        if not isinstance(value, list):
            errors.append(f"{path}: must be a list")
            return
        for i, row in enumerate(value):
            if not isinstance(row, dict):
                errors.append(f"{path}[{i}]: must be an object")
                continue
            errors.extend(validate_answers({"questions": q["item"]}, row, prefix=f"{path}[{i}]."))
    else:
        errors.append(f"{path}: unknown question type '{t}'")


def validate_answers(definition, answers, prefix=""):
    """Return a list of error strings (empty list means valid)."""
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
        _check_value(q, value, path, errors)
    return errors
