# FixIt G2 — CPU / bcrypt tuning

**Experimental, no G1/G2 PASS.** All measurements are on the developer's
laptop, with disposable fixture accounts and genuine DB/broker interactions.

| Profile | Runtime | bcrypt | Individual p95 (ms) | Login burst p95 (ms) | Burst N | Chat p95 (ms) | Ticket p95 (ms) | Mem peak (MiB) | Checks |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| balanced | three | native c10 | 346.7 | 2580.3 | 12 | 1490.7 | 576.1 | 337.7 | 14 |
| balanced | three | native c11 | 511.4 | 4941.9 | 12 | 1496.5 | 588.5 | 339.4 | 14 |
| expanded | three | native c10 | 170.9 | 1217.2 | 12 | 789.8 | 233.2 | 323.2 | 14 |
| expanded | three | native c12 | 602.2 | 4315.6 | 12 | 699.9 | 300.2 | 325.2 | 14 |
| shared2 | three | native c11 | 380.7 | 1706.3 | 12 | 428.1 | 182.4 | 332.3 | 14 |
| shared2 | three | native c11 | 345.9 | 1725.5 | 10 | 468.6 | 184.7 | 325.5 | 14 |
| shared2 | three | native c12 | 615.9 | 2797.2 | 12 | 374.7 | 169.6 | 335.7 | 14 |
| balanced | two | native c10 | 159 | 1604.6 | 12 | 1589 | 30.2 | 299.0 | 14 |
| expanded | two | native c10 | 144.3 | 801.4 | 12 | 738.7 | 27.5 | 276.5 | 14 |
| shared2 | two | native c11 | 327.5 | 1605.4 | 12 | 401.4 | 87 | 270.3 | 14 |
| shared2 | two | native c11 | 307.4 | 1501 | 10 | 383.5 | 76.6 | 273.4 | 14 |

The original `login` field in early tuning results included ten
simultaneous logins plus two subsequent logins (N=12). Later runs use
`login_burst_10` (exactly ten concurrent requests). Do not treat those
different cohorts as identical.

Profiles:
- `balanced`: 2 vCPU quota sum, hard partitioned per container.
- `expanded`: 4 vCPU quota sum, hard partitioned per container.
- `shared2`: all containers share laptop's two **physical cores 0,2**
  through `cpuset`, without individual fractional CPU partitions.
- `shared4`: all containers share physical cores 0,1,2,3.

All profiles retain the 2,510 MiB aggregate *container* memory caps.
The shared-core experiment is NOT equivalent to EC2 virtual CPUs. It has
no global CPU time quota; each service can borrow otherwise unused cores.

The bcrypt cost is an adaptive password security parameter and must be
calibrated on the actual deployment, balancing protection and login SLA.
Do not lower cost merely to make the benchmark faster.

p95 is a small sample statistic, not a guarantee for real users,
and observed memory is only periodic Podman container snapshots.
Nothing here validates AWS price, free-tier eligibility, or real FixIt deployment.
