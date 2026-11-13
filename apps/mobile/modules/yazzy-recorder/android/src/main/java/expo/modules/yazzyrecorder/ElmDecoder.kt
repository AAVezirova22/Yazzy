package expo.modules.yazzyrecorder

object ElmDecoder {
 val pids=listOf("0C","0D","05","06","07","0B","0F","10","11","04","2F","42","46","5E")
 val fastPids=listOf("0D","0C")
 val setup=listOf("ATZ","ATE0","ATL0","ATS1","ATH0","ATSP0","0100","0120","0140")
 fun allowed(command:String)=command in setup || command in pids.map{"01$it"} || command in listOf("03","07","0A","ATRV","ATI","ATDP")
 fun supported(reply:String,command:String):Set<String>{val base=command.takeLast(2).toIntOrNull(16)?:return emptySet();return reply.lines().flatMap{val line=it.replace(" ","").uppercase();if(line.startsWith("41"+command.takeLast(2))&&line.length>=12){val mask=line.substring(4,12).toLongOrNull(16)?:0;(0..31).filter{n->mask and (1L shl (31-n))!=0L}.map{n->"%02X".format(base+n+1)}}else emptyList()}.toSet()}
 fun decode(reply:String,command:String):List<Triple<String,Double,String>> {
  if(!allowed(command)||!command.startsWith("01"))return emptyList()
  val pid=command.takeLast(2)
  return reply.lines().mapNotNull {raw->val line=raw.replace(" ","").uppercase();if(!line.startsWith("41$pid")||line.length<6)return@mapNotNull null
   val hex=line.drop(4);if(hex.length%2!=0||!hex.matches(Regex("[0-9A-F]+")))return@mapNotNull null;val bytes=hex.chunked(2).mapNotNull{it.toIntOrNull(16)};if(bytes.isEmpty())return@mapNotNull null
   val a=bytes[0].toDouble();val combined=if(bytes.size>1)a*256+bytes[1] else null
   when(pid){"0C"->combined?.let{Triple("ENGINE_RPM",it/4,"rpm")};"0D"->Triple("VEHICLE_SPEED",a,"km/h");"05"->Triple("COOLANT_TEMP",a-40,"degC");"06"->Triple("SHORT_FUEL_TRIM",(a-128)*100/128,"%");"07"->Triple("LONG_FUEL_TRIM",(a-128)*100/128,"%");"0B"->Triple("INTAKE_PRESSURE",a,"kPa");"0F"->Triple("INTAKE_TEMP",a-40,"degC");"10"->combined?.let{Triple("MAF",it/100,"g/s")};"11"->Triple("THROTTLE",a*100/255,"%");"04"->Triple("ENGINE_LOAD",a*100/255,"%");"2F"->Triple("FUEL_LEVEL",a*100/255,"%");"42"->combined?.let{Triple("MODULE_VOLTAGE",it/1000,"V")};"46"->Triple("AMBIENT_TEMP",a-40,"degC");"5E"->combined?.let{Triple("FUEL_RATE",it/20,"L/h")};else->null}
  }
 }
}
