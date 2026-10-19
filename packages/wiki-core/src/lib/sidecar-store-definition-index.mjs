

export function replaceStoreDocumentDefinitions(writer, { did, pid, occurrences }) {
  for (const { sid } of writer.prepare(
    "SELECT sid FROM provider_document_definitions WHERE did = ?").all(did)) {
    writer.released.add(sid);
  }
  writer.prepare("DELETE FROM provider_document_definitions WHERE did = ?").run(did);
  const symbols = new Set(occurrences.filter(row => (row.roles & 1) === 1)
    .map(row => row.symbol_id));
  for (const symbol of symbols) {
    writer.prepare("INSERT INTO provider_document_definitions(pid, sid, did) VALUES (?, ?, ?)")
      .run(pid, writer.intern(symbol), did);
  }
}
