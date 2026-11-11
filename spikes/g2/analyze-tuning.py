#!/usr/bin/env python3
"""Summarize exploratory G2 CPU profiles without merging them with baseline."""
from pathlib import Path
import json
import re
from collections import defaultdict

ROOT = Path(__file__).resolve().parent / "results" / "tuning"
UNITS = {"B": 1 / (1024 * 1024), "KB": 1000 / (1024 * 1024),
         "MB": 1_000_000 / (1024 * 1024), "GB": 1_000_000_000 / (1024 * 1024),
         "KiB": 1 / 1024, "MiB": 1, "GiB": 1024}


def peak_memory(path):
    totals, cur = [], []
    for line in path.read_text().splitlines():
        if line.startswith("timestamp="):
            if cur:
                totals.append(sum(cur))
                cur = []
        else:
            p = line.split("|")
            if len(p) != 3:
                continue
            value = p[1].split(" / ")[0]
            m = re.fullmatch(r"([0-9.]+)\s*(B|KB|MB|GB|KiB|MiB|GiB)", value)
            if m:
                cur.append(float(m[1]) * UNITS[m[2]])
    if cur:
        totals.append(sum(cur))
    return round(max(totals), 1) if totals else None


rows = []
for f in sorted(ROOT.glob("g2-*.json")):
    data = json.loads(f.read_text())
    if data.get("status") != "PASS_SPIKE":
        continue
    summary = data.get("request_latency", {})
    def get(name):
        val = summary.get(name)
        return val["p95_ms"] if val else None

    rows.append({
        "name": f.name, "mode": data["mode"], "profile": data.get("profile"),
        "engine": data.get("bcryptEngine"), "cost": data.get("bcryptCost"),
        "count": len(data["checks"]),
        "single": get("login_single"),
        "burst": get("login_burst_10") or get("login"),
        "burst_n": summary.get("login_burst_10", summary.get("login", {})).get("count"),
        "chat": get("chat_send"),
        "tickets": get("create_ticket"),
        "memory": peak_memory(f.with_name(f.stem + "-stats.tsv")),
    })

def fmt(x):
    return str(x) if x is not None else "-"


lines = [
    "# FixIt G2 — CPU / bcrypt tuning",
    "",
    "**Experimental, no G1/G2 PASS.** All measurements are on the developer's",
    "laptop, with disposable fixture accounts and genuine DB/broker interactions.",
    "",
    "| Profile | Runtime | bcrypt | Individual p95 (ms) | Login burst p95 (ms) | Burst N | Chat p95 (ms) | Ticket p95 (ms) | Mem peak (MiB) | Checks |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
]
for r in rows:
    lines.append("| {profile} | {mode} | {engine} c{cost} | {single} | {burst} | {burst_n} | {chat} | {tickets} | {memory} | {count} |".format(**r))
lines += [
    "",
    "The original `login` field in early tuning results included ten",
    "simultaneous logins plus two subsequent logins (N=12). Later runs use",
    "`login_burst_10` (exactly ten concurrent requests). Do not treat those",
    "different cohorts as identical.",
    "",
    "Profiles:",
    "- `balanced`: 2 vCPU quota sum, hard partitioned per container.",
    "- `expanded`: 4 vCPU quota sum, hard partitioned per container.",
    "- `shared2`: all containers share laptop's two **physical cores 0,2**",
    "  through `cpuset`, without individual fractional CPU partitions.",
    "- `shared4`: all containers share physical cores 0,1,2,3.",
    "",
    "All profiles retain the 2,510 MiB aggregate *container* memory caps.",
    "The shared-core experiment is NOT equivalent to EC2 virtual CPUs. It has",
    "no global CPU time quota; each service can borrow otherwise unused cores.",
    "",
    "The bcrypt cost is an adaptive password security parameter and must be",
    "calibrated on the actual deployment, balancing protection and login SLA.",
    "Do not lower cost merely to make the benchmark faster.",
    "",
    "p95 is a small sample statistic, not a guarantee for real users,",
    "and observed memory is only periodic Podman container snapshots.",
    "Nothing here validates AWS price, free-tier eligibility, or real FixIt deployment.",
]
ROOT.joinpath("SUMMARY.md").write_text("\n".join(lines) + "\n")
print("wrote tuning summary from", len(rows), "passing runs")
