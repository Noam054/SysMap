"""Check questionnaire definition files for mistakes before they reach users.

Run from the backend folder:
    python -m app.core.schema_check
It checks every *.json file in backend/questionnaires and exits with code 1 on problems.
"""
import json
import re
import sys
from pathlib import Path

from app.core.validation import FORMATS

TYPES = {"text", "number", "boolean", "choice", "list"}
QUESTIONNAIRE_ID_RE = re.compile(r"^[a-z][a-z0-9-]*$")
QUESTION_ID_RE = re.compile(r"^[a-z][a-z0-9_]*$")


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def check_definition(d):
    """Return a list of problems found in one questionnaire definition (empty list = fine)."""
    if not isinstance(d, dict):
        return ["the file must contain one JSON object"]
    errors = []

    qid = d.get("id")
    if not isinstance(qid, str) or not QUESTIONNAIRE_ID_RE.match(qid):
        errors.append("id: use lowercase letters, digits and dashes, e.g. 'system-basic'")
    version = d.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        errors.append("version: must be a whole number, 1 or higher")
    if not isinstance(d.get("title"), str) or not d["title"].strip():
        errors.append("title: is required")

    questions = d.get("questions")
    if not isinstance(questions, list) or not questions:
        errors.append("questions: must be a non-empty list")
    else:
        _check_questions(questions, "", errors, [questions])
    return errors


def _check_questions(questions, prefix, errors, stack):
    """stack: the question lists we are inside, the top level first and `questions` last."""
    by_id = {}
    for i, q in enumerate(questions):
        if not isinstance(q, dict):
            errors.append(f"{prefix}question #{i + 1}: must be an object")
            continue

        qid = q.get("id")
        where = f"{prefix}{qid}" if isinstance(qid, str) and qid else f"{prefix}question #{i + 1}"

        if not isinstance(qid, str) or not QUESTION_ID_RE.match(qid):
            errors.append(f"{where}: id must use lowercase letters, digits and underscores, and start with a letter")
        elif qid in by_id:
            errors.append(f"{where}: duplicate id (every question needs its own id)")

        if not isinstance(q.get("label"), str) or not q["label"].strip():
            errors.append(f"{where}: label is required (this is the question the user sees)")
        if "required" in q and not isinstance(q["required"], bool):
            errors.append(f"{where}: required must be true or false")

        qtype = q.get("type")
        if qtype not in TYPES:
            errors.append(f"{where}: type must be one of {sorted(TYPES)}")
        elif qtype == "choice":
            options = q.get("options")
            if "options_from" in q:
                refs = q["options_from"]
                for ref in refs if isinstance(refs, list) and refs else [refs]:
                    if isinstance(ref, dict):
                        label = ref.get("label")
                        if label is not None and (not isinstance(label, str) or "{value}" not in label):
                            errors.append(f"{where}: an options_from label must be a text with {{value}} in it")
                        ref = ref.get("path")
                    _check_path(ref, where, "options_from", stack, errors, {"text"})
                if options is not None and (
                    not isinstance(options, list) or not all(isinstance(o, str) and o for o in options)
                ):
                    errors.append(f"{where}: 'options' must be a list of texts")
            elif not isinstance(options, list) or not options or not all(isinstance(o, str) and o for o in options):
                errors.append(f"{where}: a choice question needs 'options', a non-empty list of texts")
        elif qtype == "number":
            lo, hi = q.get("min"), q.get("max")
            if "min" in q and not _is_number(lo):
                errors.append(f"{where}: min must be a number")
            if "max" in q and not _is_number(hi):
                errors.append(f"{where}: max must be a number")
            if _is_number(lo) and _is_number(hi) and lo > hi:
                errors.append(f"{where}: min is bigger than max")
        elif qtype == "list":
            item = q.get("item")
            if not isinstance(item, list) or not item:
                errors.append(f"{where}: a list question needs 'item', the non-empty list of questions asked for each row")
            else:
                _check_questions(item, f"{where}[].", errors, [*stack, item])
            if "start_empty" in q and not isinstance(q["start_empty"], bool):
                errors.append(f"{where}: start_empty must be true or false")

        if "unique" in q:
            if not isinstance(q["unique"], str) or not q["unique"].strip():
                errors.append(f"{where}: unique must be a group name, e.g. \"server-name\"")
            elif qtype != "text":
                errors.append(f"{where}: unique only works on text questions")

        if "exclude" in q:
            refs = q["exclude"]
            if qtype != "choice":
                errors.append(f"{where}: exclude only works on choice questions")
            for ref in refs if isinstance(refs, list) and refs else [refs]:
                _check_path(ref, where, "exclude", stack, errors, {"text", "choice"})
        if "start_empty" in q and qtype != "list":
            errors.append(f"{where}: start_empty only works on list questions")

        if "format" in q:
            if q["format"] not in FORMATS:
                errors.append(f"{where}: format must be one of {sorted(FORMATS)}")
            elif qtype != "text":
                errors.append(f"{where}: format only works on text questions")

        if "not_in" in q:
            refs = q["not_in"]
            if qtype != "text":
                errors.append(f"{where}: not_in only works on text questions")
            for ref in refs if isinstance(refs, list) and refs else [refs]:
                _check_path(ref, where, "not_in", stack, errors, {"text"})

        if "multiple" in q and (not isinstance(q["multiple"], bool) or qtype != "choice"):
            errors.append(f"{where}: multiple must be true or false, on a choice question")

        for flag in ("collapsible",):
            if flag in q and (not isinstance(q[flag], bool) or qtype != "list"):
                errors.append(f"{where}: {flag} must be true or false, on a list question")
        if "add_label" in q and (not isinstance(q["add_label"], str) or not q["add_label"].strip() or qtype != "list"):
            errors.append(f"{where}: add_label must be a text, on a list question")

        for flag in ("duplicate", "copy_from_site"):
            if flag in q and (not isinstance(q[flag], bool) or qtype != "list"):
                errors.append(f"{where}: {flag} must be true or false, on a list question")

        if "distinct" in q:
            if not isinstance(q["distinct"], bool):
                errors.append(f"{where}: distinct must be true or false")
            elif len(stack) < 2:
                errors.append(f"{where}: distinct only works on a question inside a list")
            elif qtype != "text":
                errors.append(f"{where}: distinct only works on text questions")

        if "differs_from" in q:
            other = by_id.get(q["differs_from"])
            if other is None:
                errors.append(f"{where}: differs_from must name an earlier question in the same list")

        if "show_if" in q:
            _check_show_if(q["show_if"], where, by_id, errors)

        if isinstance(qid, str) and qid:
            by_id.setdefault(qid, q)


def _check_path(ref, where, key, stack, errors, types):
    """A path like "servers.name", "/other_sites.servers.name" or "/primary_site" (see validation.resolve).
    Returns the questions of the list that holds the last part, or None when the path is wrong."""
    hint = (
        f"{key} must look like \"servers.name\" (or a list of them): list questions, then a question in their rows; "
        "start with / to begin at the top level"
    )
    if not isinstance(ref, str) or not ref.strip("/") or any(not x for x in ref.lstrip("/").split(".")):
        errors.append(f"{where}: {hint}")
        return None
    parts = ref.lstrip("/").split(".")
    if ref.startswith("/"):
        level = stack[0]
    else:
        level = next((qs for qs in reversed(stack) if _find(qs, parts[0])), None)
        if level is None:
            errors.append(f"{where}: {key} refers to '{parts[0]}', which is not a question here or around this question")
            return None
    for part in parts[:-1]:
        lst = _find(level, part)
        if lst is None or lst.get("type") != "list" or not isinstance(lst.get("item"), list):
            errors.append(f"{where}: {key} refers to '{part}', which is not a list question")
            return None
        level = lst["item"]
    field = _find(level, parts[-1])
    if field is None or field.get("type") not in types:
        kinds = " or ".join(sorted(types))
        errors.append(f"{where}: {key} refers to '{parts[-1]}', which is not a {kinds} question in '{ref}'")
        return None
    return level


def _find(questions, qid):
    return next((x for x in questions if isinstance(x, dict) and x.get("id") == qid), None)


def _check_show_if(cond, where, by_id, errors):
    if not isinstance(cond, dict) or "question" not in cond or "equals" not in cond:
        errors.append(f"{where}: show_if must look like {{\"question\": \"some_id\", \"equals\": true}}")
        return
    ref = by_id.get(cond["question"])
    if ref is None:
        errors.append(
            f"{where}: show_if refers to '{cond['question']}', which must be an earlier question in the same list"
        )
        return
    if ref.get("type") == "boolean" and not isinstance(cond["equals"], bool):
        errors.append(f"{where}: '{cond['question']}' is yes/no, so show_if 'equals' must be true or false")
    if ref.get("type") == "choice" and cond["equals"] not in ref.get("options", []):
        errors.append(f"{where}: show_if 'equals' is not one of the options of '{cond['question']}'")


def check_directory(directory):
    """Check every questionnaire file. Returns a list of (file name, [problems])."""
    problems = []
    seen = {}
    for f in sorted(Path(directory).glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            problems.append((f.name, [f"not valid JSON: {e}"]))
            continue
        errors = check_definition(d)
        if not errors:
            expected = f"{d['id']}.v{d['version']}.json"
            if f.name != expected:
                errors.append(f"file name should be '{expected}'")
            key = (d["id"], d["version"])
            if key in seen:
                errors.append(f"same id and version as {seen[key]}")
            seen[key] = f.name
        if errors:
            problems.append((f.name, errors))
    return problems


def main():
    directory = Path(__file__).resolve().parents[2] / "questionnaires"
    problems = check_directory(directory)
    if not problems:
        print(f"OK: all questionnaires in {directory} look fine")
        return 0
    for name, errors in problems:
        print(name)
        for e in errors:
            print(f"  - {e}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
