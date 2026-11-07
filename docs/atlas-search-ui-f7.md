# Search UI (F7)

The interface uses the F1 POST contract. The current route has no index loader and reports unavailable. The client requests the corresponding F1 record kind and filters displayed content types locally. The F1 group limit applies before subtype filtering, so a subtype can appear empty even when matching records exist beyond the returned groups.

Not verified: hosted Thai or English queries with real F6 data. The browser tests use mocked responses and do not verify live indexing, semantic retrieval, or production coverage.

Language tags come from each record, not individual evidence fields; mixed or unknown records are labelled as such.
