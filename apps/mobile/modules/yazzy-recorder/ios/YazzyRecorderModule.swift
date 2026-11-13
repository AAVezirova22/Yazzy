import ExpoModulesCore
import CoreBluetooth
import CoreLocation
import Foundation

public class YazzyRecorderModule: Module {
  private var recorder: NativeRecorder { NativeRecorder.shared }
  public func definition() -> ModuleDefinition {
    Name("YazzyRecorder")
    AsyncFunction("discover") { (promise:Promise) in DispatchQueue.main.async { self.recorder.discover { promise.resolve($0) } } }
    AsyncFunction("inspect") { (id:String,promise:Promise) in DispatchQueue.main.async { self.recorder.inspect(id) { list,failure in if let failure=failure{promise.reject("RECORDER_INSPECT",failure)}else{promise.resolve(list)} } } }
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
  private var names=[UUID:String]()
  private var peripheral:CBPeripheral?
  private var writeCharacteristic:CBCharacteristic?
  private var inspectDone: (([[String:Any]],String?)->Void)?
  private var inspectToken=0
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
  private var lastObdAt=Date.distantPast
  private var startWhenReady=false
  private let armedKey="yazzy.armed"
  private var syncing=false
  private var syncFailures=0
  private var nextSync=Date.distantPast
  override init(){super.init();central=CBCentralManager(delegate:self,queue:.main,options:[CBCentralManagerOptionRestoreIdentifierKey:"yazzy.obd.central"]);location.delegate=self;location.desiredAccuracy=kCLLocationAccuracyBest;location.distanceFilter=5;location.activityType = .automotiveNavigation}
  var hasPendingCapture:Bool { recording || store.count>0 }
  func snapshot()->[String:Any]{["recording":recording,"connected":connected,"configured":RecorderSecret.read() != nil,"waitingForAdapter":recording && !connected,"queued":store.count,"error":error as Any? ?? NSNull(),"signals":signals,"qualification":"PENDING_DEVICE_TEST","tripState":trip.snapshot(now:Date().timeIntervalSince1970)]}
  func discover(_ done:@escaping ([[String:Any]])->Void){
    guard !recording,central.state == .poweredOn else{error="Stop recording and enable Bluetooth before scanning";done([]);return}
    found.removeAll();rssi.removeAll();names.removeAll()
    // Duplicates are allowed so the scan-response packet (which usually carries the local name) is not dropped.
    central.scanForPeripherals(withServices:nil,options:[CBCentralManagerScanOptionAllowDuplicatesKey:true])
    DispatchQueue.main.asyncAfter(deadline:.now()+5){self.central.stopScan();done(self.found.map{["id":$0.key.uuidString,"name":self.names[$0.key] ?? $0.value.name ?? "","rssi":self.rssi[$0.key] ?? 0]})}
  }
  func inspect(_ id:String,_ done:@escaping ([[String:Any]],String?)->Void){
    guard !recording else{done([],"Stop recording before inspecting an adapter");return}
    guard central.state == .poweredOn else{done([],"Bluetooth is off or unavailable");return}
    guard let uuid=UUID(uuidString:id),let p=found[uuid] else{done([],"Adapter not found. Scan again and retry");return}
    if inspectDone != nil,let old=peripheral{finishInspect("Superseded by a new inspection",cancel:old)}
    inspectToken+=1;let token=inspectToken
    inspectDone=done;discovered=[];pendingServices=0;peripheral=p;p.delegate=self;central.connect(p)
    DispatchQueue.main.asyncAfter(deadline:.now()+15){if self.inspectToken==token{self.finishInspect("Timed out connecting to the adapter. Close other apps that may hold it (for example VgateFwUpdater), then retry",cancel:p)}}
  }
  private func finishInspect(_ failure:String?,cancel p:CBPeripheral?=nil){
    guard let completion=inspectDone else{return}
    inspectDone=nil;inspectToken+=1
    if let p=p{central.cancelPeripheralConnection(p)}
    if let failure=failure,discovered.isEmpty{completion([],failure)}
    else if discovered.isEmpty{completion([],"The adapter exposed no characteristics")}
    else{completion(discovered,nil)}
  }
  /// Arms the recorder: it connects to the saved adapter now, or whenever the adapter next powers on, until stopped.
  func start() throws {
    guard !recording else{return}
    switch central.state {
    case .poweredOn:break
    case .unknown,.resetting:startWhenReady=true;return
    default:throw NSError(domain:"BluetoothUnavailable",code:1)
    }
    guard let c=RecorderSecret.read(),let id=c["peripheralId"],let uuid=UUID(uuidString:id),let p=central.retrievePeripherals(withIdentifiers:[uuid]).first else{throw NSError(domain:"SelectDiscoveredAdapter",code:1)}
    for key in ["apiUrl","deviceId","assignmentId","deviceToken","serviceUuid","writeUuid","notifyUuid"] {guard let value=c[key],!value.isEmpty else{throw NSError(domain:"MissingConfiguration",code:1)}}
    startWhenReady=false;UserDefaults.standard.set(true,forKey:armedKey)
    recording=true;error=nil;peripheral=p;p.delegate=self;central.connect(p)
    location.requestAlwaysAuthorization();location.allowsBackgroundLocationUpdates=true;location.pausesLocationUpdatesAutomatically=false;setLocation(active:false);location.startUpdatingLocation()
    timer?.invalidate();timer=Timer.scheduledTimer(withTimeInterval:0.5,repeats:true){[weak self]_ in self?.tick()}
  }
  /// While waiting for the adapter the phone only needs coarse, rarely-updated location to stay alive in the background; full accuracy starts once the adapter answers.
  private func setLocation(active:Bool){
    location.desiredAccuracy=active ? kCLLocationAccuracyBest:kCLLocationAccuracyThreeKilometers
    location.distanceFilter=active ? 5:1000
  }
  private func resumeIfArmed(){if UserDefaults.standard.bool(forKey:armedKey) && !recording{try? start()}}
  func stop(){
    if recording{try? store.enqueue(signal:"USER_STOP",value:1,unit:"bool")}
    UserDefaults.standard.set(false,forKey:armedKey);startWhenReady=false
    recording=false;connected=false;timer?.invalidate();location.stopUpdatingLocation()
    if let p=peripheral{central.cancelPeripheralConnection(p)};trip.stop(time:Date().timeIntervalSince1970);trip.save();sync();try? store.newSession()
  }
  func centralManagerDidUpdateState(_ central:CBCentralManager){
    if central.state != .poweredOn{connected=false;error="Bluetooth unavailable";return}
    if recording{if let p=peripheral{error=nil;central.connect(p)}}  // Bluetooth came back while armed
    else if startWhenReady{try? start()}
    else{resumeIfArmed()}                                          // relaunched while armed: re-arm without the UI
  }
  func centralManager(_ central:CBCentralManager,didDiscover peripheral:CBPeripheral,advertisementData:[String:Any],rssi RSSI:NSNumber){
    let id=peripheral.identifier
    found[id]=peripheral
    if RSSI.intValue != 127 {rssi[id]=RSSI.intValue}
    // peripheral.name is frequently nil/stale while scanning; the advertised local name is authoritative.
    let advertised=(advertisementData[CBAdvertisementDataLocalNameKey] as? String)?.trimmingCharacters(in:.whitespacesAndNewlines)
    if let n=advertised,!n.isEmpty{names[id]=n}else if names[id]==nil,let n=peripheral.name?.trimmingCharacters(in:.whitespacesAndNewlines),!n.isEmpty{names[id]=n}
  }
  func centralManager(_ central:CBCentralManager,willRestoreState dict:[String:Any]){if let p=(dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral])?.first{peripheral=p;p.delegate=self;error="Bluetooth state restored; verify recording continuity"}}
  func centralManager(_ central:CBCentralManager,didConnect peripheral:CBPeripheral){peripheral.discoverServices(nil)}
  func centralManager(_ central:CBCentralManager,didFailToConnect peripheral:CBPeripheral,error:Error?){connected=false;self.error="Connection failed";if recording{DispatchQueue.main.asyncAfter(deadline:.now()+5){if self.recording{central.connect(peripheral)}}};finishInspect("Could not connect to the adapter"+(error.map{": "+$0.localizedDescription} ?? ""),cancel:peripheral)}
  func centralManager(_ central:CBCentralManager,didDisconnectPeripheral peripheral:CBPeripheral,error:Error?){finishInspect("The adapter disconnected during inspection");connected=false;inFlight=nil;setLocation(active:false);self.error="Connection lost; measurements unavailable";if recording{DispatchQueue.main.asyncAfter(deadline:.now()+5){if self.recording{central.connect(peripheral)}}}}
  func peripheral(_ peripheral:CBPeripheral,didDiscoverServices error:Error?){guard error==nil else{self.error="Service discovery failed";finishInspect("Service discovery failed: "+(error?.localizedDescription ?? ""),cancel:peripheral);return};pendingServices=peripheral.services?.count ?? 0;if pendingServices==0{finishInspect("The adapter exposed no services",cancel:peripheral);return};for service in peripheral.services ?? []{peripheral.discoverCharacteristics(nil,for:service)}}
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
    if pendingServices==0{finishInspect(nil,cancel:peripheral)}
  }
  func peripheral(_ peripheral:CBPeripheral,didUpdateNotificationStateFor characteristic:CBCharacteristic,error:Error?){
    if error != nil || !characteristic.isNotifying{self.error="Adapter does not accept the selected notification characteristic";return}
    connected=true;lastObdAt=Date();setLocation(active:true);setup=ElmDecoder.setup;supported=[];inFlight=nil;buffer="";failures=0;self.error=nil
  }
  private func tick(){guard recording else{return};sync();pump()}
  /// Sends the next command only when none is in flight. Called by the 0.5 s watchdog timer and immediately after each reply, so polling is limited by the adapter instead of a fixed delay.
  private func pump(){
    guard recording,connected,let p=peripheral else{return}
    guard let write=writeCharacteristic else{error="Write characteristic not found on the adapter; re-select it on the Connect tab";return}
    if inFlight != nil {if Date().timeIntervalSince(sentAt)>8{inFlight=nil;buffer="";failures+=1;error="Diagnostic timeout; capture gap";if failures>=3{central.cancelPeripheralConnection(p)}};return}
    let command:String
    if !setup.isEmpty{command=setup.removeFirst()}else{
      let polls=ElmDecoder.pids.filter{supported.contains($0)}
      guard !polls.isEmpty else{error="No supported PIDs detected";return}
      // Speed and RPM drive trip detection, so they are polled every cycle; the remaining PIDs rotate in between.
      let fast=ElmDecoder.fastPids.filter{supported.contains($0)},slow=polls.filter{!fast.contains($0)}
      let n=pollIndex;pollIndex+=1
      let slot=n%(fast.count+1)
      let pid:String
      if !fast.isEmpty && (slot<fast.count || slow.isEmpty){pid=fast[slot % fast.count]}else{pid=slow[(n/(fast.count+1)) % slow.count]}
      command="01"+pid
    }
    guard ElmDecoder.allowed(command) else{return};inFlight=command;sentAt=Date()
    p.writeValue(Data((command+"\r").utf8),for:write,type:write.properties.contains(.write) ? .withResponse:.withoutResponse)
  }
  func peripheral(_ peripheral:CBPeripheral,didUpdateValueFor characteristic:CBCharacteristic,error:Error?){
    guard error==nil,let bytes=characteristic.value,let command=inFlight else{return}
    buffer+=String(data:bytes,encoding:.ascii) ?? ""
    guard buffer.count<=8192 else{buffer="";inFlight=nil;self.error="Malformed adapter response";return}
    guard buffer.contains(">") else{return};lastObdAt=Date();let frame=buffer.components(separatedBy:">")[0];buffer="";inFlight=nil;failures=0
    if ["0100","0120","0140"].contains(command){supported.formUnion(ElmDecoder.supported(frame,command:command))}
    for (signal,value,unit) in ElmDecoder.decode(frame,command:command){signals[signal]=value;if signal=="VEHICLE_SPEED"{trip.observe(time:Date().timeIntervalSince1970,speed:value,ignition:nil);trip.save()};do{try store.enqueue(signal:signal,value:value,unit:unit)}catch{self.error="Durable queue unavailable or full; recording stopped";stop();return}}
    DispatchQueue.main.asyncAfter(deadline:.now()+0.02){self.pump()}
  }
  func locationManager(_ manager:CLLocationManager,didUpdateLocations locations:[CLLocation]){
    // Only keep positions while the adapter is answering, so waiting for the car never records the phone wandering around.
    guard recording,connected || Date().timeIntervalSince(lastObdAt)<=20,let fix=locations.last else{return};let age=max(0,Date().timeIntervalSince(fix.timestamp))
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
