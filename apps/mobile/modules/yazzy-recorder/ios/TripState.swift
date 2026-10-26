import Foundation

/// Provisional local state only. Final metrics and correction history belong to the server.
struct TripState: Codable {
  var state = "IDLE"
  var candidate:Double?
  var start:Double?
  var parked:Double?
  var last:Double?
  mutating func observe(time:Double,speed:Double,ignition:Double?) {
    last=time
    if speed>5 {
      parked=nil
      if start != nil {state="ACTIVE";return}
      if candidate == nil || time-candidate!>30 {candidate=time;state="CANDIDATE"}
      else if time-candidate!>=3 {start=candidate;state="ACTIVE"}
    } else if start != nil {
      state="PAUSED"
      if speed<=1 && ignition==0 {
        if parked==nil {parked=time}
        if time-parked!>=180 {state="CLOSED";start=nil;candidate=nil;parked=nil}
      } else {parked=nil}
    } else {candidate=nil;if state != "CLOSED" {state="IDLE"}}
  }
  mutating func stop(time:Double){state="CLOSED";candidate=nil;start=nil;parked=nil;last=time}
  func snapshot(now:Double)->String {if let last=last,start != nil,now-last>30{return "UNCERTAIN"};return state}
  static func load()->TripState {guard let bytes=UserDefaults.standard.data(forKey:"yazzy.trip-state"),let value=try? JSONDecoder().decode(TripState.self,from:bytes) else{return TripState()};return value}
  func save(){if let bytes=try? JSONEncoder().encode(self){UserDefaults.standard.set(bytes,forKey:"yazzy.trip-state")}}
}
