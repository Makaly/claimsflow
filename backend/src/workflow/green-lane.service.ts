// REMOVED — automatic ("green lane") approval of claims is no longer permitted.
//
// This service previously auto-approved low-risk claims against threshold rules,
// flipping a claim straight to status='approved' / workflowStage='payment_pending'
// with changedBy='system' and no human reviewer. Per policy, every claim must be
// approved by a human (maker_checker → claims_officer). The service is no longer
// registered in WorkflowModule and has no callers.
//
// The `green_lane_rules` table is left in the database (no migration) but is now
// dead — nothing reads or writes it. It can be dropped in a later migration.
export {};
