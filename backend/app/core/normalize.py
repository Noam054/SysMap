"""Turn raw answers into the common model: system, servers, sites, links, connections."""

# The special "server" for traffic to or from all endpoints (e.g. agents). Same text in frontend/js/diagram.js.
ENDPOINTS = "All endpoints"
# The first option of the DR question in questionnaire v2: no DR site.
NO_DR = "No DR site"


def _connection(server, c):
    """One answer about a server's connection -> {from, to, both, protocol, ports}.
    The direction is read from the start of the chosen option: "Incoming ...", "Both ..." or outgoing."""
    other = c["to"].strip()
    direction = (c.get("direction") or "").strip().lower()
    incoming = direction.startswith("incoming")
    return {
        "from": other if incoming else server,
        "to": server if incoming else other,
        "both": direction.startswith("both"),
        "protocol": (c.get("protocol") or "").strip(),
        "ports": (c.get("ports") or "").strip(),
    }


def _same(a, b):
    """The same connection described from both of its ends counts once."""
    if (a["both"], a["protocol"], a["ports"]) != (b["both"], b["protocol"], b["ports"]):
        return False
    if a["both"]:
        return {a["from"], a["to"]} == {b["from"], b["to"]}
    return (a["from"], a["to"]) == (b["from"], b["to"])


def _text(v):
    return v.strip() if isinstance(v, str) else ""


def _server_rows(answers):
    """(row, site) for every server: the primary site's servers, then servers in other sites.
    Older answers (questionnaire v1) give a site per server and have no primary site."""
    primary = _text(answers.get("primary_site"))
    for row in answers.get("servers") or []:
        yield row, _text(row.get("site")) or primary
    if answers.get("has_other_sites"):
        for row in answers.get("other_servers") or []:
            yield row, _text(row.get("site"))


def _dr_site(answers):
    if "has_dr" in answers:  # v1: a yes/no question, then the DR site typed in
        return _text(answers.get("dr_site")) if answers.get("has_dr") else ""
    dr = _text(answers.get("dr_site"))  # v2: a dropdown that starts with "No DR site"
    return "" if dr == NO_DR else dr


def normalize(answers):
    system = _text(answers.get("system_name"))
    rows = list(_server_rows(answers))
    servers = [
        {"name": _text(row["name"]), "site": site, "role": row.get("role", "other"), "os": row.get("os", "")}
        for row, site in rows
    ]
    links = [
        {"to": row["system"].strip(), "protocol": row.get("protocol", "")}
        for row in answers.get("depends_on") or []
    ]
    connections = []
    for row, _site in rows:
        if not row.get("has_connections"):
            continue  # the connections question was hidden, so any answers to it are not valid
        for c in row.get("connections") or []:
            conn = _connection(_text(row["name"]), c)
            if not any(_same(conn, other) for other in connections):
                connections.append(conn)
    dr_site = _dr_site(answers)
    sites = {s["site"] for s in servers} | {x for x in (_text(answers.get("primary_site")), dr_site) if x}
    return {
        "system": system,
        "servers": servers,
        "sites": sorted(sites),
        "dr_site": dr_site,
        "links": links,
        "connections": connections,
    }
