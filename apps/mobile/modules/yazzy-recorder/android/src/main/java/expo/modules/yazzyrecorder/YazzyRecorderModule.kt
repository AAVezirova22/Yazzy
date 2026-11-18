package expo.modules.yazzyrecorder

import android.Manifest
import android.app.*
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.*
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.min
import kotlin.math.pow

class YazzyRecorderModule:Module(){
 override fun definition()=ModuleDefinition {
  Name("YazzyRecorder")
  // Re-arm after the app is opened again: the recorder keeps waiting for the adapter until it is stopped on purpose.
  // Otherwise finish uploading whatever an earlier recording left on the phone.
  OnCreate{appContext.reactContext?.let{c->if(RecorderManager.isArmed(c)&&RecorderSecret.read(c)!=null){try{val intent=Intent(c,RecordingService::class.java);if(Build.VERSION.SDK_INT>=26)c.startForegroundService(intent)else c.startService(intent)}catch(_:Exception){}}else try{val r=RecorderManager.get(c);if(r.store.count()>0)r.sync(true)}catch(_:Exception){}}}
  AsyncFunction("discover") Coroutine { -> val r=RecorderManager.get(appContext.reactContext!!);r.scan();delay(5000);r.stopScan();r.devices()}
  AsyncFunction("inspect") Coroutine {id:String->RecorderManager.get(appContext.reactContext!!).inspect(id)}
  AsyncFunction("configure"){json:String->val c=appContext.reactContext!!;val config=JSONObject(json);for(key in listOf("apiUrl","deviceId","assignmentId","deviceToken","peripheralId","serviceUuid","writeUuid","notifyUuid"))require(config.getString(key).isNotEmpty());val r=RecorderManager.get(c);check(!r.recording){"Stop recording before changing the adapter"}
   // Queued samples belong to the saved device and assignment, so only a change of those needs an empty queue; re-picking characteristics does not.
   val previous=RecorderSecret.read(c);val sameAssignment=previous!=null&&listOf("apiUrl","deviceId","assignmentId","deviceToken").all{previous.optString(it)==config.getString(it)}
   check(sameAssignment||r.store.count()==0){"Stop and upload queued samples before changing assignment"};RecorderSecret.save(c,json);if(!sameAssignment)r.resetProfile()}
  // startService returns a ComponentName, which cannot cross to JS; return nothing so the call resolves.
  AsyncFunction("start"){val c=appContext.reactContext!!;val intent=Intent(c,RecordingService::class.java);if(Build.VERSION.SDK_INT>=26)c.startForegroundService(intent)else c.startService(intent);Unit}
  AsyncFunction("stop"){val c=appContext.reactContext!!;RecorderManager.get(c).stop();c.stopService(Intent(c,RecordingService::class.java));Unit}
  AsyncFunction("sync"){RecorderManager.get(appContext.reactContext!!).sync(true)}
  AsyncFunction("snapshot"){RecorderManager.get(appContext.reactContext!!).snapshot()}
 }
}

class RecordingService:Service(){
 override fun onBind(intent:Intent?) :IBinder? =null
 override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
  if(intent?.action=="STOP"){RecorderManager.get(this).stop();stopSelf();return START_NOT_STICKY}
  val channel="yazzy-recording"
  if(Build.VERSION.SDK_INT>=26)getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(channel,"Vehicle recording",NotificationManager.IMPORTANCE_LOW))
  val stop=PendingIntent.getService(this,1,Intent(this,RecordingService::class.java).setAction("STOP"),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  val notification=Notification.Builder(this,channel).setContentTitle("Yazzy is recording your vehicle").setContentText("Read-only diagnostics. Tap Stop to end recording.").setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).addAction(Notification.Action.Builder(null,"Stop",stop).build()).build()
  startForeground(42,notification)
  try{RecorderManager.get(this).start()}catch(e:Exception){RecorderManager.get(this).error="Start failed: check Bluetooth and location permissions";stopSelf()}
  return START_STICKY
 }
 override fun onDestroy(){RecorderManager.get(this).stop();super.onDestroy()}
}

@Suppress("MissingPermission","DEPRECATION")
class RecorderManager private constructor(private val context:Context):BluetoothGattCallback(),LocationListener {
 companion object { fun isArmed(c:Context)=c.applicationContext.getSharedPreferences("yazzy-armed",Context.MODE_PRIVATE).getBoolean("armed",false); @Volatile private var instance:RecorderManager?=null; fun get(c:Context):RecorderManager=instance?:synchronized(this){instance?:RecorderManager(c.applicationContext).also{instance=it}} }
 val store=RecorderStore(context)
 private val handler=Handler(Looper.getMainLooper())
 private val network=Executors.newSingleThreadExecutor()
 private val manager=context.getSystemService(BluetoothManager::class.java)
 private val adapter get()=manager.adapter
 private val location=context.getSystemService(LocationManager::class.java)
 private val seen=mutableMapOf<String,ScanResult>()
 private val names=mutableMapOf<String,String>()
 private var gatt:BluetoothGatt?=null
 private var discovered=listOf<Map<String,Any>>()
 @Volatile private var inspecting:CompletableDeferred<List<Map<String,Any>>>?=null
 private var writing:BluetoothGattCharacteristic?=null
 private var config:JSONObject?=null
 @Volatile var recording=false
 @Volatile private var connected=false
 @Volatile var error:String?=null
 private val signals=mutableMapOf<String,Double>()
 private val armedPrefs=context.getSharedPreferences("yazzy-armed",Context.MODE_PRIVATE)
 @Volatile private var locating=false
 private val tripPrefs=context.getSharedPreferences("yazzy-trip-state",Context.MODE_PRIVATE)
 private val trip=TripState(state=tripPrefs.getString("state","IDLE")?:"IDLE",start=tripPrefs.getString("start",null)?.toDoubleOrNull(),last=tripPrefs.getString("last",null)?.toDoubleOrNull())
 private var setup=ArrayDeque<String>()
 // The car report: identification and diagnostics read once per connection, refreshed every 3 minutes, kept across restarts.
 private var identify=ArrayDeque<String>()
 private var nextReportAt=0L
 private val reportPrefs=context.getSharedPreferences("yazzy-car-profile",Context.MODE_PRIVATE)
 private var profile=runCatching{JSONObject(reportPrefs.getString("profile",null)?:"{}")}.getOrDefault(JSONObject())
 @Volatile private var profileJson:String?=reportPrefs.getString("profile",null)
 // Where the car is: the last GPS fix taken while the car was moving or its engine ran, so the phone is still inside it.
 // Fixes after that (car switched off, you walking away while Bluetooth still reaches) never move the spot.
 @Volatile private var parkedJson:String?=reportPrefs.getString("parked",null)
 @Volatile private var lastMovingAt=0L
 fun resetProfile(){handler.post{profile=JSONObject();profileJson=null;parkedJson=null;reportPrefs.edit().clear().apply()}}
 private var supported=mutableSetOf<String>()
 private var pollIndex=0
 private var inFlight:String?=null
 private var sentAt=0L
 private var buffer=""
 private var failures=0
 @Volatile private var answered=false
 @Volatile private var lastObdAt=0L
 @Volatile private var syncing=false
 @Volatile private var syncFailures=0
 @Volatile private var nextSync=0L
 @Volatile private var lastSyncAt=0L
 // Upload problems are kept apart from adapter errors so a successful upload can clear its own message.
 @Volatile var uploadError:String?=null
 private val retry=Runnable{sync()}
 private val scanCallback=object:ScanCallback(){override fun onScanResult(type:Int,result:ScanResult){synchronized(seen){seen[result.device.address]=result;
  // The advertised name needs no BLUETOOTH_CONNECT permission and often arrives only in the scan response, so remember it.
  val advertised=result.scanRecord?.deviceName?.trim();if(!advertised.isNullOrEmpty())names[result.device.address]=advertised}}}
 fun scan(){check(!recording);check(adapter?.isEnabled==true){"Enable Bluetooth"};synchronized(seen){seen.clear();names.clear()};adapter.bluetoothLeScanner.startScan(scanCallback)}
 fun stopScan(){adapter?.bluetoothLeScanner?.stopScan(scanCallback)}
 fun devices():List<Map<String,Any>> = synchronized(seen){seen.values.map{mapOf("id" to it.device.address,"name" to (names[it.device.address]?:runCatching{it.device.name}.getOrNull()?.trim()?:""),"rssi" to it.rssi)}}
 /** Connects, lists the adapter's characteristics and disconnects. Fails with a reason instead of returning an empty list. */
 suspend fun inspect(id:String):List<Map<String,Any>>{
  check(!recording){"Stop recording before inspecting an adapter"}
  check(adapter?.isEnabled==true){"Bluetooth is off or unavailable"}
  inspecting?.completeExceptionally(IllegalStateException("Superseded by a new inspection"))
  val result=CompletableDeferred<List<Map<String,Any>>>();inspecting=result;discovered=emptyList()
  handler.post{try{gatt?.close();gatt=adapter.getRemoteDevice(id).connectGatt(context,false,this,BluetoothDevice.TRANSPORT_LE)}catch(e:Exception){result.completeExceptionally(IllegalStateException("Adapter not found. Scan again and retry"))}}
  try{return withTimeout(15000){result.await()}}
  catch(e:TimeoutCancellationException){throw IllegalStateException("Timed out connecting to the adapter. Close other apps that may hold it (for example VgateFwUpdater), then retry")}
  finally{if(inspecting===result)inspecting=null;handler.post{if(!recording){gatt?.disconnect();gatt?.close();gatt=null}}}
 }
 fun snapshot():Map<String,Any?> = mapOf("recording" to recording,"connected" to connected,"configured" to (RecorderSecret.read(context)!=null),"waitingForAdapter" to (recording&&!connected),"queued" to store.count(),"error" to listOfNotNull(error,uploadError).joinToString("\n").ifEmpty{null},"signals" to synchronized(signals){signals.toMap()},"qualification" to "PENDING_DEVICE_TEST","tripState" to trip.snapshot(System.currentTimeMillis()/1000.0),"profile" to profileJson,"parked" to parkedJson)
 /** Arms the recorder: it connects to the saved adapter now, or whenever the adapter next powers on, until stopped. */
 fun start(){if(recording)return;config=RecorderSecret.read(context)?:error("Configure the recorder first");recording=true;error=null;armedPrefs.edit().putBoolean("armed",true).apply();handler.post{try{connect()}catch(e:SecurityException){error="Bluetooth permission needed: open the app and allow nearby devices";recording=false;return@post};handler.removeCallbacks(ticker);handler.post(ticker)}}
 // autoConnect keeps one passive connection request open, so the phone links up when the adapter powers on without scanning or draining the battery.
 private fun connect(){val c=config?:return;gatt?.close();gatt=adapter.getRemoteDevice(c.getString("peripheralId")).connectGatt(context,true,this,BluetoothDevice.TRANSPORT_LE)}
 // GPS only runs while the adapter answers, so waiting for the car costs no battery and never records the phone wandering around.
 private fun startLocation(){if(locating)return;try{location.requestLocationUpdates(LocationManager.GPS_PROVIDER,2000,3f,this,Looper.getMainLooper());locating=true}catch(e:SecurityException){error="Location permission needed: GPS not recorded"}catch(e:Exception){error="GPS unavailable; OBD capture continues"}}
 private fun stopLocation(){if(!locating)return;location.removeUpdates(this);locating=false}
 fun stop(){if(recording)try{store.enqueue("USER_STOP",1,"bool")}catch(_:Exception){};armedPrefs.edit().putBoolean("armed",false).apply();recording=false;connected=false;handler.removeCallbacks(ticker);stopLocation();gatt?.disconnect();gatt?.close();gatt=null;trip.stop(System.currentTimeMillis()/1000.0);tripPrefs.edit().clear().putString("state","CLOSED").apply();store.newSession();sync(true)}
 override fun onConnectionStateChange(g:BluetoothGatt,status:Int,newState:Int){handler.post{if(newState==BluetoothProfile.STATE_CONNECTED)g.discoverServices() else if(newState==BluetoothProfile.STATE_DISCONNECTED){inspecting?.completeExceptionally(IllegalStateException(if(status==BluetoothGatt.GATT_SUCCESS)"The adapter disconnected during inspection" else "Could not connect to the adapter (Bluetooth status $status)"));connected=false;inFlight=null;stopLocation();error="Bluetooth disconnected; observations unavailable";if(recording)handler.postDelayed({if(recording)connect()},5000)}}}
 override fun onServicesDiscovered(g:BluetoothGatt,status:Int){handler.post{
  if(status!=BluetoothGatt.GATT_SUCCESS){error="Service discovery failed";inspecting?.completeExceptionally(IllegalStateException("Service discovery failed (Bluetooth status $status)"));return@post}
  discovered=g.services.flatMap{s->s.characteristics.map{c->mapOf("service" to s.uuid.toString(),"uuid" to c.uuid.toString(),"write" to (c.properties and (BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)!=0),"notify" to (c.properties and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE)!=0))}}
  if(!recording){if(discovered.isEmpty())inspecting?.completeExceptionally(IllegalStateException("The adapter exposed no characteristics")) else inspecting?.complete(discovered);g.disconnect();return@post}
  val c=config?:return@post;val service=g.getService(UUID.fromString(c.getString("serviceUuid")))
  writing=service?.getCharacteristic(UUID.fromString(c.getString("writeUuid")))
  val notify=service?.getCharacteristic(UUID.fromString(c.getString("notifyUuid")))
  if(writing==null||notify==null){error="Selected GATT characteristics are unavailable";return@post}
  g.setCharacteristicNotification(notify,true)
  val descriptor=notify.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))
  if(descriptor==null){error="Notification descriptor missing";return@post}
  descriptor.value=if(notify.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY!=0)BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE else BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
  g.writeDescriptor(descriptor)
 }}
 override fun onDescriptorWrite(g:BluetoothGatt,d:BluetoothGattDescriptor,status:Int){handler.post{if(status==BluetoothGatt.GATT_SUCCESS){connected=true;lastObdAt=SystemClock.elapsedRealtime();error=null;if(recording)startLocation();setup=ArrayDeque(ElmDecoder.setup);identify.clear();nextReportAt=0L;supported.clear();buffer="";inFlight=null;failures=0;answered=false}else error="Notification subscription failed"}}
 override fun onCharacteristicChanged(g:BluetoothGatt,c:BluetoothGattCharacteristic){val bytes=c.value?.copyOf()?:return;handler.post{receive(bytes)}}
 private fun receive(bytes:ByteArray){val command=inFlight?:return;buffer+=bytes.toString(Charsets.US_ASCII);if(buffer.length>8192){buffer="";inFlight=null;error="Malformed adapter response";return};if(!buffer.contains('>'))return;val frame=buffer.substringBefore('>');buffer="";inFlight=null;failures=0;answered=true;lastObdAt=SystemClock.elapsedRealtime()
  if(command in ElmDecoder.setup&&command.startsWith("01"))supported.addAll(ElmDecoder.supported(frame.replace('\r','\n'),command))
  if(ElmDecoder.isReport(command))try{
   ElmDecoder.profile(frame,command,profile)
   if(command=="ATRV"&&profile.has("batteryVoltage"))synchronized(signals){signals["ADAPTER_VOLTAGE"]=profile.getDouble("batteryVoltage")}
   profile.put("readAt",System.currentTimeMillis()/1000.0).put("supported",org.json.JSONArray(supported.sorted()))
   profileJson=profile.toString();reportPrefs.edit().putString("profile",profileJson).apply()
  }catch(_:Exception){/* a malformed reply only leaves that line of the report empty */}
  for((signal,value,unit) in ElmDecoder.decode(frame.replace('\r','\n'),command)){synchronized(signals){signals[signal]=value};if((signal=="VEHICLE_SPEED"||signal=="ENGINE_RPM")&&value>0)lastMovingAt=SystemClock.elapsedRealtime();if(signal !in ElmDecoder.uploaded)continue;if(signal=="VEHICLE_SPEED"){trip.observe(System.currentTimeMillis()/1000.0,value,null);tripPrefs.edit().putString("state",trip.state).putString("start",trip.start?.toString()).putString("last",trip.last?.toString()).apply()};try{store.enqueue(signal,value,unit)}catch(_:Exception){error="Queue full; recording stopped";stop();return}}
  handler.postDelayed({poll()},20)
 }
 // Uploads go out every 5 s while recording: each one empties the queue, and fewer, larger batches keep a small server responsive.
 private val ticker=object:Runnable {override fun run(){if(!recording)return;if(SystemClock.elapsedRealtime()-lastSyncAt>=5000)sync();poll();handler.postDelayed(this,500)}}
 /** Sends the next command only when none is in flight. Called by the 0.5 s watchdog and straight after each reply. */
 private fun poll(){if(!recording||!connected)return
  val ch=writing?:run{error="Write characteristic not found on the adapter; re-select it on the Connect tab";return}
  if(inFlight!=null){if(SystemClock.elapsedRealtime()-sentAt>8000){inFlight=null;buffer="";failures++;error=if(answered)"Diagnostic timeout; capture gap" else "Adapter not answering on this channel. Stop, then pick the recommended write/notify pair on Drive › Adapter";if(failures>=3)gatt?.disconnect()};return}
  if(setup.isEmpty()&&identify.isEmpty()&&supported.isNotEmpty()&&SystemClock.elapsedRealtime()>=nextReportAt){identify=ArrayDeque(ElmDecoder.identify(supported,full=nextReportAt==0L));nextReportAt=SystemClock.elapsedRealtime()+180000}
  val command=if(setup.isNotEmpty())setup.removeFirst()else if(identify.isNotEmpty())identify.removeFirst()else{
   val polls=ElmDecoder.pids.filter{it in supported};if(polls.isEmpty()){error="No supported PIDs detected";return}
   // Speed and RPM drive trip detection, so they are polled every cycle; the remaining PIDs rotate in between.
   val fast=ElmDecoder.fastPids.filter{it in supported};val slow=polls.filter{it !in fast}
   val n=pollIndex++;val slot=n%(fast.size+1)
   "01"+(if(fast.isNotEmpty()&&(slot<fast.size||slow.isEmpty()))fast[slot%fast.size] else slow[(n/(fast.size+1))%slow.size])}
  if(!ElmDecoder.allowed(command))return;inFlight=command;sentAt=SystemClock.elapsedRealtime();ch.writeType=if(ch.properties and BluetoothGattCharacteristic.PROPERTY_WRITE!=0)BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;ch.value=(command+"\r").toByteArray(Charsets.US_ASCII);if(gatt?.writeCharacteristic(ch)!=true){inFlight=null;error="GATT write failed"}
 }
 override fun onLocationChanged(fix:Location){if(!recording||(!connected&&SystemClock.elapsedRealtime()-lastObdAt>20000))return;val age=(SystemClock.elapsedRealtimeNanos()-fix.elapsedRealtimeNanos)/1e9
  if(age<=10&&fix.accuracy<=100&&SystemClock.elapsedRealtime()-lastMovingAt<=15000){parkedJson=JSONObject().put("latitude",fix.latitude).put("longitude",fix.longitude).put("accuracy",fix.accuracy.toDouble()).put("at",System.currentTimeMillis()/1000.0).toString();reportPrefs.edit().putString("parked",parkedJson).apply()}
 val position=JSONObject().put("latitude",fix.latitude).put("longitude",fix.longitude).put("accuracy",fix.accuracy.toDouble()).put("fixAge",age.coerceAtLeast(0.0)).put("validFix",age<=10).put("provider","PHONE");try{store.enqueue("GPS",position,"deg")}catch(_:Exception){error="Queue full; recording stopped";stop()}}
 override fun onProviderDisabled(provider:String){error="GPS unavailable; OBD capture continues"}
 /**
  * Uploads queued readings batch after batch until the queue is empty. Runs every 5 s while recording, straight
  * after a stop and when the app opens; after a failure it retries with backoff, also when nothing is recording,
  * so a finished drive always reaches the server. force skips the backoff (Upload now, stop, app start).
  */
 fun sync(force:Boolean=false){
  if(syncing||(!force&&SystemClock.elapsedRealtime()<nextSync))return
  val c=RecorderSecret.read(context)?:return
  syncing=true;lastSyncAt=SystemClock.elapsedRealtime();handler.removeCallbacks(retry)
  network.execute{
   try{
    while(true){
     val (id,body)=store.batch(c,500)?:break
     val (code,answer)=post(c,body)
     if(code==202&&runCatching{JSONObject(answer).optBoolean("accepted")}.getOrDefault(false)){store.ack(id);syncFailures=0;nextSync=0;uploadError=null}
     // 409 and 422 are final for this exact batch: resending it can never succeed and would block every reading queued behind it.
     else if(code==409||code==422){val n=runCatching{JSONObject(body).getJSONArray("samples").length()}.getOrDefault(0);store.ack(id);uploadError="Skipped $n readings the server cannot accept (${reason(code,answer)})"}
     else throw IllegalStateException("Server refused the upload (${reason(code,answer)})")
     // While recording, new readings keep arriving: leave a part-batch for the next round instead of a stream of tiny uploads.
     if(recording&&store.count()<500)break
    }
   }catch(e:Exception){
    syncFailures++;val wait=min(300000.0,2.0.pow(min(syncFailures,8))*1000).toLong();nextSync=SystemClock.elapsedRealtime()+wait
    uploadError=when(e){is java.net.SocketTimeoutException->"Upload timed out: the server is busy or waking up";is java.io.IOException->"Upload waiting for an internet connection";else->e.message?:"Upload failed"}+". Readings stay on the phone and are retried automatically."
    if(!recording)handler.postDelayed(retry,wait)
   }finally{syncing=false}
  }
 }
 private fun post(c:JSONObject,body:String):Pair<Int,String>{
  val url=URL(c.getString("apiUrl")+"/api/v1/telemetry/batches");require(url.protocol=="https"||url.host in listOf("localhost","10.0.2.2","127.0.0.1")||url.host.startsWith("192.168.")){"Use HTTPS for remote recording"}
  val connection=url.openConnection() as HttpURLConnection
  try{
   // A free host can take most of a minute to wake up, so wait for its answer rather than retrying into the same delay.
   connection.requestMethod="POST";connection.connectTimeout=15000;connection.readTimeout=60000;connection.doOutput=true
   connection.setRequestProperty("Authorization","Device "+c.getString("deviceToken"));connection.setRequestProperty("Content-Type","application/json")
   connection.outputStream.use{it.write(body.toByteArray())}
   val code=connection.responseCode
   return code to ((if(code<400)connection.inputStream else connection.errorStream)?.bufferedReader()?.use{it.readText()}?:"")
  }finally{connection.disconnect()}
 }
 /** The server's error code (for example DEVICE_REVOKED_OR_UNKNOWN) and HTTP status, so an upload problem can be diagnosed from a screenshot. */
 private fun reason(code:Int,answer:String):String{
  val detail=runCatching{JSONObject(answer).opt("detail")}.getOrNull()
  val name=(detail as? JSONObject)?.optString("code").orEmpty().ifEmpty{if(detail is org.json.JSONArray)"INVALID_READINGS" else ""}
  return if(name.isEmpty())"HTTP $code" else "$name, HTTP $code"
 }
}
