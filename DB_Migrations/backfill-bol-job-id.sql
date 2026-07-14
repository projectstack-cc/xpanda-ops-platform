-- P241 — Relink multi-load BOL rows that were saved with job_id = NULL.
-- Cause: load-builder applied the job prefill (incl. jobId) to trailer index 0 only, so
-- loads 2..N persisted orphaned. P170's bol_group_id is the recovery key: any orphan in a
-- group where at least one sibling IS linked inherits that sibling's job_id.
-- Idempotent: re-running is a no-op once no NULL job_id rows with a group key remain.

UPDATE bols
   SET job_id = (
         SELECT b2.job_id
           FROM bols b2
          WHERE b2.bol_group_id = bols.bol_group_id
            AND b2.job_id IS NOT NULL
          LIMIT 1
       )
 WHERE job_id IS NULL
   AND bol_group_id IS NOT NULL
   AND EXISTS (
         SELECT 1
           FROM bols b3
          WHERE b3.bol_group_id = bols.bol_group_id
            AND b3.job_id IS NOT NULL
       );
