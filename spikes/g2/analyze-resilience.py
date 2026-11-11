#!/usr/bin/env python3
"""Summarize G2 resilience outputs; do not mix outage latency with normal operation."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent / "results" / "resilience"
FACTORS = {"B": 1 / 1048576, "KB": 1000 / 1048576,
           "MB": 1e6 / 1048576, "GB": 1e9 / 1048576,
           "KiB": 1 / 1024, "MiB": 1, "GiB": 1024}


def peak_memory(path):
    totals, current = [], []
    for line in path.read_text().splitlines():
        if line.startswith("timestamp="):
            if current:
                totals.append(sum(current))
                current = []
        else:
            fields = line.split("|")
            if len(fields) != 3:
                continue
            match = re.fullmatch(r"([\d.]+)\s*(B|KB|MB|GB|KiB|MiB|GiB)",
                                 fields[1].split(" / ")[0])
            if match:
                current.append(float(match[1]) * FACTORS[match[2]])
    if current:
        totals.append(sum(current))
    return round(max(totals), 1) if totals else None


runs = []
for path in sorted(ROOT.glob("g2-*.json")):
    data = json.loads(path.read_text())
    assert data["status"] == "PASS_RESILIENCE_SPIKE"
    mem = peak_memory(path.with_name(path.stem + "-stats.tsv"))
    runs.append((path.name, data, mem, "soakSuccessfulSends" in data))

lines = [
    "# FixIt G2: 10 WebSockets + outages",
    "",
    "**Experimental only; G2 NOT PASS.** 10 fixture users, 10 authenticated",
    "Socket.IO connections, one message/user/second for 20 or 25 seconds.",
    "All containers share two physical laptop cores (cpuset 0,2), with",
    "2,510 MiB of aggregate container memory limits. This is not EC2.",
    "",
    "| Mode | Seconds | Soak ACKs | Soak errors | Soak p50/p95/p99 (ms) | Peak container MiB | Checks |",
    "| --- | ---: | ---: | ---: | --- | ---: | ---: |",
]
for filename, d, peak, corrected in runs:
    label = "soak only" if corrected else "mixed with outages: not comparable"
    n = str(d.get("soakSuccessfulSends", d["successfulSends"]))
    p = d["socketSend"]
    lines.append(f"| {d['mode']} ({label}) | {d['durationTargetSeconds']} | {n} | "
                 f"{d['soakErrors']} | {p['p50Ms']}/{p['p95Ms']}/{p['p99Ms']} | "
                 f"{peak} | {len(d['checks'])} |")
lines += [
    "",
    "Checks: ten independently authenticated sockets and their authorized",
    "ticket joins; messages and ACKs persist in MongoDB; HTTP history;",
    "Auth outage for three-service mode; Tickets outage; MongoDB and",
    "PostgreSQL outages; NATS down with pending outbox and catch-up.",
    "",
    "The first 25-second results mix failure injection requests into",
    "their socket latency cohort; newer JSON with soakSuccessfulSends",
    "separates it. Do not compare the mixed figures to pure soak latency.",
    "",
    "Restarting the same database/broker container preserves its existing",
    "container files, which is not a backup/restore or lost-volume test.",
    "No production FixIt code, full TLS/CSRF, multi-hour load, or AWS host",
    "and T3 CPU-credit simulation was exercised. No gate is accepted.",
]
ROOT.joinpath("SUMMARY.md").write_text("\n".join(lines) + "\n")
print("resilience runs", len(runs), "corrected", sum(ok for _, _, _, ok in runs))
