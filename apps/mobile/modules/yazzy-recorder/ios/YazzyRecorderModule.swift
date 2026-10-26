import ExpoModulesCore
import CoreBluetooth
import CoreLocation
import Foundation

public class YazzyRecorderModule: Module {
  private var recorder: NativeRecorder { NativeRecorder.shared }
  public func definition() -> ModuleDefinition {
    Name("YazzyRecorder")
    AsyncFunction("discover") { (promise:Promise) in DispatchQueue.main.async { self.recorder.discover { promise.resolve($0) } } }
    AsyncFunction("inspect") { (id:String,promise:Promise) in DispatchQueue.main.async { self.recorder.inspect(id) { promise.resolve($0) } } }
    AsyncFunction("configure") { (json:String,promise:Promise) in DispatchQueue.main.async {
      do {
        guard !self.recorder.hasPendingCapture else { throw NSError(domain:"UploadQueueBeforeReassignment",code:1) }
        guard let data=json.data(using:.utf8),let config=(try JSONSerialization.jsonObject(with:data)) as? [String:String] else {throw NSError(domain:"Configuration",code:1)}
        for key in ["apiUrl","deviceId","assignmentId","deviceToken","peripheralId","serviceUuid","writeUuid","notifyUuid"] {guard let value=config[key],!value.isEmpty else {throw NSError(domain:"MissingConfiguration",code:1)}}
        guard let url=URL(string:config["apiUrl"]!),url.scheme=="https" || ["localhost","127.0.0.1"].contains(url.host ?? "") else {throw NSError(domain:"UseHTTPS",code:1)}
        try RecorderSecret.save(data);promise.resolve(nil)
      } catch {promise.reject("RECORDER_CONFIGURE",error.localizedDescription)}
    } }
    AsyncFunction("start") { (promise:Promise) in DispatchQueue.main.async { do{try self.recorder.start();promise.resolve(nil)}catch{promise.reject("RECORDER_START",error.localizedDescription)} } }
    AsyncFunction("stop") { DispatchQueue.main.async { self.recorder.stop() } }
    AsyncFunction("sync") { DispatchQueue.main.async { self.recorder.sync() } }
    AsyncFunction("snapshot") { (promise:Promise) in DispatchQueue.main.async { promise.resolve(self.recorder.snapshot()) } }
  }
}

final class NativeRecorder: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate, CLLocationManagerDelegate {
  static let shared=NativeRecorder()
  private var central:CBCentralManager!
  private let location=CLLocationManager()
  private let store=RecorderStore()
  private var found=[UUID:CBPeripheral]()
  private var rssi=[UUID:Int]()
  private var peripheral:CBPeripheral?
  private var writeCharacteristic:CBCharacteristic?
  private var inspectDone: (([[String:Any]])->Void)?
  private var discovered=[[String:Any]]()
  private var pendingServices=0
  private var trip=TripState.load()
  private var recording=false
  private var connected=false
  private var error:String?
  private var signals=[String:Double]()
  private var timer:Timer?
  private var buffer=""
  private var inFlight:String?
  private var sentAt=Date.distantPast
  private var setup=[String]()
  private var supported=Set<String>()
  private var pollIndex=0
  private var failures=0
  private var syncing=false
  private var syncFailures=0
  private var nextSync=Date.distantPast
  override init(){super.init();central=CBCentralManager(delegate:self,queue:.main,options:[CBCentralManagerOptionRestoreIdentifierKey:"yazzy.obd.central"]);location.delegate=self;location.desiredAccuracy=kCLLocationAccuracyBest;location.distanceFilter=5;location.activityType = .automotiveNavigation}
  var hasPendingCapture:Bool { recording || store.count>0 }
  func snapshot()->[String:Any]{["recording":recording,"connected":connected,"queued":store.count,"error":error as Any? ?? NSNull(),"signals":signals,"qualification":"PENDING_DEVICE_TEST","tripState":trip.snapshot(now:Date().timeIntervalSince1970)]}
  func discover(_ done:@escaping ([[String:Any]])->Void){
    guard !recording,central.state == .poweredOn else{error="Stop recording and enable Bluetooth before scanning";done([]);return}
    found.removeAll();rssi.removeAll();central.scanForPeripherals(withServices:nil)
    DispatchQueue.main.asyncAfter(deadline:.now()+5){self.central.stopScan();done(self.found.map{["id":$0.key.uuidString,"name":$0.value.name ?? "Unnamed adapter","rssi":self.rssi[$0.key] ?? 0]})}
  }
  func inspect(_ id:String,_ done:@escaping ([[String:Any]])->Void){
    guard !recording,let uuid=UUID(uuidString:id),let p=found[uuid] else{done([]);return}
    inspectDone=done;discovered=[];peripheral=p;p.delegate=self;central.connect(p)
    DispatchQueue.main.asyncAfter(deadline:.now()+15){if let completion=self.inspectDone{self.inspectDone=nil;completion(self.discovered);self.central.cancelPeripheralConnection(p)}}
  }
  func start() throws {
    guard !recording,let c=RecorderSecret.read(),let id=c["peripheralId"],let uuid=UUID(uuidString:id),let p=central.retrievePeripherals(withIdentifiers:[uuid]).first else{throw NSError(domain:"SelectDiscoveredAdapter",code:1)}
    for key in ["apiUrl","deviceId","assignmentId","deviceToken","serviceUuid","writeUuid","notifyUuid"] {guard let value=c[key],!value.isEmpty else{throw NSError(domain:"MissingConfiguration",code:1)}}
    recording=true;error=nil;peripheral=p;p.delegate=self;central.connect(p)
    location.requestAlwaysAuthorization();location.allowsBackgroundLocationUpdates=true;location.pausesLocationUpdatesAutomatically=false;location.startUpdatingLocation()
    timer?.invalidate();timer=Timer.scheduledTimer(withTimeInterval:0.5,repeats:true){[weak self]_ in self?.tick()}
  }
  func stop(){
    if recording{try? store.enqueue(signal:"USER_STOP",value:1,unit:"bool")}
    recording=false;connected=false;timer?.invalidate();location.stopUpdatingLocation()
    if let p=peripheral{central.cancelPeripheralConnection(p)};trip.stop(time:Date().timeIntervalSince1970);trip.save();sync();try? store.newSession()
  }
  func centralManagerDidUpdateState(_ central:CBCentralManager){if central.state != .poweredOn{connected=false;error="Bluetooth unavailable"}}
  func centralManager(_ central:CBCentralManager,didDiscover peripheral:CBPeripheral,advertisementData:[String:Any],rssi RSSI:NSNumber){found[peripheral.identifier]=peripheral;rssi[peripheral.identifier]=RSSI.intValue}
  func centralManager(_ central:CBCentralManager,willRestoreState dict:[String:Any]){if let p=(dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral])?.first{peripheral=p;p.delegate=self;error="Bluetooth state restored; verify recording continuity"}}
  func centralManager(_ central:CBCentralManager,didConnect peripheral:CBPeripheral){peripheral.discoverServices(nil)}
  func centralManager(_ central:CBCentralManager,didFailToConnect peripheral:CBPeripheral,error:Error?){connected=false;self.error="Connection failed"}
  func centralManager(_ central:CBCentralManager,didDisconnectPeripheral peripheral:CBPeripheral,error:Error?){connected=false;inFlight=nil;self.error="Connection lost; measurements unavailable";if recording{DispatchQueue.main.asyncAfter(deadline:.now()+5){if self.recording{central.connect(peripheral)}}}}
  func peripheral(_ peripheral:CBPeripheral,didDiscoverServices error:Error?){guard error==nil else{self.error="Service discovery failed";return};pendingServices=peripheral.services?.count ?? 0;for service in peripheral.services ?? []{peripheral.discoverCharacteristics(nil,for:service)}}
  func peripheral(_ peripheral:CBPeripheral,didDiscoverCharacteristicsFor service:CBService,error:Error?){
    let c=RecorderSecret.read()
    for ch in service.characteristics ?? [] {
      let canWrite=ch.properties.contains(.write) || ch.properties.contains(.writeWithoutResponse)
      let canNotify=ch.properties.contains(.notify) || ch.properties.contains(.indicate)
      discovered.append(["service":service.uuid.uuidString,"uuid":ch.uuid.uuidString,"write":canWrite,"notify":canNotify])
      if recording,let c=c,service.uuid==CBUUID(string:c["serviceUuid"]!) {
        if ch.uuid==CBUUID(string:c["writeUuid"]!),canWrite{writeCharacteristic=ch}
        if ch.uuid==CBUUID(string:c["notifyUuid"]!),canNotify{peripheral.setNotifyValue(true,for:ch)}
      }
    }
    pendingServices-=1
    if pendingServices==0,let done=inspectDone{inspectDone=nil;done(discovered);central.cancelPeripheralConnection(peripheral)}
  }
  func peripheral(_ peripheral:CBPeripheral,didUpdateNotificationStateFor characteristic:CBCharacteristic,error:Error?){
    if error != nil || !characteristic.isNotifying{self.error="Adapter does not accept the selected notification characteristic";return}
    connected=true;setup=ElmDecoder.setup;supported=[];inFlight=nil;buffer="";failures=0
  }
  private func tick(){
    guard recording else{return};sync()
    guard connected,let p=peripheral,let write=writeCharacteristic else{return}
    if inFlight != nil {if Date().timeIntervalSince(sentAt)>8{inFlight=nil;buffer="";failures+=1;error="Diagnostic timeout; capture gap";if failures>=3{central.cancelPeripheralConnection(p)}};return}
    let polls=ElmDecoder.pids.filter{supported.contains($0)}
    let command:String
    if !setup.isEmpty{command=setup.removeFirst()}else{guard !polls.isEmpty else{error="No supported PIDs detected";return};command="01"+polls[pollIndex % polls.count];pollIndex+=1}
    guard ElmDecoder.allowed(command) else{return};inFlight=command;sentAt=Date()
    p.writeValue(Data((command+"\r").utf8),for:write,type:write.properties.contains(.write) ? .withResponse:.withoutResponse)
  }
  func peripheral(_ peripheral:CBPeripheral,didUpdateValueFor characteristic:CBCharacteristic,error:Error?){
    guard error==nil,let bytes=characteristic.value,let command=inFlight else{return}
    buffer+=String(data:bytes,encoding:.ascii) ?? ""
    guard buffer.count<=8192 else{buffer="";inFlight=nil;self.error="Malformed adapter response";return}
    guard buffer.contains(">") else{return};let frame=buffer.components(separatedBy:">")[0];buffer="";inFlight=nil;failures=0
    if ["0100","0120","0140"].contains(command){supported.formUnion(ElmDecoder.supported(frame,command:command))}
    for (signal,value,unit) in ElmDecoder.decode(frame,command:command){signals[signal]=value;if signal=="VEHICLE_SPEED"{trip.observe(time:Date().timeIntervalSince1970,speed:value,ignition:nil);trip.save()};do{try store.enqueue(signal:signal,value:value,unit:unit)}catch{self.error="Durable queue unavailable or full; recording stopped";stop();return}}
  }
  func locationManager(_ manager:CLLocationManager,didUpdateLocations locations:[CLLocation]){
    guard recording,let fix=locations.last else{return};let age=max(0,Date().timeIntervalSince(fix.timestamp))
    let value:[String:Any]=["latitude":fix.coordinate.latitude,"longitude":fix.coordinate.longitude,"accuracy":max(0,fix.horizontalAccuracy),"fixAge":age,"validFix":fix.horizontalAccuracy>=0 && age<=10,"provider":"PHONE"]
      do{try store.enqueue(signal:"GPS",value:value,unit:"deg")}catch{self.error="Queue full; GPS capture stopped";stop()}
  }
  func locationManager(_ manager:CLLocationManager,didFailWithError error:Error){self.error="GPS unavailable; OBD capture continues"}
  func sync(){
    guard !syncing,Date()>=nextSync,let c=RecorderSecret.read(),let url=URL(string:(c["apiUrl"] ?? "")+"/api/v1/telemetry/batches") else{return}
    do{guard let (id,payload)=try store.nextBatch(config:c) else{return};syncing=true
      var request=URLRequest(url:url);request.httpMethod="POST";request.timeoutInterval=20;request.httpBody=payload
      request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.setValue("Device "+c["deviceToken"]!,forHTTPHeaderField:"Authorization")
      URLSession.shared.dataTask(with:request){data,response,err in DispatchQueue.main.async{
        self.syncing=false
        let accepted=data.flatMap{try? JSONSerialization.jsonObject(with:$0) as? [String:Any]}?["accepted"] as? Bool
        if err==nil,(response as? HTTPURLResponse)?.statusCode==202,accepted==true{do{try self.store.acknowledge(id);self.syncFailures=0;self.nextSync=Date();self.sync()}catch{self.error="Acknowledgement persistence failed; batch retained"}}
        else{self.syncFailures+=1;self.nextSync=Date().addingTimeInterval(min(300,pow(2,Double(min(self.syncFailures,8)))));self.error="Upload pending; observations retained locally"}
      }}.resume()
    }catch{self.error="Could not read durable upload queue"}
  }
}
