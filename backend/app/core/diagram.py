"""Build a Mermaid flowchart from normalized models."""
import re

from app.core.normalize import ENDPOINTS


def _id(prefix, text):
    return prefix + "_" + re.sub(r"[^A-Za-z0-9]", "_", text)


def _label(text):
    return text.replace('"', "'")


def _server_id(system, s):
    return _id("srv", system + "_" + s.get("key", s["name"]))


def _server_node(system, s):
    node = _server_id(system, s)
    ip = " " + s["ip"] if s.get("ip") else ""
    return f'{node}["{_label(s["name"])} ({_label(s["role"])}){ip}"]'


def build_mermaid(models):
    """models: list of normalized dicts (one per system)."""
    lines = ["flowchart LR"]
    sites = {}
    for m in models:
        for s in m["servers"]:
            sites.setdefault(s["site"], []).append((m["system"], s))
        for g in m.get("segments") or []:
            sites.setdefault(g["site"], [])
    for site in sorted(sites):
        lines.append(f'  subgraph {_id("site", site)}["Site: {_label(site)}"]')
        for m in models:
            for g in m.get("segments") or []:
                if g["site"] != site:
                    continue
                seg_id = _id("seg", m["system"] + "_" + g.get("key", g["name"]))
                lines.append(f'    subgraph {seg_id}["{_label(g["name"])} {g["subnet"]}"]')
                for system, s in sites[site]:
                    if system == m["system"] and s.get("segment") == g["name"]:
                        lines.append(f"      {_server_node(system, s)}")
                lines.append("    end")
        names = {(m["system"], g["name"]) for m in models for g in m.get("segments") or [] if g["site"] == site}
        for system, s in sites[site]:
            if (system, s.get("segment")) not in names:
                lines.append(f"    {_server_node(system, s)}")
        lines.append("  end")
    known = set()
    for m in models:
        known.add(m["system"])
        lines.append(f'  {_id("sys", m["system"])}(["{_label(m["system"])}"])')
        for s in m["servers"]:
            lines.append(f'  {_id("sys", m["system"])} -.-> {_server_id(m["system"], s)}')
    for m in models:
        for link in m["links"]:
            if link["to"] not in known:
                lines.append(f'  {_id("sys", link["to"])}(["{_label(link["to"])} (not described yet)"])')
                known.add(link["to"])
            label = f'|{_label(link["protocol"])}|' if link["protocol"] else ""
            lines.append(f'  {_id("sys", m["system"])} -->{label} {_id("sys", link["to"])}')
    for m in models:
        conns = m.get("connections") or []
        if any(ENDPOINTS in (c["from"], c["to"]) for c in conns):
            lines.append(f'  {_id("ep", m["system"])}[["{_label(ENDPOINTS)}"]]')
        segment_names = {g.get("key", g["name"]) for g in m.get("segments") or []} | {g["name"] for g in m.get("segments") or []}
        server_ids = {s.get("key", s["name"]): _server_id(m["system"], s) for s in m["servers"]}
        server_ids.update({s["name"]: _server_id(m["system"], s) for s in m["servers"] if s["name"] not in server_ids})
        for c in conns:
            ends = [
                _id("ep", m["system"]) if n == ENDPOINTS
                else server_ids[n] if n in server_ids
                else _id("seg", f'{m["system"]}_{n}') if n in segment_names
                else _id("srv", f'{m["system"]}_{n}')
                for n in (c["from"], c["to"])
            ]
            text = " ".join(x for x in (c["protocol"], c["ports"]) if x)
            label = f'|{_label(text)}|' if text else ""
            arrow = "<-->" if c.get("both") else "-->"
            lines.append(f"  {ends[0]} {arrow}{label} {ends[1]}")
    return "\n".join(lines)
