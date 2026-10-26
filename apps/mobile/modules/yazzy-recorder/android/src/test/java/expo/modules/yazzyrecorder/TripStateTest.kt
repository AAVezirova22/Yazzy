package expo.modules.yazzyrecorder
import org.junit.Assert.*
import org.junit.Test
class TripStateTest {
 @Test fun stopStartRemainsOneTrip(){val t=TripState();t.observe(0.0,30.0,1.0);t.observe(10.0,30.0,1.0);t.observe(20.0,0.0,1.0);assertEquals("PAUSED",t.state);t.observe(40.0,30.0,1.0);assertEquals("ACTIVE",t.state);assertEquals(0.0,t.start!!,0.0)}
 @Test fun parkingRequiresConfirmation(){val t=TripState();t.observe(0.0,30.0,1.0);t.observe(10.0,30.0,1.0);t.observe(20.0,0.0,0.0);assertEquals("PAUSED",t.state);t.observe(200.0,0.0,0.0);assertEquals("CLOSED",t.state)}
 @Test fun obdWritesAreForbidden(){assertFalse(ElmDecoder.allowed("04"));assertFalse(ElmDecoder.allowed("ATZ\r04"));assertTrue(ElmDecoder.allowed("010C"))}
}
