# FixIt G2: 10 WebSockets + outages

**Experimental only; G2 NOT PASS.** 10 fixture users, 10 authenticated
Socket.IO connections, one message/user/second for 20 or 25 seconds.
All containers share two physical laptop cores (cpuset 0,2), with
2,510 MiB of aggregate container memory limits. This is not EC2.

| Mode | Seconds | Soak ACKs | Soak errors | Soak p50/p95/p99 (ms) | Peak container MiB | Checks |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| three (mixed with outages: not comparable) | 20 | 204 | 0 | 69.3/117.3/1786.9 | 333.8 | 11 |
| three (soak only) | 20 | 200 | 0 | 75.9/122.9/134.6 | 338.1 | 11 |
| three (mixed with outages: not comparable) | 25 | 252 | 0 | 95.2/142.1/229.6 | 352.0 | 9 |
| two (soak only) | 20 | 200 | 0 | 58.4/88.6/101.6 | 282.0 | 10 |
| two (mixed with outages: not comparable) | 25 | 251 | 0 | 56.5/105.8/127 | 284.5 | 8 |

Checks: ten independently authenticated sockets and their authorized
ticket joins; messages and ACKs persist in MongoDB; HTTP history;
Auth outage for three-service mode; Tickets outage; MongoDB and
PostgreSQL outages; NATS down with pending outbox and catch-up.

The first 25-second results mix failure injection requests into
their socket latency cohort; newer JSON with soakSuccessfulSends
separates it. Do not compare the mixed figures to pure soak latency.

Restarting the same database/broker container preserves its existing
container files, which is not a backup/restore or lost-volume test.
No production FixIt code, full TLS/CSRF, multi-hour load, or AWS host
and T3 CPU-credit simulation was exercised. No gate is accepted.
