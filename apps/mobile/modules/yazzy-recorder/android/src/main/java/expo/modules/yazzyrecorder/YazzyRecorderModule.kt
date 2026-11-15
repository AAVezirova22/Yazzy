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
  OnCreate{appContext.reactContext?.let{c->if(RecorderManager.isArmed(c)&&RecorderSecret.read(c)!=null){try{val intent=Intent(c,RecordingService::class.java);if(Build.VERSION.SDK_INT>=26)c.startForegroundService(intent)else c.startService(intent)}catch(_:Exception){}}}}
  AsyncFunction("discover") Coroutine { -> val r=RecorderManager.get(appContext.reactContext!!);r.scan();delay(5000);r.stopScan();r.devices()}
  AsyncFunction("inspect") Coroutine {id:String->RecorderManager.get(appContext.reactContext!!).inspect(id)}
  AsyncFunction("configure"){json:String->val c=appContext.reactContext!!;val config=JSONObject(json);for(key in listOf("apiUrl","deviceId","assignmentId","deviceToken","peripheralId","serviceUuid","writeUuid","notifyUuid"))require(config.getString(key).isNotEmpty());val r=RecorderManager.get(c);check(!r.recording && r.store.count()==0){"Stop and upload queued samples before changing assignment"};RecorderSecret.save(c,json)}
  AsyncFunction("start"){val c=appContext.reactContext!!;val intent=Intent(c,RecordingService::class.java);if(Build.VERSION.SDK_INT>=26)c.startForegroundService(intent)else c.startService(intent)}
  AsyncFunction("stop"){val c=appContext.reactContext!!;RecorderManager.get(c).stop();c.stopService(Intent(c,RecordingService::class.java))}
  AsyncFunction("sync"){RecorderManager.get(appContext.reactContext!!).sync()}
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
 private var supported=mutableSetOf<String>()
 private var pollIndex=0
 private var inFlight:String?=null
 private var sentAt=0L
 private var buffer=""
 private var failures=0
 @Volatile private var lastObdAt=0L
 @Volatile private var syncing=false
 private var syncFailures=0
 private var nextSync=0L
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
 fun snapshot():Map<String,Any?> = mapOf("recording" to recording,"connected" to connected,"configured" to (RecorderSecret.read(context)!=null),"waitingForAdapter" to (recording&&!connected),"queued" to store.count(),"error" to error,"signals" to synchronized(signals){signals.toMap()},"qualification" to "PENDING_DEVICE_TEST","tripState" to trip.snapshot(System.currentTimeMillis()/1000.0))
 /** Arms the recorder: it connects to the saved adapter now, or whenever the adapter next powers on, until stopped. */
 fun start(){if(recording)return;config=RecorderSecret.read(context)?:error("Configure the recorder first");recording=true;error=null;armedPrefs.edit().putBoolean("armed",true).apply();handler.post{try{connect()}catch(e:SecurityException){error="Bluetooth permission needed: open the app and allow nearby devices";recording=false;return@post};handler.removeCallbacks(ticker);handler.post(ticker)}}
 // autoConnect keeps one passive connection request open, so the phone links up when the adapter powers on without scanning or draining the battery.
 private fun connect(){val c=config?:return;gatt?.close();gatt=adapter.getRemoteDevice(c.getString("peripheralId")).connectGatt(context,true,this,BluetoothDevice.TRANSPORT_LE)}
 // GPS only runs while the adapter answers, so waiting for the car costs no battery and never records the phone wandering around.
 private fun startLocation(){if(locating)return;try{location.requestLocationUpdates(LocationManager.GPS_PROVIDER,2000,3f,this,Looper.getMainLooper());locating=true}catch(e:SecurityException){error="Location permission needed: GPS not recorded"}catch(e:Exception){error="GPS unavailable; OBD capture continues"}}
 private fun stopLocation(){if(!locating)return;location.removeUpdates(this);locating=false}
 fun stop(){if(recording)try{store.enqueue("USER_STOP",1,"bool")}catch(_:Exception){};armedPrefs.edit().putBoolean("armed",false).apply();recording=false;connected=false;handler.removeCallbacks(ticker);stopLocation();gatt?.disconnect();gatt?.close();gatt=null;trip.stop(System.currentTimeMillis()/1000.0);tripPrefs.edit().clear().putString("state","CLOSED").apply();store.newSession();sync()}
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
 override fun onDescriptorWrite(g:BluetoothGatt,d:BluetoothGattDescriptor,status:Int){handler.post{if(status==BluetoothGatt.GATT_SUCCESS){connected=true;lastObdAt=SystemClock.elapsedRealtime();error=null;if(recording)startLocation();setup=ArrayDeque(ElmDecoder.setup);supported.clear();buffer="";inFlight=null;failures=0}else error="Notification subscription failed"}}
 override fun onCharacteristicChanged(g:BluetoothGatt,c:BluetoothGattCharacteristic){val bytes=c.value?.copyOf()?:return;handler.post{receive(bytes)}}
 private fun receive(bytes:ByteArray){val command=inFlight?:return;buffer+=bytes.toString(Charsets.US_ASCII);if(buffer.length>8192){buffer="";inFlight=null;error="Malformed adapter response";return};if(!buffer.contains('>'))return;val frame=buffer.substringBefore('>');buffer="";inFlight=null;failures=0;lastObdAt=SystemClock.elapsedRealtime()
  if(command in listOf("0100","0120","0140"))supported.addAll(ElmDecoder.supported(frame.replace('\r','\n'),command))
  for((signal,value,unit) in ElmDecoder.decode(frame.replace('\r','\n'),command)){synchronized(signals){signals[signal]=value};if(signal=="VEHICLE_SPEED"){trip.observe(System.currentTimeMillis()/1000.0,value,null);tripPrefs.edit().putString("state",trip.state).putString("start",trip.start?.toString()).putString("last",trip.last?.toString()).apply()};try{store.enqueue(signal,value,unit)}catch(_:Exception){error="Queue full; recording stopped";stop();return}}
  handler.postDelayed({poll()},20)
 }
 private val ticker=object:Runnable {override fun run(){if(!recording)return;sync();poll();handler.postDelayed(this,500)}}
 /** Sends the next command only when none is in flight. Called by the 0.5 s watchdog and straight after each reply. */
 private fun poll(){if(!recording||!connected)return
  val ch=writing?:run{error="Write characteristic not found on the adapter; re-select it on the Connect tab";return}
  if(inFlight!=null){if(SystemClock.elapsedRealtime()-sentAt>8000){inFlight=null;buffer="";failures++;error="Diagnostic timeout; capture gap";if(failures>=3)gatt?.disconnect()};return}
  val command=if(setup.isNotEmpty())setup.removeFirst()else{
   val polls=ElmDecoder.pids.filter{it in supported};if(polls.isEmpty()){error="No supported PIDs detected";return}
   // Speed and RPM drive trip detection, so they are polled every cycle; the remaining PIDs rotate in between.
   val fast=ElmDecoder.fastPids.filter{it in supported};val slow=polls.filter{it !in fast}
   val n=pollIndex++;val slot=n%(fast.size+1)
   "01"+(if(fast.isNotEmpty()&&(slot<fast.size||slow.isEmpty()))fast[slot%fast.size] else slow[(n/(fast.size+1))%slow.size])}
  if(!ElmDecoder.allowed(command))return;inFlight=command;sentAt=SystemClock.elapsedRealtime();ch.writeType=if(ch.properties and BluetoothGattCharacteristic.PROPERTY_WRITE!=0)BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;ch.value=(command+"\r").toByteArray(Charsets.US_ASCII);if(gatt?.writeCharacteristic(ch)!=true){inFlight=null;error="GATT write failed"}
 }
 override fun onLocationChanged(fix:Location){if(!recording||(!connected&&SystemClock.elapsedRealtime()-lastObdAt>20000))return;val age=(SystemClock.elapsedRealtimeNanos()-fix.elapsedRealtimeNanos)/1e9;val position=JSONObject().put("latitude",fix.latitude).put("longitude",fix.longitude).put("accuracy",fix.accuracy.toDouble()).put("fixAge",age.coerceAtLeast(0.0)).put("validFix",age<=10).put("provider","PHONE");try{store.enqueue("GPS",position,"deg")}catch(_:Exception){error="Queue full; recording stopped";stop()}}
 override fun onProviderDisabled(provider:String){error="GPS unavailable; OBD capture continues"}
 fun sync(){if(syncing||SystemClock.elapsedRealtime()<nextSync)return;val c=RecorderSecret.read(context)?:return;syncing=true;network.execute{try{val batch=store.batch(c);if(batch!=null){val url=URL(c.getString("apiUrl")+"/api/v1/telemetry/batches");require(url.protocol=="https"||url.host in listOf("localhost","10.0.2.2","127.0.0.1")||url.host.startsWith("192.168.")){"Use HTTPS for remote recording"};val connection=url.openConnection() as HttpURLConnection;try{connection.requestMethod="POST";connection.connectTimeout=10000;connection.readTimeout=20000;connection.doOutput=true;connection.setRequestProperty("Authorization","Device "+c.getString("deviceToken"));connection.setRequestProperty("Content-Type","application/json");connection.outputStream.use{it.write(batch.second.toByteArray())};check(connection.responseCode==202);val response=JSONObject(connection.inputStream.bufferedReader().use{it.readText()});check(response.optBoolean("accepted"));store.ack(batch.first);syncFailures=0;nextSync=0}catch(e:Exception){throw e}finally{connection.disconnect()}}}catch(_:Exception){syncFailures++;nextSync=SystemClock.elapsedRealtime()+min(300000.0,2.0.pow(min(syncFailures,8))*1000).toLong();error="Upload pending; queue retained"}finally{syncing=false}}}
}
