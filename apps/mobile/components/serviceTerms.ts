import {getLang,type Lang} from './i18n';

/**
 * Service names in the three languages. What the owner types stays as typed (a record is never rewritten); it is only
 * shown in the reader's language, and only when every word of it is a known term (numbers like 5W-30 and joiners like
 * commas pass through). Anything else, "Oil change at Bosch" for instance, is shown exactly as written.
 * The same glossary lives in backend/src/yazzy/modules/advisor/language.py; keep the two in step.
 */
const TERMS:[string[],string,string][]=[
 [['Oil change'],'Смяна на масло','Замена масла'],
 [['Engine oil change'],'Смяна на моторно масло','Замена моторного масла'],
 [['Engine oil'],'Моторно масло','Моторное масло'],
 [['Oil filter'],'Маслен филтър','Масляный фильтр'],
 [['Air filter'],'Въздушен филтър','Воздушный фильтр'],
 [['Cabin filter'],'Поленов филтър','Салонный фильтр'],
 [['Fuel filter'],'Горивен филтър','Топливный фильтр'],
 [['Brake pads'],'Спирачни накладки','Тормозные колодки'],
 [['Brake discs','Brake disks'],'Спирачни дискове','Тормозные диски'],
 [['Brake fluid'],'Спирачна течност','Тормозная жидкость'],
 [['Tyres','Tires'],'Гуми','Шины'],
 [['Tyre change','Tire change'],'Смяна на гуми','Замена шин'],
 [['Tyre rotation','Tire rotation'],'Размяна на гуми','Перестановка шин'],
 [['Wheel alignment'],'Геометрия на колелата','Развал-схождение'],
 [['Battery'],'Акумулатор','Аккумулятор'],
 [['Coolant'],'Охлаждаща течност','Охлаждающая жидкость'],
 [['Timing belt'],'Ангренажен ремък','Ремень ГРМ'],
 [['Spark plugs'],'Свещи','Свечи'],
 [['Wipers'],'Чистачки','Дворники'],
 [['Transmission oil','Gearbox oil'],'Масло за скоростна кутия','Масло в коробке передач'],
 [['Repair'],'Ремонт','Ремонт'],
 [['Inspection'],'Проверка','Осмотр'],
 [['Technical inspection'],'Технически преглед','Технический осмотр'],
 [['Service'],'Обслужване','Обслуживание'],
 [['Full service'],'Пълно обслужване','Полное обслуживание'],
 [['Maintenance'],'Поддръжка','Обслуживание'],
 [['Work order'],'Работна поръчка','Заказ-наряд'],
 [['Appointment'],'Час','Запись'],
 [['Review recorded evidence with a technician'],'Преглед на записаните данни с техник','Просмотр записанных данных с техником'],
];

type Forms=Record<Lang,string>;
const LOOKUP=new Map<string,Forms>();
for(const [en,bg,ru] of TERMS){
 const forms:Forms={en:en[0],bg,ru};
 for(const variant of [...en,bg,ru])if(!LOOKUP.has(variant.toLowerCase()))LOOKUP.set(variant.toLowerCase(),forms);
}
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// A term must stand on its own: not inside a longer word. Longer terms are tried first ("Engine oil change" before "Oil change").
const TERM=new RegExp('(^|[^\\p{L}])('+[...LOOKUP.keys()].sort((a,b)=>b.length-a.length).map(escape).join('|')+')(?![\\p{L}])','giu');
const JOINER=/(^|[^\p{L}])(?:and|и)(?![\p{L}])/giu;

/** A service description in the chosen language when it is made only of known terms; otherwise exactly as written. */
export function localizeService(text:string|null|undefined,lang:Lang=getLang()):string{
 if(!text)return text||'';
 // "Inspection: brake noise" (a task the advisor prepared): the label is translated, the owner's details are kept.
 const colon=text.indexOf(': ');
 if(colon>0){const head=localizeService(text.slice(0,colon),lang);if(head!==text.slice(0,colon))return head+text.slice(colon);}
 const rest=text.replace(TERM,'$1').replace(JOINER,'$1').replace(/[\s,;+&/.\-–]+/g,'').replace(/[\p{L}\p{N}-]*\p{N}[\p{L}\p{N}-]*/gu,'');
 if(rest||!TERM.test(text)){TERM.lastIndex=0;return text;}
 TERM.lastIndex=0;
 const out=text.replace(TERM,(_m,before:string,found:string)=>{
  const word=LOOKUP.get(found.toLowerCase())?.[lang]||found,first=word.charAt(0);
  return before+(found.charAt(0)!==found.charAt(0).toLowerCase()?first.toUpperCase():first.toLowerCase())+word.slice(1);
 });
 return out.replace(JOINER,(_m,before:string)=>before+(lang==='en'?'and':'и'));
}
