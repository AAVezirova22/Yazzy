/**
 * What the app knows about OBD-II itself: the car report the recorder reads (SAE J1979 modes 01, 03, 07, 09, 0A),
 * how to tell petrol, diesel, hybrid and electric cars apart, and plain-language labels for codes and monitors.
 */
export type Monitor={id:string;complete:boolean};
export type CarProfile={
 readAt?:number;vin?:string;ecus?:string[];protocol?:string;obdStandard?:number;fuelType?:number;ignition?:'SPARK'|'COMPRESSION';
 mil?:boolean;dtcCount?:number;readiness?:Monitor[];stored?:string[];pending?:string[];permanent?:string[];
 distanceSinceClearKm?:number;distanceWithMilKm?:number;warmupsSinceClear?:number;minutesWithMil?:number;minutesSinceClear?:number;
 odometerKm?:number;batteryVoltage?:number;supported?:string[];
 /** Latest live values and when they were seen; added by the app. */
 signals?:Record<string,number>;signalsAt?:number;
 /** Where the car is: the last GPS fix taken while it moved or ran. */
 parked?:Spot|null;
 /** The type chosen by hand on the car page; wins over detection. */
 userKind?:Kind|null;
};
export type Spot={latitude:number;longitude:number;accuracy?:number;at:number};
export type Kind='HYBRID'|'PETROL'|'DIESEL'|'ELECTRIC'|'LPG';
export type Detection={kind:Kind|null;label:string;source:string};

export const KINDS:[Kind,string,string][]=[['PETROL','Petrol','flame'],['DIESEL','Diesel','water'],['HYBRID','Hybrid','leaf'],['ELECTRIC','Electric','flash'],['LPG','LPG','cloud']];
export const kindIcon=(k:Kind|null)=>KINDS.find(x=>x[0]===k)?.[2]||'help-circle';

// PID 51 fuel type coding.
const FUEL:Record<number,[Kind|null,string]>={
 1:['PETROL','Petrol'],2:['PETROL','Methanol'],3:['PETROL','Ethanol'],4:['DIESEL','Diesel'],5:['LPG','LPG'],6:[null,'CNG'],7:['LPG','Propane'],8:['ELECTRIC','Electric'],
 9:['PETROL','Bi-fuel, running on petrol'],10:['PETROL','Bi-fuel, running on methanol'],11:['PETROL','Bi-fuel, running on ethanol'],12:['LPG','Bi-fuel, running on LPG'],
 13:[null,'Bi-fuel, running on CNG'],14:['LPG','Bi-fuel, running on propane'],15:['ELECTRIC','Bi-fuel, running on electricity'],16:['HYBRID','Bi-fuel, electric and combustion engine'],
 17:['HYBRID','Hybrid, petrol'],18:['HYBRID','Hybrid, ethanol'],19:['HYBRID','Hybrid, diesel'],20:['HYBRID','Hybrid, electric'],21:['HYBRID','Hybrid, electric and combustion engine'],22:['HYBRID','Hybrid, regenerative'],23:['DIESEL','Bi-fuel, running on diesel'],
};
const HYBRID_ECU=/^(HPCM|BECM|HCU|HVECU)\b|hybrid/i;

/** The car's type, from the most direct evidence available. */
export function detect(p:CarProfile|null|undefined):Detection{
 const name=(k:Kind)=>KINDS.find(x=>x[0]===k)![1];
 if(p?.userKind)return {kind:p.userKind,label:name(p.userKind),source:'Set by you'};
 const fuel=p?.fuelType!=null?FUEL[p.fuelType]:undefined;
 if(fuel)return {kind:fuel[0],label:fuel[1],source:'Fuel type reported by the car'};
 if(p?.supported?.includes('5B'))return p.supported.includes('0C')?{kind:'HYBRID',label:'Hybrid',source:'The car reports a hybrid battery'}:{kind:'ELECTRIC',label:'Electric',source:'Battery reported, no engine speed'};
 if(p?.ecus?.some(e=>HYBRID_ECU.test(e)))return {kind:'HYBRID',label:'Hybrid',source:'A hybrid control unit answered'};
 if(p?.ignition==='COMPRESSION')return {kind:'DIESEL',label:'Diesel',source:'Engine type from the emission monitors'};
 if(p?.ignition==='SPARK')return {kind:'PETROL',label:'Petrol',source:'Engine type from the emission monitors (a hybrid may also show as petrol)'};
 return {kind:null,label:'Not read yet',source:'Start recording with the car on'};
}
/** The server's vehicle fields for a type. */
export function serverType(k:Kind,p?:CarProfile|null){
 return k==='HYBRID'?{powertrain:'HYBRID',fuelType:p?.fuelType===19?'DIESEL':'PETROL'}:k==='ELECTRIC'?{powertrain:'EV',fuelType:'ELECTRIC'}:{powertrain:'ICE',fuelType:k};
}

export const OBD_STANDARD:Record<number,string>={1:'OBD-II (California ARB)',2:'OBD (US EPA)',3:'OBD and OBD-II',4:'OBD-I',5:'Not OBD compliant',6:'EOBD (Europe)',7:'EOBD and OBD-II',8:'EOBD and OBD',9:'EOBD, OBD and OBD-II',10:'JOBD (Japan)',11:'JOBD and OBD-II',12:'JOBD and EOBD',13:'JOBD, EOBD and OBD-II'};
export const PROTOCOL:Record<string,string>={'1':'SAE J1850 PWM','2':'SAE J1850 VPW','3':'ISO 9141-2','4':'ISO 14230-4 KWP (slow init)','5':'ISO 14230-4 KWP (fast init)','6':'ISO 15765-4 CAN (11 bit, 500 kbit/s)','7':'ISO 15765-4 CAN (29 bit, 500 kbit/s)','8':'ISO 15765-4 CAN (11 bit, 250 kbit/s)','9':'ISO 15765-4 CAN (29 bit, 250 kbit/s)','A':'SAE J1939 CAN','B':'User CAN 1','C':'User CAN 2'};
export const MONITOR:Record<string,string>={
 MISFIRE:'Misfire',FUEL_SYSTEM:'Fuel system',COMPONENTS:'Comprehensive components',CATALYST:'Catalyst',HEATED_CATALYST:'Heated catalyst',EVAP:'Evaporative system',
 SECONDARY_AIR:'Secondary air',AC_REFRIGERANT:'A/C refrigerant',O2_SENSOR:'Oxygen sensors',O2_HEATER:'Oxygen sensor heaters',EGR:'EGR / variable valve timing',
 NMHC_CATALYST:'NMHC catalyst',NOX_SCR:'NOx / SCR aftertreatment',BOOST_PRESSURE:'Boost pressure',EXHAUST_SENSOR:'Exhaust gas sensors',PM_FILTER:'Particulate filter (DPF)',
};

// Well-known generic codes; anything else is described from the code's structure (SAE J2012).
const CODES:Record<string,string>={
 P0016:'Crankshaft / camshaft position correlation (bank 1, sensor A)',P0087:'Fuel rail / system pressure too low',P0088:'Fuel rail / system pressure too high',
 P0101:'Mass air flow sensor circuit range / performance',P0102:'Mass air flow sensor circuit low',P0103:'Mass air flow sensor circuit high',P0113:'Intake air temperature sensor 1 circuit high',
 P0117:'Coolant temperature sensor circuit low',P0118:'Coolant temperature sensor circuit high',P0128:'Coolant below thermostat regulating temperature',
 P0133:'Oxygen sensor slow response (bank 1, sensor 1)',P0135:'Oxygen sensor heater circuit (bank 1, sensor 1)',P0141:'Oxygen sensor heater circuit (bank 1, sensor 2)',
 P0171:'System too lean (bank 1)',P0172:'System too rich (bank 1)',P0174:'System too lean (bank 2)',P0175:'System too rich (bank 2)',
 P0234:'Turbo / supercharger overboost',P0299:'Turbo / supercharger underboost',P0300:'Random or multiple cylinder misfire detected',
 P0335:'Crankshaft position sensor A circuit',P0340:'Camshaft position sensor A circuit (bank 1)',P0401:'EGR flow insufficient',
 P0420:'Catalyst efficiency below threshold (bank 1)',P0430:'Catalyst efficiency below threshold (bank 2)',P0440:'Evaporative emission system malfunction',
 P0442:'Evaporative emission system: small leak',P0455:'Evaporative emission system: large leak',P0456:'Evaporative emission system: very small leak',
 P0500:'Vehicle speed sensor A',P0505:'Idle air control system',P0506:'Idle speed lower than expected',P0507:'Idle speed higher than expected',
 P0562:'System voltage low',P0563:'System voltage high',P0606:'Control module processor',P0700:'Transmission control system (lamp request)',
 P0A7F:'Hybrid battery pack deterioration',P0A80:'Replace hybrid battery pack',P2002:'Particulate filter efficiency below threshold (bank 1)',P2463:'Particulate filter soot accumulation',
 U0100:'Lost communication with engine control module',U0101:'Lost communication with transmission control module',U0121:'Lost communication with ABS control module',
};
for(let n=1;n<=8;n++)CODES[`P030${n}`]=`Cylinder ${n} misfire detected`;
const SYSTEM:Record<string,string>={P:'Powertrain',C:'Chassis',B:'Body',U:'Network'};
const AREA:Record<string,string>={'0':'Fuel, air and emission controls','1':'Fuel and air metering','2':'Fuel and air metering (injectors)','3':'Ignition system or misfire','4':'Auxiliary emission controls','5':'Speed, idle control and inputs','6':'Computer and output circuits','7':'Transmission','8':'Transmission','9':'Transmission','A':'Hybrid propulsion','B':'Hybrid propulsion','C':'Hybrid propulsion'};
export function describeCode(code:string){
 if(CODES[code])return CODES[code];
 const sys=SYSTEM[code[0]]||'Unknown system',d=code[1],area=code[0]==='P'&&(d==='0'||d==='2')?AREA[code[2]]:null;
 const own=code[0]==='P'?d==='1'||(d==='3'&&code[2]<'4'):d==='1'||d==='2';
 return `${sys}${area?` · ${area}`:''}${own?' · manufacturer-specific code':''}`;
}

const WMI:Record<string,string>={
 JT:'Toyota',JTH:'Lexus',JTJ:'Lexus',SB1:'Toyota',VNK:'Toyota',NMT:'Toyota',TMB:'Škoda',WVW:'Volkswagen',WV1:'Volkswagen',WV2:'Volkswagen',WAU:'Audi',TRU:'Audi',
 WBA:'BMW',WBS:'BMW',WMW:'MINI',WDD:'Mercedes-Benz',WDB:'Mercedes-Benz',W1K:'Mercedes-Benz',VF1:'Renault',VF3:'Peugeot',VF7:'Citroën',UU1:'Dacia',ZFA:'Fiat',ZAR:'Alfa Romeo',
 KMH:'Hyundai',TMA:'Hyundai',KNA:'Kia',KNE:'Kia',U5Y:'Kia',SAL:'Land Rover',SAJ:'Jaguar',YV1:'Volvo',VSS:'SEAT',W0L:'Opel',W0V:'Opel',WF0:'Ford','1FA':'Ford',
 JHM:'Honda',SHH:'Honda',JN1:'Nissan',SJN:'Nissan',VSK:'Nissan',JMZ:'Mazda',JF1:'Subaru',TSM:'Suzuki',JMB:'Mitsubishi','5YJ':'Tesla',LRW:'Tesla',XP7:'Tesla',WP0:'Porsche',WP1:'Porsche',
};
export const makerFromVin=(vin?:string)=>vin?WMI[vin.slice(0,3)]||WMI[vin.slice(0,2)]||null:null;

export type Reading=[id:string,label:string,unit:string,digits:number];
export const READINGS:Reading[]=[
 ['HYBRID_BATTERY','Hybrid battery charge','%',0],['ADAPTER_VOLTAGE','12 V battery','V',1],['MODULE_VOLTAGE','Control module voltage','V',1],
 ['COOLANT_TEMP','Coolant','°C',0],['OIL_TEMP','Engine oil','°C',0],['INTAKE_TEMP','Intake air','°C',0],['AMBIENT_TEMP','Outside air','°C',0],
 ['ENGINE_RPM','Engine speed','rpm',0],['VEHICLE_SPEED','Speed','km/h',0],['ENGINE_LOAD','Engine load','%',0],['THROTTLE','Throttle','%',0],['TIMING_ADVANCE','Ignition timing','°',1],
 ['MAF','Air flow','g/s',1],['INTAKE_PRESSURE','Intake manifold pressure','kPa',0],['BARO_PRESSURE','Barometric pressure','kPa',0],
 ['FUEL_LEVEL','Fuel level','%',0],['FUEL_RATE','Fuel rate','L/h',1],['FUEL_PRESSURE','Fuel pressure','kPa',0],['FUEL_RAIL_PRESSURE','Fuel rail pressure','kPa',0],
 ['SHORT_FUEL_TRIM','Short-term fuel trim','%',1],['LONG_FUEL_TRIM','Long-term fuel trim','%',1],['RUN_TIME','Running since start','s',0],['ODOMETER','Odometer','km',0],
];
export const readingText=([id,,unit,digits]:Reading,v:number)=>id==='RUN_TIME'?`${Math.floor(v/60)} min ${Math.round(v%60)} s`:`${v.toFixed(digits)} ${unit}`;

/** Resting 12 V lead-acid guide; above 13.2 V the alternator or hybrid system is charging it. */
export function battery12(v?:number|null){
 if(v==null)return null;
 return v>=13.2?{tone:'ok' as const,text:'Charging'}:v>=12.4?{tone:'ok' as const,text:'Good'}:v>=12?{tone:'warn' as const,text:'Low: a longer drive or a charge helps'}:{tone:'error' as const,text:'Weak: the car may not start'};
}
/** Boost over the outside air, from manifold and barometric pressure (turbo cars). */
export const boost=(s?:Record<string,number>)=>s?.INTAKE_PRESSURE!=null&&s?.BARO_PRESSURE!=null?s.INTAKE_PRESSURE-s.BARO_PRESSURE:null;
/** The car's last known spot: the recorder's parked fix, or the end of the newest trip when that is more recent. */
export function carSpot(p:CarProfile|null|undefined,trips:any[]|null|undefined):(Spot&{source:'recorder'|'trip'})|null{
 const last=(trips||[]).filter(t=>(t.metrics?.route||[]).length&&t.startAt!=null).reduce((a:any,t:any)=>!a||t.startAt>a.startAt?t:a,null);
 const end=last?last.metrics.route[last.metrics.route.length-1]:null;
 const trip=end?{latitude:end.latitude,longitude:end.longitude,accuracy:end.accuracy,at:last.endAt??end.time??last.startAt,source:'trip' as const}:null;
 const own=p?.parked&&Number.isFinite(p.parked.latitude)&&Number.isFinite(p.parked.longitude)?{...p.parked,source:'recorder' as const}:null;
 return own&&(!trip||own.at>=trip.at-60)?own:trip;
}
/** Great-circle distance in metres. */
export function metres(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){
 const r=Math.PI/180,dLat=(b.latitude-a.latitude)*r,dLon=(b.longitude-a.longitude)*r;
 const h=Math.sin(dLat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dLon/2)**2;
 return 2*6371000*Math.asin(Math.min(1,Math.sqrt(h)));
}
export const away=(m:number)=>m<1000?`${Math.round(m/10)*10} m`:`${(m/1000).toFixed(m<10000?1:0)} km`;
export const since=(t?:number)=>{if(!t)return 'never';const m=Math.round((Date.now()/1000-t)/60);return m<1?'just now':m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} days ago`;};
