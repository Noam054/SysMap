"""Build a Mermaid flowchart from normalized models."""
import re


def _id(prefix, text):
    return prefix + "_" + re.sub(r"[^A-Za-z0-9]", "_", text)


def _label(text):
    return text.replace('"', "'")


def build_mermaid(models):
    """models: list of normalized dicts (one per system)."""
    lines = ["flowchart LR"]
    sites = {}
    for m in models:
        for s in m["servers"]:
            sites.setdefault(s["site"], []).append((m["system"], s))
    for site in sorted(sites):
        lines.append(f'  subgraph {_id("site", site)}["Site: {_label(site)}"]')
        for system, s in sites[site]:
            node = _id("srv", f'{system}_{s["name"]}')
            lines.append(f'    {node}["{_label(s["name"])} ({_label(s["role"])})"]')
        lines.append("  end")
    known = set()
    for m in models:
        known.add(m["system"])
        lines.append(f'  {_id("sys", m["system"])}(["{_label(m["system"])}"])')
        for s in m["servers"]:
            lines.append(f'  {_id("sys", m["system"])} -.-> {_id("srv", m["system"] + "_" + s["name"])}')
    for m in models:
        for link in m["links"]:
            if link["to"] not in known:
                lines.append(f'  {_id("sys", link["to"])}(["{_label(link["to"])} (not described yet)"])')
                known.add(link["to"])
            label = f'|{_label(link["protocol"])}|' if link["protocol"] else ""
            lines.append(f'  {_id("sys", m["system"])} -->{label} {_id("sys", link["to"])}')
    return "\n".join(lines)
