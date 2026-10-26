import Foundation

enum ElmDecoder {
  static let pids = ["0C","0D","05","06","07","0B","0F","10","11","04","2F","42","46","5E"]
  static let setup = ["ATZ","ATE0","ATL0","ATS1","ATH0","ATSP0","0100","0120","0140"]
  static func allowed(_ command:String)->Bool { setup.contains(command) || pids.contains(String(command.dropFirst(2))) && command.hasPrefix("01") || ["03","07","0A","ATRV","ATI","ATDP"].contains(command) }
  static func decode(_ reply:String,command:String)->[(String,Double,String)] {
    guard allowed(command),command.hasPrefix("01"),command.count==4 else { return [] }
    let pid=String(command.suffix(2)),prefix="41"+pid
    var result=[(String,Double,String)]()
    for line in reply.components(separatedBy:.newlines) {
      let text=line.replacingOccurrences(of:" ",with:"").uppercased()
      guard text.hasPrefix(prefix),text.count>=6 else { continue }
      let hex=String(text.dropFirst(4));guard hex.count % 2 == 0,hex.allSatisfy({ $0.isHexDigit }) else{continue};var b=[Int]();var index=hex.startIndex
      while index<hex.endIndex {let end=hex.index(index,offsetBy:2,limitedBy:hex.endIndex) ?? hex.endIndex;if let v=Int(hex[index..<end],radix:16){b.append(v)}else{break};index=end}
      guard let a=b.first else{continue};let x=Double(a);let combined=b.count>=2 ? Double(a*256+b[1]):nil
      switch pid {
      case "0C":if let n=combined{result.append(("ENGINE_RPM",n/4,"rpm"))}
      case "0D":result.append(("VEHICLE_SPEED",x,"km/h"))
      case "05":result.append(("COOLANT_TEMP",x-40,"degC"))
      case "06":result.append(("SHORT_FUEL_TRIM",(x-128)*100/128,"%"))
      case "07":result.append(("LONG_FUEL_TRIM",(x-128)*100/128,"%"))
      case "0B":result.append(("INTAKE_PRESSURE",x,"kPa"))
      case "0F":result.append(("INTAKE_TEMP",x-40,"degC"))
      case "10":if let n=combined{result.append(("MAF",n/100,"g/s"))}
      case "11":result.append(("THROTTLE",x*100/255,"%"))
      case "04":result.append(("ENGINE_LOAD",x*100/255,"%"))
      case "2F":result.append(("FUEL_LEVEL",x*100/255,"%"))
      case "42":if let n=combined{result.append(("MODULE_VOLTAGE",n/1000,"V"))}
      case "46":result.append(("AMBIENT_TEMP",x-40,"degC"))
      case "5E":if let n=combined{result.append(("FUEL_RATE",n/20,"L/h"))}
      default:break
      }
    };return result
  }
  static func supported(_ reply:String,command:String)->Set<String> {
    var supported=Set<String>();guard let base=Int(command.suffix(2),radix:16) else{return supported}
    for line in reply.components(separatedBy:.newlines) {let s=line.replacingOccurrences(of:" ",with:"").uppercased();if s.hasPrefix("41"+command.suffix(2)),s.count>=12,let mask=UInt32(s.dropFirst(4).prefix(8),radix:16){for n in 0..<32 where mask & (UInt32(1) << (31-n)) != 0 {supported.insert(String(format:"%02X",base+n+1))}}}
    return supported
  }
}
