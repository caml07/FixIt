# Dependency RFC

Tickets uses Express 5.3.0 for HTTP and pg 8.23.1 for parameterized PostgreSQL access. Both match Auth's pins.

Prisma 7.10.1 runs the shared migration history and validates its schema. TypeScript 5.9.3 compiles the service. Express 5.0.6, pg 8.23.1 and Node 24.19.2 type packages provide development types. Tests use Node's built-in runner and fetch.

The scoped Effect 3.22.5 override follows Auth and addresses GHSA-7589-6fvf-x4pw. Audit results must be verified from this package's lockfile.
