-- Demo seed for the Appeals feature.
-- Creates 4 appeals across every status (pending, under_review, finalised/upheld,
-- finalised/dismissed) plus a realistic three-party message thread
-- (provider · claims officer · fraud officer).

BEGIN;

-- ── Appeal 1: PENDING (no thread yet) ─────────────────────────────────────────
INSERT INTO appeals (id, "claimId", "providerId", "filedBy", reason, "additionalNotes", status, documents, "createdAt", "updatedAt")
VALUES (
  'a0000001-0000-0000-0000-000000000001',
  'f0967a08-12a0-4827-88f0-dbc4ca2f12c8',
  'dc7939f8-ca66-4d86-93f9-64b1c8fab2af',
  '5f42bd4d-feab-4edb-b6be-7daea799c0a1',           -- Auma Otieno (provider_user)
  'Invoice was rejected for a missing pre-authorisation code, but the code was supplied on the attached referral letter.',
  'Pre-auth reference PA-2026-3391 was issued by the call centre on the day of admission.',
  'pending',
  '[]'::jsonb,
  '2026-06-28 09:15:00',
  '2026-06-28 09:15:00'
);

-- ── Appeal 2: UNDER_REVIEW (active three-party thread) ────────────────────────
INSERT INTO appeals (id, "claimId", "providerId", "filedBy", reason, "additionalNotes", status, documents, "createdAt", "updatedAt")
VALUES (
  'a0000002-0000-0000-0000-000000000002',
  'bad94e80-7212-41a5-9095-d2e4f4db9dca',
  '15777ad5-836d-4c6e-bdad-27899493243f',
  '1c233240-0363-4b0b-b16d-41dd5b398442',           -- Dr. James Maina (provider_admin)
  'Treatment was medically necessary and falls within the member''s annual benefit limit.',
  'Supporting clinical notes and lab results are attached for review.',
  'under_review',
  '[]'::jsonb,
  '2026-06-20 11:00:00',
  '2026-06-24 14:30:00'
);

INSERT INTO appeal_messages (id, "appealId", "senderId", "senderRole", message, attachments, "createdAt") VALUES
 ('b0000002-0000-0000-0000-000000000001', 'a0000002-0000-0000-0000-000000000002', '1c233240-0363-4b0b-b16d-41dd5b398442', 'provider_admin',
  'We are appealing this rejection. The procedure was clinically indicated and the patient''s benefit limit had not been exhausted at the time of service.',
  '[]'::jsonb, '2026-06-20 11:05:00'),
 ('b0000002-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000002', '6f3c47f3-3528-4fbc-b7f5-f20b72180b52', 'claims_officer',
  'Thanks for filing. Could you share the discharge summary and the itemised theatre charges? The current bundle is missing both.',
  '[]'::jsonb, '2026-06-22 09:40:00'),
 ('b0000002-0000-0000-0000-000000000003', 'a0000002-0000-0000-0000-000000000002', '1c233240-0363-4b0b-b16d-41dd5b398442', 'provider_admin',
  'Done — discharge summary and theatre breakdown uploaded. The theatre time was 2h 10m, which matches the anaesthetist''s record.',
  '[]'::jsonb, '2026-06-23 16:20:00'),
 ('b0000002-0000-0000-0000-000000000004', 'a0000002-0000-0000-0000-000000000002', 'b5806e1e-f452-4bf8-9a61-ea957301be1d', 'fraud_officer',
  'No fraud indicators on this one — provider history is clean and the documentation is consistent. Happy for claims to proceed on medical merit.',
  '[]'::jsonb, '2026-06-24 14:30:00');

-- ── Appeal 3: FINALISED / UPHELD (with resolved thread) ───────────────────────
INSERT INTO appeals (id, "claimId", "providerId", "filedBy", reason, "additionalNotes", status, "adjudicatedBy", "adjudicatedAt", outcome, "outcomeNotes", documents, "createdAt", "updatedAt")
VALUES (
  'a0000003-0000-0000-0000-000000000003',
  '84568ec8-965c-440b-b5b9-b19faa972f9f',
  'c7347c08-a073-47fe-95cd-928ac1e411b3',
  '6788707c-67e4-4693-abfd-b9c1b2e9c758',           -- Samuel Rotich (provider_user)
  'The rejection cited a duplicate submission, but this is a separate admission on a different date.',
  'Original admission 02 June; this claim is for a re-admission on 09 June.',
  'finalised',
  '6f3c47f3-3528-4fbc-b7f5-f20b72180b52',           -- Jane Mwangi (claims_officer)
  '2026-06-15 10:00:00',
  'upheld',
  'Confirmed two distinct admissions. Duplicate flag was a false positive — invoice reinstated and routed to claims for final approval.',
  '[]'::jsonb,
  '2026-06-10 08:30:00',
  '2026-06-15 10:00:00'
);

INSERT INTO appeal_messages (id, "appealId", "senderId", "senderRole", message, attachments, "createdAt") VALUES
 ('b0000003-0000-0000-0000-000000000001', 'a0000003-0000-0000-0000-000000000003', '6788707c-67e4-4693-abfd-b9c1b2e9c758', 'provider_user',
  'This was flagged as a duplicate but it''s a genuine re-admission seven days later. Admission records for both dates are attached.',
  '[]'::jsonb, '2026-06-10 08:35:00'),
 ('b0000003-0000-0000-0000-000000000002', 'a0000003-0000-0000-0000-000000000003', '6f3c47f3-3528-4fbc-b7f5-f20b72180b52', 'claims_officer',
  'Verified both admission records against the member''s history. You''re right — these are distinct episodes. Upholding the appeal.',
  '[]'::jsonb, '2026-06-14 13:15:00'),
 ('b0000003-0000-0000-0000-000000000003', 'a0000003-0000-0000-0000-000000000003', '6788707c-67e4-4693-abfd-b9c1b2e9c758', 'provider_user',
  'Much appreciated, thank you for the quick turnaround.',
  '[]'::jsonb, '2026-06-14 15:02:00');

-- ── Appeal 4: FINALISED / DISMISSED ───────────────────────────────────────────
INSERT INTO appeals (id, "claimId", "providerId", "filedBy", reason, "additionalNotes", status, "adjudicatedBy", "adjudicatedAt", outcome, "outcomeNotes", documents, "createdAt", "updatedAt")
VALUES (
  'a0000004-0000-0000-0000-000000000004',
  'e380686f-dabb-459d-af42-53a2b5b89ec2',
  '4353a749-fc5d-435f-90c9-c2ec5b2b887f',
  'b1562a59-b645-460f-be71-6a98a402f1ea',           -- Hassan Abdi (provider_user)
  'We believe the service should be covered despite being listed as an exclusion.',
  'Requesting reconsideration on compassionate grounds.',
  'finalised',
  'd92df6d8-11cf-423a-b2bd-0b285e7119e6',           -- Admin User
  '2026-06-09 16:45:00',
  'dismissed',
  'The procedure is an explicit exclusion under the member''s policy schedule (section 4.2). Original decision stands.',
  '[]'::jsonb,
  '2026-06-05 12:00:00',
  '2026-06-09 16:45:00'
);

INSERT INTO appeal_messages (id, "appealId", "senderId", "senderRole", message, attachments, "createdAt") VALUES
 ('b0000004-0000-0000-0000-000000000001', 'a0000004-0000-0000-0000-000000000004', 'b1562a59-b645-460f-be71-6a98a402f1ea', 'provider_user',
  'Appealing the exclusion — the treating physician considered this medically essential.',
  '[]'::jsonb, '2026-06-05 12:05:00'),
 ('b0000004-0000-0000-0000-000000000002', 'a0000004-0000-0000-0000-000000000004', 'd92df6d8-11cf-423a-b2bd-0b285e7119e6', 'admin',
  'I understand the clinical view, but this falls under a clear policy exclusion. Unfortunately we cannot cover it under the current plan.',
  '[]'::jsonb, '2026-06-09 16:40:00');

COMMIT;
