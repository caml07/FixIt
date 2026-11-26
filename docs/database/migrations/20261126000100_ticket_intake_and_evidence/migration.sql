-- Contract-First delta approved by the user on 26 Nov 2026.
-- Additive migration: keep 20261115000100_initial immutable.
-- One coordinated migration owner for auth and tickets; do not auto-run per service.
BEGIN;

-- Existing tickets receive a neutral urgency value; new API creates must send it explicitly.
ALTER TABLE tickets.support_tickets
  ADD COLUMN reporter_urgency varchar(16) NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN effective_priority varchar(16);

ALTER TABLE tickets.support_tickets
  ALTER COLUMN reporter_urgency DROP DEFAULT;

-- Preserve the new invariant for any legacy ticket that already passed triage.
UPDATE tickets.support_tickets
SET effective_priority = 'P3_NORMAL'
WHERE status IN ('IN_PROGRESS', 'RESOLVED', 'CLOSED')
  AND effective_priority IS NULL;

ALTER TABLE tickets.support_tickets
  ADD CONSTRAINT support_tickets_reporter_urgency_check
    CHECK (reporter_urgency IN ('LOW', 'NORMAL', 'HIGH')),
  ADD CONSTRAINT support_tickets_effective_priority_check
    CHECK (effective_priority IS NULL OR effective_priority IN
      ('P1_CRITICAL', 'P2_HIGH', 'P3_NORMAL', 'P4_LOW')),
  ADD CONSTRAINT support_tickets_priority_required_after_triage
    CHECK (status NOT IN ('IN_PROGRESS', 'RESOLVED', 'CLOSED') OR effective_priority IS NOT NULL);

-- Keep the before/after values in the existing ticket timeline; no audit service or JSON metadata layer.
ALTER TABLE tickets.ticket_timeline
  ADD COLUMN from_urgency varchar(16),
  ADD COLUMN to_urgency varchar(16),
  ADD COLUMN from_priority varchar(16),
  ADD COLUMN to_priority varchar(16);

ALTER TABLE tickets.ticket_timeline
  DROP CONSTRAINT ticket_timeline_event_type_check,
  ADD CONSTRAINT ticket_timeline_event_type_check
    CHECK (event_type IN (
      'CREATED', 'EDITED', 'CLAIMED', 'REASSIGNED', 'STATUS_CHANGED',
      'PHOTO_ADDED', 'ATTACHMENT_ADDED', 'PRIORITY_UPDATED'
    )),
  ADD CONSTRAINT ticket_timeline_urgency_values_check
    CHECK (
      (from_urgency IS NULL OR from_urgency IN ('LOW', 'NORMAL', 'HIGH'))
      AND (to_urgency IS NULL OR to_urgency IN ('LOW', 'NORMAL', 'HIGH'))
    ),
  ADD CONSTRAINT ticket_timeline_priority_values_check
    CHECK (
      (from_priority IS NULL OR from_priority IN
        ('P1_CRITICAL', 'P2_HIGH', 'P3_NORMAL', 'P4_LOW'))
      AND (to_priority IS NULL OR to_priority IN
        ('P1_CRITICAL', 'P2_HIGH', 'P3_NORMAL', 'P4_LOW'))
    ),
  ADD CONSTRAINT ticket_timeline_priority_reason_check
    CHECK (
      event_type <> 'PRIORITY_UPDATED'
      OR (to_priority IS NOT NULL AND
        (from_priority IS NULL OR NULLIF(trim(reason), '') IS NOT NULL))
    );

-- Replace the one-file-per-ticket rule with bounded multi-file evidence.
ALTER TABLE tickets.ticket_attachments
  DROP CONSTRAINT ticket_attachments_ticket_id_key,
  DROP CONSTRAINT ticket_attachments_content_type_check,
  DROP CONSTRAINT ticket_attachments_size_bytes_check,
  ALTER COLUMN content_type TYPE varchar(80),
  ADD CONSTRAINT ticket_attachments_content_type_size_check
    CHECK (
      (content_type IN ('image/jpeg', 'image/png', 'image/webp')
        AND size_bytes BETWEEN 1 AND 5242880)
      OR (content_type = 'video/mp4'
        AND size_bytes BETWEEN 1 AND 26214400)
    );

CREATE INDEX ticket_attachments_ticket_uploaded_idx
  ON tickets.ticket_attachments(ticket_id, uploaded_at, id);

COMMIT;
