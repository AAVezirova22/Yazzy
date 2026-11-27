import {codeMeaning} from './car';
import {t} from './i18n';

/** A fault code explained: what it means, what usually causes it, and what to do. Every part is translated. */
export type CodeDetail={what:string;causes?:string;advice?:string;note?:string};

/** A meaning dropped into the middle of a sentence starts in lower case, unless it opens with an acronym (EGR). */
const inline=(text:string)=>/^\p{Lu}\p{Ll}/u.test(text)?text.charAt(0).toLowerCase()+text.slice(1):text;
const num=(code:string)=>/^P0\d{3}$/.test(code)?Number(code.slice(1)):null;
const bank=(code:string)=>code==='P0171'||code==='P0172'?1:2;
const BANK_NOTE='Bank 1 is the side of the engine that holds cylinder 1; many four-cylinder engines have only bank 1.';
const ADVICE='Have a workshop check the car. Yazzy only reads the code; it cannot tell which of these causes applies.';

/**
 * The explanation for one code. The common codes have their own text; the rest are explained from their meaning, and a
 * code Yazzy does not know says so rather than guess. The text never names a part to buy and never says the car is safe.
 */
export function codeDetail(code:string):CodeDetail{
 const n=num(code),meaning=codeMeaning(code),advice=t(ADVICE);
 const b=bank(code);
 if(code==='P0171'||code==='P0174')return {what:t('The engine control module (ECM/PCM) has detected a lean condition on bank {b}: there is too much air, or too little fuel, in the air-fuel mixture.',{b})+' '+t(BANK_NOTE),
  causes:t('A vacuum or intake air leak, a dirty or faulty air flow (MAF) sensor, a weak fuel pump or clogged fuel filter, dirty injectors, an exhaust leak ahead of the oxygen sensor, or, on a car converted to LPG or CNG, a gas system that is not tuned correctly.'),advice};
 if(code==='P0172'||code==='P0175')return {what:t('The engine control module (ECM/PCM) has detected a rich condition on bank {b}: there is too much fuel, or too little air, in the air-fuel mixture.',{b})+' '+t(BANK_NOTE),
  causes:t('A leaking or stuck injector, too high fuel pressure, a clogged air filter, a faulty air flow (MAF), oxygen or coolant temperature sensor, a purge valve stuck open, or, on a car converted to LPG or CNG, a gas system that is not tuned correctly.'),advice};
 if(code==='P0420'||code==='P0430')return {what:t('The catalytic converter on bank {b} is not cleaning the exhaust as well as it should: the oxygen sensor behind it reads too much like the one in front of it.',{b:code==='P0420'?1:2})+' '+t(BANK_NOTE),
  causes:t('A worn-out catalytic converter, an exhaust leak, a faulty oxygen sensor, or engine problems such as misfires or a too lean or too rich mixture, which can damage the converter. Such problems are best fixed first.'),advice};
 if(code==='P0300')return {what:t('The engine control module (ECM/PCM) has detected misfires in several cylinders, or in changing cylinders: the mixture is not burning properly.'),
  causes:t('Worn spark plugs or ignition coils, a faulty injector, a vacuum leak, low fuel pressure, poor fuel, or low compression.'),
  advice:t('If the check engine light is flashing, the misfire is severe: drive gently and have the car checked soon, because unburnt fuel can damage the catalytic converter.')+' '+advice};
 const cylinder=/^P03(0[1-9]|1[0-2])$/.exec(code);
 if(cylinder)return {what:t('The engine control module (ECM/PCM) has detected misfires in cylinder {n}: the mixture in that cylinder is not burning properly.',{n:Number(cylinder[1])}),
  causes:t('Worn spark plugs or ignition coils, a faulty injector, a vacuum leak, low fuel pressure, poor fuel, or low compression.'),
  advice:t('If the check engine light is flashing, the misfire is severe: drive gently and have the car checked soon, because unburnt fuel can damage the catalytic converter.')+' '+advice};
 if(meaning&&n!=null&&n>=440&&n<=457)return {what:t('The fuel vapour (EVAP) system, which stops fuel fumes escaping from the tank, has a fault: {meaning}.',{meaning:inline(meaning)}),
  causes:t('Most often the fuel cap is loose, worn or the wrong one. Other causes are a cracked vapour hose or a faulty purge or vent valve.'),
  advice:t('It rarely changes how the car drives, but the light stays on and the car can fail an emissions inspection. Check that the fuel cap is closed tightly first.')};
 if(meaning&&n!=null&&n>=400&&n<=409)return {what:t('The exhaust gas recirculation (EGR) system, which feeds some exhaust back into the engine to reduce emissions, is not working as expected: {meaning}.',{meaning:inline(meaning)}),
  causes:t('Carbon clogging the EGR valve or passages, a faulty EGR valve or sensor, or a vacuum hose problem.'),advice};
 if(code==='P0128')return {what:t('The engine is warming up too slowly, or is not reaching its normal temperature.'),
  causes:t('A thermostat stuck open, a faulty coolant temperature sensor, or low coolant.'),advice};
 if(code==='P0016')return {what:t('The crankshaft and camshaft positions do not match as the engine control module expects.'),
  causes:t('A stretched timing chain or worn timing belt, or a faulty crankshaft or camshaft sensor.'),
  advice:t('Worn timing parts can damage the engine, so do not leave this for long.')+' '+advice};
 if(meaning&&n!=null&&n>=10&&n<=15)return {what:t('The variable valve timing system is not moving the camshaft as the engine control module commands: {meaning}.',{meaning:inline(meaning)}),
  causes:t('Low or dirty engine oil, a faulty timing solenoid, or a stretched timing chain.'),advice};
 if(meaning&&n!=null&&n>=505&&n<=507)return {what:t('The idle speed is not what the engine control module expects: {meaning}.',{meaning:inline(meaning)}),
  causes:t('A dirty throttle body or idle control valve, or a vacuum leak.'),advice};
 if(meaning&&n!=null&&n>=560&&n<=563)return {what:t('The system voltage is outside the range the engine control module expects: {meaning}.',{meaning:inline(meaning)}),
  causes:t('A weak battery, a failing alternator or charging system, or poor battery or ground connections.'),advice};
 if(/^U0/.test(code)&&meaning)return {what:t('A control unit in the car has lost contact with another one: {meaning}.',{meaning:inline(meaning)}),
  causes:t('Damaged wiring or connectors, a blown fuse, low battery voltage, or a faulty control unit.'),advice};
 if(meaning)return {what:t('The engine control module (ECM/PCM) has stored this fault: {meaning}.',{meaning:inline(meaning)}),
  causes:t('Usual reasons are a faulty part, damaged wiring or a loose connector.'),advice};
 return {what:t("Yazzy does not have an explanation for this code yet. Codes like this are often specific to the car's make; a workshop scanner or the manufacturer's code list will name it."),advice};
}
