import {t,tp} from './i18n';

/**
 * What the app knows about OBD-II itself: the car report the recorder reads (SAE J1979 modes 01, 03, 07, 09, 0A),
 * how to tell petrol, diesel, hybrid and electric cars apart, and plain-language labels for codes and monitors.
 */
export type Monitor={id:string;complete:boolean};
export type CarProfile={
 readAt?:number;vin?:string;/** The car's own answer when it gave no VIN (for example NO DATA). */vinReply?:string;/** The owner typed the VIN. */vinManual?:boolean;/** Which mode 09 requests (01…20) the car offers; without 02 it cannot give its VIN over OBD. */mode09?:string[];ecus?:string[];protocol?:string;obdStandard?:number;fuelType?:number;ignition?:'SPARK'|'COMPRESSION';
 mil?:boolean;dtcCount?:number;readiness?:Monitor[];stored?:string[];pending?:string[];permanent?:string[];/** The car's own reply to the code requests (03, 07, 0A), kept so a code can be checked against another scanner. */codeReplies?:Record<string,string>;
 distanceSinceClearKm?:number;distanceWithMilKm?:number;warmupsSinceClear?:number;minutesWithMil?:number;minutesSinceClear?:number;
 odometerKm?:number;batteryVoltage?:number;supported?:string[];
 /** Production year from the engine ECU's manufacturing date (UDS 22 F18B / KWP 1A 8B), when the ECU tells it. */
 ecuYear?:number;
 /** Latest live values and when they were seen; added by the app. */
 signals?:Record<string,number>;signalsAt?:number;
 /** Where the car is: the last GPS fix taken while it moved or ran. */
 parked?:Spot|null;
 /** The type chosen by hand on the car page; wins over detection. */
 userKind?:Kind|null;
 /** Make, model and model year decoded from the VIN (components/vinCar.ts). */
 vinModel?:VinModel|null;
};
import type {VinModel} from './vinCar';
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
 const name=(k:Kind)=>t(KINDS.find(x=>x[0]===k)![1]);
 if(p?.userKind)return {kind:p.userKind,label:name(p.userKind),source:t('Set by you')};
 const fuel=p?.fuelType!=null?FUEL[p.fuelType]:undefined;
 if(fuel)return {kind:fuel[0],label:t(fuel[1]),source:t('Fuel type reported by the car')};
 if(p?.supported?.includes('5B'))return p.supported.includes('0C')?{kind:'HYBRID',label:t('Hybrid'),source:t('The car reports a hybrid battery')}:{kind:'ELECTRIC',label:t('Electric'),source:t('Battery reported, no engine speed')};
 if(p?.ecus?.some(e=>HYBRID_ECU.test(e)))return {kind:'HYBRID',label:t('Hybrid'),source:t('A hybrid control unit answered')};
 if(p?.ignition==='COMPRESSION')return {kind:'DIESEL',label:t('Diesel'),source:t('Engine type from the emission monitors')};
 if(p?.ignition==='SPARK')return {kind:'PETROL',label:t('Petrol'),source:t('Engine type from the emission monitors (a hybrid may also show as petrol)')};
 return {kind:null,label:t('Not read yet'),source:t('Start recording with the car on')};
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
 P0010:'Intake camshaft position actuator circuit (bank 1)',P0011:'Intake camshaft timing over-advanced (bank 1)',P0012:'Intake camshaft timing over-retarded (bank 1)',
 P0013:'Exhaust camshaft position actuator circuit (bank 1)',P0014:'Exhaust camshaft timing over-advanced (bank 1)',P0015:'Exhaust camshaft timing over-retarded (bank 1)',
 P0125:'Coolant too cold for closed-loop fuel control',P0170:'Fuel trim malfunction (bank 1)',P0173:'Fuel trim malfunction (bank 2)',P0217:'Engine over-temperature',P0230:'Fuel pump primary circuit',
 P0402:'EGR flow excessive',P0403:'EGR circuit',P0410:'Secondary air injection system',P0411:'Secondary air injection: incorrect flow',
 P0421:'Warm-up catalyst efficiency below threshold (bank 1)',P0441:'Evaporative emission system: incorrect purge flow',P0443:'Evaporative purge control valve circuit',
 P0446:'Evaporative vent control circuit',P0457:'Evaporative emission system leak (fuel cap loose or missing)',P0480:'Cooling fan 1 control circuit',P0510:'Closed throttle position switch',
 P0560:'System voltage',P0561:'System voltage unstable',P0601:'Control module memory checksum error',P0602:'Control module programming error',
 P0705:'Transmission range sensor circuit',P0715:'Input / turbine speed sensor circuit',P0720:'Output speed sensor circuit',P0730:'Incorrect gear ratio',P0740:'Torque converter clutch circuit',
 P2096:'Post-catalyst fuel trim too lean (bank 1)',P2097:'Post-catalyst fuel trim too rich (bank 1)',P2187:'System too lean at idle (bank 1)',P2188:'System too rich at idle (bank 1)',
 P2101:'Throttle actuator control motor circuit',P2106:'Throttle actuator: forced limited power',P2135:'Throttle position sensors A / B voltage correlation',P2138:'Pedal position sensors D / E voltage correlation',
 U0100:'Lost communication with engine control module',U0101:'Lost communication with transmission control module',U0121:'Lost communication with ABS control module',
};

const SYSTEM:Record<string,string>={P:'Powertrain',C:'Chassis',B:'Body',U:'Network'};
const AREA:Record<string,string>={'0':'Fuel, air and emission controls','1':'Fuel and air metering','2':'Fuel and air metering (injectors)','3':'Ignition system or misfire','4':'Auxiliary emission controls','5':'Speed, idle control and inputs','6':'Computer and output circuits','7':'Transmission','8':'Transmission','9':'Transmission','A':'Hybrid propulsion','B':'Hybrid propulsion','C':'Hybrid propulsion'};
// The standard code families (SAE J2012), built from parts so every part is translated once. A code outside every
// family and the list above is not described at all: guessing a meaning for a code is worse than saying it is unknown.
const FAULTS5=['circuit malfunction','range or performance problem','signal too low','signal too high','intermittent signal'];
const SENSORS:[number,string][]=[
 [100,'Mass air flow sensor'],[105,'Manifold pressure sensor'],[110,'Intake air temperature sensor'],[115,'Coolant temperature sensor'],
 [120,'Throttle position sensor A'],[190,'Fuel rail pressure sensor'],[220,'Throttle position sensor B'],[335,'Crankshaft position sensor A'],[340,'Camshaft position sensor A'],
];
const FAULTS6=['circuit malfunction','signal too low','signal too high','slow response','no activity detected','heater circuit'];
// [first code, bank, sensor]: six codes each, in the order of FAULTS6.
const OXYGEN:[number,number,number][]=[[130,1,1],[136,1,2],[142,1,3],[150,2,1],[156,2,2],[162,2,3]];
const KNOCK:[number,number][]=[[325,1],[330,2]];
const COIL='ABCDEFGHIJKL';

/** The meaning of a code from the list or its family, in the chosen language; null when the app does not know it. */
export function codeMeaning(code:string):string|null{
 const cylinder=/^P03(0[1-9]|1[0-2])$/.exec(code);
 if(cylinder)return t('Cylinder {n} misfire detected',{n:Number(cylinder[1])});
 if(CODES[code])return t(CODES[code]);
 if(!/^P0[0-9]{3}$/.test(code))return null;
 // The digits of these codes are decimal (P0139 is followed by P0140), so the arithmetic is decimal too.
 const n=Number(code.slice(1));
 for(const [first,part] of SENSORS)if(n>=first&&n<first+5)return `${t(part)}: ${t(FAULTS5[n-first])}`;
 for(const [first,bank,sensor] of OXYGEN)if(n>=first&&n<first+6)return `${t('Oxygen sensor')} (${t('bank {b}, sensor {s}',{b:bank,s:sensor})}): ${t(FAULTS6[n-first])}`;
 for(const [first,bank] of KNOCK)if(n>=first&&n<first+4)return `${t('Knock sensor')} (${t('bank {b}',{b:bank})}): ${t(FAULTS5[n-first])}`;
 if(n>=201&&n<=212)return t('Fuel injector circuit, cylinder {n}',{n:n-200});
 if(n>=351&&n<=362)return t('Ignition coil {l} circuit',{l:COIL[n-351]});
 return null;
}

export function describeCode(code:string){
 const known=codeMeaning(code);
 if(known)return known;
 const sys=t(SYSTEM[code[0]]||'Unknown system'),d=code[1],area=code[0]==='P'&&(d==='0'||d==='2')?AREA[code[2]]:null;
 const own=code[0]==='P'?d==='1'||(d==='3'&&code[2]<'4'):d==='1'||d==='2';
 return `${t("Not in Yazzy's list")} · ${sys}${area?` · ${t(area)}`:''}${own?` · ${t('manufacturer-specific code')}`:''}`;
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
export const readingText=([id,,unit,digits]:Reading,v:number)=>id==='RUN_TIME'?t('{m} min {s} s',{m:Math.floor(v/60),s:Math.round(v%60)}):`${v.toFixed(digits)} ${unit}`;

/** Resting 12 V lead-acid guide; above 13.2 V the alternator or hybrid system is charging it. */
export function battery12(v?:number|null){
 if(v==null)return null;
 return v>=13.2?{tone:'ok' as const,text:t('Charging')}:v>=12.4?{tone:'ok' as const,text:t('Good')}:v>=12?{tone:'warn' as const,text:t('Low: a longer drive or a charge helps')}:{tone:'error' as const,text:t('Weak: the car may not start')};
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
export const since=(at?:number)=>{if(!at)return t('never');const m=Math.round((Date.now()/1000-at)/60);return m<1?t('just now'):m<60?t('{n} min ago',{n:m}):m<1440?t('{n} h ago',{n:Math.round(m/60)}):tp(Math.round(m/1440),'{n} day ago','{n} days ago');};
