"""Output guard: the last line of defence behind the system prompt.

check(text) looks for buy/sell calls and price predictions in English and Spanish.
When it finds one, apply() replaces the whole answer with a refusal and a coaching
reframe (prompts.REFUSAL). It is deliberately simple and errs on the strict side: a
false positive costs one re-phrased question, a false negative could read as advice.

Matching runs on an accent-free copy of the text (so "deberías" == "deberias") with
case ignored, except for tickers, which must be written in capitals (TSLA).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from .prompts import REFUSAL

# A price-ish number: $364, 364.18, US$ 400, 400 dollars
NUM = r"(?:us\s?)?\$?\s?\d"
# Who a prediction is about: the price/stock/market or a ticker in capitals.
SUBJ_EN = r"(?:\b(?:the )?(?:price|prices|stock|stocks|shares|share price|market|it|they)\b|(?-i:\b[A-Z]{2,5}\b))"
SUBJ_ES = (r"(?:\b(?:el |la |las |los )?(?:precio|precios|accion|acciones|mercado|cotizacion|papel|titulo)\b"
           r"|(?-i:\b[A-Z]{2,5}\b))")
ADV_EN = r"(?: (?:definitely|probably|likely|surely|soon|easily|really|eventually|quickly|then|still))*"
ADV_ES = r"(?: (?:seguramente|probablemente|pronto|facilmente|definitivamente|rapidamente|ya))*"
NOT_ORDER_WORD = r"(?! (?:order|orders|ticket|tickets|fill|fills|side|signal|bracket|limit|stop|entry|price|qty|of|for))"

_RULES: list[tuple[str, str]] = [
    # ---------------------------------------------------------------- English: buy / sell calls
    ("en_should", r"\b(?:you|u) (?:should|must|need to|ought to|have to|gotta|might want to|may want to)"
                  r"(?: (?:definitely|probably|really|seriously|just|absolutely|totally|consider|go ahead and))*"
                  r" (?:buy|buying|sell|selling|short|shorting|go long|go short|hold|keep holding|load up"
                  r"|pull the trigger|take (?:this|the|that) trade|jump in|average down)\b"),
    ("en_recommend", r"\b(?:i|we)(?: would|'d| d)? (?:strongly )?(?:recommend|suggest|advise|say)(?: that)?(?: you)?"
                     r" (?:buy|buying|sell|selling|short|shorting|go long|going long|go short|going short"
                     r"|hold|holding|load|loading|take|taking)\b"),
    ("en_my_advice", r"\b(?:my|our) (?:advice|recommendation|suggestion|call|pick|take)(?: here)?(?: is| would be)?"
                     r"(?: to)?(?: just)? (?:buy|sell|short|go long|go short|hold|get in)\b"),
    ("en_i_would", r"\bi(?: would|'d| d)(?: definitely| probably| personally)? (?:buy|sell|short|go long|go short"
                   r"|load up|get in|hold)\b"),
    ("en_now", r"\b(?:buy|sell|short|get in|get out|jump in|enter|load up)(?: it| this| that| (?-i:[A-Z]{2,5}))?"
               r" (?:now|right now|immediately|asap|at the open|at market|before it'?s too late)\b"),
    ("en_good_time", r"\b(?:good|great|perfect|ideal|right|best|safe|smart) (?:time|moment|entry|spot|place|price"
                     r"|opportunity|day) to (?:buy|sell|short|get in|enter|load up|go long|go short)\b"),
    ("en_is_a_buy", r"\b(?:is|looks like|looks|seems like) (?:a |an )?(?:strong |clear |good |great |solid |obvious "
                    r"|no-brainer )?(?:buy|sell|short)\b" + NOT_ORDER_WORD),
    ("en_rating", r"\b(?:strong|clear|obvious) (?:buy|sell)\b" + NOT_ORDER_WORD + r"|\b(?:buy|sell) (?:rating|call)\b"),
    ("en_all_in", r"\b(?:go|going|went) all[- ]in\b|\bload up on\b|\bbuy the dip\b|\bbuy more\b|\bsell everything\b"),
    # ---------------------------------------------------------------- English: price predictions
    ("en_pred_level", SUBJ_EN + r".{0,30}?\b(?:will|is going to|are going to|gonna|is likely to|are likely to"
                      r"|is expected to|should|could|might|is set to|is poised to|is bound to|is headed|is heading)"
                      + ADV_EN + r" (?:reach|hit|touch|rise to|climb to|fall to|drop to|sink to|go to|go up to"
                      r"|go down to|trade at|trade above|trade below|trade around|test|break(?: above| below)?"
                      r"|get to|close above|close below|top out at|bottom (?:out )?at|be at|be around|be above"
                      r"|be below|be worth|rally to|run to|jump to|move to)(?: around| about| near| above| below"
                      r"| at| to)* " + NUM),
    ("en_pred_dir", SUBJ_EN + r".{0,30}?\b(?:will|is going to|are going to|gonna|is likely to|are likely to"
                    r"|is expected to|is set to|is poised to|is bound to|is about to)" + ADV_EN +
                    r" (?:go up|go down|rise|fall|drop|rally|crash|climb|bounce|recover|surge|soar|plunge|tank"
                    r"|moon|break out|pump|dump|explode|skyrocket|rip|keep (?:rising|falling|going up|going down)"
                    r"|move (?:up|down|higher|lower)|head (?:up|down|higher|lower)|go higher|go lower)\b"),
    ("en_target", r"\b(?:my|our|a reasonable|a realistic|a fair|the next|your) (?:price target|target price"
                  r"|price objective)\b|\b(?:upside|downside) (?:to|of) " + NUM),
    # ---------------------------------------------------------------- Spanish: compra / venta
    ("es_deberias", r"\b(?:deberias|deberia usted|tienes que|te conviene|conviene|seria bueno|lo mejor es|lo mejor seria"
                    r"|lo ideal es|debes|hay que)(?: (?:definitivamente|ya|ahora|mejor|considerar|pensar en|de))*"
                    r" (?:comprar|vender|comprarla|venderla|comprarlo|venderlo|comprarlas|venderlas|ponerte en corto"
                    r"|ir en corto|ir largo|cargar|meterte|apostar|aguantar|promediar a la baja)\b"),
    ("es_recomiendo", r"\b(?:te|le|les)? ?(?:recomiendo|recomendaria|sugiero|sugeriria|aconsejo|aconsejaria)(?: que)?"
                      r"(?: (?:definitivamente|ya|ahora))? (?:compres|vendas|comprar|vender|entres|entrar|abras|abrir"
                      r"|aguantes|mantengas la posicion|te pongas en corto|ponerte en corto)\b"),
    ("es_yo", r"\b(?:yo|en tu lugar|si yo fuera tu|si fuera tu|personalmente)\b.{0,20}?\b(?:compraria|venderia"
              r"|entraria|me pondria en corto|aguantaria)\b"),
    ("es_ya", r"\b(?:compra|vende|compralo|compralas|compralos|vendelo|vendelas|vendelos|entra|metete|ponte en corto)"
              r"(?: (?-i:[A-Z]{2,5}))? (?:ya|ahora|ahorita|de inmediato|inmediatamente|hoy mismo|en la apertura"
              r"|antes de que sea tarde)\b"),
    ("es_momento", r"\b(?:buen|gran|excelente|mejor|el|un) (?:momento|punto|precio|dia) (?:para|de) (?:comprar|vender"
                   r"|entrar|ponerse en corto|ponerte en corto|cargar)\b|\bmomento ideal para (?:comprar|vender|entrar)\b"),
    ("es_es_compra", r"\bes (?:una )?(?:buena |clara |excelente |gran |obvia )?(?:compra|venta)\b"
                     r"(?! (?:de|del|manual|limitada|a mercado|bracket|en papel))"),
    ("es_rating", r"\brecomendacion de (?:compra|venta)\b|\b(?:compra|venta) (?:clara|fuerte|segura)\b"
                  r"|\bcompra (?:la caida|el bajon|mas)\b|\bvende todo\b|\ba todo o nada\b"
                  r"|\b(?:metele|mete|ve con|apuesta|invierte) todo\b"
                  r"|\bmi (?:consejo|recomendacion|sugerencia) (?:es|seria)(?: que)? (?:comprar|vender|compres|vendas"
                  r"|entrar|entres|aguantar|aguantes)\b"),
    # ---------------------------------------------------------------- Spanish: predicciones de precio
    ("es_pred_level", SUBJ_ES + r".{0,30}?\b(?:va a|van a|podria|podrian|deberia|deberian|puede|pueden|seguramente"
                      r"|probablemente|esta por|estaria)" + ADV_ES + r" (?:llegar|subir|bajar|caer|alcanzar|tocar"
                      r"|romper|cotizar|cerrar por encima de|cerrar por debajo de|rebotar|repuntar|irse|estar|valer"
                      r"|terminar|ubicarse)"
                      r"(?: (?:a|hasta|en|los|las|por|cerca de|alrededor de|arriba de|encima de|debajo de|unos))* "
                      + NUM),
    ("es_pred_future", SUBJ_ES + r".{0,30}?\b(?:subira|bajara|llegara|alcanzara|caera|tocara|rompera|cotizara"
                       r"|repuntara|rebotara|se disparara|se desplomara|se recuperara|ira a|valdra)\b"),
    ("es_pred_dir", SUBJ_ES + r".{0,30}?\b(?:va a|van a|esta por|estan por)" + ADV_ES +
                    r" (?:subir|bajar|caer|repuntar|rebotar|dispararse|desplomarse|recuperarse|explotar"
                    r"|seguir subiendo|seguir bajando)\b"),
    ("es_target", r"\b(?:mi|nuestro|un|el proximo|tu) (?:precio objetivo|objetivo de precio)\b"
                  r"|\b(?:potencial de subida|potencial alcista|potencial de bajada) (?:a|de|hasta) " + NUM),
]

# A sentence that reports what an analyst / a headline said is news, not our own call.
_REPORTED = re.compile(r"\b(?:analyst|analysts|analista|analistas|headline|titular|titulares|upgrade|downgrade"
                       r"|raised|raises|cut|cuts|lowered|lowers|eleva|elevo|recorta|recorto|reduce|redujo|firma"
                       r"|according to|segun)\b", re.I)
_REPORTABLE = {"en_rating", "en_target", "es_rating", "es_target"}

_COMPILED = [(name, re.compile(rx, re.I)) for name, rx in _RULES]
_SENTENCE = re.compile(r"(?<=[.!?¿¡\n])\s+|\n+")


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFKD", text or "")
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.replace("\u2019", "'").replace("\u2018", "'").replace("`", "'")
    t = re.sub(r"[*_]{1,3}", "", t)  # **bold** / _italics_ must not hide a phrase
    return re.sub(r"[ \t]+", " ", t)


def check(text: str) -> list[str]:
    """Names of the rules the text breaks (empty = clean)."""
    hits: list[str] = []
    for sentence in _SENTENCE.split(normalize(text)):
        if not sentence.strip():
            continue
        reported = bool(_REPORTED.search(sentence))
        for name, rx in _COMPILED:
            if name in hits or (reported and name in _REPORTABLE):
                continue
            if rx.search(sentence):
                hits.append(name)
    return hits


@dataclass
class Guarded:
    text: str
    blocked: bool
    rules: list[str]


def apply(text: str, lang: str) -> Guarded:
    rules = check(text)
    if rules:
        return Guarded(REFUSAL.get(lang, REFUSAL["en"]), True, rules)
    return Guarded(text, False, [])
