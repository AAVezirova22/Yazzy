package expo.modules.yazzyrecorder

import org.json.JSONArray
import org.json.JSONObject

object ElmDecoder {
 val pids=listOf("0C","0D","05","06","07","0B","0F","10","11","04","2F","42","46","5E","5B","5C","0E","33","0A","23","1F")
 val fastPids=listOf("0D","0C")
 val setup=listOf("ATZ","ATE0","ATL0","ATS1","ATH0","ATSP0","0100","0120","0140","0160","0180","01A0")
 /** Mode 01 PIDs that describe the car rather than the moment: monitor status, fuel type, OBD standard, distances, odometer. */
 val infoPids=listOf("01","51","1C","21","30","31","4D","4E","A6")
 // 22F18B (UDS) and 1A8B (KWP2000) only read the engine ECU's manufacturing date, the car's production year.
 private val reads=listOf("03","07","0A","0902","090A","22F18B","1A8B","ATRV","ATI","ATDP","ATDPN")
 // Read-only by construction: only these exact requests can ever be sent. Never 04 (clear codes) or any write service.
 fun allowed(command:String)=command in setup||command in (pids+infoPids).map{"01$it"}||command in reads
 /** The car-report requests: everything once per connection, then a light refresh of what can change while driving. */
 fun identify(supported:Set<String>,full:Boolean):List<String> =
  if(full)listOf("ATDPN","ATRV")+infoPids.filter{it in supported}.map{"01$it"}+listOf("0902","090A","22F18B","1A8B","03","07","0A")
  else listOf("ATRV")+listOf("01","31","A6").filter{it in supported}.map{"01$it"}+listOf("03","07")
 fun isReport(command:String)=command in reads||(command.startsWith("01")&&command.length==4&&command.substring(2) in infoPids)
 /** Readings the server accepts. The others are shown live and kept in the car report but never uploaded. */
 val uploaded=setOf("ENGINE_RPM","VEHICLE_SPEED","COOLANT_TEMP","SHORT_FUEL_TRIM","LONG_FUEL_TRIM","INTAKE_PRESSURE","INTAKE_TEMP","MAF","THROTTLE","ENGINE_LOAD","FUEL_LEVEL","MODULE_VOLTAGE","AMBIENT_TEMP","FUEL_RATE")
 fun supported(reply:String,command:String):Set<String>{val base=command.takeLast(2).toIntOrNull(16)?:return emptySet();return reply.lines().flatMap{val line=it.replace(" ","").uppercase();if(line.startsWith("41"+command.takeLast(2))&&line.length>=12){val mask=line.substring(4,12).toLongOrNull(16)?:0;(0..31).filter{n->mask and (1L shl (31-n))!=0L}.map{n->"%02X".format(base+n+1)}}else emptyList()}.toSet()}
 fun decode(reply:String,command:String):List<Triple<String,Double,String>> {
  if(!allowed(command)||!command.startsWith("01"))return emptyList()
  val pid=command.takeLast(2)
  return reply.lines().mapNotNull {raw->val line=raw.replace(" ","").uppercase();if(!line.startsWith("41$pid")||line.length<6)return@mapNotNull null
   val hex=line.drop(4);if(hex.length%2!=0||!hex.matches(Regex("[0-9A-F]+")))return@mapNotNull null;val bytes=hex.chunked(2).mapNotNull{it.toIntOrNull(16)};if(bytes.isEmpty())return@mapNotNull null
   val a=bytes[0].toDouble();val combined=if(bytes.size>1)a*256+bytes[1] else null
   when(pid){"0C"->combined?.let{Triple("ENGINE_RPM",it/4,"rpm")};"0D"->Triple("VEHICLE_SPEED",a,"km/h");"05"->Triple("COOLANT_TEMP",a-40,"degC");"06"->Triple("SHORT_FUEL_TRIM",(a-128)*100/128,"%");"07"->Triple("LONG_FUEL_TRIM",(a-128)*100/128,"%");"0B"->Triple("INTAKE_PRESSURE",a,"kPa");"0F"->Triple("INTAKE_TEMP",a-40,"degC");"10"->combined?.let{Triple("MAF",it/100,"g/s")};"11"->Triple("THROTTLE",a*100/255,"%");"04"->Triple("ENGINE_LOAD",a*100/255,"%");"2F"->Triple("FUEL_LEVEL",a*100/255,"%");"42"->combined?.let{Triple("MODULE_VOLTAGE",it/1000,"V")};"46"->Triple("AMBIENT_TEMP",a-40,"degC");"5E"->combined?.let{Triple("FUEL_RATE",it/20,"L/h")}
    "5B"->Triple("HYBRID_BATTERY",a*100/255,"%");"5C"->Triple("OIL_TEMP",a-40,"degC");"0E"->Triple("TIMING_ADVANCE",a/2-64,"deg");"33"->Triple("BARO_PRESSURE",a,"kPa");"0A"->Triple("FUEL_PRESSURE",a*3,"kPa")
    "23"->combined?.let{Triple("FUEL_RAIL_PRESSURE",it*10,"kPa")};"1F"->combined?.let{Triple("RUN_TIME",it,"s")};"A6"->odometer(bytes)?.let{Triple("ODOMETER",it,"km")};else->null}
  }.filter{(signal,value,_)->value<=(ceiling[signal]?:Double.MAX_VALUE)}
 }
 // The server's plausibility ceilings (backend telemetry contracts) for PIDs whose raw range goes beyond them,
 // for example 0xFF meaning "not available" decoding to 215 degC outside. Such readings are dropped, not uploaded.
 private val ceiling=mapOf("ENGINE_RPM" to 16000.0,"MAF" to 655.0,"MODULE_VOLTAGE" to 60.0,"AMBIENT_TEMP" to 80.0,"FUEL_RATE" to 200.0)
 private fun odometer(b:List<Int>)=if(b.size>=4)((b[0].toLong() shl 24)+(b[1] shl 16)+(b[2] shl 8)+b[3])/10.0 else null

 /** Every reply as its data bytes. A CAN multi-frame reply (a length line such as "014", then "0:", "1:" … lines) becomes one. */
 fun messages(reply:String):List<List<Int>>{
  val out=mutableListOf<MutableList<Int>>();var multi:MutableList<Int>?=null;var size=0
  for(raw in reply.replace('\r','\n').lines()){
   val line=raw.trim().uppercase();if(line.isEmpty())continue
   val part=Regex("^([0-9A-F]):\\s*(.*)$").find(line)
   if(Regex("^[0-9A-F]{3}$").matches(line)){size=line.toInt(16);multi=mutableListOf<Int>().also{out.add(it)}}
   else if(part!=null&&multi!=null){multi.addAll(hex(part.groupValues[2])?:emptyList());while(size>0&&multi.size>size)multi.removeAt(multi.lastIndex)}
   else{multi=null;hex(line)?.let{out.add(it.toMutableList())}}
  }
  return out.filter{it.isNotEmpty()}
 }
 /** The year of a manufacturing date written as ASCII digits (YYMMDD, YYYYMMDD) or BCD (YY MM DD, YYYY MM DD). */
 fun ecuYear(b:List<Int>,now:Int=java.util.Calendar.getInstance().get(java.util.Calendar.YEAR)):Int?{
  fun bcd(x:Int)=if(x shr 4<=9&&x and 15<=9)(x shr 4)*10+(x and 15) else null
  val digits=if(b.isNotEmpty()&&b.all{it in 0x30..0x39})b.map{it-0x30}.joinToString("") else null
  val (year,month)=when{
   digits!=null&&digits.length>=8&&digits.startsWith("19")||digits!=null&&digits.length>=8&&digits.startsWith("20")->digits.take(4).toInt() to digits.substring(4,6).toInt()
   digits!=null&&digits.length>=6->2000+digits.take(2).toInt() to digits.substring(2,4).toInt()
   b.size>=3&&(bcd(b[0])==19||bcd(b[0])==20)&&bcd(b[1])!=null&&bcd(b[2]) in 1..12->bcd(b[0])!!*100+bcd(b[1])!! to bcd(b[2])!!
   b.size>=2&&bcd(b[0])!=null&&bcd(b[1]) in 1..12->2000+bcd(b[0])!! to bcd(b[1])!!
   else->return null
  }
  return year.takeIf{it in 1990..now+1&&month in 1..12}
 }
 private fun hex(text:String):List<Int>?{val t=text.replace(" ","");if(t.isEmpty()||t.length%2!=0||!t.matches(Regex("[0-9A-F]+")))return null;return t.chunked(2).map{it.toInt(16)}}
 private fun dtc(a:Int,b:Int)="${"PCBU"[a shr 6]}${(a shr 4) and 3}${"%X".format(a and 15)}${"%02X".format(b)}"
 private val spark=listOf("CATALYST","HEATED_CATALYST","EVAP","SECONDARY_AIR","AC_REFRIGERANT","O2_SENSOR","O2_HEATER","EGR")
 private val compression=listOf("NMHC_CATALYST","NOX_SCR",null,"BOOST_PRESSURE",null,"EXHAUST_SENSOR","PM_FILTER","EGR")

 /** Folds one car-report reply into the profile. Codes, names and labels are resolved in the app. */
 fun profile(reply:String,command:String,p:JSONObject){
  val all=messages(reply)
  fun mode01()=all.filter{it.size>=3&&it[0]==0x41&&it[1]==command.substring(2).toInt(16)}.map{it.drop(2)}
  fun word(key:String)=mode01().firstOrNull{it.size>=2}?.let{p.put(key,it[0]*256+it[1])}
  when(command){
   "ATDPN"->reply.replace('\r','\n').lines().map{it.trim().uppercase()}.firstOrNull{it.isNotEmpty()}?.removePrefix("A")?.takeIf{it.length==1}?.let{p.put("protocol",it)}
   "ATRV"->Regex("(\\d+(?:\\.\\d+)?)\\s*V").find(reply.uppercase())?.groupValues?.get(1)?.toDoubleOrNull()?.takeIf{it in 0.0..60.0}?.let{p.put("batteryVoltage",it)}
   "0101"->{
    // Every ECU that answers (engine, hybrid system …) reports its own lamp request and code count.
    val replies=mode01().filter{it.size>=4};if(replies.isEmpty())return
    val ready=LinkedHashMap<String,Boolean>()
    fun test(id:String,available:Boolean,incomplete:Boolean){if(available)ready[id]=(ready[id]?:true)&&!incomplete}
    val diesel=replies.any{it[1] and 0x08!=0}
    for(r in replies){val (_,b,c,d)=r
     test("MISFIRE",b and 1!=0,b and 0x10!=0);test("FUEL_SYSTEM",b and 2!=0,b and 0x20!=0);test("COMPONENTS",b and 4!=0,b and 0x40!=0)
     val names=if(b and 0x08!=0)compression else spark
     for(i in 0..7)names[i]?.let{test(it,c and (1 shl i)!=0,d and (1 shl i)!=0)}}
    p.put("mil",replies.any{it[0] and 0x80!=0}).put("dtcCount",replies.sumOf{it[0] and 0x7F}).put("ignition",if(diesel)"COMPRESSION" else "SPARK")
    p.put("readiness",JSONArray(ready.map{(id,complete)->JSONObject().put("id",id).put("complete",complete)}))
   }
   // The engine ECU may say petrol while the hybrid ECU says hybrid: the hybrid (then electric) answer wins.
   "0151"->{val types=mode01().filter{it.isNotEmpty()&&it[0]!=0}.map{it[0]};(types.firstOrNull{it in 17..22}?:types.firstOrNull{it==8}?:types.firstOrNull())?.let{p.put("fuelType",it)}}
   "011C"->mode01().firstOrNull{it.isNotEmpty()}?.let{p.put("obdStandard",it[0])}
   "0121"->word("distanceWithMilKm");"0131"->word("distanceSinceClearKm");"014D"->word("minutesWithMil");"014E"->word("minutesSinceClear")
   "0130"->mode01().firstOrNull{it.isNotEmpty()}?.let{p.put("warmupsSinceClear",it[0])}
   "01A6"->mode01().firstNotNullOfOrNull{odometer(it)}?.let{p.put("odometerKm",it)}
   "0902"->{
    // CAN sends 49 02 01 + 17 characters; older protocols send five numbered lines of four bytes each.
    val parts=all.filter{it.size>3&&it[0]==0x49&&it[1]==0x02}.sortedBy{if(it.size==7)it[2] else 0}
    val text=parts.flatMap{it.drop(3)}.filter{it in 0x30..0x5A}.map{it.toChar()}.joinToString("")
    if(text.length>=17)text.takeLast(17).takeIf{Regex("[A-HJ-NPR-Z0-9]{17}").matches(it)}?.let{p.put("vin",it)}
   }
   "090A"->{
    val parts=all.filter{it.size>3&&it[0]==0x49&&it[1]==0x0A}
    val groups=if(parts.isNotEmpty()&&parts.all{it.size==7})listOf(parts.sortedBy{it[2]}.flatMap{it.drop(3)}) else parts.map{it.drop(3)}
    val names=groups.map{g->g.filter{it in 0x20..0x7E}.map{it.toChar()}.joinToString("").trim()}.filter{it.length>=3}.distinct()
    if(names.isNotEmpty())p.put("ecus",JSONArray(names))
   }
   // Most European VINs carry no model year, so the ECU's own manufacturing date stands in for it.
   "22F18B","1A8B"->{
    val body=if(command=="22F18B")all.firstOrNull{it.size>=5&&it[0]==0x62&&it[1]==0xF1&&it[2]==0x8B}?.drop(3)
     else all.firstOrNull{it.size>=4&&it[0]==0x5A&&it[1]==0x8B}?.drop(2)
    body?.let{ecuYear(it)}?.let{if(!p.has("ecuYear"))p.put("ecuYear",it)}
   }
   "03","07","0A"->{
    val mode=command.toInt(16)+0x40
    // CAN replies carry a count byte first (an even total length); older protocols pad to three codes per line.
    val codes=all.filter{it.isNotEmpty()&&it[0]==mode}.flatMap{m->val data=if(m.size%2==0)m.drop(2).take(2*(m.getOrElse(1){0})) else m.drop(1)
     data.chunked(2).filter{it.size==2&&(it[0]!=0||it[1]!=0)}.map{dtc(it[0],it[1])}}.distinct()
    p.put(when(command){"03"->"stored";"07"->"pending";else->"permanent"},JSONArray(codes))
   }
  }
 }
}
