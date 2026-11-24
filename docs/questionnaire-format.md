# Writing questionnaires

A questionnaire is one JSON file in `backend/questionnaires/`. The web app builds the form from it,
so adding or changing questions needs **no code change**.

## File name and versions

The file name is `<id>.v<version>.json`, for example `system-basic.v1.json`.

To change a questionnaire that people already answered, **do not edit the old file**. Copy it to
`system-basic.v2.json`, change `"version"` to 2 and edit the copy. The app always shows the newest
version, and every saved answer remembers the version it was given for.

## Top level

```json
{
  "id": "system-basic",
  "version": 1,
  "title": "Basic system information",
  "questions": [ ... ]
}
```

## Questions

Every question has `id`, `type` and `label` (the text the user reads).

| Field | Meaning |
|---|---|
| `id` | Short name with lowercase letters, digits and `_`, e.g. `server_count`. Unique in its list. |
| `type` | `text`, `number`, `boolean` (yes/no), `choice` (pick one) or `list` (repeating rows). |
| `label` | The question shown to the user. |
| `required` | `true` to force an answer. Default is optional. |
| `help` | Optional small grey explanation under the question. |
| `placeholder` | Optional hint inside text and number boxes. |
| `min`, `max` | Optional limits for `number`. |
| `options` | Required for `choice`: a list of texts, e.g. `["web", "app", "database"]`. |
| `item` | Required for `list`: the questions asked for every row (same format, one level deep or more). |
| `row_label` | Optional name of a list row, e.g. `"Server"` gives "Server 1", "+ Add server". |
| `show_if` | Show the question only for a given answer, see below. |

### Showing a question only sometimes

```json
{ "id": "has_dr", "type": "boolean", "label": "Do you have a disaster recovery site?" },
{ "id": "dr_site", "type": "text", "label": "Where is it?", "required": true,
  "show_if": { "question": "has_dr", "equals": true } }
```

The question in `show_if` must come **earlier** in the same list. Answers to hidden questions are never saved,
and a hidden question is never required.

## What the diagram understands

The diagram is drawn from a fixed set of question ids. Other questions are saved and visible under
**Submissions**, but they do not change the picture yet.

| Question id | Type | Used for |
|---|---|---|
| `system_name` | text | the system's name (required for the diagram) |
| `servers` | list of `name`, `site`, `role`, `os` | servers and the site each one is in |
| `depends_on` | list of `system`, `protocol` | arrows to other systems |
| `has_dr`, `dr_site` | yes/no, text | an extra site for disaster recovery |

`role` should be a `choice` with the options `web`, `app`, `database`, `storage`, `other`
(any other value is drawn as `other`).

## Check your file

```
cd backend
python -m app.core.schema_check
```

It lists every mistake in plain words. A file with mistakes is skipped by the app (and logged), so one bad file
cannot break the other questionnaires.
