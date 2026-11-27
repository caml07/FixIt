---
surface: fixit-workspace
status: approved-by-user
mode: operate
platform: web
language: en
reviewed_on: 2026-11-25
---

# FixIt Workspace — UI design brief

## 1. Job and audience

FixIt is a browser-based IT Help Desk for the Keiser University LAC academic pilot. The surface serves three roles in one application:

- **Reporter:** submit an IT incident, see its status, communicate with the assigned agent, and confirm that it is resolved.
- **Support Agent:** review available incidents, claim one, work on assigned tickets, communicate with the reporter, and resolve the issue.
- **Admin:** supervise all tickets, manage personal accounts, and perform exceptional reassignment or status actions.

**Mode:** Operate. Visitors arrive to complete support tasks, not to explore a marketing page. The first viewport must be a working workspace, not a hero or promotional dashboard.

## 2. Outcome and product truth

The primary journey is:

1. Reporter signs in and submits an IT request.
2. The ticket enters OPEN and appears in the permitted queues.
3. One Support Agent claims it. Competing claims produce one winner and a conflict for the other agent.
4. The assigned agent and reporter communicate inside the ticket.
5. The agent marks the issue RESOLVED.
6. The reporter confirms closure, producing CLOSED.

The system keeps ticket activity separate from chat messages. Permissions come from the backend and apply equally to page data, attachments, chat history, and live socket events.

Use synthetic names, ticket IDs, dates, and messages in design examples. Do not fabricate university approval, service metrics, testimonials, or real institutional data.

## 3. Selected direction

- **Visual direction:** option **B**, previously described in the design discussion as **Campus / Warm**. Keep this as the selected direction; do not silently replace it.
- **Responsive priority:** desktop and mobile are equally important.
- **Interface language:** English (en).
- **Product character:** warm, campus-oriented, and professional. It must still read immediately as a capable IT support tool, not a university marketing site or student portal.
- **Working palette reference only:** warm neutral surfaces, white content panels, muted sage, deep forest green, and a restrained green accent. The earlier exploratory swatches (#F5F4EF, #FFFFFF, #E2E8DE, #20372D, #46765B) are not final design tokens.
- Prefer one readable sans-serif family for product UI. Use standard web controls and familiar navigation patterns.
- Do not add decorative stock photography, invented university logos, or ornamental campus imagery.
- Use color for navigation hierarchy, selection, actions, and semantic ticket states. Final tokens and exact type scale remain open until the first rendered design is reviewed.

### Visual references pinned for implementation

- [Badi — SaaS login / signup design](https://dribbble.com/shots/20718765-SaaS-login-signup-design): focused authentication layout and restrained form hierarchy.
- [Aly Bump — Responsive Datatables & Dashboard](https://dribbble.com/shots/22552214-Responsive-Datatables-Dashboard): information-dense service-desk tables and deliberate desktop/mobile adaptation.
- [Oyegoke Praise — Customer Support Ticket Details Web App UI](https://dribbble.com/shots/27822858-Customer-Support-Ticket-Details-Web-App-UI): ticket conversation with a distinct details rail.

Use these as structural references, not as permission to copy their unrelated palettes or product content. The FixIt Campus / Warm direction remains authoritative.

## 4. Surface map and navigation

Use one shared application shell with role-aware navigation. Hide destinations the current role cannot use.

| Role | Main destinations |
| --- | --- |
| Reporter | My Requests; New Request |
| Support Agent | Support Inbox |
| Admin | All Tickets; User Management |

### Shared shell

- **Desktop:** persistent left navigation, a compact top bar, page title and contextual actions, then the main work area.
- **Mobile:** drawer navigation, compact page header, and content optimized for a narrow viewport.
- Keep the FixIt identity and account actions visible without consuming the main work area.
- Do not add a separate landing dashboard full of decorative metrics.

### Screen inventory

1. **Authentication**
   - Sign in.
   - Mandatory first-login password change.
   - No public sign-up or self-service password recovery in the MVP.

2. **Ticket workspace**
   - Reporter sees only their own tickets.
   - Support Agent sees one inbox with two tabs: **Available** and **Assigned to me**.
   - Admin sees all tickets.
   - Desktop uses a compact, scannable table. Mobile uses ticket cards.
   - Provide status filters, stable creation-time sorting, pagination, loading, empty, and error states.
   - Do not show full ticket descriptions or private content in the available queue; it exposes only the API's permitted summary.

3. **New Request**
   - Keep the primary form short and on one page.
   - Show Subject, Category, and Description in the main form.
   - Show the server-generated creation time after submission; do not let the client set createdAt.
   - Put **Location** and **Equipment** inside a collapsed section named **Additional details (optional)**.
   - Provide an optional evidence area for JPEG/PNG/WebP and MP4 uploads, following the frozen limits: 5 files/2 videos per ticket, 5 MiB per image, 25 MiB per video, 50 MiB total.
   - Require a distinct Reporter urgency input (`LOW`, `NORMAL`, `HIGH`). Never label or submit it as official priority.

4. **Ticket detail**
   - **Desktop:** conversation is the primary work area. A separate side rail contains ticket details and a distinct Activity section.
   - **Mobile:** use **Conversation** and **Details** tabs. Keep Activity as a distinct section inside Details; do not merge system events into the message thread.
   - Show ticket identity, category, status, creation time, reporter/assignee information when permitted, and current official priority when available.
   - Keep the message composer visible while chat is writable. Replace it with a clear read-only explanation when the ticket is no longer writable.
   - Place attachment previews in ticket evidence, not in the chat transcript.

5. **User Management**
   - Admin can list users, create a personal account, issue a password reset, disable an account, and reactivate an account.
   - Use focused dialogs or sheets for create and account actions.
   - Do not provide role editing or public registration.

## 5. Interaction and permission rules

### Ticket workspace

- Support Inbox uses **Available** and **Assigned to me** tabs within one page.
- Claim is an explicit action, never drag-and-drop.
- On a 409 claim conflict, explain that another agent claimed the ticket and refresh the affected queue.
- The current contract supports scope, status, cursor pagination, and creation-time sorting. Do not add global search or category/assignee filters without a contract change.

### Ticket actions

- Reporter can cancel their own OPEN ticket and close their own RESOLVED ticket.
- Support Agent can claim an eligible OPEN ticket and move an assigned ticket through IN_PROGRESS to RESOLVED.
- Admin can reassign eligible tickets and perform documented exceptional actions. Require a reason wherever the contract requires one.
- Never rely on hidden buttons as authorization. The backend remains authoritative.
- A Reporter may see the official priority but cannot create or change it.
- Only the currently assigned Support Agent or Admin can set or change official priority; the control uses the frozen priority endpoint and requires a reason for subsequent changes.

### Chat and Activity

| Ticket state | Chat behavior |
| --- | --- |
| OPEN | No chat room; composer disabled and assignment guidance shown |
| ASSIGNED | Writable for authorized participants |
| IN_PROGRESS | Writable for authorized participants |
| RESOLVED | History is read-only |
| CLOSED | History is read-only |
| CANCELLED | History is read-only |

Activity is a separate, chronological audit trail for events such as creation, claim, reassignment, and status changes. It is not a second chat stream.

### Notifications

Show in-app feedback for ticket creation, assignment or reassignment, status changes, and new messages, only to authorized recipients. Do not add email, push, or a separate notification center.

## 6. States and content ranges

Design and verify these states for every relevant screen:

- Initial loading with content skeletons.
- First-use and filtered empty states with a useful next action.
- Validation errors beside the relevant fields.
- Network/service errors with a safe retry action.
- Expired or revoked session.
- Permission-denied or unavailable resource.
- Disabled, pending, and read-only controls.
- Successful create, claim, update, upload, and account actions.
- Claim conflict and stale-version conflict.
- Long descriptions, long names, long email addresses, and narrow mobile widths.
- Empty conversation and empty Activity history.
- Reconnection and duplicate-message handling without duplicate visible messages.

Keep error copy actionable and specific. Do not expose tokens, internal service details, or sensitive ticket data in error messages.

## 7. Responsive behavior and accessibility

| Area | Desktop | Mobile |
| --- | --- | --- |
| Navigation | Left sidebar | Drawer |
| Ticket list | Table | Cards |
| Ticket detail | Conversation plus details/activity side rail | Conversation and Details tabs; Activity is a separate section within Details |
| New Request | Centered form | Full-width form |
| User Management | Table | Cards |
| Confirmations | Dialog | Dialog or full-screen sheet when space requires it |

- Review at 1280 px desktop and 360 px mobile.
- Support keyboard-only navigation and visible focus.
- Use persistent labels, semantic headings, accessible names, and clear validation.
- Do not communicate ticket status by color alone.
- Respect reduced-motion preferences.
- Use brief, purposeful transitions for state changes and feedback. Avoid decorative entrance choreography.

## 8. Reusable component vocabulary

Build one shared component system for all roles:

- AppShell, Sidebar, MobileDrawer, PageHeader
- TicketTable, TicketCard, TicketStatusBadge, TicketFilters, Pagination
- TicketForm, AdditionalDetails, EvidenceUploader
- TicketConversation, MessageBubble, MessageComposer
- TicketDetailsPanel, ActivityTimeline
- UserTable, UserCard, UserForm
- ConfirmDialog, Toast, EmptyState, ErrorState, LoadingSkeleton

Component names describe responsibilities, not a mandate to create every component before it is needed.

## 9. Scope boundaries

Do not include:

- Global or ticket-independent chat.
- AI triage or automatic priority assignment.
- Facilities maintenance, inventory, asset tracking, or device identity.
- Multi-tenant organization switching.
- Public self-registration or role editing.
- Email or push notifications.
- Advanced analytics, charts, SLA dashboards, or gamification.
- Search and filters that the current API does not support.
- Native mobile applications.

## 10. Frozen contract baseline

Contract baseline **0.2.0 was frozen by the project owner on 26 November 2026** for implementation. This is not a claim of technical ratification by Valeria/Rina or a G1 PASS. It includes:

1. **Urgency and priority:** Reporter urgency is required and editable only while `OPEN`; the assigned Agent/Admin sets official priority, which starts unset and is required before `IN_PROGRESS`.
2. **Photo/video evidence:** optional multi-file uploads follow the limits in FR-016 and use private storage; evidence is not part of Chat messages.
3. **Subject and description:** Subject maps to the required API `title`; description remains required.
4. **Category labels:** render the existing category catalog from the API and confirm final English labels against seeded codes.
5. **Accessibility target:** keyboard, labels, focus, contrast, and responsive behavior are required; formal WCAG conformance level remains undecided.

Do not implement a control that submits unsupported fields. Changes after 0.2.0 require a new coordinated contract version. The 0.2.0 contract is recorded in dev before implementation commits. UI uses typed fixtures until service integration is authorized.

## 11. Direction contract

**THESIS:** FixIt is an operational service desk, not a student portal. The interface puts the ticket queue and its next action in the first viewport instead of hiding work behind decorative dashboard cards.

**OWN-WORLD:** Warm mineral neutrals, white working surfaces, muted sage selection, deep forest navigation, and a restrained green action color. Use one crisp sans-serif UI voice, fine borders, quiet depth, compact status labels, and authored ticket content. No glass, gradients, stock imagery, fake university marks, or ornamental campus motifs.

**STORY:** Sign in, arrive at the queue permitted for the role, scan a ticket, claim or open it, then resolve the case in one workspace. Ticket Activity remains a separate audit trail; Conversation is the live exchange. Every visible action has a real local behavior or a clearly stated integration boundary.

**FIRST VIEWPORT:** At 1280 px, a persistent 232 px sidebar anchors the role's destinations; a 64 px top bar carries page context and account actions. The remaining canvas opens directly on a page title, a compact count/description line, primary action, status filters, and a scannable ticket table. Ticket detail gives Conversation the dominant center column and places Details + Activity in a separate right rail. At 360 px, navigation becomes a drawer, rows become ticket cards, and ticket detail becomes Conversation / Details tabs.

**FORM:** Reference-led service-desk workspace; authentication borrows Badi's focused split form, queues borrow Aly Bump's responsive datatable, and ticket detail borrows Oyegoke Praise's conversation-plus-details structure. The three pinned references determine the composition; no concept tournament is needed. `seed: none (pinned)` — "Badi — SaaS login / signup design; Aly Bump — Responsive Datatables & Dashboard; Oyegoke Praise — Customer Support Ticket Details Web App UI; Campus / Warm".

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 12. Build and review boundary

- This is an **Operate** surface and therefore follows a **code-first** build path when implementation begins.
- This document is the user-approved UX shape brief. It is not an implementation plan, a final token sheet, or a rendered high-fidelity visual approval.
- Do not create DESIGN.md from this brief alone. Record the durable visual system after the interface is built and reviewed against the selected direction.
- The direction contract above pins the structure for implementation. Resolve final visual tokens from the rendered interface and document them only after review.
