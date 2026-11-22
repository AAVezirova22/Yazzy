import Foundation

/// Mirrors the Android ElmDecoder: the same read-only requests, the same readings and the same car report.
enum ElmDecoder {
  static let pids = ["0C","0D","05","06","07","0B","0F","10","11","04","2F","42","46","5E","5B","5C","0E","33","0A","23","1F"]
  static let fastPids = ["0D","0C"]
  static let setup = ["ATZ","ATE0","ATL0","ATS1","ATH0","ATSTFF","ATSP0","0100","0120","0140","0160","0180","01A0"]
  /// Mode 01 PIDs that describe the car rather than the moment: monitor status, fuel type, OBD standard, distances, odometer.
  static let infoPids = ["01","51","1C","21","30","31","4D","4E","A6"]
  // 22F18B (UDS) and 1A8B (KWP2000) only read the engine ECU's manufacturing date, the car's production year.
  private static let reads = ["03","07","0A","0902","090A","22F18B","1A8B","ATRV","ATI","ATDP","ATDPN"]
  /// Read-only by construction: only these exact requests can ever be sent. Never 04 (clear codes) or any write service.
  static func allowed(_ command:String)->Bool { setup.contains(command) || (pids+infoPids).contains{ "01"+$0==command } || reads.contains(command) }
  /// The car-report requests: everything once per connection, then a light refresh of what can change while driving.
  static func identify(supported:Set<String>,full:Bool,needVin:Bool=false)->[String] {
    if full { return ["ATDPN","ATRV"]+infoPids.filter{supported.contains($0)}.map{"01"+$0}+["0902","090A","22F18B","1A8B","03","07","0A"] }
    return ["ATRV"]+["01","31","A6"].filter{supported.contains($0)}.map{"01"+$0}+["03","07"]+(needVin ? ["0902"]:[])
  }
  /// Which live reading to ask for as the n-th poll. Fuel is worked out from air flow, fuel trims, speed and RPM, and the
  /// server only joins readings less than 15 s apart, so those come first: speed, RPM, air flow and the car's own fuel rate every cycle, the
  /// trims every other spare slot. The readings that are only shown on screen share what is left.
  static func nextPoll(supported:Set<String>,index n:Int)->String? {
    func have(_ list:[String])->[String]{list.filter{supported.contains($0)}}
    let fast=have(fastPids),maf=have(["10","5E"]),trims=have(["06","07"])
    let others=have(["05","0B","0F","11","04","2F","42","46"]),extras=have(["5B","5C","0E","33","0A","23","1F"])
    let cycle=fast.count+maf.count+1,slot=n%cycle,k=n/cycle
    if slot<fast.count{return fast[slot]}
    if slot<fast.count+maf.count{return maf[slot-fast.count]}
    let m=k%6
    let order:[([String],Int)] = m==5 ? [(extras,k/6),(others,k),(trims,k)] : m%2==0 ? [(trims,k/6*3+m/2),(others,k),(extras,k)] : [(others,k/6*2+m/2),(trims,k),(extras,k)]
    for (list,i) in order where !list.isEmpty {return list[i%list.count]}
    return fast.first ?? maf.first
  }
  static func isReport(_ command:String)->Bool { reads.contains(command) || (command.hasPrefix("01") && command.count==4 && infoPids.contains(String(command.suffix(2)))) }
  /// Readings the server accepts. The others are shown live and kept in the car report but never uploaded.
  static let uploaded:Set<String> = ["ENGINE_RPM","VEHICLE_SPEED","COOLANT_TEMP","SHORT_FUEL_TRIM","LONG_FUEL_TRIM","INTAKE_PRESSURE","INTAKE_TEMP","MAF","THROTTLE","ENGINE_LOAD","FUEL_LEVEL","MODULE_VOLTAGE","AMBIENT_TEMP","FUEL_RATE"]
  // The server's plausibility ceilings for PIDs whose raw range goes beyond them (0xFF meaning "not available"): such readings are dropped.
  private static let ceiling:[String:Double] = ["ENGINE_RPM":16000,"MAF":655,"MODULE_VOLTAGE":60,"AMBIENT_TEMP":80,"FUEL_RATE":200]
  private static func odometer(_ b:[Int])->Double? { b.count>=4 ? Double((b[0]<<24)+(b[1]<<16)+(b[2]<<8)+b[3])/10 : nil }

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
      var found:(String,Double,String)?
      switch pid {
      case "0C":if let n=combined{found=("ENGINE_RPM",n/4,"rpm")}
      case "0D":found=("VEHICLE_SPEED",x,"km/h")
      case "05":found=("COOLANT_TEMP",x-40,"degC")
      case "06":found=("SHORT_FUEL_TRIM",(x-128)*100/128,"%")
      case "07":found=("LONG_FUEL_TRIM",(x-128)*100/128,"%")
      case "0B":found=("INTAKE_PRESSURE",x,"kPa")
      case "0F":found=("INTAKE_TEMP",x-40,"degC")
      case "10":if let n=combined{found=("MAF",n/100,"g/s")}
      case "11":found=("THROTTLE",x*100/255,"%")
      case "04":found=("ENGINE_LOAD",x*100/255,"%")
      case "2F":found=("FUEL_LEVEL",x*100/255,"%")
      case "42":if let n=combined{found=("MODULE_VOLTAGE",n/1000,"V")}
      case "46":found=("AMBIENT_TEMP",x-40,"degC")
      case "5E":if let n=combined{found=("FUEL_RATE",n/20,"L/h")}
      case "5B":found=("HYBRID_BATTERY",x*100/255,"%")
      case "5C":found=("OIL_TEMP",x-40,"degC")
      case "0E":found=("TIMING_ADVANCE",x/2-64,"deg")
      case "33":found=("BARO_PRESSURE",x,"kPa")
      case "0A":found=("FUEL_PRESSURE",x*3,"kPa")
      case "23":if let n=combined{found=("FUEL_RAIL_PRESSURE",n*10,"kPa")}
      case "1F":if let n=combined{found=("RUN_TIME",n,"s")}
      case "A6":if let n=odometer(b){found=("ODOMETER",n,"km")}
      default:break
      }
      if let f=found,f.1<=(ceiling[f.0] ?? Double.greatestFiniteMagnitude){result.append(f)}
    };return result
  }
  static func supported(_ reply:String,command:String)->Set<String> {
    var supported=Set<String>();guard let base=Int(command.suffix(2),radix:16) else{return supported}
    for line in reply.components(separatedBy:.newlines) {let s=line.replacingOccurrences(of:" ",with:"").uppercased();if s.hasPrefix("41"+command.suffix(2)),s.count>=12,let mask=UInt32(s.dropFirst(4).prefix(8),radix:16){for n in 0..<32 where mask & (UInt32(1) << (31-n)) != 0 {supported.insert(String(format:"%02X",base+n+1))}}}
    return supported
  }

  private static func hexBytes(_ text:String)->[Int]? {
    let t=text.replacingOccurrences(of:" ",with:"")
    guard !t.isEmpty,t.count%2==0,t.allSatisfy({ $0.isHexDigit && $0.isASCII }) else{return nil}
    var out=[Int]();var i=t.startIndex
    while i<t.endIndex{let j=t.index(i,offsetBy:2);out.append(Int(t[i..<j],radix:16)!);i=j}
    return out
  }
  /// Every reply as its data bytes. A CAN multi-frame reply (a length line such as "014", then "0:", "1:" … lines) becomes one.
  static func messages(_ reply:String)->[[Int]] {
    var out=[[Int]]();var multi:Int?;var size=0
    for raw in reply.replacingOccurrences(of:"\r",with:"\n").components(separatedBy:"\n") {
      let line=raw.trimmingCharacters(in:.whitespaces).uppercased();if line.isEmpty{continue}
      let chars=Array(line)
      if chars.count==3,chars.allSatisfy({$0.isHexDigit && $0.isASCII}){size=Int(line,radix:16) ?? 0;out.append([]);multi=out.count-1}
      else if chars.count>=2,chars[0]=="0",chars[1]==":",multi==nil {out.append(hexBytes(String(chars.dropFirst(2)).trimmingCharacters(in:.whitespaces)) ?? []);multi=out.count-1;size=0}
      else if chars.count>=2,chars[0].isHexDigit,chars[1]==":",let m=multi {
        out[m]+=hexBytes(String(chars.dropFirst(2)).trimmingCharacters(in:.whitespaces)) ?? []
        while size>0 && out[m].count>size{out[m].removeLast()}
      } else {multi=nil;if let b=hexBytes(line){out.append(b)}}
    }
    return out.filter{!$0.isEmpty}
  }
  /// The year of a manufacturing date written as ASCII digits (YYMMDD, YYYYMMDD) or BCD (YY MM DD, YYYY MM DD).
  static func ecuYear(_ b:[Int],now:Int=Calendar.current.component(.year,from:Date()))->Int? {
    func bcd(_ x:Int)->Int? { (x>>4)<=9 && (x&15)<=9 ? (x>>4)*10+(x&15) : nil }
    func inMonths(_ x:Int?)->Bool { x.map{(1...12).contains($0)} ?? false }
    let digits:String? = !b.isEmpty && b.allSatisfy({(0x30...0x39).contains($0)}) ? b.map{String($0-0x30)}.joined() : nil
    let year:Int,month:Int
    if let d=digits,d.count>=8,d.hasPrefix("19")||d.hasPrefix("20"){year=Int(d.prefix(4))!;month=Int(d.dropFirst(4).prefix(2))!}
    else if let d=digits,d.count>=6{year=2000+Int(d.prefix(2))!;month=Int(d.dropFirst(2).prefix(2))!}
    else if b.count>=3,let c=bcd(b[0]),c==19||c==20,let y=bcd(b[1]),inMonths(bcd(b[2])){year=c*100+y;month=bcd(b[2])!}
    else if b.count>=2,let y=bcd(b[0]),inMonths(bcd(b[1])){year=2000+y;month=bcd(b[1])!}
    else{return nil}
    return (1990...now+1).contains(year) && (1...12).contains(month) ? year : nil
  }
  private static func dtc(_ a:Int,_ b:Int)->String { String(Array("PCBU")[a>>6])+String((a>>4)&3)+String(format:"%X",a&15)+String(format:"%02X",b) }
  private static let spark:[String?] = ["CATALYST","HEATED_CATALYST","EVAP","SECONDARY_AIR","AC_REFRIGERANT","O2_SENSOR","O2_HEATER","EGR"]
  private static let compression:[String?] = ["NMHC_CATALYST","NOX_SCR",nil,"BOOST_PRESSURE",nil,"EXHAUST_SENSOR","PM_FILTER","EGR"]
  private static func distinct<T:Hashable>(_ list:[T])->[T] { var seen=Set<T>();return list.filter{seen.insert($0).inserted} }

  /// Folds one car-report reply into the profile. Codes, names and labels are resolved in the app.
  static func profile(_ reply:String,command:String,into p:inout [String:Any]) {
    let all=messages(reply)
    func mode01()->[[Int]] { guard let pid=Int(command.dropFirst(2),radix:16) else{return []};return all.filter{$0.count>=3 && $0[0]==0x41 && $0[1]==pid}.map{Array($0.dropFirst(2))} }
    func word(_ key:String){if let w=mode01().first(where:{$0.count>=2}){p[key]=w[0]*256+w[1]}}
    switch command {
    case "ATDPN":
      if let first=reply.replacingOccurrences(of:"\r",with:"\n").components(separatedBy:"\n").map({$0.trimmingCharacters(in:.whitespaces).uppercased()}).first(where:{!$0.isEmpty}) {
        let id=first.hasPrefix("A") ? String(first.dropFirst()) : first;if id.count==1{p["protocol"]=id}
      }
    case "ATRV":
      if let re=try? NSRegularExpression(pattern:"(\\d+(?:\\.\\d+)?)\\s*V"),let text=Optional(reply.uppercased()),let m=re.firstMatch(in:text,range:NSRange(text.startIndex...,in:text)),let r=Range(m.range(at:1),in:text),let v=Double(text[r]),(0.0...60.0).contains(v){p["batteryVoltage"]=v}
    case "0101":
      // Every ECU that answers (engine, hybrid system …) reports its own lamp request and code count.
      let replies=mode01().filter{$0.count>=4};if replies.isEmpty{return}
      var order=[String](),ready=[String:Bool]()
      func test(_ id:String,_ available:Bool,_ incomplete:Bool){if available{if ready[id]==nil{order.append(id)};ready[id]=(ready[id] ?? true) && !incomplete}}
      let diesel=replies.contains{$0[1]&0x08 != 0}
      for r in replies {let b=r[1],c=r[2],d=r[3]
        test("MISFIRE",b&1 != 0,b&0x10 != 0);test("FUEL_SYSTEM",b&2 != 0,b&0x20 != 0);test("COMPONENTS",b&4 != 0,b&0x40 != 0)
        let names=b&0x08 != 0 ? compression : spark
        for i in 0..<8 {if let n=names[i]{test(n,c&(1<<i) != 0,d&(1<<i) != 0)}}}
      p["mil"]=replies.contains{$0[0]&0x80 != 0};p["dtcCount"]=replies.reduce(0){$0+($1[0]&0x7F)};p["ignition"]=diesel ? "COMPRESSION":"SPARK"
      p["readiness"]=order.map{["id":$0,"complete":ready[$0]!] as [String:Any]}
    // The engine ECU may say petrol while the hybrid ECU says hybrid: the hybrid (then electric) answer wins.
    case "0151":
      let types=mode01().filter{!$0.isEmpty && $0[0] != 0}.map{$0[0]}
      if let t=types.first(where:{(17...22).contains($0)}) ?? types.first(where:{$0==8}) ?? types.first{p["fuelType"]=t}
    case "011C":if let v=mode01().first(where:{!$0.isEmpty}){p["obdStandard"]=v[0]}
    case "0121":word("distanceWithMilKm")
    case "0131":word("distanceSinceClearKm")
    case "014D":word("minutesWithMil")
    case "014E":word("minutesSinceClear")
    case "0130":if let v=mode01().first(where:{!$0.isEmpty}){p["warmupsSinceClear"]=v[0]}
    case "01A6":if let o=mode01().compactMap({odometer($0)}).first{p["odometerKm"]=o}
    case "0902":
      // CAN sends 49 02 01 + 17 characters; older protocols send five numbered lines of four bytes each.
      let parts=all.enumerated().filter{$0.element.count>3 && $0.element[0]==0x49 && $0.element[1]==0x02}
        .sorted{let l=$0.element.count==7 ? $0.element[2]:0,r=$1.element.count==7 ? $1.element[2]:0;return l != r ? l<r : $0.offset<$1.offset}.map{$0.element}
      let text=String(parts.flatMap{$0.dropFirst(3)}.filter{(0x30...0x5A).contains($0)}.compactMap{UnicodeScalar($0)}.map{Character($0)})
      func valid(_ c:Character)->Bool{c.isASCII && (c.isNumber || c.isUppercase) && !"IOQ".contains(c)}
      var vin:String?
      if text.count>=17{let last=String(text.suffix(17));if last.allSatisfy(valid){vin=last}}
      // Some adapters or ECUs frame the reply differently: take the first run of 17 VIN characters anywhere in it.
      if vin==nil{
        let ascii=all.flatMap{$0}.map{b -> Character in let ch=Character(UnicodeScalar(b) ?? " ");return (0x30...0x5A).contains(b) && valid(ch) ? ch : " "}
        vin=String(ascii).split(separator:" ").map(String.init).first{$0.count>=17 && $0.allSatisfy(valid)}.map{String($0.suffix(17))}
      }
      if let v=vin{p["vin"]=v;p["vinReply"]=nil}
      else if p["vin"]==nil{p["vinReply"]=String(reply.replacingOccurrences(of:"\r",with:" ").replacingOccurrences(of:"\n",with:" ").split(separator:" ",omittingEmptySubsequences:true).joined(separator:" ").prefix(60))}
    case "090A":
      let parts=all.enumerated().filter{$0.element.count>3 && $0.element[0]==0x49 && $0.element[1]==0x0A}
      let oneMessage = !parts.isEmpty && parts.allSatisfy({$0.element.count==7})
      let groups:[[Int]] = oneMessage ? [parts.sorted{$0.element[2]<$1.element[2]}.flatMap{Array($0.element.dropFirst(3))}] : parts.map{Array($0.element.dropFirst(3))}
      let names=distinct(groups.map{g in String(g.filter{(0x20...0x7E).contains($0)}.compactMap{UnicodeScalar($0)}.map{Character($0)}).trimmingCharacters(in:.whitespaces)}.filter{$0.count>=3})
      if !names.isEmpty{p["ecus"]=names}
    // Most European VINs carry no model year, so the ECU's own manufacturing date stands in for it.
    case "22F18B","1A8B":
      let body:[Int]? = command=="22F18B" ? all.first(where:{$0.count>=5 && $0[0]==0x62 && $0[1]==0xF1 && $0[2]==0x8B}).map{Array($0.dropFirst(3))}
        : all.first(where:{$0.count>=4 && $0[0]==0x5A && $0[1]==0x8B}).map{Array($0.dropFirst(2))}
      if let y=body.flatMap({ecuYear($0)}),p["ecuYear"]==nil{p["ecuYear"]=y}
    case "03","07","0A":
      let mode=(Int(command,radix:16) ?? 0)+0x40
      // CAN replies carry a count byte first (an even total length); older protocols pad to three codes per line.
      let codes=distinct(all.filter{!$0.isEmpty && $0[0]==mode}.flatMap{m -> [String] in
        let data:[Int]=m.count%2==0 ? Array(m.dropFirst(2).prefix(2*(m.count>1 ? m[1]:0))) : Array(m.dropFirst(1))
        return stride(from:0,to:data.count-1,by:2).map{(data[$0],data[$0+1])}.filter{$0.0 != 0 || $0.1 != 0}.map{dtc($0.0,$0.1)}})
      p[command=="03" ? "stored":command=="07" ? "pending":"permanent"]=codes
    default:break
    }
  }
}
