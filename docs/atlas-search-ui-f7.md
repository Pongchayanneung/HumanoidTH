# Search UI (F7)

The interface uses the F1 POST contract backed by the F6 database search service. The client sends the selected record kind and, for sources, the subtype. The API applies both filters before ranking and the group limit.

Not verified: hosted Thai or English queries with real F6 data. The browser tests use mocked responses and do not verify live indexing, semantic retrieval, or production coverage.

Language tags come from each record, not individual evidence fields; mixed or unknown records are labelled as such.
