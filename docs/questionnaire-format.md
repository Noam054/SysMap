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
| `multiple` | Optional for `choice`: `true` lets the user pick several options (checkboxes). The answer is a list, e.g. `["DB (Ofek)", "Web (Sapir)"]`; nothing is picked at the start. With `differs_from`, the options picked in the other question are not offered. |
| `options_from` | Optional for `choice`: also offer the answers typed in another list, see below. |
| `exclude` | Optional for `choice`: hide options already given elsewhere, e.g. `["/primary_site", "/other_sites.site"]` (same paths as `options_from`). The row the question sits in does not count. |
| `differs_from` | Optional: the answer must differ from an earlier question in the same row, e.g. a connection's `to` and `from`. A choice also leaves that answer out of its options. |
| `format` | Optional for `text`: `ipv4` (an address like `10.20.30.40`) or `cidr` (a subnet like `14.151.0.0/24`: the network address, `/`, the mask length). |
| `start_empty` | Optional for `list`: `true` starts with no rows (only an "+ Add …" button), e.g. other sites or connections. Other lists start with one row. |
| `duplicate` | Optional for `list`: `true` adds a "Duplicate" button on each row. It opens a pop-up with a copy of the row's answers (the name gets the next number, e.g. `web-1` → `web-2`) to change before adding it. |
| `copy_from_site` | Optional for `list` at the top level or in an `other_sites` block: `true` adds a "Copy from another site…" button under the list. The pop-up asks which row of another site to pull into this site, and shows the copy (same name) with this site's choices: a segment with the same name is kept, otherwise it is chosen again. |
| `collapsible` | Optional for `list`: `false` draws the list without a section header to minimize: only its rows and its "+ Add …" button (e.g. other sites). |
| `add_label` | Optional for `list`: the text of its add button, e.g. `"Add new site"` (default "Add " + the row label). |
| `item` | Required for `list`: the questions asked for every row (same format, one level deep or more). |
| `row_label` | Optional name of a list row, e.g. `"Server"` gives "Server 1", "+ Add server", and `"Site"` gives "+ Add site". |
| `show_if` | Show the question only for a given answer, see below. |
| `unique` | Optional for `text`: a group name, e.g. `"server-name"`. Every answer in the group, in any list of the form, must be different (upper/lower case and spaces around it do not count). |
| `not_in` | Optional for `text`: paths (as in `options_from`) whose answers this one must differ from, e.g. a server's name `"not_in": ["segments.name"]`: not the name of a segment in the same site. Upper/lower case does not count. |
| `distinct` | Optional for `text` inside a list: `true` means the rows of **that one list** need different answers, e.g. segment names within one site (two sites may both have a "DB" segment). |

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

`options_from` can also be a list, to offer the answers of several lists. The last part of a path is a `text`
question; the parts before it are list questions:

| Path | Means |
|---|---|
| `servers.name` | the `servers` list **nearest** to the question: inside an "Add site" block, that site's own servers; elsewhere the top-level list |
| `/servers.name` | starting with `/`: always the top-level list |
| `/other_sites.servers.name` | every server name in every row of `other_sites` |
| `/primary_site` | one top-level answer (useful in `exclude`) |

An entry can also be `{ "path": …, "label": … }` to show more than the answer itself. In the label, `{value}` is the
answer and `{a|b}` is the answer to question `a` (or else `b`) in the same row or the rows around it. Segments
use this so two segments with the same name are told apart by their site:

```json
{ "path": "/other_sites.segments.name", "label": "{value} ({site|primary_site})" }
```

offers "DB (Sapir)". The label is what is saved as the answer.

A row never offers itself: in a server's own connections, "Connected to" lists every *other* server, and a
site block's `exclude` of `/other_sites.site` does not hide its own site.

### Starting values

Yes/no questions start on **No**, and other choices start on their **first option**. A choice with nothing to
offer yet (e.g. a server's segment before any segment is added) is an empty, greyed-out box. Put the most common
or safest answer first.

## What the diagram understands

The diagram is drawn from a fixed set of question ids. Other questions are saved and visible under
**Submissions**, but they do not change the picture yet.

| Question id | Type | Used for |
|---|---|---|
| `system_name` | text | the system's name (the title of its diagram) |
| `primary_site` | choice | the site of the top-level `segments`, `servers` and `connections` |
| `segments` | list of `name`, `subnet` | network segments: a framed box inside the site, with its subnet (e.g. `14.151.0.0/24`) |
| `servers` | list of `name`, `role`, `os`, `segment` | servers, drawn inside the box of their `segment` (or loose in the site when it has none) |
| `connections` | list of `from`, `to`, `direction`, `protocol`, `ports` | From version 4: one top-level list at the end for all sites, with `from` and `to` picking one or more segments (`multiple`); each pair of a `from` and a `to` is one arrow. Before: arrows between servers and/or segments (a port opening can be from or to a whole segment); `"All endpoints"` is a tag on the card instead. `direction` is read from the start of the option: `Incoming…` (the "To" side opens it), `Both…`, anything else is outgoing |
| `other_sites` | list of `site` + the same `segments`, `servers` (and `connections` in version 3) | one block per other site (the "+ Add site" button) |
| `dr_site` | choice, first option `"No DR site"` | the DR site, marked "DR" in the diagram |
| `standby` | boolean, in each server row (version 5) | the server is turned off right now: drawn grey with an "OFF" tag |
| `skipping` | list of `action`, `server`, `note` (version 5) | the skipping process: steps in order, each turning one server off or on (`action` starting with "Turn on…", else off); `server` is a server key like `core-1 (Sapir)`. "Play skipping" on the system's page animates them |

From version 4, server and segment names are `distinct` within a site (another site may use the same names),
a server is never named like a segment of its site (`not_in`), and a connection names its ends as
`"name (site)"` (the label above), so a connection's end is never ambiguous. The model and the diagram call each
server and segment by that same key. Version 3 answers name an end without its site: it is taken to be the one
in the connection's own site (else the only one with that name).

From version 5, **every connection is always open**: teams enter all of them, also those to servers that are
turned off right now. The diagram greys out what is not in use instead of hiding it. A segment is not in use when
it has servers and all of them are off. A connection is not in use when one of its ends is an off server or a
segment that is not in use ("All endpoints" is always in use). Each skipping step changes which servers are off,
so the diagram works out by itself which communication stops and which starts: for example, turning off
`core-1 (Ofek)` and then turning on `core-1 (Sapir)` moves the communication from Ofek's Core to Sapir's.

Older answers are still drawn. Version 2: `has_other_sites` + `other_servers` (each with a `site`), and
`has_connections` + `connections` inside each server with a `to`. Version 1: a `site` inside each server,
`depends_on` for other systems, and `has_dr` + a typed `dr_site`.

`role` should be a `choice` with the options `web`, `app`, `database`, `storage`, `other`
(any other value is drawn as `other`).

## Check your file

```
cd backend
python -m app.core.schema_check
```

It lists every mistake in plain words. A file with mistakes is skipped by the app (and logged), so one bad file
cannot break the other questionnaires.
