# FixIt — Design system

## Direction

Campus / Warm, an English-language IT service desk for a small university pilot. Desktop and mobile have equal priority. The interface prioritizes requests, ownership and conversation rather than a decorative metrics dashboard.

Structural references: Badi (focused sign-in), Aly Bump (responsive datatables), and Oyegoke Praise (ticket detail/conversation and details rail). The approved brief is [.impeccable/surfaces/fixit-workspace.md](.impeccable/surfaces/fixit-workspace.md). These are references, not pixel-perfect reproduction targets.

## Tokens

Implemented in [tokens.css](apps/web/src/styles/tokens.css) and [app.css](apps/web/src/styles/app.css). Manrope Variable is self-hosted through the package. Warm mineral canvas, paper-white surfaces, deep forest navigation and primary actions, muted sage selection, warm amber for higher priority, blue for in-progress status and rose for critical priority. Use explicit labels in addition to semantic color. Keep borders restrained, contrast readable, and shadows quiet. Avoid ornamental stock imagery, invented institutional logos, glass effects and analytics without a real product need.

## Composition

- Sign-in: split forest introduction and focused form on desktop; form-first on mobile. Sample accounts are labeled as local preview data.
- Queue: persistent sidebar and compact top bar, with ticket tables on desktop and stacked ticket cards on mobile. Available / Assigned to me for Support Agents; status filter on each list.
- Detail: conversation takes the primary column, with issue description, metadata and independent activity in the right rail. On mobile, use Conversation / Details & activity tabs.
- New request: explicit reporter urgency, technical description, evidence selection and collapsible optional location/equipment.
- Admin: all tickets and a sample user-management surface. Provisioning is a preview interaction, not real account creation.

## Verification and limitations

Rendered and driven with Playwright/Chromium at 1280×900 and 360×800, with screenshots under [.impeccable/review](.impeccable/review). Initial review corrected small typography, low contrast and description placement that displaced the conversation on mobile. Static Impeccable detector reported no findings; manual review was performed in the same session, not by an independent reviewer. No formal accessibility certification or pixel-by-pixel reference comparison is claimed.

All names, tickets and sample messages are synthetic. The visual design is ready for local review, not a claim of production integration.
