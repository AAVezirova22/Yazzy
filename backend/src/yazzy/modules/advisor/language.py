"""The advisor's languages: English, Bulgarian and Russian.

The advisor answers in the language the question was asked in. Cyrillic means Bulgarian or Russian (the app's own
language, sent with the question, settles which when the letters do not); anything else is English. The service names
the owner types ("Oil change") are shown in the reader's language when every word of them is a known term.
"""

import re

LANGS = ("en", "bg", "ru")

CYRILLIC = re.compile(r"[Ѐ-ӿ]")
RUSSIAN_ONLY = re.compile(r"[ыэёЫЭЁ]")
RUSSIAN_WORDS = re.compile(
    r"\b(?:что|когда|мне|нужно|пожалуйста|обслуживани\w*|следующ\w*|предстоит|сколько|есть|какой|сервис\w*)\b"
)
BULGARIAN_WORDS = re.compile(
    r"\b(?:кога|какво|трябва|моля|следващ\w*|предстои\w*|обслужван\w*|сервиз\w*|колко|ми|има|какъв|поддръжк\w*)\b"
)


def detect_language(message: str, hint: str | None = None) -> str:
    """ "en", "bg" or "ru" for the reply to this message.

    Latin letters mean English. Between the two Cyrillic languages the question itself decides: letters only Russian
    uses, then the words it is made of. The app's language only breaks a tie.
    """
    if not CYRILLIC.search(message):
        return "en"
    if RUSSIAN_ONLY.search(message):
        return "ru"
    text = message.lower()
    russian, bulgarian = len(RUSSIAN_WORDS.findall(text)), len(BULGARIAN_WORDS.findall(text))
    if russian != bulgarian:
        return "ru" if russian > bulgarian else "bg"
    return hint if hint in ("bg", "ru") else "bg"


MESSAGES: dict[str, dict[str, str]] = {
    "refusal": {
        "en": "Vehicle write commands, arbitrary code and access to other organisations are unavailable.",
        "bg": "Командите за запис в автомобила, произволният код и достъпът до други организации не са налични.",
        "ru": "Команды записи в автомобиль, произвольный код и доступ к другим организациям недоступны.",
    },
    "history_pointer": {
        "en": "Past services are kept in Health › Service. Tap Add service record there and enter what was done, the date, the price and the kilometres, and Yazzy will remind you when it is due again.",
        "bg": "Миналите обслужвания се пазят в Състояние › Сервиз. Натиснете там „Добави обслужване“ и въведете какво е направено, датата, цената и километрите — Yazzy ще ви напомни, когато е време отново.",
        "ru": "Прошлые обслуживания хранятся в разделе Состояние › Обслуживание. Нажмите там «Добавить обслуживание» и введите, что было сделано, дату, цену и пробег — Yazzy напомнит, когда снова пора.",
    },
    "confirm": {
        "en": "Review and confirm this task: {title}. No appointment has been booked.",
        "bg": "Прегледайте и потвърдете задачата: {title}. Не е записан час.",
        "ru": "Проверьте и подтвердите задачу: {title}. Запись не оформлена.",
    },
    "default_title": {
        "en": "Review recorded evidence with a technician",
        "bg": "Преглед на записаните данни с техник",
        "ru": "Просмотр записанных данных с техником",
    },
    "simulated": {
        "en": "These readings are simulated. ",
        "bg": "Тези показания са симулирани. ",
        "ru": "Эти показания имитированы. ",
    },
    "fuel": {
        "en": "This report covers recorded sessions. Consumption and purchases are separate; gaps are not counted as zero fuel. No cause or failure probability is inferred.",
        "bg": "Отчетът обхваща записаните сесии. Разходът и зареждането са отделни; липсите не се броят за нулев разход. Не се предполага причина или вероятност за повреда.",
        "ru": "Отчёт охватывает записанные сессии. Расход и заправки учитываются отдельно; пропуски не считаются нулевым расходом. Причина и вероятность неисправности не предполагаются.",
    },
    "no_data": {
        "en": "No car data has been collected yet. Connect and qualify your adapter, or explore the separate demo fleet. Real-car predictions are unavailable.",
        "bg": "Все още не са събрани данни за автомобила. Свържете и квалифицирайте адаптера или разгледайте отделния демо парк. Прогнози за реален автомобил не са налични.",
        "ru": "Данные об автомобиле ещё не собраны. Подключите и квалифицируйте адаптер или посмотрите отдельный демо-парк. Прогнозы для реального автомобиля недоступны.",
    },
    "finding_tail": {
        "en": " This is a trend, not a confirmed failed component. Review the evidence with a qualified technician.",
        "bg": " Това е тенденция, а не потвърдена повредена част. Прегледайте данните с квалифициран техник.",
        "ru": " Это тенденция, а не подтверждённая неисправная деталь. Покажите данные квалифицированному специалисту.",
    },
    "nothing_recorded": {
        "en": "No supported persistent change is currently recorded. This does not establish that the vehicle is healthy or safe to drive. More comparable drives may be needed.",
        "bg": "В момента не е записана устойчива промяна. Това не доказва, че автомобилът е изправен или безопасен за шофиране. Може да са нужни повече сравними пътувания.",
        "ru": "Сейчас устойчивых изменений не записано. Это не доказывает, что автомобиль исправен или безопасен. Возможно, нужно больше сопоставимых поездок.",
    },
    "svc_none": {
        "en": "No services are recorded for this car yet. Open Health › Service and tap Add service: enter what was done, the date, the price and the kilometres, and choose a reminder (for example 10 000 km). Then I can tell you what is due.",
        "bg": "За този автомобил още няма записани обслужвания. Отворете Състояние › Сервиз, натиснете „Добави обслужване“, въведете какво е направено, датата, цената и километрите и изберете напомняне (например 10 000 км). Тогава ще мога да ви кажа какво предстои.",
        "ru": "Для этого автомобиля обслуживаний пока не записано. Откройте Состояние › Обслуживание, нажмите «Добавить обслуживание», введите, что сделано, дату, цену и пробег, и выберите напоминание (например, 10 000 км). Тогда я смогу сказать, что предстоит.",
    },
    "svc_due_next": {"en": "Due next:", "bg": "Предстои:", "ru": "Предстоит:"},
    "svc_due_at": {
        "en": "due at {due}",
        "bg": "срок при {due}",
        "ru": "срок при {due}",
    },
    "svc_overdue": {
        "en": "overdue by {over} (was due at {due})",
        "bg": "просрочено с {over} (срокът беше при {due})",
        "ru": "просрочено на {over} (срок был при {due})",
    },
    "svc_in": {
        "en": "in {left} (at {due})",
        "bg": "след {left} (при {due})",
        "ru": "через {left} (при {due})",
    },
    "svc_current": {
        "en": "Current kilometres: {km}.",
        "bg": "Текущи километри: {km}.",
        "ru": "Текущий пробег: {km}.",
    },
    "svc_current_estimated": {
        "en": "Current kilometres: about {km}, estimated from your last entry and the drives since.",
        "bg": "Текущи километри: около {km}, изчислени по последния запис и пътуванията след него.",
        "ru": "Текущий пробег: около {km}, рассчитан по последней записи и поездкам после неё.",
    },
    "svc_km_unknown": {
        "en": "The car's current kilometres are unknown, so the distance left cannot be worked out.",
        "bg": "Текущите километри на автомобила не са известни, затова не мога да изчисля оставащото разстояние.",
        "ru": "Текущий пробег автомобиля неизвестен, поэтому оставшееся расстояние рассчитать нельзя.",
    },
    "svc_no_reminder_for": {
        "en": "No service reminder is open for this.",
        "bg": "Няма отворено напомняне за това.",
        "ru": "Для этого нет открытых напоминаний.",
    },
    "svc_no_reminders": {
        "en": "No service reminders are open. Choose Remind me after when you add a service to get one.",
        "bg": "Няма отворени напомняния за обслужване. Изберете „Напомни след“ при добавяне на обслужване, за да получите такова.",
        "ru": "Открытых напоминаний об обслуживании нет. Выберите «Напомнить через» при добавлении обслуживания, чтобы получить его.",
    },
    "svc_last": {"en": "Last recorded:", "bg": "Последно записано:", "ru": "Последняя запись:"},
    "svc_at": {"en": " at {km}", "bg": " при {km}", "ru": " при {km}"},
}

UNIT = {"en": "km", "bg": "км", "ru": "км"}


def say(key: str, lang: str, **values) -> str:
    text = MESSAGES[key].get(lang) or MESSAGES[key]["en"]
    return text.format(**values) if values else text


def kilometres(value: float, lang: str) -> str:
    return f"{round(value):,}".replace(",", " ") + " " + UNIT.get(lang, "km")


# Service names, in the three languages. The owner's own words are never rewritten: a description is translated only
# when all of it is made of these terms (plus numbers like 5W-30 and joiners like commas), so nothing is half translated.
# The same glossary lives in apps/mobile/components/serviceTerms.ts; keep the two in step.
TERMS: list[tuple[list[str], str, str]] = [
    (["Oil change"], "Смяна на масло", "Замена масла"),
    (["Engine oil change"], "Смяна на моторно масло", "Замена моторного масла"),
    (["Engine oil"], "Моторно масло", "Моторное масло"),
    (["Oil filter"], "Маслен филтър", "Масляный фильтр"),
    (["Air filter"], "Въздушен филтър", "Воздушный фильтр"),
    (["Cabin filter"], "Поленов филтър", "Салонный фильтр"),
    (["Fuel filter"], "Горивен филтър", "Топливный фильтр"),
    (["Brake pads"], "Спирачни накладки", "Тормозные колодки"),
    (["Brake discs", "Brake disks"], "Спирачни дискове", "Тормозные диски"),
    (["Brake fluid"], "Спирачна течност", "Тормозная жидкость"),
    (["Tyres", "Tires"], "Гуми", "Шины"),
    (["Tyre change", "Tire change"], "Смяна на гуми", "Замена шин"),
    (["Tyre rotation", "Tire rotation"], "Размяна на гуми", "Перестановка шин"),
    (["Wheel alignment"], "Геометрия на колелата", "Развал-схождение"),
    (["Battery"], "Акумулатор", "Аккумулятор"),
    (["Coolant"], "Охлаждаща течност", "Охлаждающая жидкость"),
    (["Timing belt"], "Ангренажен ремък", "Ремень ГРМ"),
    (["Spark plugs"], "Свещи", "Свечи"),
    (["Wipers"], "Чистачки", "Дворники"),
    (["Transmission oil", "Gearbox oil"], "Масло за скоростна кутия", "Масло в коробке передач"),
    (["Repair"], "Ремонт", "Ремонт"),
    (["Inspection"], "Проверка", "Осмотр"),
    (["Technical inspection"], "Технически преглед", "Технический осмотр"),
    (["Service"], "Обслужване", "Обслуживание"),
    (["Full service"], "Пълно обслужване", "Полное обслуживание"),
    (["Maintenance"], "Поддръжка", "Обслуживание"),
    (["Work order"], "Работна поръчка", "Заказ-наряд"),
    (["Appointment"], "Час", "Запись"),
    (["Review recorded evidence with a technician"], MESSAGES["default_title"]["bg"], MESSAGES["default_title"]["ru"]),
]  # fmt: skip

_LOOKUP: dict[str, dict[str, str]] = {}
for _en, _bg, _ru in TERMS:
    _forms = {"en": _en[0], "bg": _bg, "ru": _ru}
    for _variant in [*_en, _bg, _ru]:
        _LOOKUP.setdefault(_variant.lower(), _forms)
_TERM = re.compile(
    r"(?<![^\W\d_])("
    + "|".join(re.escape(t) for t in sorted(_LOOKUP, key=len, reverse=True))
    + r")(?![^\W\d_])",
    re.I,
)
_JOINER = re.compile(r"\s*(?:,|;|\+|&|/|\band\b|\bи\b)\s*", re.I)
_PASS = re.compile(r"[\s,;+&/.\-–]+|\b[^\W_]*\d[^\W_]*(?:-[^\W_]+)*\b")


def localize_service(text: str, lang: str) -> str:
    """The service description in `lang` when it is made only of known terms; otherwise exactly as written."""
    if not text or lang not in LANGS:
        return text
    # "Inspection: brake noise" (a task the advisor prepared): the label is translated, the owner's details are kept.
    head, colon, tail = text.partition(": ")
    if colon and head:
        done = localize_service(head, lang)
        if done != head:
            return done + colon + tail
    left = _TERM.sub("", text)
    left = re.sub(r"\band\b|\bи\b", "", left, flags=re.I)
    if _PASS.sub("", left).strip():
        return text
    if not _TERM.search(text):
        return text

    def swap(match):
        found = match.group(1)
        word = _LOOKUP[found.lower()][lang]
        return word[:1].upper() + word[1:] if found[:1].isupper() else word[:1].lower() + word[1:]

    out = _TERM.sub(swap, text)
    return re.sub(r"\band\b|\bи\b", "and" if lang == "en" else "и", out, flags=re.I)
