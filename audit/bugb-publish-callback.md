# Bug B — publish callback audit

## Scope and method

Static, read-only review of the checked-out `main` source on 2026-07-31. No runtime request, DB access, or configuration-secret inspection was performed. Statements about the current Runtime/VPS network topology are therefore **ไม่แน่ใจ** unless they follow directly from source configuration.

## A. Backend — where publication occurs

### Confirmed publication writer

- The backend public publish operation is `approveReviewContent(...)` in `backend/services/reviewDecisionService.js:386-506`. It upserts the public `places` or `events` entity (`:419-425`), promotes translations (`:427-450`), then sets `review_contents.status='published'`, public entity identity, and `published_at=NOW()` (`:452-457`). It also marks the reviewed assets `published` (`:459-464`) and commits (`:487`).
- The normal approving HTTP route is not rechecked end-to-end here, but the controller imports this service in `backend/controllers/reviewContentController.js:1-7`. The publish side-effect itself is confirmed in the service above.

### Collector provenance

- Yes. The backend record has a Collector reference: `source_system` and `source_content_item_id`. The publish transaction uses `content.source_system`, `content.content_type`, and `content.source_content_item_id` to update the backend-side Collector import-review record at `backend/services/reviewDecisionService.js:478-485`.
- The source ID is also validated at ingest before the backend review record is created: `backend/controllers/reviewContentController.js:63-91` and `backend/services/reviewIngestService.js:616-640`.
- This is a backend-local correlation/update, not a request back to Collector.

### Who is notified after publish

- Confirmed: backend updates its own `collector_import_reviews` decision through `markCollectorImportReviewApprovedBySource` (`backend/services/reviewDecisionService.js:478-485`; function entry `backend/services/collectorImportReviewService.js:653-661`).
- Not found: a Collector HTTP callback, event, queue message, or notification triggered after the successful publish commit. The sole source call to `/api/web-review-feedback` is the revision helper in section B, not the approve/publish function.

## B. Existing return channel

### Caller, payload, and authentication

- Backend calls `POST ${COLLECTOR_SYNC_BASE_URL}/api/web-review-feedback` only in `syncNeedsRevisionToCollector` at `backend/services/reviewDecisionService.js:509-535`; its direct caller for a normal review decision is `markNeedsRevision` at `:654-703`, specifically `:666`.
- It sends JSON fields `source_system`, `source_content_item_id`, `content_type`, `status: "needs_revision"`, `review_note`, `reviewed_by`, and `reviewed_at` (`:520-528`).
- Authentication is the shared `x-review-sync-token` header, sourced from `COLLECTOR_REVIEW_SYNC_TOKEN` (`:511-519`). The backend rejects missing/non-HTTP configuration before the request via `assertBackendIntegrationReadiness` (`:510`; readiness rules `backend/services/integrationReadinessService.js:21-35,81-96`).

### Failure behavior

- A non-2xx Collector response is read as text and thrown as `collector sync failed ...` (`backend/services/reviewDecisionService.js:530-533`). There is no retry loop, timeout option, durable outbox, or queue in this call path.
- In the normal `markNeedsRevision` flow the callback happens before the backend DB update (`:666-692`) and before commit (`:693`); an error rolls back the transaction and is returned to the caller (`:696-703`). Thus this failure is fail-closed for the revision decision, not silent.
- No corresponding `published` callback call exists. Therefore publication succeeds and commits without any attempt to update Collector.

## C. Collector receiver

- Endpoint: `POST /api/web-review-feedback` at `collector/server/index.mjs:14705-14793`.
- It accepts only `status === "needs_revision"`; any other value receives HTTP 400 at `:14735-14737`.
- It requires a configured non-placeholder `COLLECTOR_REVIEW_SYNC_TOKEN` (`:14706-14708`) and validates `x-review-sync-token` with a timing-safe comparison (`:14710-14713`; helper `:435-442`).
- It validates `source_system === "collector-app"` (`:14723-14725`), `content_type` as `place|event` (`:14727-14729`), and a positive numeric `source_content_item_id` (`:14731-14733`), then verifies the Collector item exists (`:14740-14743`).
- For accepted feedback, it writes a revision workflow state and audit record (`:14746-14789`). It maps a place from `in_review|ready_for_publish|submitted_for_admin_review` back to a positional state and sets its `place_review_flag=revision_requested`; a non-place becomes `needs_revision` (`:14752-14778`).
- If a new status such as `published` were introduced, the status allowlist at `:14735-14737`, state-selection/writer logic at `:14752-14778`, the audit event/result at `:14780-14789`, and any related tests would need review. This is an impact inventory, not a patch proposal.

## D. Meaning of `completed` and `published`

- The Collector state catalog treats `completed` as a production state and `published` as a publication state (`collector/db/repository.mjs:431-450`). Their transition graphs are independent: production permits `ready_for_publish|submitted_for_admin_review → completed`, while publication permits `approved → published` (`:477-498`). For places, `submitted_for_admin_review → completed` is also an explicit production edge (`:508-520`).
- Current article-process display semantics are driven primarily by publication: `publication_state === "published"` derives `synced_to_admin`; `submitted_for_admin_review` derives from the production state; `approved|ready_for_publish` derives `ready_for_sync` (`collector/server/index.mjs:4708-4729`).
- There is a legacy mapping that pairs `workflow_status="published"` to `completed/published` (`collector/server/index.mjs:6863-6874`). This supports the pair as the intended terminal representation, but it is not a normal callback/write path.
- Conclusion: policy permits the two transitions independently, but the normal end-to-end lifecycle has no confirmed writer for the pair after backend publication. For Bug B's public-publication meaning, setting both together is the consistent terminal representation; the repository does not prove it is a hard invariant.
- The edge `submitted_for_admin_review → completed` exists in the transition graph, but no normal backend-publish callback currently traverses it. The edge `approved → published` exists in the publication graph, but no normal backend-publish callback currently traverses it either.
- Collector has an unpublish route only for an already-Collector-published item (`collector/server/index.mjs:14818-14876`): it requires `publication_state=published` (`:14832-14835`), retains production state and writes `unpublished` (`:14846-14858`). Backend unpublish behavior and a production use case for notifying Collector are **ไม่แน่ใจ**: no backend unpublish handler/callback was established in this audit. It is outside the currently implemented feedback channel.

## E. Reliability

- If the proposed publish callback were simply added as a synchronous call patterned after the revision callback, a network/Collector outage could either block the backend publish (if placed before commit) or leave Collector stale (if placed after commit); the existing code has no durable delivery mechanism to resolve the latter. This is an architectural inference from the confirmed call and transaction order, not observed runtime behavior.
- Today, because publish has no callback, a successfully submitted item can remain `submitted_for_admin_review/approved` in Collector after the backend makes it public. The Collector set that state only after successful backend ingest (`collector/server/index.mjs:13755-13796`), and there is no later publish-status import in this path.
- The existing submission snapshot can make a user-initiated **ingest** retry idempotent when the manifest is unchanged (`collector/db/repository.mjs:12212-12232`), but it does not reconcile a later backend publish decision.
- No reusable backend queue/retry/outbox was found for this callback path. Search results found retry behavior for ingest idempotency and unrelated translation/AI flows, not delivery of `/api/web-review-feedback`.
- Therefore a recovery/check-again mechanism is required before callback delivery can be considered reliable; none was found in the audited paths.

## F. VPS migration effect

- The current backend-to-Collector feedback call relies on a reachable `COLLECTOR_SYNC_BASE_URL` plus the shared token (`backend/services/reviewDecisionService.js:511-519`). Configuration readiness only checks that the URL has an HTTP(S) scheme and the token is non-placeholder; it does not prove reachability (`backend/services/integrationReadinessService.js:21-35`).
- After backend moves to a VPS, it can call Collector only if that configured URL is routable from the VPS (for example, a public/reverse-proxied Collector endpoint or a private network/VPN/tunnel). The actual Runtime and planned VPS topology are **ไม่แน่ใจ** because they are deployment configuration, not established by source.
- This is not a new constraint introduced by Bug B. The already-implemented `needs_revision` callback has exactly the same backend-to-Collector dependency. Bug B exposes the same dependency for publish completion and additionally needs reliable reconciliation because publish is terminal and currently has no callback at all.

## Final answer to the single question

At present, backend cannot tell Collector that a Collector-originated item was published: it knows the source identity and records the backend-side decision, but its only outbound Collector callback sends `needs_revision`. A publish completion signal requires a separate supported status/state path and a delivery/reconciliation design; neither exists in the audited code.
