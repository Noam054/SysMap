"""Turn raw answers into the common model: system, sites, segments, servers, links, connections.
Keep in step with frontend/js/model.js (the browser's copy, for the live diagram)."""
from app.core.validation import cidr, ipv4_text

# The special "server" for traffic to or from all endpoints (e.g. agents). Same text in frontend/js/diagram.js.
ENDPOINTS = "All endpoints"
# The first option of the DR question (v2 and later): no DR site.
NO_DR = "No DR site"


def _text(v):
    return v.strip() if isinstance(v, str) else ""


def _rows(v):
    return [r for r in v if isinstance(r, dict)] if isinstance(v, list) else []


def _names(v):
    """One name, or several picked at once (v4: "From" and "To" may each list several segments)."""
    return [x for x in (_text(n) for n in (v if isinstance(v, list) else [v])) if x]


def _connections(sources, c):
    """One answer about a connection -> [{from, to, both, protocol, ports}], one per pair of ends.
    sources: the names it is described from ("From" since v3, the server itself in v2).
    The direction is read from the start of the chosen option: "Incoming ...", "Both ..." or outgoing."""
    direction = _text(c.get("direction")).lower()
    incoming = direction.startswith("incoming")
    out = []
    for source in sources:
        for other in _names(c.get("to")):
            out.append({
                "from": other if incoming else source,
                "to": source if incoming else other,
                "both": direction.startswith("both"),
                "protocol": _text(c.get("protocol")),
                "ports": _text(c.get("ports")),
            })
    return out


def _same(a, b):
    """The same connection described from both of its ends counts once."""
    if (a["both"], a["protocol"], a["ports"]) != (b["both"], b["protocol"], b["ports"]):
        return False
    if a["both"]:
        return {a["from"], a["to"]} == {b["from"], b["to"]}
    return (a["from"], a["to"]) == (b["from"], b["to"])


def _site_blocks(answers):
    """(answers of one site, site name): the top level is the primary site, then each "Add site" block (v3).
    Older answers: v2 lists servers of other sites in 'other_servers' (each with its own 'site'),
    and v1 gives a site per server with no primary site."""
    yield answers, _text(answers.get("primary_site"))
    for block in _rows(answers.get("other_sites")):
        yield block, _text(block.get("site"))


def _subnet(text):
    """' 14.151.0.0 / 24 ' -> '14.151.0.0/24' (tidied); text that is not a valid subnet is kept as typed."""
    parsed = cidr(text)
    return f"{ipv4_text(parsed[0])}/{parsed[1]}" if parsed else _text(text)


def _dr_site(answers):
    if "has_dr" in answers:  # v1: a yes/no question, then the DR site typed in
        return _text(answers.get("dr_site")) if answers.get("has_dr") else ""
    dr = _text(answers.get("dr_site"))  # v2 and later: a dropdown that starts with "No DR site"
    return "" if dr == NO_DR else dr


def node_key(name, site):
    """How a server or segment is named in connections and in the model: "DB (Sapir)". Two sites may both
    have a segment (or a server) called "DB"; the site tells them apart. Same text as the questionnaire's
    options_from label. A server and a segment of one site never share a name (the "not_in" rule)."""
    return f"{name} ({site or '?'})"


def normalize(answers):
    segments, server_rows, raw_connections, connections = [], [], [], []

    for block, site in _site_blocks(answers):
        for row in _rows(block.get("segments")):
            name = _text(row.get("name"))
            segments.append({"name": name, "site": site, "subnet": _subnet(row.get("subnet")), "key": node_key(name, site)})
        for row in _rows(block.get("servers")):
            server_rows.append((row, _text(row.get("site")) or site))
        for c in _rows(block.get("connections")):  # v3: each site's own; v4: one list for all sites (top level)
            raw_connections.append((_names(c.get("from")), c, site))
    if answers.get("has_other_sites"):  # v2
        server_rows += [(row, _text(row.get("site"))) for row in _rows(answers.get("other_servers"))]

    servers = []
    for row, site in server_rows:
        servers.append({
            "name": _text(row.get("name")), "site": site,
            "role": row.get("role", "other"), "os": row.get("os", ""),
            "segment": _text(row.get("segment")),
            "key": node_key(_text(row.get("name")), site),
        })
        if row.get("has_connections"):  # v2: connections inside each server (hidden, so ignored, when "No")
            for c in _rows(row.get("connections")):
                raw_connections.append((_names(row.get("name")), c, site))

    nodes = servers + segments  # servers first: in older answers a plain name means the server
    keys = {n["key"] for n in nodes}

    def end(value, site):
        """A connection end -> a server or segment key ("DB (Sapir)"), or ENDPOINTS.
        v3 answers name a server or segment without its site: the one in the connection's own site,
        else the only one with that name."""
        if value in keys or value == ENDPOINTS:
            return value
        same_name = [n for n in nodes if n["name"] == value]
        here = [n for n in same_name if n["site"] == site]
        return (here or same_name)[0]["key"] if (here or len(same_name) == 1) else value

    for sources, c, site in raw_connections:
        for conn in _connections(sources, c):
            conn["from"], conn["to"] = end(conn["from"], site), end(conn["to"], site)
            if conn["from"] != conn["to"] and not any(_same(conn, other) for other in connections):
                connections.append(conn)

    links = [
        {"to": _text(row.get("system")), "protocol": row.get("protocol", "")}
        for row in _rows(answers.get("depends_on"))
    ]
    dr_site = _dr_site(answers)
    sites = {s["site"] for s in servers} | {s["site"] for s in segments}
    sites |= {x for x in (_text(answers.get("primary_site")), dr_site) if x}
    sites |= {site for _block, site in _site_blocks(answers) if site}
    return {
        "system": _text(answers.get("system_name")),
        "servers": servers,
        "segments": segments,
        "sites": sorted(sites),
        "dr_site": dr_site,
        "links": links,
        "connections": connections,
    }
