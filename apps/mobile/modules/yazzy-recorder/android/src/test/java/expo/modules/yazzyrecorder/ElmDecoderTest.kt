package expo.modules.yazzyrecorder
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
class ElmDecoderTest {
 private fun report(vararg replies:Pair<String,String>)=JSONObject().also{p->replies.forEach{(command,reply)->ElmDecoder.profile(reply,command,p)}}
 private fun list(p:JSONObject,key:String)=p.getJSONArray(key).let{a->(0 until a.length()).map{a.get(it)}}

 @Test fun vinFromCanMultiFrame(){
  val p=report("0902" to "014\r0: 49 02 01 4A 54 44\r1: 4B 42 32 30 55 34 30\r2: 33 31 32 33 34 35 36\r\r")
  assertEquals("JTDKB20U403123456",p.getString("vin"))
 }
 @Test fun vinFromOlderProtocolLines(){
  val p=report("0902" to "49 02 01 00 00 00 4A\r49 02 02 54 44 4B 42\r49 02 03 32 30 55 34\r49 02 04 30 33 31 32\r49 02 05 33 34 35 36\r")
  assertEquals("JTDKB20U403123456",p.getString("vin"))
 }
 @Test fun faultCodesOnCanAndOlderProtocols(){
  assertEquals(listOf("P0133","P0A80"),list(report("03" to "43 02 01 33 0A 80\r"),"stored"))
  assertEquals(listOf("P0133"),list(report("03" to "43 01 33 00 00 00 00\r"),"stored"))
  assertEquals(listOf("P0A80"),list(report("07" to "43 00\r47 00\r47 01 0A 80\r"),"pending"))
  assertEquals(emptyList<Any>(),list(report("0A" to "4A 00\r"),"permanent"))
  assertEquals(listOf("C0123","B1234","U0100"),list(report("03" to "008\r0: 43 03 41 23 92\r1: 34 C1 00 00 00 00 00\r"),"stored"))
 }
 @Test fun monitorStatusGivesLampCodesIgnitionAndReadiness(){
  val p=report("0101" to "41 01 81 07 65 04\r")
  assertTrue(p.getBoolean("mil"));assertEquals(1,p.getInt("dtcCount"));assertEquals("SPARK",p.getString("ignition"))
  val ready=p.getJSONArray("readiness").let{a->(0 until a.length()).associate{a.getJSONObject(it).let{o->o.getString("id") to o.getBoolean("complete")}}}
  assertEquals(false,ready["EVAP"]);assertEquals(true,ready["CATALYST"]);assertEquals(true,ready["MISFIRE"]);assertNull(ready["EGR"])
  assertEquals("COMPRESSION",report("0101" to "41 01 00 0F 00 00\r").getString("ignition"))
 }
 @Test fun hybridFuelTypeWinsOverEngineEcu(){
  assertEquals(17,report("0151" to "41 51 01\r41 51 11\r").getInt("fuelType"))
  assertEquals(4,report("0151" to "41 51 04\r").getInt("fuelType"))
 }
 @Test fun batteryEcuNamesAndDistances(){
  val p=report("ATRV" to "12.6V\r","090A" to "017\r0: 49 0A 01 45 43 4D\r1: 00 2D 45 6E 67 69 6E\r2: 65 43 6F 6E 74 72 6F\r3: 6C 00 00 00 00 00 00\r","0131" to "41 31 01 F4\r","01A6" to "41 A6 00 12 D6 87\r")
  assertEquals(12.6,p.getDouble("batteryVoltage"),0.0);assertEquals(listOf("ECM-EngineControl"),list(p,"ecus"))
  assertEquals(500,p.getInt("distanceSinceClearKm"));assertEquals(123456.7,p.getDouble("odometerKm"),0.001)
 }
 @Test fun newLiveReadings(){
  assertEquals(65.1,ElmDecoder.decode("41 5B A6\r","015B").single().second,0.1)
  assertEquals("ODOMETER",ElmDecoder.decode("41 A6 00 12 D6 87\r","01A6").single().first)
  assertEquals(90.0,ElmDecoder.decode("41 5C 82\r","015C").single().second,0.0)
  assertFalse("HYBRID_BATTERY" in ElmDecoder.uploaded);assertTrue("VEHICLE_SPEED" in ElmDecoder.uploaded)
 }
 @Test fun stillReadOnly(){
  assertFalse(ElmDecoder.allowed("04"));assertFalse(ElmDecoder.allowed("14"));assertFalse(ElmDecoder.allowed("0904"))
  assertTrue(ElmDecoder.allowed("0902"));assertTrue(ElmDecoder.allowed("0101"));assertTrue(ElmDecoder.allowed("01A6"))
  assertTrue(ElmDecoder.identify(setOf("01","51","A6"),full=true).all{ElmDecoder.allowed(it)})
 }
}
