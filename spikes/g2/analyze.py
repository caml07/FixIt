#!/usr/bin/env python3
"""Summarize verified G2 spike outputs; do not interpret this as a gate PASS."""
from collections import defaultdict
from pathlib import Path
import json
import re

BASE = Path(__file__).resolve().parent / "results"
UNITS = {"B": 1 / 1048576, "KB": 1 / 1024, "MB": 1e6 / 1048576,
         "GB": 1e9 / 1048576, "KiB": 1 / 1024, "MiB": 1, "GiB": 1024}


def to_mib(text):
    match = re.fullmatch(r"([\d.]+)\s*(B|KB|MB|GB|KiB|MiB|GiB)", text)
    if not match:
        raise ValueError("Unrecognized memory usage: " + text)
    return float(match[1]) * UNITS[match[2]]


def sample_mem(path):
    totals = []
    current = []
    for line in path.read_text().splitlines():
        if line.startswith("timestamp="):
            if current:
                totals.append(sum(current))
                current = []
        else:
            parts = line.split("|")
            if len(parts) == 3:
                current.append(to_mib(parts[1].split(" / ")[0]))
    if current:
        totals.append(sum(current))
    if not totals:
        raise ValueError("No stats samples in " + str(path))
    return round(max(totals), 1), len(totals)


runs = []
for file in sorted(BASE.glob("g2-*.json")):
    if not re.fullmatch(r"g2-(two|three)-\d{8}T\d{6}Z\.json", file.name):
        continue
    data = json.loads(file.read_text())
    if data.get("status") != "PASS_SPIKE":
        raise ValueError("Incomplete result: " + str(file))
    mem, samples = sample_mem(file.with_name(file.stem + "-stats.tsv"))
    runs.append({"name": file.name, "mode": data["mode"], "checks": len(data["checks"]),
                 "time": data["total_seconds"], "peak": mem, "samples": samples,
                 "latency": data["request_latency"]})
groups = {mode: [run for run in runs if run["mode"] == mode] for mode in ("three", "two")}


def values(mode, key):
    selected = groups[mode]
    return [r["peak"] if key == "peak" else r["latency"][key]["p95_ms"] for r in selected]


def range_text(mode, key):
    xs = values(mode, key)
    return "N/A" if not xs else (
        str(xs[0]) if min(xs) == max(xs) else str(min(xs)) + "–" + str(max(xs))
    )


q = chr(96)
lines = [
    "# G2 — Benchmark exploratorio",
    "",
    "**Estado: evidencia de spike, G2 NO PASS.** Datos de procesos reales",
    "Express + PostgreSQL + MongoDB + NATS + Socket.IO; no es el FixIt final.",
    "",
    "Cuotas de los contenedores: **2,510 MiB / 1.95 vCPU** en ambos escenarios.",
    "Cada corrida usa diez actores y verifica 13 comportamientos.",
    "",
    "| Indicador | 3 servicios | Core + Chat |",
    "| --- | ---: | ---: |",
]
for label, key in [
    ("Login (p95 ms)", "login"),
    ("Crear ticket (p95 ms)", "create_ticket"),
    ("Claim de ticket (p95 ms)", "claim"),
    ("Chat send (p95 ms)", "chat_send"),
    ("Consulta de sesión (p95 ms)", "10_users_get_me"),
    ("Memoria pico observada (MiB)", "peak"),
]:
    lines.append("| " + label + " | " + range_text("three", key) + " | "
                 + range_text("two", key) + " |")
lines += [
    "", "## Corridas", "",
    "| Modo | JSON | Checks | Duración (s) | Memoria pico (MiB) | Samples |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
]
for r in runs:
    lines.append("| {mode} | {quote}{name}{quote} | {checks}/13 | {time} | {peak} | {samples} |".format(
        quote=q, **r))
lines += [
    "",
    "Los rangos son **mínimo–máximo de p95 por corrida**, no intervalos de confianza.",
    "La memoria es suma máxima de muestras de podman stats y no incluye todo el host.",
    "La CPU total asignada es igual, pero en tres servicios Auth recibe 0.20 vCPU",
    "y Tickets 0.30, mientras Core comparte 0.50 vCPU; esa diferencia importa.",
    "",
    "**Limitaciones:** bcryptjs cost 9, no TLS/CSRF, un solo socket WebSocket,",
    "muestras pequeñas, sin carga prolongada, sin backups ni race in-flight,",
    "sin memoria de kernel y sistema operativo EC2, sin costos de AWS validados.",
    "La recuperación probada es de Chat/consumo JetStream, no de la base de datos.",
    "",
    "Un primer intento de tres servicios falló por un matcher incompleto del",
    "proxy Caddy. Se corrigió y ese intento no se incluye en las corridas válidas.",
]
BASE.joinpath("SUMMARY.md").write_text("\n".join(lines) + "\n")
print("Runs:", len(runs), "Three:", len(groups["three"]), "Two:", len(groups["two"]))
print("Generated:", BASE / "SUMMARY.md")
