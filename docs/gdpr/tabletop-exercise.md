# Personal-data breach tabletop exercise

**Purpose:** Practise the breach SOP (`docs/gdpr/breach-notification-sop.md`) end to end in a controlled setting so that the 72-hour ODPC notification clock is met when a real incident lands.
**Frequency:** Twice a year; first exercise scheduled within 60 days of this document being published.
**Facilitator:** Data Protection Officer.
**Observers:** Internal Audit; one rotating member from another business unit.
**Statutory basis:** KDPA s.43; GDPR Art. 33-34; ISO 27001 A.16.1.

## 1. Participants

| Role | Backup |
|---|---|
| Incident Commander (Backend Lead) | On-call engineer |
| DPO | Deputy DPO |
| Comms Lead | Head of Member Experience |
| Engineering (forensics) | DevOps |
| Legal | External counsel |
| Executive Sponsor (CRO) | COO |

## 2. Pre-brief (T-7 days)

* Facilitator confirms the scenario with the Executive Sponsor and the CISO only — other participants do not see the scenario in advance.
* Each participant blocks 3 hours in their calendar.
* The incident channel (`#incident-response`) is cleared of unrelated noise.

## 3. Ground rules

1. The exercise runs in real time. If the SOP says "within 1 hour", the facilitator times it.
2. Decisions are made on the information available — no peeking at the SOP.
3. No production system is touched. All commands are described verbally or in a paste-only window.
4. Observers do not intervene; they only take notes.
5. After-action notes are blameless. Names appear only in the participant list.

## 4. Scenario A — credentialed insider exfiltration

**T+0** A junior claims officer's laptop is reported stolen at Nairobi airport. The laptop was unlocked at the time. The employee's SSO session and cached database tooling were active.

**T+45min** Internal Audit flags an unusual export job in the activity logs: 14,200 `GET /api/claims/:id` requests in 7 minutes from the stolen laptop's last known IP.

**T+1h 30min** A second alert: the same session has triggered the data-export endpoint (`GET /api/gdpr/export`) on three accounts, none of which belong to the employee.

**T+3h** A regional newspaper messages the press office asking whether CIC has had a data breach affecting members in the Mombasa region.

### Decisions the exercise must elicit

* When is the incident channel opened? (target: within 15 min of T+0)
* When are the employee's credentials revoked? (target: before T+1h)
* Is this notifiable to ODPC? (yes — special category data exfiltrated)
* When does the 72-hour clock start? (T+0 in this scenario, because awareness is from the laptop report)
* Who drafts the initial ODPC notification? Is it lodged before T+72h?
* Who briefs the press office, and with what message?
* Are affected members notified individually? On what basis is the population determined?

### Evaluation criteria

| # | Target | How measured |
|---|---|---|
| E1 | Credentials revoked &lt; 60 min from T+0 | Timestamp on session-revoke action |
| E2 | DPO notified &lt; 30 min from technical containment | Channel log |
| E3 | ODPC initial notification drafted &lt; 36 h from T+0 | Document timestamp |
| E4 | Affected-subject notification text approved by Legal &lt; 48 h | Document timestamp |
| E5 | Comms message to press is consistent with subject notification | Side-by-side review |
| E6 | Activity-log query identifies exact affected member set | SQL pasted in channel |

## 5. Scenario B — sub-processor disclosure

**T+0** Procurement receives a security advisory from a sub-processor (pick one from `docs/gdpr/dpa-inventory.md`) disclosing that a misconfigured S3 bucket containing OCR working files was world-readable for 48 hours, and that requests from unknown IPs were observed.

**T+1h** The sub-processor cannot confirm whether ClaimsFlow tenant data was in the affected bucket.

**T+4h** Engineering confirms via the integration logs that batches B-2026-0501 through B-2026-0503 were sent to this sub-processor during the exposure window.

### Decisions

* When does the 72-hour clock start? (when CIC becomes aware, i.e. T+0, **not** when the sub-processor began to investigate)
* Is the contractual breach-notification obligation in the DPA met?
* Does ClaimsFlow have an independent obligation to notify ODPC even if the sub-processor will also notify?
* What technical step contains the exposure — rotating credentials, revoking the integration, both?

### Evaluation criteria

| # | Target | How measured |
|---|---|---|
| E7 | DPA in `docs/gdpr/dpa-inventory.md` found and clause cited &lt; 1 h | Channel paste |
| E8 | Engineering identifies affected batches &lt; 4 h | Channel paste |
| E9 | Decision to notify ODPC documented &lt; 36 h | Document timestamp |
| E10 | Sub-processor contract renewal date is correctly reflected in the inventory | Cross-check |

## 6. Hot wash (immediately after)

15 minutes, facilitated. Each participant in turn answers:

1. What went well?
2. What confused you?
3. What single change would you make to the SOP?

The facilitator captures one sentence per participant per question.

## 7. After-action report

The DPO writes the after-action report within 5 business days. Template:

```
# Tabletop Exercise — <Scenario>
- Date / participants
- Scenario summary
- Timeline (actual vs. target)
- Evaluation results (E1…En, PASS / FAIL with note)
- Top 3 control gaps observed
- Owners and due dates for each gap
- Sign-off (DPO, CISO, Executive Sponsor)
```

Filed at `docs/gdpr/exercises/YYYY-MM-DD-<scenario>.md`.

## 8. Closing the loop

Each gap becomes an action in the DPIA register. The next tabletop must reassess every open gap from the previous run.
