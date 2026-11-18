package expo.modules.yazzyrecorder

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.time.Instant
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class RecorderStore(context: Context): SQLiteOpenHelper(context,"yazzy.sqlite",null,1) {
 override fun onCreate(db:SQLiteDatabase){db.execSQL("CREATE TABLE samples(id INTEGER PRIMARY KEY AUTOINCREMENT,session TEXT NOT NULL,sequence INTEGER NOT NULL,json TEXT NOT NULL)");db.execSQL("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)");db.execSQL("CREATE TABLE pending(id TEXT PRIMARY KEY,session TEXT,maxseq INTEGER,payload TEXT)")}
 override fun onUpgrade(db:SQLiteDatabase,old:Int,new:Int){throw IllegalStateException("Recorder migration required")}
 init {setWriteAheadLoggingEnabled(true)}
 @Synchronized fun count():Int=readableDatabase.rawQuery("SELECT count(*) FROM samples",null).use{it.moveToFirst();it.getInt(0)}
 private fun meta(key:String):String?=readableDatabase.rawQuery("SELECT value FROM meta WHERE key=?",arrayOf(key)).use{if(it.moveToFirst())it.getString(0) else null}
 private fun putMeta(key:String,value:String){writableDatabase.execSQL("INSERT OR REPLACE INTO meta VALUES(?,?)",arrayOf(key,value))}
 @Synchronized fun newSession(){writableDatabase.delete("meta","key=?",arrayOf("session"))}
 @Synchronized fun enqueue(signal:String,value:Any,unit:String){
  check(count()<250000){"Durable queue full; recording paused without silent loss"}
  val db=writableDatabase;db.beginTransaction()
  try{val sid=meta("session")?:UUID.randomUUID().toString().also{putMeta("session",it)};val seq=(meta("sequence")?.toLong()?:0)+1
   val sample=JSONObject().put("sequence",seq).put("observedAt",Instant.now().toString()).put("monotonicMs",SystemClock.elapsedRealtime()).put("signal",signal).put("value",value).put("unit",unit).put("quality","VALID")
   val cv=ContentValues().apply{put("session",sid);put("sequence",seq);put("json",sample.toString())}
   db.insertOrThrow("samples",null,cv);putMeta("sequence",seq.toString());db.setTransactionSuccessful()
  }finally{db.endTransaction()}
 }
 /** The batch waiting for an answer, or a new one of up to limit readings from the oldest session. The server takes up to 1000. */
 @Synchronized fun batch(config:JSONObject,limit:Int=100):Pair<String,String>? {
  readableDatabase.rawQuery("SELECT id,payload FROM pending LIMIT 1",null).use{if(it.moveToFirst())return it.getString(0) to it.getString(1)}
  val sid=readableDatabase.rawQuery("SELECT session FROM samples ORDER BY id LIMIT 1",null).use{if(it.moveToFirst())it.getString(0) else return null}
  val samples=JSONArray();var min=0L;var max=0L
  readableDatabase.rawQuery("SELECT sequence,json FROM samples WHERE session=? ORDER BY id LIMIT ${limit.coerceIn(1,1000)}",arrayOf(sid)).use{while(it.moveToNext()){val seq=it.getLong(0);if(samples.length()==0)min=seq;max=seq;samples.put(JSONObject(it.getString(1)))}}
  val id=UUID.randomUUID().toString();val body=JSONObject().put("schemaVersion",1).put("batchId",id).put("deviceId",config.getString("deviceId")).put("assignmentId",config.getString("assignmentId")).put("sessionId",sid).put("sequenceStart",min).put("source","MOBILE_OBD").put("platform","ANDROID").put("decoderVersion","elm-v1").put("samples",samples).toString()
  writableDatabase.execSQL("INSERT INTO pending VALUES(?,?,?,?)",arrayOf(id,sid,max,body));return id to body
 }
 @Synchronized fun ack(id:String){val db=writableDatabase;db.beginTransaction();try{db.rawQuery("SELECT session,maxseq FROM pending WHERE id=?",arrayOf(id)).use{if(it.moveToFirst())db.delete("samples","session=? AND sequence<=?",arrayOf(it.getString(0),it.getString(1)))};db.delete("pending","id=?",arrayOf(id));db.setTransactionSuccessful()}finally{db.endTransaction()}}
}

object RecorderSecret {
 private fun key():SecretKey {val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)};if(store.containsAlias("yazzy-recorder"))return store.getKey("yazzy-recorder",null) as SecretKey
  return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{init(KeyGenParameterSpec.Builder("yazzy-recorder",KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())}.generateKey()}
 fun save(context:Context,json:String){val c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());val blob=c.iv+c.doFinal(json.toByteArray());check(context.getSharedPreferences("yazzy-secrets",Context.MODE_PRIVATE).edit().putString("config",Base64.encodeToString(blob,Base64.NO_WRAP)).commit())}
 fun read(context:Context):JSONObject? {val encoded=context.getSharedPreferences("yazzy-secrets",Context.MODE_PRIVATE).getString("config",null)?:return null;val bytes=Base64.decode(encoded,Base64.NO_WRAP);val c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,bytes.copyOfRange(0,12)));return JSONObject(String(c.doFinal(bytes.copyOfRange(12,bytes.size))))}
}
