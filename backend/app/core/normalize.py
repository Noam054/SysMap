"""Turn raw answers into the common model: system, servers, sites, links."""


def normalize(answers):
    system = (answers.get("system_name") or "").strip()
    servers = []
    for row in answers.get("servers") or []:
        servers.append({
            "name": row["name"].strip(),
            "site": row["site"].strip(),
            "role": row.get("role", "other"),
            "os": row.get("os", ""),
        })
    links = [
        {"to": row["system"].strip(), "protocol": row.get("protocol", "")}
        for row in answers.get("depends_on") or []
    ]
    sites = sorted({s["site"] for s in servers})
    if answers.get("has_dr") and answers.get("dr_site"):
        sites = sorted(set(sites) | {answers["dr_site"].strip()})
    return {"system": system, "servers": servers, "sites": sites, "links": links}
