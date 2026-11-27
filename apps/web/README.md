# FixIt web workspace

React, TypeScript, Vite, React Router and Socket.IO client. Local preview on feat/ui. The Chat source stays on feat/chat; neither feature is merged into dev. The UI communicates with the actual Chat Service and MongoDB; Auth and Tickets are development fixtures. No real institutional credentials or AWS resources are required.

## Run locally

From the feat/ui checkout, with Node 24+ and Podman, use a separate checkout of feat/chat for the optional local preview:
```sh
git worktree add --detach ../fixit-chat-preview feat/chat
(cd ../fixit-chat-preview/services/chat && npm ci)
(cd apps/web && npm ci)
FIXIT_CHAT_DIR="$(realpath ../fixit-chat-preview/services/chat)" bash apps/web/scripts/preview-local.sh
```

Open http://localhost:5173. The local script starts Mongo in a disposable Podman container, fixtures on loopback port 4001, Chat on loopback port 4000, and Vite on port 5173. Stop with Ctrl+C. The preview script cleans up only its own processes/container; its Mongo data is ephemeral across stack restarts, while messages persist across browser refresh and service operations during the run. Use the separate Compose setup documented in services/chat/README.md on feat/chat for the persistent-volume workflow. The preview is optional and does not merge or change either feature branch.

The login page offers Reporter, Support Agent, and Administrator sample accounts. These use fixed synthetic credentials; they are NOT a production authentication mechanism. Do not expose the preview to external networks.

## Verification

```sh
cd apps/web
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
npx playwright install chromium
# With preview-local.sh running in a separate terminal:
npm run e2e
```

If an already-installed Chromium is needed, set FIXIT_CHROMIUM_PATH to its executable. FIXIT_URL defaults to http://localhost:5173. E2E creates sample tickets and messages. Use a fresh stack for clean screenshots.

Evidence: [screenshots](../../.impeccable/review) from the previous local preview, before splitting branches. Browser test covers role sign-in, inbox tabs, agent/reporter chat delivery, message history after refresh, mobile navigation and detail tabs, reporter ticket submission, agent claim, and administrator user-management navigation. It is a local integration smoke, not proof of all permissions or all production endpoints.

## Boundaries

- Auth and Tickets adapters still need real API integration against OpenAPI 0.2.0. Preview ticket state is in memory in the fixtures; it resets when the fixture process stops.
- Chat uses REST history, WebSocket messaging, and persisted messages in real MongoDB. JetStream consumption/recovery and real Auth/Tickets interoperability are pending.
- The Activity rail displays seeded data; it is not yet a live audit trail. Attachment selection validates type and size in the UI, but uploads/storage are not implemented. Admin sample user creation does not provision credentials. First-access password activation, real user administration, notifications and other contract flows remain pending.
- Production build compilation does not prove that its real-service adapters are compatible with the team's completed APIs.
- No deployment or shared DB migrations were performed.

## Auth service adapter

For a local integration setup, set `VITE_AUTH_MODE=real` and
`FIXIT_AUTH_TARGET` to the Auth server before starting Vite. The proxy's
`FIXIT_PUBLIC_ORIGIN` must match Auth's configured origin. The application
maps Auth's account ID and requires a password change before opening the
workspace when Auth returns a temporary session. After activation, sign in
again; Auth invalidates that temporary session.

This switch only connects Auth. The development Tickets adapter remains a
fixture and does not accept real Auth sessions, so it does not demonstrate an
end-to-end ticket or conversation flow. Use a single-origin HTTPS proxy for
browser integration; Vite's local proxy is for development only.

### Local browser integration checks

With Node 24, Docker, OpenSSL, Playwright Chromium and dependencies installed
in this package and the relevant service checkout, run from the UI root:

```sh
FIXIT_AUTH_ROOT=/path/to/auth CONTAINER_ENGINE=docker sh apps/web/scripts/test-real-auth.sh
FIXIT_CHAT_ROOT=/path/to/chat/services/chat CONTAINER_ENGINE=docker sh apps/web/scripts/test-real-chat.sh
```

`FIXIT_CHROMIUM_PATH` can select an existing Chromium installation. The first
check uses real Auth and disposable PostgreSQL, with Tickets simulated. The
second uses real Chat and disposable MongoDB, with Auth and Tickets simulated.
Both create and remove only their own temporary resources.
