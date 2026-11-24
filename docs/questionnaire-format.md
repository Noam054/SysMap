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
| `options` | Required for `choice` (unless it has `options_from`): a list of texts, e.g. `["web", "app", "database"]`. |
| `options_from` | Optional for `choice`: also offer the answers typed in another list, see below. |
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

### Choosing from earlier answers

A `choice` can offer what the user typed earlier in a list. `"options_from": "servers.name"` means
"every server name typed in the top-level list `servers`". The dropdown updates while the user types.
Fixed `options` are added after them:

```json
{ "id": "to", "type": "choice", "label": "Connected to", "required": true,
  "options_from": "servers.name", "options": ["All endpoints"] }
```

The list must be a **top-level** question and the field must be a `text` question in its rows.
`options_from` can also be a list, to offer the answers of several lists:
`["servers.name", "other_servers.name"]`.

A row never offers itself: in a server's own connections, "Connected to" lists every *other* server.

### Starting values

Yes/no questions start on **No**, and other choices start on their **first option**. Put the most common
or safest answer first.

## What the diagram understands

The diagram is drawn from a fixed set of question ids. Other questions are saved and visible under
**Submissions**, but they do not change the picture yet.

| Question id | Type | Used for |
|---|---|---|
| `system_name` | text | the system's name (the title of its diagram) |
| `primary_site` | choice | the site of the servers in `servers` |
| `servers` | list of `name`, `role`, `os`, `has_connections`, `connections` | the servers in the primary site |
| `has_other_sites`, `other_servers` | yes/no, list of `site` + the same server questions | servers in other sites |
| `connections` (inside a server) | list of `to`, `direction`, `protocol`, `ports` | arrows between the system's servers; `"All endpoints"` adds an Endpoints box. `direction` is read from the start of the option: `Incoming…`, `Both…`, anything else is outgoing |
| `dr_site` | choice, first option `"No DR site"` | the DR site, marked "DR" in the diagram |

Older answers (version 1) are still drawn: a `site` inside each server, `depends_on` for other systems,
and `has_dr` + a typed `dr_site`.

`role` should be a `choice` with the options `web`, `app`, `database`, `storage`, `other`
(any other value is drawn as `other`).

## Check your file

```
cd backend
python -m app.core.schema_check
```

It lists every mistake in plain words. A file with mistakes is skipped by the app (and logged), so one bad file
cannot break the other questionnaires.
