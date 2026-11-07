# Search serving orchestration (F6)

`createSearchService` accepts a corpus loader, optional vector loader and embedder, a current-record revalidator, a semantic policy, and an injectable timer. Loaders must validate releases and throw on invalid releases. The revalidator returns false for a confirmed ineligible record and throws if a check fails. Failed checks return 503 without candidates. The policy's current-record check limit stops refill and returns the groups already validated.

Inference has a 2.5-second deadline and the request has a five-second deadline. Both receive abort signals where supported. Provider failure, timeout, or incompatible model profile degrades to keyword with `degraded_semantic`. Serving hybrid requires a frozen, calibrated policy, compatible vectors and an embedder. The current F8 cutoff is provisional, so it does not enable hybrid serving. Partial coverage is reported for selected records. Browse skips vectors and inference.

The POST route exports current database records through the F3 database exporter and checks each candidate against current database state before returning it. Deleted, ineligible or changed records are suppressed; database errors fail the request closed. It searches in keyword mode and does not read stored F3 or F4 releases. Their integrity validation remains the responsibility of any injected release loader.

The tests use synthetic documents, a database double and vectors, and injected failures. No real embedding service, real vector release, live database integration, hosted deployment or semantic quality has been verified. Timers bound the response but synchronous CPU work and dependencies that ignore abort cannot be forcibly stopped.
