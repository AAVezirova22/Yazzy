package expo.modules.yazzyrecorder

/** Pure deterministic provisional state; RPM is deliberately not an input. */
class TripState(var state:String="IDLE",var candidate:Double?=null,var start:Double?=null,var parked:Double?=null,var last:Double?=null) {
 fun observe(time:Double,speed:Double,ignition:Double?) {
  last=time
  if(speed>5){parked=null;if(start!=null){state="ACTIVE";return}
   if(candidate==null||time-candidate!!>30){candidate=time;state="CANDIDATE"}
   else if(time-candidate!!>=3){start=candidate;state="ACTIVE"}
  }else if(start!=null){state="PAUSED";if(speed<=1&&ignition==0.0){if(parked==null)parked=time;if(time-parked!!>=180){state="CLOSED";start=null;candidate=null;parked=null}}else parked=null
  }else{candidate=null;if(state!="CLOSED")state="IDLE"}
 }
 fun stop(time:Double){state="CLOSED";candidate=null;start=null;parked=null;last=time}
 fun snapshot(now:Double):String=if(last!=null&&start!=null&&now-last!!>30)"UNCERTAIN" else state
}
