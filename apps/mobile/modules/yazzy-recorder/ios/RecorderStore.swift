import Foundation
import SQLite3
import Security

final class RecorderStore {
  private var db: OpaquePointer?
  private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
  init() {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    guard sqlite3_open(dir.appendingPathComponent("yazzy.sqlite").path, &db) == SQLITE_OK else { fatalError("Cannot open durable recorder") }
    sqlite3_exec(db, "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS samples(id INTEGER PRIMARY KEY AUTOINCREMENT,session TEXT NOT NULL,sequence INTEGER NOT NULL,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY,session TEXT,maxseq INTEGER,payload TEXT);", nil, nil, nil)
  }
  deinit { sqlite3_close(db) }
  private func rows(_ sql: String, _ args: [String] = []) -> [[String]] {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
    defer { sqlite3_finalize(stmt) }
    for (i,value) in args.enumerated() { sqlite3_bind_text(stmt, Int32(i+1), value, -1, transient) }
    var result = [[String]]()
    while sqlite3_step(stmt) == SQLITE_ROW {
      result.append((0..<sqlite3_column_count(stmt)).map { col in
        guard let text = sqlite3_column_text(stmt, col) else { return "" }; return String(cString: text)
      })
    }
    return result
  }
  private func write(_ sql: String, _ args: [String] = []) throws {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { throw NSError(domain:"SQLite",code:1) }
    defer { sqlite3_finalize(stmt) }
    for (i,value) in args.enumerated() { sqlite3_bind_text(stmt, Int32(i+1), value, -1, transient) }
    guard sqlite3_step(stmt) == SQLITE_DONE else { throw NSError(domain:"SQLite",code:2) }
  }
  var count: Int { Int(rows("SELECT count(*) FROM samples").first?.first ?? "0") ?? 0 }
  var session: String {
    if let value = rows("SELECT value FROM meta WHERE key='session'").first?.first { return value }
    let value=UUID().uuidString
    try? write("INSERT INTO meta VALUES('session',?)",[value]); return value
  }
  func newSession() throws { try write("DELETE FROM meta WHERE key='session'") }
  func enqueue(signal: String, value: Any, unit: String, quality: String = "VALID") throws {
    guard count < 100000 else { throw NSError(domain:"QueueFull",code:1) }
    let sid=session
    let seq=(Int(rows("SELECT value FROM meta WHERE key='sequence'").first?.first ?? "0") ?? 0)+1
    let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
    let now=formatter.string(from:Date())
    let sample:[String:Any] = ["sequence":seq,"observedAt":now,"monotonicMs":Int(ProcessInfo.processInfo.systemUptime*1000),"signal":signal,"value":value,"unit":unit,"quality":quality]
    let encoded=String(data:try JSONSerialization.data(withJSONObject:sample),encoding:.utf8)!
    try write("BEGIN IMMEDIATE")
    do {
      try write("INSERT INTO samples(session,sequence,json) VALUES(?,?,?)",[sid,String(seq),encoded])
      try write("INSERT OR REPLACE INTO meta VALUES('sequence',?)",[String(seq)])
      try write("COMMIT")
    } catch { try? write("ROLLBACK"); throw error }
  }
  func nextBatch(config:[String:String]) throws -> (String,Data)? {
    if let pending=rows("SELECT id,payload FROM pending LIMIT 1").first { return (pending[0],Data(pending[1].utf8)) }
    guard let sid=rows("SELECT session FROM samples ORDER BY id LIMIT 1").first?.first else { return nil }
    let batch=rows("SELECT sequence,json FROM samples WHERE session=? ORDER BY id LIMIT 100",[sid])
    let samples=try batch.map { try JSONSerialization.jsonObject(with:Data($0[1].utf8)) }
    let id=UUID().uuidString
    let payload:[String:Any] = ["schemaVersion":1,"batchId":id,"deviceId":config["deviceId"]!,"assignmentId":config["assignmentId"]!,"sessionId":sid,"sequenceStart":Int(batch[0][0])!,"source":"MOBILE_OBD","platform":"IOS","decoderVersion":"elm-v1","samples":samples]
    let bytes=try JSONSerialization.data(withJSONObject:payload)
    try write("INSERT INTO pending VALUES(?,?,?,?)",[id,sid,batch.last![0],String(data:bytes,encoding:.utf8)!])
    return (id,bytes)
  }
  /// Discards every queued reading and the session/sequence counters. Used only by an explicit user reset.
  func clear() throws {
    try write("BEGIN IMMEDIATE")
    do { try write("DELETE FROM samples");try write("DELETE FROM pending");try write("DELETE FROM meta");try write("COMMIT") }
    catch { try? write("ROLLBACK");throw error }
  }
  func acknowledge(_ id:String) throws {
    guard let batch=rows("SELECT session,maxseq FROM pending WHERE id=?",[id]).first else { return }
    try write("BEGIN IMMEDIATE")
    do {
      try write("DELETE FROM samples WHERE session=? AND sequence<=?",batch)
      try write("DELETE FROM pending WHERE id=?",[id]);try write("COMMIT")
    } catch {try? write("ROLLBACK");throw error}
  }
}

enum RecorderSecret {
  static func save(_ value:Data) throws {
    let query:[String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"YazzyRecorder",kSecAttrAccount as String:"configuration"]
    SecItemDelete(query as CFDictionary)
    var insert=query;insert[kSecValueData as String]=value
    insert[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    guard SecItemAdd(insert as CFDictionary,nil) == errSecSuccess else { throw NSError(domain:"Keychain",code:1) }
  }
  static func clear() {
    let query:[String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"YazzyRecorder",kSecAttrAccount as String:"configuration"]
    SecItemDelete(query as CFDictionary)
  }
  static func read() -> [String:String]? {
    let query:[String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"YazzyRecorder",kSecAttrAccount as String:"configuration",kSecReturnData as String:true]
    var value:CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary,&value) == errSecSuccess,let data=value as? Data else { return nil }
    return (try? JSONSerialization.jsonObject(with:data)) as? [String:String]
  }
}
