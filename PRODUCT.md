# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React web frontend, selected by the user. Vite is the documented bundler direction; no component library is selected. Keep the UI stack lean and avoid adding a component system without a demonstrated need.

## Users

- **Reporter:** Keiser LAC faculty, staff, and authorized pilot users who need to report an IT incident, follow its progress, communicate with the assigned support agent, and confirm resolution.
- **Support Agent:** IT support personnel who review the available queue, claim incidents, work on assigned tickets, communicate with reporters, and record resolution.
- **Admin:** an authorized operator who manages user accounts, supervises all tickets, and handles exceptional reassignment or status actions.

The MVP is a single-tenant academic pilot for Keiser University Latin American Campus. It does not imply an official university deployment. General student access, real institutional identities, and directory integration are out of scope.

## Product Purpose

FixIt centralizes IT incidents as traceable support tickets. Each incident has an authenticated reporter, a status, an accountable support agent when claimed, an auditable history, and a private conversation attached to that ticket.

Success means that a reporter can submit an issue and follow it to closure, a support agent can claim and resolve it without duplicate assignment, and an admin can supervise the process without losing its history.

## Positioning

FixIt is a ticket-first IT Help Desk. Conversation belongs to an incident instead of becoming a separate, untracked support channel. Ticket ownership, assignment, status, and access are enforced by the backend.

## Operating Context

- Users access FixIt through a browser on desktop and mobile. Both device classes have equal design priority.
- The interface language is English (en).
- The product is used in an academic pilot with synthetic test data. Do not imply that it is an officially deployed university service.
- Each account represents a person. Admin provisions accounts; there is no public self-registration.
- The web UI has role-specific navigation inside one shared application.

## Capabilities and Constraints

- The MVP has three roles: REPORTER, SUPPORT_AGENT, and ADMIN.
- Admin creates, resets, disables, and reactivates personal accounts. Temporary passwords require a password change on first access. Role changes and self-registration are not part of the MVP.
- Reporter creates IT tickets with a server-generated timestamp, a required title and description, a category from the existing IT catalog, and required proposed urgency. Location and equipment are optional.
- The available ticket categories are hardware/computer, network/Wi-Fi, software, accounts, and peripherals. The informal example “light” does not expand the product into facilities maintenance.
- Reporter urgency is `LOW`, `NORMAL`, or `HIGH`. The currently assigned Support Agent or Admin sets the official priority manually (`P1_CRITICAL`, `P2_HIGH`, `P3_NORMAL`, `P4_LOW`). Official priority starts unset and is required before `IN_PROGRESS`; later changes require a reason. These are distinct values and have distinct permissions.
- Optional evidence supports up to 5 files per ticket (maximum 2 videos): JPEG/PNG/WebP images up to 5 MiB each, MP4 videos up to 25 MiB each, and 50 MiB total per ticket. There is no separate duration limit. Local development uses private filesystem storage; private S3 is reserved for an authorized Cloud environment.
- The ticket lifecycle is OPEN → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED, with OPEN → CANCELLED.
- Support Agents claim unassigned OPEN tickets atomically. The available queue exposes only the summary fields allowed by the API.
- Chat belongs to a ticket. It is unavailable while a ticket is OPEN, writable while it is ASSIGNED or IN_PROGRESS, and read-only after RESOLVED, CLOSED, or CANCELLED.
- Ticket activity and system events remain auditable and are distinct from human chat messages.
- In-app updates cover new tickets for Admin, assignment or reassignment, status changes, and new messages for authorized participants. Email, push, and a separate notification-history center are out of scope.
- The current API supports ticket scope, status filtering, cursor pagination, and creation-time sorting. Full-text search and advanced category filters are not currently part of the contract.
- Contract baseline 0.2.0, including ticket urgency, official priority, multi-file evidence, and the Chat protocol, was frozen by the user on 26 Nov for implementation. Redocly, Prisma validation, disposable PostgreSQL migration/deploy/diff checks pass. Technical review by Valeria/Rina and the baseline commit remain pending; no application behavior is implemented and G1 is not PASS.

## Brand Commitments

- Product name: **FixIt**.
- Do not use a Keiser University logo or claim official university endorsement unless the team supplies and authorizes the relevant brand assets.
- The selected visual direction is recorded in the FixIt UI surface brief. This product record does not define colors, typography, or components.

## Evidence on Hand

- Product scope, roles, ticket lifecycle, and requirements are documented in docs/001.Product.md and docs/002.Requirements.md.
- API behavior and current contract gaps are documented in docs/010.G1-Contracts.md and docs/openapi.json.
- No production data, approved university brand assets, real testimonials, or verified service metrics are available. Use clearly synthetic examples in prototypes and demos.

## Product Principles

- Keep the reporter's path to submitting and following an incident short.
- Keep every conversation attached to its ticket.
- Make ownership, status, and history visible without exposing data to unauthorized users.
- Prefer a small, complete IT Help Desk workflow over unrelated service-management features.
- Treat desktop and mobile as first-class browser experiences.

## Accessibility & Inclusion

- Support keyboard navigation and visible focus.
- Give form controls persistent labels and clear validation feedback.
- Maintain readable contrast and responsive layouts at the project's 360 px mobile and 1280 px desktop review widths.
- The formal WCAG conformance target has not yet been selected.
