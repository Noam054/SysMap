import json
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.core.diagram import build_mermaid
from app.core.normalize import normalize
from app.core.schema_check import check_definition
from app.core.validation import validate_answers
from app.db import SessionLocal, Submission, init_db

logger = logging.getLogger("sysmap")

BASE = Path(__file__).resolve().parent.parent
QUESTIONNAIRE_DIR = Path(os.environ.get("QUESTIONNAIRE_DIR", BASE / "questionnaires"))

app = FastAPI(title="SysMap")


def load_all_questionnaires():
    """Every questionnaire definition found on disk, as {(id, version): definition}.

    A file with mistakes is skipped (and logged) so one bad file cannot break the others.
    Run `python -m app.core.schema_check` to see what is wrong with it.
    """
    found = {}
    for f in sorted(QUESTIONNAIRE_DIR.glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            logger.warning("Skipping %s: not valid JSON (%s)", f.name, e)
            continue
        errors = check_definition(d)
        if errors:
            logger.warning("Skipping %s: %s", f.name, "; ".join(errors))
            continue
        found[(d["id"], d["version"])] = d
    return found


def load_questionnaires():
    """Latest version of each questionnaire: the one new answers are given in."""
    latest = {}
    for (qid, version), d in sorted(load_all_questionnaires().items()):
        latest[qid] = d  # sorted by version, so the last one wins
    return latest


def _definition(qid, version=None):
    """One questionnaire: the given version (to edit answers given in it), else the latest."""
    d = load_all_questionnaires().get((qid, version)) if version is not None else load_questionnaires().get(qid)
    if d is None:
        raise HTTPException(404, "Unknown questionnaire" if version is None else f"Unknown questionnaire version {version}")
    return d


@app.middleware("http")
async def always_revalidate(request, call_next):
    """Browsers must check with the server before reusing a saved copy, so after an upgrade everyone
    gets the new web app at once. Unchanged files still cost almost nothing: the browser sends the
    file's ETag and the server answers "304 Not Modified" without sending the file again."""
    response = await call_next(request)
    response.headers.setdefault("Cache-Control", "no-cache")
    return response


@app.on_event("startup")
def startup():
    init_db()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/questionnaires")
def list_questionnaires():
    return [
        {"id": d["id"], "version": d["version"], "title": d["title"]}
        for d in load_questionnaires().values()
    ]


@app.get("/api/questionnaires/{qid}")
def get_questionnaire(qid: str, version: Optional[int] = None):
    return _definition(qid, version)


@app.post("/api/submissions", status_code=201)
def create_submission(payload: dict = Body(...)):
    """New answers, in the latest questionnaire. Editing a system's answers also sends
    "version" (the questionnaire version they were given in) and "replaces" (the system's name before the
    edit): when the name changed, the system's earlier submissions move to the new name with it."""
    version = payload.get("version")
    if version is not None and (not isinstance(version, int) or isinstance(version, bool)):
        raise HTTPException(422, "version must be a number")
    definition = _definition(payload.get("questionnaire_id"), version)
    answers = payload.get("answers") or {}
    errors = validate_answers(definition, answers)
    if errors:
        raise HTTPException(422, {"errors": errors})
    model = normalize(answers)
    replaces = payload.get("replaces")
    with SessionLocal() as db:
        if isinstance(replaces, str) and replaces and replaces != model["system"]:
            if db.query(Submission).filter(Submission.system_name == model["system"]).first():
                raise HTTPException(409, f"Another system is already called “{model['system']}”. Choose a different name.")
            db.query(Submission).filter(Submission.system_name == replaces).update({"system_name": model["system"]})
            logger.info("Renamed system %r to %r", replaces, model["system"])
        row = Submission(
            questionnaire_id=definition["id"],
            questionnaire_version=definition["version"],
            system_name=model["system"],
            answers=answers,
            normalized=model,
        )
        db.add(row)
        db.commit()
        return {"id": row.id, "system": row.system_name}


def _summary(r):
    return {
        "id": r.id,
        "system": r.system_name,
        "questionnaire": r.questionnaire_id,
        "version": r.questionnaire_version,
        "created_at": r.created_at.isoformat(),
    }


@app.get("/api/submissions")
def list_submissions():
    with SessionLocal() as db:
        rows = db.query(Submission).order_by(Submission.created_at.desc()).all()
        return [_summary(r) for r in rows]


@app.get("/api/submissions/{submission_id}")
def get_submission(submission_id: int):
    with SessionLocal() as db:
        row = db.get(Submission, submission_id)
        if row is None:
            raise HTTPException(404, "Unknown submission")
        return {**_summary(row), "answers": row.answers, "normalized": row.normalized}


def _latest_models():
    """Newest submission per system."""
    with SessionLocal() as db:
        rows = db.query(Submission).order_by(Submission.created_at.asc()).all()
        return list({r.system_name: r.normalized for r in rows}.values())


@app.get("/api/systems/answers")
def get_system_answers(name: str):
    """The newest answers of one system, to edit them (?name=..., as for delete)."""
    with SessionLocal() as db:
        row = (db.query(Submission).filter(Submission.system_name == name)
               .order_by(Submission.created_at.desc(), Submission.id.desc()).first())
        if row is None:
            raise HTTPException(404, "Unknown system")
        return {**_summary(row), "answers": row.answers}


@app.delete("/api/systems")
def delete_system(name: str):
    """Delete every submission of one system, so it disappears from the diagram.
    The name is a query parameter (?name=...) because system names may contain '/'."""
    with SessionLocal() as db:
        deleted = db.query(Submission).filter(Submission.system_name == name).delete()
        db.commit()
    if not deleted:
        raise HTTPException(404, "Unknown system")
    logger.info("Deleted system %r (%d submissions)", name, deleted)
    return {"system": name, "deleted": deleted}


@app.get("/api/model")
def get_model():
    return _latest_models()


@app.get("/api/diagram", response_class=PlainTextResponse)
def get_diagram():
    return build_mermaid(_latest_models())


def _find_frontend():
    """The web app: /srv/frontend in the container, <repo>/frontend when run from the repo."""
    candidates = []
    if os.environ.get("FRONTEND_DIR"):
        candidates.append(Path(os.environ["FRONTEND_DIR"]))
    candidates += [BASE / "frontend", BASE.parent / "frontend"]
    return next((p for p in candidates if (p / "index.html").is_file()), None)


# Mounted last, so the /api routes above always win.
_frontend = _find_frontend()
if _frontend is not None:
    app.mount("/", StaticFiles(directory=_frontend, html=True), name="frontend")
else:
    logger.warning("Frontend folder not found; only the API is served")
